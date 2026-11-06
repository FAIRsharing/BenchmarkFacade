let resultDetailId = 0;
let resultControlGroups = [];

function resultLabel(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
    .replace(/^./, character => character.toUpperCase());
}

function resultElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function setResultsExpanded(root, expanded) {
  if (root.setResultsExpanded) {
    root.setResultsExpanded(expanded);
    return;
  }
  for (const child of root.children) setResultsExpanded(child, expanded);
}

function resultExpansionState(root) {
  if (root.resultExpansionState) return root.resultExpansionState();
  return [...root.children].reduce((state, child) => {
    const nested = resultExpansionState(child);
    return { open: state.open + nested.open, total: state.total + nested.total };
  }, { open: 0, total: 0 });
}

function refreshResultControls() {
  for (const { target, buttons } of resultControlGroups) {
    const state = resultExpansionState(target);
    buttons[0].setAttribute("aria-pressed", String(state.total > 0 && state.open === state.total));
    buttons[1].setAttribute("aria-pressed", String(state.total > 0 && state.open === 0));
  }
}

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

function renderResult(value, caption = "Benchmark results", depth = 0, sectionLevel = 0) {
  if (depth > 0 && value && typeof value === "object" && Object.keys(value).length) {
    const count = Object.keys(value).length;
    const noun = Array.isArray(value) ? "item" : "field";
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
  const content = resultElement("span", text, "result-value");
  if (text.length > 180) {
    return resultDisclosure(`${text.slice(0, 100)}… — Read full value`, content);
  }
  return content;
}

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
