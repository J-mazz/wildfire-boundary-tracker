import firmsEngineModule from '../../wasm/firms_engine.wasm';
import {
  PERSISTENCE_HOURS,
  type Bounds,
  type Detection,
  type FirmsTimeline,
  type FrameRange
} from './domain';

const RECORD_STRIDE = 64;
const QUERY_FRAME_STRIDE = 8;
const QUERY_RESULT_STRIDE = 16;
const NO_OBSERVATION = -(1n << 63n);
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
  firms_query_frames(): number;
  firms_query_frame_capacity(): number;
  firms_query_frame_stride(): number;
  firms_query_results(): number;
  firms_query_result_count(): number;
  firms_query_result_stride(): number;
  firms_query_coverage(frameCount: number, persistenceHours: number): number;
  firms_query_range(persistenceHours: number): number;
}

export function createEngine(): FirmsExports {
  const exports = new WebAssembly.Instance(firmsEngineModule, {}).exports;
  if (!(exports.memory instanceof WebAssembly.Memory)
    || typeof exports.firms_input !== 'function'
    || typeof exports.firms_input_capacity !== 'function'
    || typeof exports.firms_reset !== 'function'
    || typeof exports.firms_ingest_csv !== 'function'
    || typeof exports.firms_finalize !== 'function'
    || typeof exports.firms_records !== 'function'
    || typeof exports.firms_count !== 'function'
    || typeof exports.firms_record_stride !== 'function'
    || typeof exports.firms_bound !== 'function'
    || typeof exports.firms_query_frames !== 'function'
    || typeof exports.firms_query_frame_capacity !== 'function'
    || typeof exports.firms_query_frame_stride !== 'function'
    || typeof exports.firms_query_results !== 'function'
    || typeof exports.firms_query_result_count !== 'function'
    || typeof exports.firms_query_result_stride !== 'function'
    || typeof exports.firms_query_coverage !== 'function'
    || typeof exports.firms_query_range !== 'function') {
    throw new Error('FIRMS WASM engine ABI mismatch.');
  }
  return exports as FirmsExports;
}

function checkedRegion(
  memory: WebAssembly.Memory,
  pointer: number,
  count: number,
  stride: number,
  label: string
): number {
  if (!Number.isInteger(pointer) || pointer < 0
    || !Number.isInteger(count) || count < 0
    || !Number.isInteger(stride) || stride <= 0
    || count > Math.floor((memory.buffer.byteLength - pointer) / stride)) {
    throw new Error(`FIRMS WASM ${label} memory region is invalid.`);
  }
  return count * stride;
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
  checkedRegion(engine.memory, inputOffset, capacity, 1, 'input');
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
  const byteLength = checkedRegion(engine.memory, pointer, count, stride, 'records');
  const view = new DataView(engine.memory.buffer, pointer, byteLength);
  const bytes = new Uint8Array(engine.memory.buffer, pointer, byteLength);
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

function validateFrame(frame: number): void {
  if (!Number.isSafeInteger(frame)) throw new Error(`FIRMS timeline frame is not a safe integer (${frame}).`);
}

function validatePersistence(persistenceHours: number): void {
  if (!Number.isInteger(persistenceHours) || persistenceHours < 0 || persistenceHours > 0xffff_ffff) {
    throw new Error(`FIRMS timeline persistence is invalid (${persistenceHours}).`);
  }
}

function writeFrames(engine: FirmsExports, frameTimes: readonly number[]): void {
  const capacity = engine.firms_query_frame_capacity();
  const stride = engine.firms_query_frame_stride();
  if (stride !== QUERY_FRAME_STRIDE) throw new Error(`FIRMS WASM query frame stride mismatch (${stride}).`);
  if (frameTimes.length > capacity) {
    throw new Error(`FIRMS timeline query exceeds frame capacity (${frameTimes.length} > ${capacity}).`);
  }
  const pointer = engine.firms_query_frames();
  const byteLength = checkedRegion(engine.memory, pointer, frameTimes.length, stride, 'query frames');
  const view = new DataView(engine.memory.buffer, pointer, byteLength);
  frameTimes.forEach((frame, index) => {
    validateFrame(frame);
    view.setBigInt64(index * stride, BigInt(frame), true);
  });
}

function queryFailure(status: number): Error {
  const reasons: Record<number, string> = {
    [-1]: 'scratch storage unavailable',
    [-2]: 'records were not finalized',
    [-3]: 'frame capacity exceeded',
    [-4]: 'frames must be sorted cadence boundaries',
    [-5]: 'timestamp arithmetic overflow'
  };
  return new Error(`FIRMS WASM timeline query failed: ${reasons[status] ?? `code ${status}`}.`);
}

function readRanges(engine: FirmsExports, expectedCount: number): FrameRange[] {
  const count = engine.firms_query_result_count();
  const stride = engine.firms_query_result_stride();
  if (count !== expectedCount) throw new Error(`FIRMS WASM query result count mismatch (${count}).`);
  if (stride !== QUERY_RESULT_STRIDE) throw new Error(`FIRMS WASM query result stride mismatch (${stride}).`);
  const pointer = engine.firms_query_results();
  const byteLength = checkedRegion(engine.memory, pointer, count, stride, 'query results');
  const view = new DataView(engine.memory.buffer, pointer, byteLength);
  return Array.from({ length: count }, (_, index): FrameRange => {
    const offset = index * stride;
    const newest = view.getBigInt64(offset, true);
    const beginIndex = view.getUint32(offset + 8, true);
    const featureCount = view.getUint32(offset + 12, true);
    if (beginIndex > engine.firms_count() || featureCount > engine.firms_count() - beginIndex) {
      throw new Error('FIRMS WASM query result is outside the finalized record range.');
    }
    return {
      beginIndex,
      featureCount,
      newestObservedAt: newest === NO_OBSERVATION
        ? null
        : new Date(Number(newest)).toISOString().replace(/\.\d{3}Z$/, 'Z')
    };
  });
}

export function createTimeline(engine: FirmsExports): FirmsTimeline {
  return {
    coverage(frameTimes, persistenceHours = PERSISTENCE_HOURS) {
      validatePersistence(persistenceHours);
      writeFrames(engine, frameTimes);
      const status = engine.firms_query_coverage(frameTimes.length, persistenceHours);
      if (status < 0) throw queryFailure(status);
      if (status !== frameTimes.length) throw new Error(`FIRMS WASM coverage count mismatch (${status}).`);
      return readRanges(engine, frameTimes.length).map(({ featureCount, newestObservedAt }) => ({
        featureCount,
        newestObservedAt
      }));
    },
    range(frameTime, persistenceHours = PERSISTENCE_HOURS) {
      validatePersistence(persistenceHours);
      writeFrames(engine, [frameTime]);
      const status = engine.firms_query_range(persistenceHours);
      if (status < 0) throw queryFailure(status);
      if (status !== 1) throw new Error(`FIRMS WASM range count mismatch (${status}).`);
      return readRanges(engine, 1)[0]!;
    }
  };
}

export function finalizeEngine(
  engine: FirmsExports,
  bounds: Bounds
): { detections: Detection[]; timeline: FirmsTimeline; bounds: Bounds } {
  engine.firms_finalize(...bounds, PADDING_DEGREES, MAX_SPAN_DEGREES);
  return {
    detections: readDetections(engine),
    timeline: createTimeline(engine),
    bounds: [0, 1, 2, 3].map((index) => engine.firms_bound(index)) as Bounds
  };
}
