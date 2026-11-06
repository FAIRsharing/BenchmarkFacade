const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../public/js/benchmark.js"), "utf8");

function element(tagName = "div") {
  return {
    tagName, hidden: true, textContent: "", children: [],
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(event, callback) { this.listeners ||= {}; this.listeners[event] = callback; }
  };
}

function descendants(node, tagName) {
  return [node, ...node.children.flatMap(child => descendants(child, tagName))]
    .filter(child => !tagName || child.tagName === tagName);
}

function text(node) {
  return node.textContent + node.children.filter(child => child["aria-hidden"] !== "true").map(text).join(" ");
}

function startBenchmark(response) {
  const elements = Object.fromEntries([
    "benchmark", "benchmark-loading", "benchmark-waiting", "benchmark-error",
    "benchmark-results", "benchmark-table", "benchmark-status", "benchmark-expand-controls"
  ].map(id => [id, element()]));
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
    document: { getElementById: id => elements[id], createElement: element },
    URLSearchParams,
    URL,
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

test("posts the GUID once and renders results as safe table text", async () => {
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

  const table = benchmark.elements["benchmark-table"];
  assert.equal(descendants(table, "dl").length, 1);
  assert.deepEqual(descendants(table, "dt").map(text), ["Score", "Details"]);
  assert.match(text(table), /0\.75/);
  assert.match(text(table), /<script>alert\(1\)<\/script>/);
  assert.equal(descendants(table, "script").length, 0);
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


test("aligns record arrays by field, including missing values and nested results", async () => {
  const results = { checks: [
    { test_name: "Findable", passed: true, score: 0 },
    { test_name: "Reusable", passed: false, details: { reason: "Missing metadata" } }
  ] };
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => results }));
  await benchmark.finish();
  const tables = descendants(benchmark.elements["benchmark-table"], "table");
  assert.equal(tables.length, 1);
  const headers = descendants(tables[0].children[1], "th").map(text);
  assert.deepEqual(headers, ["#", "Test name", "Passed", "Score", "Details"]);
  const rows = tables[0].children[2].children.filter(row => row.className === "result-summary-row");
  assert.deepEqual(rows[0].children.map(text), ["1", "Findable", "Yes", "0", "Show details"]);
  assert.deepEqual(rows[1].children.slice(0, 4).map(text), ["2", "Reusable", "No", "Not provided"]);
  assert.match(text(tables[0]), /Missing metadata/);
  assertFinished(benchmark);
});

test("renders empty responses and absent values clearly", async () => {
  for (const [value, expected] of [[{}, "No results returned"], [[], "No items returned"], [null, "Not provided"], ["", "Empty"]]) {
    const benchmark = startBenchmark(() => ({ ok: true, json: async () => value }));
    await benchmark.finish();
    assert.equal(text(benchmark.elements["benchmark-table"]), expected);
    assert.equal(benchmark.elements["benchmark-results"].hidden, false);
  }
});

test("preserves mixed arrays, numbers and literal HTML without executing it", async () => {
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => [0, false, null, "<img src=x onerror=alert(1)>", ["nested"]] }));
  await benchmark.finish();
  const table = benchmark.elements["benchmark-table"];
  assert.match(text(table), /0/);
  assert.match(text(table), /No/);
  assert.match(text(table), /Not provided/);
  assert.match(text(table), /<img src=x onerror=alert\(1\)>/);
  assert.match(text(table), /nested/);
  assert.equal(descendants(table, "img").length, 0);
});


test("collapses nested results and lengthy values without discarding their content", async () => {
  const longValue = "Detailed assessment information. ".repeat(30);
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => ({ description: longValue, checks: [{ name: "Example", passed: true }] }) }));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const disclosures = descendants(root, "details");
  assert.equal(disclosures.length, 2);
  assert.ok(disclosures.every(item => !item.open));
  assert.match(text(disclosures[0].children[0]), /Read full value/);
  assert.ok(text(disclosures[0]).includes(longValue));
  assert.match(text(disclosures[1].children[0]), /Checks · 1 item/);
  assert.match(benchmark.elements["benchmark-status"].textContent, /Assessment complete/);
});

test("paginates large result sets and searches across all pages and hidden details", async () => {
  const values = Array.from({ length: 25 }, (_, index) => ({ name: `Check ${index + 1}`, passed: index % 2 === 0, details: { explanation: index === 22 ? "Unique matching evidence" : "Other evidence" } }));
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => values }));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const collection = root.children[0];
  const search = descendants(collection, "input")[0];
  const buttons = descendants(collection, "button").filter(button => ["Previous", "Next"].includes(button.textContent));
  const status = descendants(collection, "span").find(item => item.role === "status");
  const body = descendants(collection, "table")[0].children[2];
  assert.equal(body.children.filter(row => row.className === "result-summary-row").length, 10);
  assert.match(status.textContent, /Showing 1–10 of 25/);
  assert.equal(buttons[0]["aria-disabled"], "true");
  const firstDetailButton = descendants(body, "button")[0];
  const firstDetailRow = body.children[1];
  firstDetailButton.listeners.click();
  assert.equal(firstDetailRow.hidden, false);
  buttons[1].listeners.click();
  assert.match(status.textContent, /Showing 11–20 of 25/);
  buttons[1].listeners.click();
  assert.equal(body.children.filter(row => row.className === "result-summary-row").length, 5);
  assert.equal(buttons[1]["aria-disabled"], "true");
  buttons[1].listeners.click();
  assert.equal(body.children.filter(row => row.className === "result-summary-row").length, 5);
  buttons[0].listeners.click();
  assert.match(status.textContent, /Showing 11–20 of 25/);
  search.value = "unique MATCHING";
  search.listeners.input();
  assert.equal(body.children.filter(row => row.className === "result-summary-row").length, 1);
  assert.match(text(body), /Check 23/);
  assert.match(status.textContent, /Showing 1–1 of 1/);
  search.value = "does not exist";
  search.listeners.input();
  assert.equal(body.children.length, 0);
  assert.equal(status.textContent, "0 matching results");
  search.value = "";
  search.listeners.input();
  assert.equal(body.children.filter(row => row.className === "result-summary-row").length, 10);
  assert.match(status.textContent, /Showing 1–10 of 25/);
  assert.equal(body.children[1], firstDetailRow);
  assert.equal(firstDetailRow.hidden, false, "Expanded details survive paging and searching");
  firstDetailButton.listeners.click();
  assert.equal(firstDetailRow.hidden, true);
});

test("keeps wide records compact while preserving every field in details", async () => {
  const benchmark = startBenchmark(() => ({ ok: true, json: async () => [{ name: "Example", passed: false, score: 0, description: "Evidence", reference: "reference-id", extra: "Extra data" }] }));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const table = descendants(root, "table")[0];
  assert.equal(table.children[1].children[0].children.length, 5);
  const detailRow = descendants(root, "tr").find(row => row.className === "result-expanded-row");
  assert.ok(detailRow);
  assert.equal(detailRow.children[0].colSpan, 5);
  assert.equal(detailRow.hidden, true);
  assert.match(text(detailRow), /Evidence/);
  assert.match(text(detailRow), /reference-id/);
  assert.match(text(detailRow), /Extra data/);
  const button = descendants(root, "button")[0];
  assert.equal(button["aria-controls"], detailRow.children[0].children[0].id);
  button.listeners.click();
  assert.equal(detailRow.hidden, false);
  assert.equal(button["aria-expanded"], "true");
  button.listeners.click();
  assert.equal(detailRow.hidden, true);
  assert.equal(button["aria-expanded"], "false");
});


test("renders success and failure guidance outside narrow table columns", async () => {
  const benchmark = startBenchmark(() => ({ok:true, json:async () => ({checks:[{
    name:"F3", score:0.25, passed:true,
    success:"PASS: 25% compliance reached for F3.",
    failure:"FAIL: 25% compliance not yet reached for F3.", guidance:null
  }]})}));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  assert.equal(descendants(root, "table").length, 1, "No table is nested inside a details column");
  const detailRow = descendants(root, "tr").find(row => row.className === "result-expanded-row");
  assert.equal(detailRow.children[0].colSpan, 5);
  assert.deepEqual(descendants(detailRow, "dt").map(text), ["Success", "Failure", "Guidance"]);
  assert.match(text(detailRow), /PASS: 25% compliance reached for F3/);
  assert.match(text(detailRow), /FAIL: 25% compliance not yet reached for F3/);
});

test("global expand and collapse covers nested values and other result pages", async () => {
  const checks = Array.from({length: 12}, (_, index) => ({name:`Check ${index + 1}`, passed:true, score:1, evidence:"Long evidence. ".repeat(30)}));
  const benchmark = startBenchmark(() => ({ok:true, json:async () => ({checks})}));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const [expand, collapse] = benchmark.elements["benchmark-expand-controls"].children[0].children;
  assert.equal(expand["aria-controls"], root.id);
  expand.listeners.click();
  assert.ok(descendants(root, "details").every(node => node.open));
  assert.ok(descendants(root, "tr").filter(node => node.className === "result-expanded-row").every(node => !node.hidden));
  const next = descendants(root, "button").find(node => node.textContent === "Next");
  next.listeners.click();
  let rows = descendants(root, "tr").filter(node => node.className === "result-expanded-row");
  assert.equal(rows.length, 2);
  assert.ok(rows.every(node => !node.hidden), "Other pages must also be expanded");
  assert.ok(descendants(root, "details").every(node => node.open));
  const search = descendants(root, "input")[0];
  search.value = "no matches";
  search.listeners.input();
  collapse.listeners.click();
  search.value = "Check 12";
  search.listeners.input();
  rows = descendants(root, "tr").filter(node => node.className === "result-expanded-row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hidden, true, "Filtered results must also be collapsed");
  assert.ok(descendants(root, "details").every(node => !node.open));
  assert.match(benchmark.elements["benchmark-status"].textContent, /all details collapsed/);
});

test("section controls sit above the title and affect only their section", async () => {
  const benchmark = startBenchmark(() => ({ok:true, json:async () => ({
    first: { nested: { evidence: "First evidence. ".repeat(30) } },
    second: { nested: { evidence: "Second evidence. ".repeat(30) } }
  })}));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const firstSection = root.children[0].children[0].children[1].children[0];
  const secondSection = root.children[0].children[1].children[1].children[0];
  const first = descendants(firstSection, "details")[0];
  const second = descendants(secondSection, "details")[0];
  const [expand, collapse] = firstSection.children[0].children;
  assert.equal(firstSection.children[0].role, "group");
  assert.equal(firstSection.children[1], first, "Controls precede the section title and remain outside its disclosure");
  assert.equal(expand["aria-controls"], first.id);
  const sectionGroups = descendants(root).filter(node => node.role === "group");
  assert.equal(sectionGroups.length, 2, "Only main sections have bulk controls");
  assert.equal(descendants(first, "button").length, 0, "Nested sections retain their summaries without repeated bulk buttons");
  expand.listeners.click();
  assert.ok(descendants(first, "details").every(node => node.open));
  assert.ok(descendants(second, "details").every(node => !node.open));
  collapse.listeners.click();
  assert.equal(first.open, false);
  assert.ok(descendants(first, "details").every(node => !node.open));
  assert.ok(descendants(second, "details").every(node => !node.open));
});

test("active expansion buttons reflect collapsed, expanded and manually mixed states", async () => {
  const benchmark = startBenchmark(() => ({ok:true, json:async () => ({
    first:{nested:{evidence:"Example evidence"}}, second:{value:1}
  })}));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const [expandAll, collapseAll] = benchmark.elements["benchmark-expand-controls"].children[0].children;
  assert.equal(expandAll["aria-pressed"], "false");
  assert.equal(collapseAll["aria-pressed"], "true");
  const firstSection = root.children[0].children[0].children[1].children[0];
  const [expandFirst, collapseFirst] = firstSection.children[0].children;
  expandFirst.listeners.click();
  assert.equal(expandFirst["aria-pressed"], "true");
  assert.equal(collapseFirst["aria-pressed"], "false");
  assert.equal(expandAll["aria-pressed"], "false");
  assert.equal(collapseAll["aria-pressed"], "false");
  const nested = descendants(firstSection, "details")[1];
  nested.open = false;
  nested.listeners.toggle();
  assert.equal(expandFirst["aria-pressed"], "false");
  assert.equal(collapseFirst["aria-pressed"], "false");
  expandAll.listeners.click();
  assert.equal(expandAll["aria-pressed"], "true");
  assert.equal(collapseAll["aria-pressed"], "false");
  collapseAll.listeners.click();
  assert.equal(expandAll["aria-pressed"], "false");
  assert.equal(collapseAll["aria-pressed"], "true");
  assert.equal(collapseFirst["aria-pressed"], "true");
});

test("renders keyed test results as searchable paginated rows with full-width log details", async () => {
  const testResults = Object.fromEntries(Array.from({length:26}, (_, index) => [
    `ft_test_${index + 1}`, {log:index === 25 ? "Unique final evidence" : "No matching record found.", result:"indeterminate", weight:0}
  ]));
  const benchmark = startBenchmark(() => ({ok:true, json:async () => ({test_results:testResults})}));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const table = descendants(root,"table")[0];
  assert.ok(table);
  assert.deepEqual(table.children[1].children[0].children.map(text), ["#","Test","Result","Weight","Details"]);
  const body = table.children[2];
  const summaries = () => body.children.filter(row => row.className === "result-summary-row");
  assert.equal(summaries().length,10);
  assert.deepEqual(summaries()[0].children.map(text), ["1","ft_test_1","indeterminate","0","Show details"]);
  const search = descendants(root,"input")[0];
  search.value = "Unique final evidence";
  search.listeners.input();
  assert.equal(summaries().length,1);
  assert.match(text(summaries()[0]),/ft_test_26/);
  const detail = descendants(root,"tr").find(row => row.className === "result-expanded-row");
  assert.equal(detail.children[0].colSpan,5);
  descendants(summaries()[0],"button")[0].listeners.click();
  assert.equal(detail.hidden,false);
  assert.match(text(detail),/Unique final evidence/);
  assert.match(text(descendants(root,"summary")[0]),/Test results · 26 tests/);
  benchmark.elements["benchmark-expand-controls"].children[0].children[1].listeners.click();
  assert.equal(detail.hidden,true);
});

test("preserves extra fields and unusual entries in a test-results map", async () => {
  const benchmark = startBenchmark(() => ({ok:true,json:async () => ({test_results:{
    example:{result:false,weight:0,log:"<script>unsafe()</script>",guidance:{message:"More evidence"}},
    missing:null,
    scalar:"not evaluated"
  }})}));
  await benchmark.finish();
  const root = benchmark.elements["benchmark-table"];
  const rows=descendants(root,"tr").filter(row => row.className === "result-summary-row");
  assert.match(text(rows[0]),/No/);
  assert.match(text(rows[1]),/Not provided/);
  assert.match(text(rows[2]),/not evaluated/);
  assert.match(text(root),/More evidence/);
  assert.match(text(root),/<script>unsafe\(\)<\/script>/);
  assert.equal(descendants(root,"script").length,0);
});


test("renders HTTP and HTTPS URLs as safe new-tab links in result values", async () => {
  const benchmark = startBenchmark(() => ({ok:true,json:async () => ({
    website:"https://example.org/resource?a=1&b=2#section",
    details:"See (http://example.org/first), then https://example.org/second.",
    nested:{reference:"https://example.org/path_(part)"},
    unsafe:"javascript:alert(1) <img src=x onerror=alert(1)> https://[invalid]"
  })}));
  await benchmark.finish();
  const root=benchmark.elements["benchmark-table"];
  const links=descendants(root,"a");
  assert.deepEqual(links.map(link=>link.href), [
    "https://example.org/resource?a=1&b=2#section", "http://example.org/first",
    "https://example.org/second", "https://example.org/path_(part)"
  ]);
  for (const link of links) {
    assert.equal(link.target,"_blank");
    assert.equal(link.rel,"noopener noreferrer");
    assert.match(link["aria-label"],/opens in a new tab/);
  }
  assert.equal(descendants(root,"img").length,0);
  assert.match(text(root),/javascript:alert/);
});

test("keeps long URLs clickable inside expanded values and test-result identifiers", async () => {
  const address="https://example.org/" + "long-resource-".repeat(30);
  const benchmark=startBenchmark(()=>({ok:true,json:async()=>({
    reference:address, test_results:{"https://example.org/test/1":{result:"pass",weight:1}}
  })}));
  await benchmark.finish();
  const links=descendants(benchmark.elements["benchmark-table"],"a");
  assert.deepEqual(links.map(link=>link.href),[address,"https://example.org/test/1"]);
});
