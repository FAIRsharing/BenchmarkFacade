/** Populate a prebuilt benchmark page from its query string before the runner loads. */
(() => {
  const benchmark = document.getElementById("benchmark");
  if (!benchmark || benchmark.dataset.guidSource !== "query") return;

  const guid = new URLSearchParams(window.location.search).get("guid");
  let valid = false;
  try {
    const url = new URL(guid);
    valid = typeof guid === "string" && guid.length <= 2048 &&
      /^https?:\/\//i.test(guid) && !/\s/.test(guid) &&
      ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch { /* Invalid URLs are reported before the benchmark makes a request. */ }

  if (!valid) {
    const error = document.getElementById("benchmark-error");
    error.textContent = "Please enter a valid HTTP or HTTPS URL for the GUID (maximum 2048 characters).";
    error.hidden = false;
    // The runner deliberately skips pages without this element's ID.
    benchmark.removeAttribute("id");
    return;
  }

  benchmark.dataset.guid = guid;
  const link = document.getElementById("benchmark-resource-link");
  link.href = guid;
  link.textContent = guid;
  link.setAttribute("aria-label", `${guid} (opens in a new tab)`);
})();
