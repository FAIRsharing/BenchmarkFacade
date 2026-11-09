/**
 * Benchmark results UI for views/run_benchmark.erb.
 *
 * runBenchmark() posts the page's GUID to the local Sinatra endpoint, then
 * renderResult() builds tables, field lists and expandable details from JSON.
 * Renderers use textContent for API text; resultText() adds validated HTTP(S)
 * links without interpreting returned text as HTML.
 *
 * Expandable elements may implement setResultsExpanded(expanded) and
 * resultExpansionState(). These hooks let bulk controls include detached rows
 * on other pages and rows excluded by search, as well as native <details>.
 *
 * @typedef {{open: number, total: number}} ExpansionState
 * @typedef {Array<HTMLElement> & {
 *   details?: HTMLElement,
 *   detailsLabel?: string,
 *   rendered?: HTMLTableRowElement[]
 * }} ResultRow
 */

// Shared counter for unique disclosure IDs referenced by aria-controls.
let resultDetailId = 0;
// Current result view's bulk controls; reset before rendering a new response.
let resultControlGroups = [];

/**
 * Convert camelCase, snake_case or hyphenated keys into readable field labels.
 * @param {string} key
 * @returns {string}
 */
function resultLabel(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
    .replace(/^./, character => character.toUpperCase());
}

/**
 * Create an element with optional plain text and CSS classes.
 * @param {string} tag - HTML tag name.
 * @param {string} [text] - Assigned through textContent, never innerHTML.
 * @param {string} [className] - Space-separated CSS classes.
 * @returns {HTMLElement}
 */
function resultElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

/**
 * Render text with HTTP(S) URLs as links that open in a new tab.
 * Trailing prose punctuation and unmatched closing brackets stay outside links;
 * malformed URLs stay as text. New-tab links include opener protection and an
 * accessible label announcing that they open in a new tab.
 * @param {string} text
 * @param {string} [className="result-value"] - Classes for the wrapping span.
 * @returns {HTMLSpanElement}
 */
function resultText(text, className = "result-value") {
  const content = resultElement("span", undefined, className);
  const matches = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)];
  if (!matches.length) {
    content.textContent = text;
    return content;
  }
  let offset = 0;
  for (const match of matches) {
    let address = match[0].replace(/[.,;!?]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (address.endsWith(close) && address.split(close).length > address.split(open).length) {
        address = address.slice(0, -1);
      }
    }
    content.append(resultElement("span", text.slice(offset, match.index)));
    try {
      const url = new URL(address);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("Invalid URL");
      const link = resultElement("a", address);
      link.setAttribute("href", address);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      link.setAttribute("aria-label", `${address} (opens in a new tab)`);
      link.setAttribute("title", "Opens in a new tab");
      content.append(link);
    } catch {
      content.append(resultElement("span", address));
    }
    offset = match.index + address.length;
  }
  content.append(resultElement("span", text.slice(offset)));
  return content;
}

/**
 * Expand or collapse a result subtree, using custom hooks where available.
 * A hook owns traversal of its contents, so its children are not visited twice.
 * @param {HTMLElement} root
 * @param {boolean} expanded
 * @returns {void}
 */
function setResultsExpanded(root, expanded) {
  if (root.setResultsExpanded) {
    root.setResultsExpanded(expanded);
    return;
  }
  for (const child of root.children) setResultsExpanded(child, expanded);
}

/**
 * Count open and total disclosures in a subtree, including off-page rows when
 * the subtree supplies its own state hook.
 * @param {HTMLElement} root
 * @returns {ExpansionState}
 */
function resultExpansionState(root) {
  if (root.resultExpansionState) return root.resultExpansionState();
  return [...root.children].reduce((state, child) => {
    const nested = resultExpansionState(child);
    return { open: state.open + nested.open, total: state.total + nested.total };
  }, { open: 0, total: 0 });
}

/**
 * Synchronize button highlights and aria-pressed with the current result state.
 * Mixed states and subtrees without disclosures leave both buttons unselected.
 * @returns {void}
 */
function refreshResultControls() {
  for (const { target, buttons } of resultControlGroups) {
    const state = resultExpansionState(target);
    buttons[0].setAttribute("aria-pressed", String(state.total > 0 && state.open === state.total));
    buttons[1].setAttribute("aria-pressed", String(state.total > 0 && state.open === 0));
  }
}

/**
 * Build and register scoped Expand all / Collapse all buttons.
 * Each action updates the target subtree, button states and live status text.
 * @param {HTMLElement} target - Result subtree controlled by these buttons.
 * @param {string} label - Scope name used in accessible labels and announcements.
 * @returns {HTMLDivElement}
 */
function resultExpansionControls(target, label) {
  if (!target.id) target.id = `result-section-${++resultDetailId}`;
  const group = resultElement("div", undefined, "result-expansion-controls d-flex flex-wrap gap-2");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `${label} expansion controls`);
  for (const [text, expanded] of [["Expand all", true], ["Collapse all", false]]) {
    const button = resultElement("button", text, "btn btn-outline-secondary btn-sm");
    button.type = "button";
    button.setAttribute("aria-label", `${text} in ${label}`);
    button.setAttribute("aria-controls", target.id);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      setResultsExpanded(target, expanded);
      refreshResultControls();
      document.getElementById("benchmark-status").textContent = `${label}: all details ${expanded ? "expanded" : "collapsed"}.`;
    });
    group.append(button);
  }
  resultControlGroups.push({ target, buttons: [...group.children] });
  return group;
}

/**
 * Build a responsive table with optional full-width detail rows.
 *
 * Each ResultRow contains one element per column. If details is provided, the
 * final element must be its Show details button; detailsLabel names the panel.
 * Cached rendered rows preserve their expansion state across page changes.
 *
 * More than 10 records enables search and pagination. searchValues must align
 * with rows and should include hidden detail text, so searches cover all data.
 * Bulk expansion and state reporting cover every row, not only the visible page.
 * @param {string[]} headers
 * @param {ResultRow[]} rows
 * @param {string} caption - Table caption and accessible region name.
 * @param {string[]} [searchValues=[]] - Search text for each row.
 * @returns {HTMLDivElement} Table wrapper, or a collection with search and paging.
 */
function resultTable(headers, rows, caption, searchValues = []) {
  const wrapper = resultElement("div", undefined, "table-responsive");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", caption);
  const table = resultElement("table", undefined, "table table-hover align-middle results-table mb-0");
  table.setAttribute("role", "table");
  table.className += headers[0] === "Field" ? " results-fields" : " results-records";
  table.append(resultElement("caption", caption, "visually-hidden"));
  const head = resultElement("thead");
  const heading = resultElement("tr");
  heading.setAttribute("role", "row");
  for (const label of headers) {
    const cell = resultElement("th", label);
    cell.setAttribute("scope", "col");
    cell.setAttribute("role", "columnheader");
    heading.append(cell);
  }
  head.append(heading);
  table.append(head);
  const body = resultElement("tbody");
  /**
   * Create or reuse a summary row and its optional full-width detail row.
   * Reusing nodes retains listeners, panel IDs and expansion state after paging.
   * @param {ResultRow} values
   * @returns {HTMLTableRowElement[]}
   */
  function tableRow(values) {
    if (values.rendered) return values.rendered;
    const row = resultElement("tr", undefined, "result-summary-row");
    row.setAttribute("role", "row");
    values.forEach((value, index) => {
      const cell = resultElement(index === 0 ? "th" : "td");
      if (index === 0) cell.setAttribute("scope", "row");
      cell.setAttribute("role", index === 0 ? "rowheader" : "cell");
      const mobileLabel = resultElement("span", headers[index], "result-mobile-label");
      mobileLabel.setAttribute("aria-hidden", "true");
      cell.append(mobileLabel);
      cell.append(value);
      row.append(cell);
    });
    if (!values.details) return (values.rendered = [row]);

    const detailRow = resultElement("tr", undefined, "result-expanded-row");
    detailRow.hidden = true;
    detailRow.setAttribute("role", "row");
    const detailId = `result-details-${++resultDetailId}`;
    const cell = resultElement("td");
    cell.colSpan = headers.length;
    cell.setAttribute("role", "cell");
    cell.setAttribute("aria-colspan", String(headers.length));
    const panel = resultElement("section", undefined, "result-expanded-panel");
    panel.id = detailId;
    panel.setAttribute("aria-label", values.detailsLabel);
    panel.append(resultElement("h3", values.detailsLabel, "h6 mb-3"), values.details);
    cell.append(panel);
    detailRow.append(cell);
    const button = values[values.length - 1];
    button.setAttribute("aria-controls", detailId);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `Show ${values.detailsLabel.toLowerCase()}`);
    /** Keep this panel's visibility, button text and ARIA state in sync. */
    function setExpanded(open) {
      detailRow.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "Hide details" : "Show details";
      button.setAttribute("aria-label", `${open ? "Hide" : "Show"} ${values.detailsLabel.toLowerCase()}`);
    }
    button.addEventListener("click", () => {
      setExpanded(detailRow.hidden);
      refreshResultControls();
    });
    detailRow.setResultsExpanded = expanded => {
      setExpanded(expanded);
      setResultsExpanded(values.details, expanded);
    };
    detailRow.resultExpansionState = () => {
      const nested = resultExpansionState(values.details);
      return { open: nested.open + (detailRow.hidden ? 0 : 1), total: nested.total + 1 };
    };
    return (values.rendered = [row, detailRow]);
  }
  table.append(body);
  wrapper.append(table);
  wrapper.setResultsExpanded = expanded => {
    // Include results on other pages and results hidden by the search filter.
    for (const values of rows) {
      for (const row of tableRow(values)) setResultsExpanded(row, expanded);
    }
  };
  wrapper.resultExpansionState = () => rows.reduce((state, values) => {
    for (const row of tableRow(values)) {
      const nested = resultExpansionState(row);
      state.open += nested.open;
      state.total += nested.total;
    }
    return state;
  }, { open: 0, total: 0 });
  if (rows.length <= 10) {
    body.append(...rows.flatMap(tableRow));
    return wrapper;
  }

  const section = resultElement("div", undefined, "result-collection");
  const label = resultElement("label", `Search ${caption.toLowerCase()}`, "form-label small fw-semibold d-block");
  const search = resultElement("input", undefined, "form-control mt-2");
  search.type = "search";
  search.placeholder = "Search all fields and details…";
  label.append(search);
  const navigation = resultElement("nav", undefined, "result-pagination d-flex flex-wrap justify-content-between align-items-center gap-3 mt-3");
  navigation.setAttribute("aria-label", `${caption} pages`);
  const status = resultElement("span", undefined, "small text-body-secondary");
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  const buttons = resultElement("div", undefined, "d-flex gap-2");
  const previous = resultElement("button", "Previous", "btn btn-outline-secondary btn-sm");
  const next = resultElement("button", "Next", "btn btn-outline-secondary btn-sm");
  previous.type = next.type = "button";
  previous.setAttribute("aria-label", `Previous page of ${caption}`);
  next.setAttribute("aria-label", `Next page of ${caption}`);
  buttons.append(previous, next);
  navigation.append(status, buttons);
  const empty = resultElement("p", "No matching results. Try a different search.", "text-body-secondary py-3 mb-0");
  let page = 0;
  let matches = rows.map((_, index) => index);
  /** Render the current filtered page and refresh its navigation/status text. */
  function update() {
    const start = page * 10;
    body.replaceChildren(...matches.slice(start, start + 10).flatMap(index => tableRow(rows[index])));
    wrapper.hidden = matches.length === 0;
    empty.hidden = matches.length !== 0;
    previous.setAttribute("aria-disabled", String(page === 0));
    next.setAttribute("aria-disabled", String(start + 10 >= matches.length));
    status.textContent = matches.length
      ? `Showing ${start + 1}–${Math.min(start + 10, matches.length)} of ${matches.length} results · Page ${page + 1} of ${Math.ceil(matches.length / 10)}`
      : "0 matching results";
  }
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    matches = rows.map((_, index) => index).filter(index =>
      (searchValues[index] || rows[index].map(cell => cell.textContent).join(" ")).toLowerCase().includes(query));
    page = 0;
    update();
  });
  previous.addEventListener("click", () => { if (page > 0) { page--; update(); } });
  next.addEventListener("click", () => { if ((page + 1) * 10 < matches.length) { page++; update(); } });
  section.append(label, wrapper, empty, navigation);
  update();
  return section;
}

/**
 * Wrap content in a native, keyboard-accessible details/summary disclosure.
 * Supplying sectionLabel adds bulk controls above the disclosure, where they
 * remain available even when the section is collapsed.
 * @param {string} label - Text shown in the disclosure summary.
 * @param {HTMLElement} content
 * @param {string} [sectionLabel] - Main-section name for its bulk controls.
 * @returns {HTMLElement} A details element or a section wrapper with controls.
 */
function resultDisclosure(label, content, sectionLabel) {
  const details = resultElement("details", undefined, "result-disclosure");
  details.append(resultElement("summary", label));
  details.append(content);
  details.setResultsExpanded = expanded => {
    details.open = expanded;
    setResultsExpanded(content, expanded);
  };
  details.resultExpansionState = () => {
    const nested = resultExpansionState(content);
    return { open: nested.open + (details.open ? 1 : 0), total: nested.total + 1 };
  };
  details.addEventListener("toggle", refreshResultControls);
  if (!sectionLabel) return details;
  const section = resultElement("div", undefined, "result-section");
  section.append(resultExpansionControls(details, sectionLabel), details);
  return section;
}

/**
 * Recursively choose a readable presentation for a JSON value.
 *
 * Record arrays show up to three short fields and move remaining fields into
 * full-width detail panels. Keyed "test_results" objects use a dedicated table
 * with Test, Result, Weight and Details columns. Other objects use field lists;
 * booleans use badges, and long strings use expandable, linked text.
 *
 * @param {*} value - JSON value from the benchmark response.
 * @param {string} [caption="Benchmark results"] - Field/section display name.
 * @param {number} [depth=0] - Positive values wrap nonempty objects/arrays in a
 * disclosure. Rendering its contents resets depth to avoid wrapping it again.
 * @param {number} [sectionLevel=0] - Tracks nesting independently of depth; only
 * main sections receive bulk controls, avoiding repeated buttons inside them.
 * @returns {HTMLElement}
 */
function renderResult(value, caption = "Benchmark results", depth = 0, sectionLevel = 0) {
  const testResults = caption.replace(/[\s_-]/g, "").toLowerCase() === "testresults";
  if (depth > 0 && value && typeof value === "object" && Object.keys(value).length) {
    const count = Object.keys(value).length;
    const noun = testResults ? "test" : Array.isArray(value) ? "item" : "field";
    return resultDisclosure(`${caption} · ${count} ${noun}${count === 1 ? "" : "s"}`,
      renderResult(value, caption, 0, sectionLevel + 1), sectionLevel === 0 ? caption : undefined);
  }
  if (value === null || value === undefined) {
    return resultElement("span", "Not provided", "text-body-secondary");
  }
  if (typeof value === "boolean") {
    return resultElement("span", value ? "Yes" : "No",
      "badge rounded-pill " + (value ? "text-bg-success" : "text-bg-secondary"));
  }
  if (Array.isArray(value)) {
    if (!value.length) return resultElement("span", "No items returned", "text-body-secondary");
    const records = value.every(item => item !== null && typeof item === "object" && !Array.isArray(item));
    const keys = records ? [...new Set(value.flatMap(item => Object.keys(item)))] : [];
    if (keys.length) {
      const priority = ["name", "title", "test_name", "id", "passed", "status", "score"];
      const compactKeys = keys.filter(key => value.every(item => item[key] == null ||
        (typeof item[key] !== "object" && String(item[key]).length <= 120)));
      const visibleKeys = [...priority.filter(key => compactKeys.includes(key)),
        ...compactKeys.filter(key => !priority.includes(key))].slice(0, 3);
      const remaining = keys.filter(key => !visibleKeys.includes(key));
      const headers = ["#", ...visibleKeys.map(resultLabel), ...(remaining.length ? ["Details"] : [])];
      return resultTable(headers, value.map((item, index) => {
        const row = [resultElement("span", String(index + 1)),
          ...visibleKeys.map(key => renderResult(item[key], resultLabel(key), 1, sectionLevel + 1))];
        if (remaining.length) {
          row.push(resultElement("button", "Show details", "btn btn-outline-secondary btn-sm result-details-toggle"));
          row[row.length - 1].type = "button";
          row.detailsLabel = `Details for item ${index + 1}`;
          row.details = renderResult(Object.fromEntries(remaining.map(key => [key, item[key]])), row.detailsLabel, 0, sectionLevel + 1);
        }
        return row;
      }), caption, value.map(item => JSON.stringify(item)));
    }
    return resultTable(["#", "Value"], value.map((item, index) => [
      resultElement("span", String(index + 1)), renderResult(item, `Item ${index + 1}`, 1, sectionLevel + 1)
    ]), caption, value.map(item => JSON.stringify(item)));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return resultElement("span", "No results returned", "text-body-secondary");
    if (testResults) {
      const rows = entries.map(([test, result], index) => {
        const record = result !== null && typeof result === "object" && !Array.isArray(result);
        const row = [
          resultElement("span", String(index + 1)),
          resultText(test),
          renderResult(record ? result.result : result, "Result", 1, sectionLevel + 1),
          renderResult(record ? result.weight : null, "Weight", 1, sectionLevel + 1)
        ];
        const fields = record ? Object.entries(result).filter(([key]) => !["result", "weight"].includes(key)) : [];
        if (fields.length) {
          row.push(resultElement("button", "Show details", "btn btn-outline-secondary btn-sm result-details-toggle"));
          row[row.length - 1].type = "button";
          row.detailsLabel = `Details for ${test}`;
          row.details = renderResult(Object.fromEntries(fields), row.detailsLabel, 0, sectionLevel + 1);
        } else {
          row.push(resultElement("span", "No additional details", "text-body-secondary"));
        }
        return row;
      });
      return resultTable(["#", "Test", "Result", "Weight", "Details"], rows, caption,
        entries.map(([test, result]) => `${test} ${JSON.stringify(result)}`));
    }
    const list = resultElement("dl", undefined, "result-fields-list mb-0");
    for (const [key, item] of entries) {
      const complex = item !== null && typeof item === "object";
      const field = resultElement("div", undefined, "result-field" + (complex ? " result-field-complex" : ""));
      const expandable = complex && Object.keys(item).length > 0;
      field.append(resultElement("dt", resultLabel(key), expandable ? "visually-hidden" : undefined), resultElement("dd"));
      field.children[1].append(renderResult(item, resultLabel(key), 1, sectionLevel));
      list.append(field);
    }
    return list;
  }
  const text = value === "" ? "Empty" : String(value);
  const content = resultText(text);
  if (text.length > 180) {
    const preview = /https?:\/\//i.test(text)
      ? `${caption} — Read full text and links`
      : `${text.slice(0, 100)}… — Read full value`;
    return resultDisclosure(preview, content);
  }
  return content;
}

/**
 * Run the assessment once when this script loads on a benchmark page.
 * Reads endpoint and guid from #benchmark's data attributes, posts to the local
 * endpoint and renders its JSON response. Manages the elapsed-time indicator,
 * busy state, result controls and error/status messages. Always clears the timer
 * and busy state, including HTTP, network, parsing and rendering failures.
 * Does nothing on pages without #benchmark.
 * @returns {Promise<void>}
 */
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

    const resultContent = document.getElementById("benchmark-table");
    resultControlGroups = [];
    resultContent.replaceChildren(renderResult(data));
    document.getElementById("benchmark-expand-controls").replaceChildren(resultExpansionControls(resultContent, "all results"));
    refreshResultControls();
    results.hidden = false;
    document.getElementById("benchmark-status").textContent = "Assessment complete. Results are ready to explore.";
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
