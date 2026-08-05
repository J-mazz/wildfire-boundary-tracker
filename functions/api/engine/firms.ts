import { fetchUpstream, logDegraded } from '../_http';
import { firmsBatchCacheRequest } from './cache';
import { quantizeBounds } from './calculations';
import { MAX_HISTORY_DAYS, type Bounds, type Defer, type DetectionResult } from './domain';
import { createEngine, finalizeEngine, ingestResponse, type FirmsExports } from './wasm';

const FIRMS_AREA = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;
const BATCH_DAYS = 4;

interface Batch {
  start: string;
  length: number;
  ttl: number;
}

interface BatchFetch {
  batch: Batch;
  cacheKey: Request;
  response: Response | null;
  fromCache: boolean;
  failure: string | null;
}

function makeBatches(dayRange: number, now: Date): Batch[] {
  const days = Math.min(MAX_HISTORY_DAYS, Math.max(1, Math.trunc(dayRange)));
  const batches: Batch[] = [];
  for (let remaining = days; remaining > 0;) {
    const length = Math.min(BATCH_DAYS, remaining);
    const start = new Date(now.getTime() - remaining * 86_400_000).toISOString().slice(0, 10);
    batches.push({ start, length, ttl: remaining <= BATCH_DAYS ? 1200 : 21_600 });
    remaining -= length;
  }
  return batches;
}

async function fetchBatch(
  env: Env,
  source: typeof FIRMS_SOURCES[number],
  area: string,
  batch: Batch,
  cache: Cache | null
): Promise<BatchFetch> {
  const cacheKey = firmsBatchCacheRequest(source, area, batch.length, batch.start);
  try {
    const cached = cache ? await cache.match(cacheKey) : undefined;
    if (cached) return { batch, cacheKey, response: cached, fromCache: true, failure: null };

    const upstreamUrl = `${FIRMS_AREA}/${env.FIRMS_MAP_KEY}/${source}/${area}/${batch.length}/${batch.start}`;
    const response = await fetchUpstream(`NASA FIRMS ${source}`, upstreamUrl, {
      headers: { Accept: 'text/csv' }
    });
    return { batch, cacheKey, response, fromCache: false, failure: null };
  } catch (error) {
    return {
      batch,
      cacheKey,
      response: null,
      fromCache: false,
      failure: error instanceof Error ? error.message : String(error)
    };
  }
}

async function processBatch(
  item: BatchFetch,
  engine: FirmsExports,
  cache: Cache | null,
  defer: Defer
): Promise<string | null> {
  if (!item.response) return batchFailure(item);
  const cacheCopy = uncachedResponseCopy(item, cache);
  try {
    await ingestResponse(item.response, engine);
    cacheAcceptedBatch(item, cacheCopy, cache, defer);
    return null;
  } catch (error) {
    evictInvalidBatch(item, cache, defer);
    return errorText(error);
  }
}

function batchFailure(item: BatchFetch): string {
  return item.failure ?? 'request failed';
}

function uncachedResponseCopy(item: BatchFetch, cache: Cache | null): Response | null {
  if (item.fromCache || !cache || !item.response) return null;
  return item.response.clone();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cacheAcceptedBatch(
  item: BatchFetch,
  cacheCopy: Response | null,
  cache: Cache | null,
  defer: Defer
): void {
  if (!cache || !cacheCopy) return;
  const cached = new Response(cacheCopy.body, {
    headers: { 'Content-Type': 'text/csv', 'Cache-Control': `public, max-age=${item.batch.ttl}` }
  });
  defer(cache.put(item.cacheKey, cached), 'firms_batch_cache_put');
}

function evictInvalidBatch(item: BatchFetch, cache: Cache | null, defer: Defer): void {
  if (cache && item.fromCache) defer(cache.delete(item.cacheKey), 'firms_batch_cache_delete');
}

async function ingestBatches(
  fetched: BatchFetch[],
  engine: FirmsExports,
  cache: Cache | null,
  defer: Defer
): Promise<{ failures: string[]; successfulBatches: number }> {
  const failures: string[] = [];
  let successfulBatches = 0;
  for (const item of fetched) {
    const failure = await processBatch(item, engine, cache, defer);
    if (failure) failures.push(failure);
    else ++successfulBatches;
  }
  return { failures, successfulBatches };
}

function failureReason(failures: string[], batchCount: number): string | null {
  return failures.length > 0
    ? `${failures.length} of ${batchCount} FIRMS batches failed; available detections may be incomplete.`
    : null;
}

async function fetchAllBatches(
  env: Env,
  area: string,
  batches: Batch[],
  cache: Cache | null
): Promise<BatchFetch[]> {
  return await Promise.all(FIRMS_SOURCES.flatMap((source) =>
    batches.map((batch) => fetchBatch(env, source, area, batch, cache))
  ));
}

function detectionResult(
  engine: FirmsExports,
  bounds: Bounds,
  fetched: BatchFetch[],
  failures: string[],
  successfulBatches: number
): DetectionResult {
  if (successfulBatches === 0 && engine.firms_count() === 0) {
    if (failures.length > 0) logDegraded('firms_fetch_failed', failures[0], { failureCount: failures.length });
    return { detections: null, bounds, reason: 'NASA FIRMS is temporarily unavailable.' };
  }
  if (failures.length > 0) {
    logDegraded('firms_fetch_degraded', failures[0], { failureCount: failures.length, batchCount: fetched.length });
  }
  return {
    ...finalizeEngine(engine, bounds),
    reason: failureReason(failures, fetched.length)
  };
}

export async function fetchDetections(
  env: Env,
  bounds: Bounds,
  dayRange: number,
  cache: Cache | null,
  defer: Defer,
  now = new Date()
): Promise<DetectionResult> {
  if (!env.FIRMS_MAP_KEY) {
    return { detections: null, bounds, reason: 'FIRMS_MAP_KEY is not configured' };
  }

  const engine = createEngine();
  engine.firms_reset();
  const area = quantizeBounds(bounds).join(',');
  const batches = makeBatches(dayRange, now);
  const fetched = await fetchAllBatches(env, area, batches, cache);
  const { failures, successfulBatches } = await ingestBatches(fetched, engine, cache, defer);
  return detectionResult(engine, bounds, fetched, failures, successfulBatches);
}
