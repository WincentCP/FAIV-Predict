/**
 * fetch that retries transient failures (network errors and 5xx responses)
 * with exponential backoff. Dev-server compiles, cold starts, and brief
 * network blips look like outages to a fetch-once page; retrying makes the
 * initial data load resilient instead of surfacing an error state instantly.
 */
export async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  retries = 3
): Promise<Response> {
  let delay = 1200;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status < 500 || attempt >= retries) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
}

