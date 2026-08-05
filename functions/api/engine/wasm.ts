import firmsEngineModule from '../../wasm/firms_engine.wasm';
import type { Bounds, Detection } from './domain';

const RECORD_STRIDE = 64;
const PADDING_DEGREES = 0.02;
const MAX_SPAN_DEGREES = 4;

export interface FirmsExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  firms_input(): number;
  firms_input_capacity(): number;
  firms_reset(): void;
  firms_ingest_csv(byteLength: number): number;
  firms_finalize(west: number, south: number, east: number, north: number, padding: number, maxSpan: number): number;
  firms_records(): number;
  firms_count(): number;
  firms_record_stride(): number;
  firms_bound(index: number): number;
}

export function createEngine(): FirmsExports {
  const exports = new WebAssembly.Instance(firmsEngineModule, {}).exports;
  if (!(exports.memory instanceof WebAssembly.Memory)
    || typeof exports.firms_input !== 'function'
    || typeof exports.firms_finalize !== 'function') {
    throw new Error('FIRMS WASM engine ABI mismatch.');
  }
  return exports as FirmsExports;
}

function responseBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error('FIRMS response body is empty.');
  return response.body;
}

function validateDeclaredLength(response: Response, capacity: number): void {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > capacity) {
    throw new Error(`FIRMS CSV exceeds WASM input capacity (${declaredLength} > ${capacity}).`);
  }
}

async function copyResponseBody(
  body: ReadableStream<Uint8Array>,
  engine: FirmsExports,
  capacity: number
): Promise<number> {
  const inputOffset = engine.firms_input();
  let offset = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > capacity) {
        await reader.cancel('FIRMS CSV exceeds WASM input capacity.');
        throw new Error('FIRMS CSV exceeds WASM input capacity.');
      }
      new Uint8Array(engine.memory.buffer, inputOffset + offset, value.byteLength).set(value);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return offset;
}

function validateIngestResult(result: number): void {
  if (result < 0) {
    const reasons: Record<number, string> = {
      [-1]: 'invalid input size',
      [-2]: 'required CSV columns missing',
      [-3]: 'detection capacity exceeded'
    };
    throw new Error(`FIRMS WASM parse failed: ${reasons[result] ?? `code ${result}`}.`);
  }
}

export async function ingestResponse(response: Response, engine: FirmsExports): Promise<void> {
  const body = responseBody(response);
  const capacity = engine.firms_input_capacity();
  validateDeclaredLength(response, capacity);
  const offset = await copyResponseBody(body, engine, capacity);
  validateIngestResult(engine.firms_ingest_csv(offset));
}

function fixedString(bytes: Uint8Array, offset: number, capacity: number): string {
  let end = offset;
  const limit = offset + capacity;
  while (end < limit && bytes[end] !== 0) ++end;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

export function readDetections(engine: FirmsExports): Detection[] {
  const count = engine.firms_count();
  const stride = engine.firms_record_stride();
  if (stride !== RECORD_STRIDE) throw new Error(`FIRMS WASM record stride mismatch (${stride}).`);
  const pointer = engine.firms_records();
  const view = new DataView(engine.memory.buffer, pointer, count * stride);
  const bytes = new Uint8Array(engine.memory.buffer, pointer, count * stride);
  const detections: Detection[] = [];
  for (let index = 0; index < count; ++index) {
    const offset = index * stride;
    const optionalFloat = (position: number): number | null => {
      const value = view.getFloat32(offset + position, true);
      return Number.isFinite(value) ? value : null;
    };
    detections.push({
      lat: view.getFloat64(offset, true),
      lon: view.getFloat64(offset + 8, true),
      observedAtMs: Number(view.getBigInt64(offset + 16, true)),
      frp: optionalFloat(24),
      brightTi4: optionalFloat(28),
      brightTi5: optionalFloat(32),
      satellite: fixedString(bytes, offset + 36, 8),
      instrument: fixedString(bytes, offset + 44, 8),
      confidence: fixedString(bytes, offset + 52, 8),
      dayNight: fixedString(bytes, offset + 60, 2)
    });
  }
  return detections;
}

export function finalizeEngine(engine: FirmsExports, bounds: Bounds): { detections: Detection[]; bounds: Bounds } {
  engine.firms_finalize(...bounds, PADDING_DEGREES, MAX_SPAN_DEGREES);
  return {
    detections: readDetections(engine),
    bounds: [0, 1, 2, 3].map((index) => engine.firms_bound(index)) as Bounds
  };
}
