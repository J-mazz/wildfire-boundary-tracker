import maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';

interface GeosplatMeta {
  bounds: [number, number, number, number];
  grid: [number, number];
  minHeightMeters: number;
  maxHeightMeters: number;
  url: string;
}

interface WildfireWasm {
  _ext_allocate_wasm_buffer(size: number): number;
  _ext_free_wasm_buffer(ptr: number): void;
  _geosplat_decode(ptr: number, length: number): number;
  _geosplat_data(): number;
  _geosplat_count(): number;
  _geosplat_floats_per_splat(): number;
  _geosplat_release(): void;
  HEAPU8: Uint8Array;
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_mercOrigin;
uniform vec2 u_mercSpan;
uniform float u_metersToMerc;
uniform float u_radiusMeters;
in vec2 a_corner;
in vec3 a_gridPos;   // u, v, heightMeters
in vec3 a_color;
in vec3 a_normal;    // ENU: x east, y north, z up
out vec2 v_corner;
out vec3 v_color;
out vec3 v_normal;
void main() {
  vec3 n = normalize(a_normal);
  vec3 helper = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(helper, n));
  vec3 t2 = cross(n, t1);
  vec3 offsetEnu = (t1 * a_corner.x + t2 * a_corner.y) * u_radiusMeters;
  vec3 base = vec3(
    u_mercOrigin.x + a_gridPos.x * u_mercSpan.x,
    u_mercOrigin.y + a_gridPos.y * u_mercSpan.y,
    a_gridPos.z * u_metersToMerc
  );
  // ENU -> mercator: east = +x, north = -y (mercator y grows southward), up = +z.
  vec3 world = base + vec3(offsetEnu.x, -offsetEnu.y, offsetEnu.z) * u_metersToMerc;
  v_corner = a_corner;
  v_color = a_color;
  v_normal = n;
  gl_Position = u_matrix * vec4(world, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec3 v_color;
in vec3 v_normal;
out vec4 fragColor;
void main() {
  float r2 = dot(v_corner, v_corner);
  float falloff = exp(-4.0 * r2);
  if (falloff < 0.22) discard;
  vec3 light = normalize(vec3(-0.45, 0.4, 0.8));
  float diffuse = max(dot(normalize(v_normal), light), 0.0);
  vec3 shaded = v_color * (0.45 + 0.65 * diffuse);
  fragColor = vec4(shaded, 1.0);
}`;

function compileProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create geosplat shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Geosplat shader compile failed: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create geosplat program.');
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Geosplat program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
  }
  return program;
}

export class GeosplatLayer implements CustomLayerInterface {
  readonly id = 'wildfire-geosplat';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  enabled = false;

  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceCount = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private mercOrigin: [number, number] = [0, 0];
  private mercSpan: [number, number] = [0, 0];
  private metersToMerc = 0;
  private radiusMeters = 0;

  constructor(
    private readonly meta: GeosplatMeta,
    private readonly instances: Float32Array,
    private readonly floatsPerSplat: number
  ) {
    this.instanceCount = instances.length / floatsPerSplat;
  }

  static async load(metadataUrl: string, onError: (message: string) => void): Promise<GeosplatLayer | null> {
    try {
      const resolvedMetadataUrl = new URL(metadataUrl, window.location.href);
      const metaResponse = await fetch(resolvedMetadataUrl, { cache: 'no-cache' });
      if (!metaResponse.ok) throw new Error(`Geosplat metadata returned ${metaResponse.status}.`);
      const meta = (await metaResponse.json()) as GeosplatMeta;
      const payloadUrl = new URL(meta.url, resolvedMetadataUrl);

      // Resolved at runtime relative to the bundle; the module ships as a static asset.
      const wasmSpecifier = './wasm/wildfire.js';
      const [factory, payload] = await Promise.all([
        import(wasmSpecifier).then((module) => module.default as () => Promise<unknown>),
        fetch(payloadUrl, { cache: 'no-cache' }).then(async (response) => {
          if (!response.ok) throw new Error(`Geosplat payload returned ${response.status}.`);
          return new Uint8Array(await response.arrayBuffer());
        })
      ]);
      const wasm = (await factory()) as WildfireWasm;

      const ptr = wasm._ext_allocate_wasm_buffer(payload.byteLength);
      if (ptr === 0) throw new Error('WASM allocation for geosplat payload failed.');
      wasm.HEAPU8.set(payload, ptr);
      const count = wasm._geosplat_decode(ptr, payload.byteLength);
      wasm._ext_free_wasm_buffer(ptr);
      if (count === 0) throw new Error('Geosplat payload failed to decode.');

      const floatsPerSplat = wasm._geosplat_floats_per_splat();
      const dataPtr = wasm._geosplat_data();
      const view = new Float32Array(wasm.HEAPU8.buffer, dataPtr, count * floatsPerSplat);
      const instances = view.slice();
      wasm._geosplat_release();

      return new GeosplatLayer(meta, instances, floatsPerSplat);
    } catch (error) {
      onError(`Terrain view unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new Error('Geosplat terrain requires a WebGL2 context.');
    }
    this.map = map;
    const [west, south, east, north] = this.meta.bounds;
    const northWest = maplibregl.MercatorCoordinate.fromLngLat({ lng: west, lat: north });
    const southEast = maplibregl.MercatorCoordinate.fromLngLat({ lng: east, lat: south });
    this.mercOrigin = [northWest.x, northWest.y];
    this.mercSpan = [southEast.x - northWest.x, southEast.y - northWest.y];
    this.metersToMerc = northWest.meterInMercatorCoordinateUnits();
    const widthMeters = (east - west) * 111_320 * Math.cos(((south + north) / 2) * (Math.PI / 180));
    this.radiusMeters = (widthMeters / this.meta.grid[0]) * 1.2;

    this.program = compileProgram(gl);
    for (const name of ['u_matrix', 'u_mercOrigin', 'u_mercSpan', 'u_metersToMerc', 'u_radiusMeters']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const cornerLocation = gl.getAttribLocation(this.program, 'a_corner');
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);

    const instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances, gl.STATIC_DRAW);
    const stride = this.floatsPerSplat * 4;
    const attributes: Array<[string, number, number]> = [
      ['a_gridPos', 3, 0],
      ['a_color', 3, 12],
      ['a_normal', 3, 24]
    ];
    for (const [name, size, offset] of attributes) {
      const location = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    }

    gl.bindVertexArray(null);
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (gl instanceof WebGL2RenderingContext) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.program = null;
    this.vao = null;
    this.map = null;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!(gl instanceof WebGL2RenderingContext)) return;
    if (!this.enabled || !this.program || !this.vao || this.instanceCount === 0) return;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms['u_matrix']!, false, options.modelViewProjectionMatrix as Float32Array);
    gl.uniform2f(this.uniforms['u_mercOrigin']!, this.mercOrigin[0], this.mercOrigin[1]);
    gl.uniform2f(this.uniforms['u_mercSpan']!, this.mercSpan[0], this.mercSpan[1]);
    gl.uniform1f(this.uniforms['u_metersToMerc']!, this.metersToMerc);
    gl.uniform1f(this.uniforms['u_radiusMeters']!, this.radiusMeters);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
    gl.bindVertexArray(null);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.map?.triggerRepaint();
  }
}
