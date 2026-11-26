const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const api = import(pathToFileURL(path.join(root, "netlify/functions/benchmark.mjs")));
const definitions = JSON.parse(fs.readFileSync(path.join(root, "config/benchmarks.json")));

function request(operation = "institutional_benchmark", guid = "https://example.org/a?b=1&c=2") {
  return new Request(`https://example.netlify.app/${operation}/run`, {
    method: "POST", body: new URLSearchParams({ guid })
  });
}

test("Netlify forwards each configured benchmark and preserves the complete response", async () => {
  const { createHandler } = await api;
  const results = { canvas: "CF1_25", conditions: [{ id: "c_ft_f1_m_metadata_id_unique" }], test_results: { example: { result: "pass", weight: 0 } } };
  for (const [operation, definition] of Object.entries(definitions)) {
    let calls = 0;
    const handler = createHandler({ fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://champion.fairsharing.org/champion/assess/algorithm");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), {
        calculation_uri: definition.calculation_uri, guid: "https://example.org/a?b=1&c=2"
      });
      return Response.json(results);
    } });
    const response = await handler(request(operation));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), results);
    assert.equal(calls, 1);
  }
});

test("Netlify rejects invalid URLs, unknown operations, methods and content types before contacting Champion", async () => {
  const { createHandler, validGuid } = await api;
  const handler = createHandler({ fetchImpl: async () => assert.fail("Must not contact Champion") });
  for (const guid of ["", "javascript:alert(1)", "file:///etc/passwd", "https://", "https://a b.com", "https://example.org/" + "a".repeat(2048)]) {
    assert.equal(validGuid(guid), false);
    assert.equal((await handler(request("institutional_benchmark", guid))).status, 422);
  }
  assert.equal((await handler(request("__proto__"))).status, 404);
  assert.equal((await handler(request("unknown"))).status, 404);
  const get = await handler(new Request("https://example.netlify.app/institutional_benchmark/run"));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal((await handler(new Request("https://example.netlify.app/institutional_benchmark/run", { method: "POST", body: "{}" }))).status, 415);
});

test("Netlify returns readable errors for upstream HTTP, JSON, network and timeout failures", async () => {
  const { createHandler } = await api;
  for (const [fetchImpl, expected] of [
    [async () => new Response("private upstream details", { status: 503 }), /HTTP 503/],
    [async () => new Response("invalid JSON"), /unreadable/],
    [async () => { throw new Error("private network details"); }, /Unable to contact/]
  ]) {
    const response = await createHandler({ fetchImpl })(request());
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, expected);
    assert.doesNotMatch(body.error, /private/);
  }
  const response = await createHandler({ timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) })(request());
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /too long/);
});

function bootstrap(guid) {
  const benchmark = { dataset: { guidSource: "query" }, removeAttribute(name) { this.removed = name; } };
  const link = { setAttribute(name, value) { this[name] = value; } };
  const error = { hidden: true };
  const nodes = { benchmark, "benchmark-resource-link": link, "benchmark-error": error };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/js/netlify-page.js"), "utf8"), {
    document: { getElementById: id => nodes[id] }, URL, URLSearchParams,
    window: { location: { search: guid === null ? "" : `?${new URLSearchParams({ guid })}` } }
  });
  return { benchmark, link, error };
}

test("static pages recover encoded GUIDs safely and stop invalid submissions", () => {
  const guid = "https://example.org/a?b=1&c=%3Cscript%3E#section";
  const page = bootstrap(guid);
  assert.equal(page.benchmark.dataset.guid, guid);
  assert.equal(page.link.href, guid);
  assert.equal(page.link.textContent, guid);
  assert.match(page.link["aria-label"], /opens in a new tab/);
  for (const invalid of [null, "", "javascript:alert(1)", "https://"]) {
    const page = bootstrap(invalid);
    assert.equal(page.benchmark.removed, "id");
    assert.equal(page.error.hidden, false);
    assert.match(page.error.textContent, /valid HTTP or HTTPS/);
    assert.equal(page.link.href, undefined);
  }
});

test("Netlify build renders the shared views and assets for every benchmark", () => {
  execFileSync("bundle", ["exec", "ruby", "scripts/build_netlify.rb"], { cwd: root });
  const home = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  for (const [operation, definition] of Object.entries(definitions)) {
    assert.ok(home.includes(`action="/${operation}"`));
    const page = fs.readFileSync(path.join(root, "dist", operation, "index.html"), "utf8");
    assert.ok(page.includes(definition.title));
    assert.ok(page.includes(`data-endpoint="/${operation}/run"`));
    assert.match(page, /data-guid-source="query"/);
    assert.ok(page.indexOf("/js/netlify-page.js") < page.indexOf("/js/benchmark.js"));
    assert.match(page, /id="benchmark-table"/);
    assert.match(page, /<html lang="en">/);
  }
  assert.ok(fs.existsSync(path.join(root, "dist/404.html")));
  assert.equal(fs.readFileSync(path.join(root, "dist/css/custom.css"), "utf8"), fs.readFileSync(path.join(root, "public/css/custom.css"), "utf8"));
});
