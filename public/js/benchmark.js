async function runBenchmark() {
  const benchmark = document.getElementById("benchmark");
  if (!benchmark) return;

  const loading = document.getElementById("benchmark-loading");
  const error = document.getElementById("benchmark-error");
  const results = document.getElementById("benchmark-results");
  const waiting = document.getElementById("benchmark-waiting");
  let timer;

  try {
    const startedAt = performance.now();
    loading.hidden = false;
    benchmark.setAttribute("aria-busy", "true");
    timer = setInterval(() => {
      const seconds = Math.floor((performance.now() - startedAt) / 1000);
      waiting.textContent = `waiting for champion — ${seconds} ${seconds === 1 ? "second" : "seconds"} elapsed`;
    }, 1000);

    const response = await fetch(benchmark.dataset.endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ guid: benchmark.dataset.guid })
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response. Please try again.");
    }

    if (!response.ok || data?.error) {
      throw new Error(data?.error || `Benchmark request failed (HTTP ${response.status}).`);
    }

    document.getElementById("benchmark-json").textContent = JSON.stringify(data, null, 2);
    results.hidden = false;
  } catch (failure) {
    results.hidden = true;
    error.textContent = `Benchmark failed: ${failure?.message || "Unable to run the benchmark. Please try again."}`;
    error.hidden = false;
  } finally {
    clearInterval(timer);
    loading.hidden = true;
    benchmark.setAttribute("aria-busy", "false");
  }
}

runBenchmark();
