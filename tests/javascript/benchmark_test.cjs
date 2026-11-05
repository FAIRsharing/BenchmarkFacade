const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../public/js/benchmark.js"), "utf8");

function startBenchmark(response) {
  const elements = Object.fromEntries([
    "benchmark", "benchmark-loading", "benchmark-waiting", "benchmark-error",
    "benchmark-results", "benchmark-json"
  ].map(id => [id, {
    hidden: true,
    textContent: "",
    setAttribute(name, value) { this[name] = value; }
  }]));
  elements.benchmark.dataset = {
    endpoint: "/institutional_benchmark/run",
    guid: "https://example.org/object?name=a&format=json"
  };

  let finish;
  let elapsed = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const requests = [];
  const intervals = new Map();
  const context = {
    document: { getElementById: id => elements[id] },
    URLSearchParams,
    performance: { now: () => elapsed },
    setInterval(callback, delay) {
      assert.equal(delay, 1000);
      intervals.set(1, callback);
      return 1;
    },
    clearInterval(id) { intervals.delete(id); },
    fetch(url, options) {
      requests.push({ url, options });
      return pending.then(response);
    }
  };

  const completion = vm.runInNewContext(source, context);
  return {
    elements, requests, intervals,
    tick(milliseconds) {
      elapsed = milliseconds;
      for (const callback of intervals.values()) callback();
    },
    async finish() {
      finish();
      await completion;
    }
  };
}

function assertFinished(benchmark) {
  assert.equal(benchmark.intervals.size, 0, "The elapsed timer must be cancelled");
  assert.equal(benchmark.elements["benchmark-loading"].hidden, true);
  assert.equal(benchmark.elements.benchmark["aria-busy"], "false");
}

test("posts the GUID once and displays formatted JSON safely", async () => {
  const results = { score: 0.75, details: "<script>alert(1)</script>" };
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => results }));
  assert.equal(benchmark.requests.length, 1);
  const { url, options } = benchmark.requests[0];
  assert.equal(url, "/institutional_benchmark/run");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Accept, "application/json");
  assert.equal(options.body.get("guid"), benchmark.elements.benchmark.dataset.guid);
  assert.equal(benchmark.elements["benchmark-loading"].hidden, false);
  assert.equal(benchmark.elements.benchmark["aria-busy"], "true");

  await benchmark.finish();

  assert.equal(benchmark.elements["benchmark-json"].textContent, JSON.stringify(results, null, 2));
  assert.equal(benchmark.elements["benchmark-results"].hidden, false);
  assert.equal(benchmark.elements["benchmark-error"].hidden, true);
  assertFinished(benchmark);
});

test("updates elapsed seconds while waiting and stops updating after completion", async () => {
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => ({}) }));
  benchmark.tick(1000);
  assert.equal(benchmark.elements["benchmark-waiting"].textContent, "waiting for champion — 1 second elapsed");
  benchmark.tick(5900);
  assert.equal(benchmark.elements["benchmark-waiting"].textContent, "waiting for champion — 5 seconds elapsed");

  await benchmark.finish();
  benchmark.tick(10000);

  assert.equal(benchmark.elements["benchmark-waiting"].textContent, "waiting for champion — 5 seconds elapsed");
  assertFinished(benchmark);
});

const failures = [
  {
    name: "HTTP error with a server message",
    response: () => ({ ok: false, status: 502, json: async () => ({ error: "Champion timed out" }) }),
    message: "Champion timed out"
  },
  {
    name: "HTTP error without a server message",
    response: () => ({ ok: false, status: 503, json: async () => ({}) }),
    message: "Benchmark request failed (HTTP 503)."
  },
  {
    name: "error payload in a successful HTTP response",
    response: () => ({ ok: true, json: async () => ({ error: "Unable to assess object" }) }),
    message: "Unable to assess object"
  },
  {
    name: "network failure",
    response: () => { throw new Error("Network unavailable"); },
    message: "Network unavailable"
  },
  {
    name: "malformed JSON",
    response: () => ({ ok: true, json: async () => { throw new SyntaxError("Bad JSON"); } }),
    message: "The server returned an unreadable response. Please try again."
  },
  {
    name: "failure without an error message",
    response: () => { throw null; },
    message: "Unable to run the benchmark. Please try again."
  }
];

for (const { name, response, message } of failures) {
  test(`shows a clear error and removes the spinner and timer after ${name}`, async () => {
    const benchmark = startBenchmark(response);
    benchmark.tick(2000);
    await benchmark.finish();

    assert.equal(benchmark.elements["benchmark-error"].textContent, `Benchmark failed: ${message}`);
    assert.equal(benchmark.elements["benchmark-error"].hidden, false);
    assert.equal(benchmark.elements["benchmark-results"].hidden, true);
    assertFinished(benchmark);
  });
}

test("does nothing when the page has no benchmark element", async () => {
  await vm.runInNewContext(source, {
    document: { getElementById: () => null },
    fetch: () => assert.fail("Must not request a benchmark on another page"),
    setInterval: () => assert.fail("Must not start a timer on another page")
  });
});
