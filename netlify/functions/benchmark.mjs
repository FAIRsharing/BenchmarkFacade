import benchmarks from "../../config/benchmarks.json" with { type: "json" };

const CHAMPION_URL = "https://champion.fairsharing.org/champion/assess/algorithm";
const INVALID_GUID = "Please enter a valid HTTP or HTTPS URL for the GUID (maximum 2048 characters).";

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders }
  });
}

/** Validate user input; only the fixed Champion endpoint is contacted. */
export function validGuid(value) {
  if (typeof value !== "string" || value.length > 2048 ||
      !/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Keep the Sinatra POST contract, including all fields in Champion's response. */
export function createHandler({ fetchImpl = fetch, timeoutMs = 55_000 } = {}) {
  return async request => {
    const operation = new URL(request.url).pathname.match(/^\/([^/]+)\/run\/?$/)?.[1];
    if (!operation || !Object.hasOwn(benchmarks, operation)) {
      return json({ error: "Unknown benchmark operation." }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST to run a benchmark." }, 405, { Allow: "POST" });
    }
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("application/x-www-form-urlencoded")) {
      return json({ error: "Submit the GUID as form data." }, 415);
    }
    const body = await request.text();
    if (body.length > 16_384) return json({ error: INVALID_GUID }, 422);
    const guid = new URLSearchParams(body).get("guid");
    if (!validGuid(guid)) return json({ error: INVALID_GUID }, 422);

    // Leave time to return a readable error before Netlify's 60-second limit.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(CHAMPION_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ calculation_uri: benchmarks[operation].calculation_uri, guid }),
        signal: controller.signal,
        redirect: "error"
      });
      if (!response.ok) {
        return json({ error: `Champion request failed (HTTP ${response.status}). Please try again.` }, 502);
      }
      try {
        return json(await response.json());
      } catch (error) {
        if (controller.signal.aborted) throw error;
        return json({ error: "Champion returned an unreadable response. Please try again." }, 502);
      }
    } catch {
      return controller.signal.aborted
        ? json({ error: "Champion took too long to respond. Please try again." }, 504)
        : json({ error: "Unable to contact Champion. Please try again." }, 502);
    } finally {
      clearTimeout(timer);
    }
  };
}

export default createHandler();
export const config = { path: "/:operation/run" };
