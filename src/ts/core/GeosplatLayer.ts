import maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';
import { fetchWithTimeout } from '../network/fetch';

interface GeosplatMeta {
  bounds: [number, number, number, number];
  grid: [number, number];
  minHeightMeters: number;
  maxHeightMeters: number;
  url: string;
}

export interface WildfireWasm {
  _ext_allocate_wasm_buffer(size: number): number;
  _ext_free_wasm_buffer(ptr: number): void;
  _geosplat_decode(ptr: number, length: number): number;
  _geosplat_data(): number;
  _geosplat_count(): number;
  _geosplat_floats_per_splat(): number;
  _geosplat_generation(): number;
  _geosplat_release_generation(generation: number): number;
  _geosplat_release(): void;
  HEAPU8: Uint8Array;
}

interface DecodedInstances {
  readonly count: number;
  upload(gl: WebGL2RenderingContext): void;
  dispose(): void;
}

class ArrayDecodedInstances implements DecodedInstances {
  readonly count: number;

  constructor(
    private readonly instances: Float32Array,
    floatsPerSplat: number
  ) {
    this.count = instances.length / floatsPerSplat;
  }

  upload(gl: WebGL2RenderingContext): void {
    gl.bufferData(gl.ARRAY_BUFFER, this.instances, gl.STATIC_DRAW);
  }

  dispose(): void {}
}

export class WasmDecodedInstances implements DecodedInstances {
  readonly count: number;
  private released = false;
  private readonly generation: number;

  constructor(
    private readonly wasm: WildfireWasm,
    private readonly dataPtr: number,
    count: number,
    private readonly floatsPerSplat: number
  ) {
    if (!Number.isSafeInteger(count) || count <= 0
      || !Number.isSafeInteger(floatsPerSplat) || floatsPerSplat <= 0
      || !Number.isSafeInteger(dataPtr) || dataPtr <= 0 || dataPtr % 4 !== 0) {
      throw new Error('WASM geosplat output descriptor is invalid.');
    }
    this.count = count;
    this.generation = wasm._geosplat_generation();
    if (!Number.isSafeInteger(this.generation) || this.generation <= 0) {
      throw new Error('WASM geosplat ownership generation is invalid.');
    }
  }

  upload(gl: WebGL2RenderingContext): void {
    if (this.released) throw new Error('WASM geosplat output was already released.');
    if (this.wasm._geosplat_generation() !== this.generation) {
      throw new Error('WASM geosplat output ownership is stale.');
    }
    const floatCount = this.count * this.floatsPerSplat;
    if (!Number.isSafeInteger(floatCount) || floatCount <= 0) {
      throw new Error('WASM geosplat output length overflows safe integer range.');
    }
    const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
    const heap = this.wasm.HEAPU8;
    const end = this.dataPtr + byteLength;
    if (!Number.isSafeInteger(byteLength) || !Number.isSafeInteger(end) || end > heap.byteLength) {
      throw new Error('WASM geosplat output exceeds linear memory.');
    }
    const view = new Float32Array(heap.buffer, this.dataPtr, floatCount);
    gl.bufferData(gl.ARRAY_BUFFER, view, gl.STATIC_DRAW);
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.wasm._geosplat_release_generation(this.generation);
  }
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
      const message = gl.getShaderInfoLog(shader) ?? 'unknown';
      gl.deleteShader(shader);
      throw new Error(`Geosplat shader compile failed: ${message}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create geosplat program.');
  const shaders: WebGLShader[] = [];
  try {
    shaders.push(compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    shaders.push(compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Geosplat program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
    }
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
  return program;
}

function validMeta(value: unknown): value is GeosplatMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  return Array.isArray(meta.bounds) && meta.bounds.length === 4 && meta.bounds.every(Number.isFinite)
    && Array.isArray(meta.grid) && meta.grid.length === 2
    && meta.grid.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry > 0)
    && typeof meta.minHeightMeters === 'number' && Number.isFinite(meta.minHeightMeters)
    && typeof meta.maxHeightMeters === 'number' && Number.isFinite(meta.maxHeightMeters)
    && typeof meta.url === 'string' && meta.url.length > 0;
}

export class GeosplatLayer implements CustomLayerInterface {
  readonly id = 'wildfire-geosplat';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  enabled = false;

  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private instanceCount = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private mercOrigin: [number, number] = [0, 0];
  private mercSpan: [number, number] = [0, 0];
  private metersToMerc = 0;
  private radiusMeters = 0;

  constructor(
    private readonly meta: GeosplatMeta,
    instances: Float32Array | WasmDecodedInstances,
    private readonly floatsPerSplat: number
  ) {
    this.decoded = instances instanceof WasmDecodedInstances
      ? instances
      : new ArrayDecodedInstances(instances, floatsPerSplat);
    this.instanceCount = this.decoded.count;
  }

  private readonly decoded: DecodedInstances;

  static async load(metadataUrl: string, onError: (message: string) => void): Promise<GeosplatLayer | null> {
    try {
      const resolvedMetadataUrl = new URL(metadataUrl, window.location.href);
      const metaResponse = await fetchWithTimeout(resolvedMetadataUrl, { cache: 'no-cache' });
      if (!metaResponse.ok) throw new Error(`Geosplat metadata returned ${metaResponse.status}.`);
      const meta: unknown = await metaResponse.json();
      if (!validMeta(meta)) throw new Error('Geosplat metadata is invalid.');
      const payloadUrl = new URL(meta.url, resolvedMetadataUrl);

      // Resolved at runtime relative to the bundle; the module ships as a static asset.
      const wasmSpecifier = './wasm/wildfire.js';
      const [factory, payload] = await Promise.all([
        import(wasmSpecifier).then((module) => module.default as () => Promise<unknown>),
        fetchWithTimeout(payloadUrl, { cache: 'no-cache' }).then(async (response) => {
          if (!response.ok) throw new Error(`Geosplat payload returned ${response.status}.`);
          return new Uint8Array(await response.arrayBuffer());
        })
      ]);
      const wasm = (await factory()) as WildfireWasm;

      const ptr = wasm._ext_allocate_wasm_buffer(payload.byteLength);
      if (ptr === 0) throw new Error('WASM allocation for geosplat payload failed.');
      let count = 0;
      try {
        wasm.HEAPU8.set(payload, ptr);
        count = wasm._geosplat_decode(ptr, payload.byteLength);
      } finally {
        wasm._ext_free_wasm_buffer(ptr);
      }
      if (count === 0) throw new Error('Geosplat payload failed to decode.');

      const floatsPerSplat = wasm._geosplat_floats_per_splat();
      const dataPtr = wasm._geosplat_data();
      try {
        return new GeosplatLayer(
          meta,
          new WasmDecodedInstances(wasm, dataPtr, count, floatsPerSplat),
          floatsPerSplat
        );
      } catch (error) {
        wasm._geosplat_release();
        throw error;
      }
    } catch (error) {
      onError(`Terrain view unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new Error('Geosplat terrain requires a WebGL2 context.');
    }
    if (this.program || this.vao || this.buffers.length > 0) this.deleteGlResources(gl);
    this.map = map;
    try {
      const [west, south, east, north] = this.meta.bounds;
      const northWest = maplibregl.MercatorCoordinate.fromLngLat({ lng: west, lat: north });
      const southEast = maplibregl.MercatorCoordinate.fromLngLat({ lng: east, lat: south });
      this.mercOrigin = [northWest.x, northWest.y];
      this.mercSpan = [southEast.x - northWest.x, southEast.y - northWest.y];
      this.metersToMerc = northWest.meterInMercatorCoordinateUnits();
      const widthMeters = (east - west) * 111_320 * Math.cos(((south + north) / 2) * (Math.PI / 180));
      this.radiusMeters = (widthMeters / this.meta.grid[0]) * 1.2;
      this.createGlResources(gl);
    } catch (error) {
      this.deleteGlResources(gl);
      this.map = null;
      throw error;
    }
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (gl instanceof WebGL2RenderingContext) this.deleteGlResources(gl);
    this.dispose();
    this.map = null;
  }

  dispose(): void {
    this.decoded.dispose();
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

  private createGlResources(gl: WebGL2RenderingContext): void {
    this.program = compileProgram(gl);
    for (const name of ['u_matrix', 'u_mercOrigin', 'u_mercSpan', 'u_metersToMerc', 'u_radiusMeters']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.vao = gl.createVertexArray();
    if (!this.vao) throw new Error('Failed to create geosplat vertex array.');
    gl.bindVertexArray(this.vao);

    const cornerBuffer = gl.createBuffer();
    if (!cornerBuffer) throw new Error('Failed to create geosplat corner buffer.');
    this.buffers.push(cornerBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const cornerLocation = gl.getAttribLocation(this.program, 'a_corner');
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);

    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) throw new Error('Failed to create geosplat instance buffer.');
    this.buffers.push(instanceBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    this.decoded.upload(gl);
    const stride = this.floatsPerSplat * 4;
    for (const [name, size, offset] of [
      ['a_gridPos', 3, 0],
      ['a_color', 3, 12],
      ['a_normal', 3, 24]
    ] as Array<[string, number, number]>) {
      const location = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
  }

  private deleteGlResources(gl: WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    this.program = null;
    this.vao = null;
    this.buffers = [];
    this.uniforms = {};
  }
}
