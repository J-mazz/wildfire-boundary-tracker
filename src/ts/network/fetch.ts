const DEFAULT_TIMEOUT_MS = 15_000;

function responseWithDeadline(
  response: Response,
  controller: AbortController,
  timeout: number,
  timeoutMs: number
): Response {
  if (!response.body) {
    window.clearTimeout(timeout);
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          window.clearTimeout(timeout);
          stream.close();
        } else {
          stream.enqueue(value);
        }
      } catch (error) {
        window.clearTimeout(timeout);
        stream.error(controller.signal.aborted
          ? new Error(`Request timed out after ${timeoutMs}ms.`, { cause: error })
          : error);
      }
    },
    async cancel(reason) {
      window.clearTimeout(timeout);
      await reader.cancel(reason);
    }
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort('request timeout'), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return responseWithDeadline(response, controller, timeout, timeoutMs);
  } catch (error) {
    window.clearTimeout(timeout);
    throw error;
  }
}
