export const UPSTREAM_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    options?: ErrorOptions
  ) {
    super(publicMessage, options);
    this.name = 'ApiError';
  }
}

export class UpstreamError extends ApiError {
  constructor(service: string, detail: string, options?: ErrorOptions) {
    super(502, 'upstream_unavailable', `${service} is temporarily unavailable.`, options);
    this.name = 'UpstreamError';
    this.message = `${service}: ${detail}`;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(level: 'error' | 'warn', event: string, error: unknown, details: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({
    level,
    event,
    error: errorText(error),
    ...details
  }));
}

export function withApiErrors<Env>(handler: PagesFunction<Env>): PagesFunction<Env> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      const known = error instanceof ApiError;
      logError(known && error.status < 500 ? 'warn' : 'error', 'api_request_failed', error, {
        method: context.request.method,
        path: new URL(context.request.url).pathname,
        status: known ? error.status : 500,
        code: known ? error.code : 'internal_error',
        rayId: context.request.headers.get('cf-ray')
      });
      return Response.json(
        {
          error: known ? error.publicMessage : 'The service encountered an unexpected error.',
          code: known ? error.code : 'internal_error'
        },
        { status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  };
}

export async function fetchUpstream(
  service: string,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('upstream timeout'), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok) throw new UpstreamError(service, `HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const detail = controller.signal.aborted ? `timed out after ${UPSTREAM_TIMEOUT_MS}ms` : errorText(error);
    throw new UpstreamError(service, detail, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export async function upstreamJson(
  service: string,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<unknown> {
  const response = await fetchUpstream(service, input, init);
  try {
    return await response.json();
  } catch (error) {
    throw new UpstreamError(service, 'returned invalid JSON', { cause: error });
  }
}

export function waitUntil(
  context: Pick<EventContext<unknown, string, unknown>, 'waitUntil'>,
  operation: string,
  promise: Promise<unknown>
): void {
  context.waitUntil(promise.catch((error) => {
    logError('error', 'deferred_operation_failed', error, { operation });
  }));
}

export function logDegraded(event: string, error: unknown, details: Record<string, unknown> = {}): void {
  logError('warn', event, error, details);
}
