export function firmsBatchCacheRequest(
  source: string,
  area: string,
  length: number,
  start: string
): Request {
  return new Request(`https://firms-cache.internal/${source}/${area}/${length}/${start}`);
}

export function frameCacheRequest(irwinId: string, frameIso: string, days: number): Request {
  return new Request(`https://firms-frame-cache.internal/${irwinId.toLowerCase()}/${frameIso}/${days}`);
}

export function perimeterCacheRequest(irwinId: string): Request {
  return new Request(`https://perimeter-cache.internal/${irwinId.toLowerCase()}`);
}

export function catalogCacheRequest(irwinId: string): Request {
  return new Request(`https://catalog-v2-cache.internal/${irwinId.toLowerCase()}`);
}
