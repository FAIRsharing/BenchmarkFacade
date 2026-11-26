const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../public/js/examples.js"), "utf8");

function startExamples() {
  const document = { activeElement: null };
  const forms = ["https://example.org/first?name=a&format=json", "https://example.org/second"].map(exampleUrl => {
    const input = { value: "https://example.org/original", focus() { document.activeElement = this; } };
    const form = { elements: { namedItem: name => name === "guid" ? input : null } };
    const buttons = [{ exampleUrl }, { clearGuid: "" }].map(dataset => ({
      dataset, form, listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      click() { this.listeners.click(); }
    }));
    return { input, exampleUrl, example: buttons[0], clear: buttons[1] };
  });
  document.querySelectorAll = () => forms.flatMap(form => [form.example, form.clear]);
  vm.runInNewContext(source, { document });
  return { forms, document };
}

test("example buttons fill and focus only their associated GUID field", () => {
  const { forms, document } = startExamples();
  assert.equal(forms[0].input.value, "https://example.org/original");
  assert.equal(forms[1].input.value, "https://example.org/original");

  forms[0].example.click();
  assert.equal(forms[0].input.value, forms[0].exampleUrl);
  assert.equal(forms[1].input.value, "https://example.org/original");
  assert.equal(document.activeElement, forms[0].input);

  forms[1].example.click();
  assert.equal(forms[1].input.value, forms[1].exampleUrl);
  assert.equal(forms[0].input.value, forms[0].exampleUrl);
  assert.equal(document.activeElement, forms[1].input);
});

test("clear buttons empty and focus only their associated GUID field", () => {
  const { forms, document } = startExamples();
  forms[0].example.click();
  forms[1].example.click();

  forms[0].clear.click();
  assert.equal(forms[0].input.value, "");
  assert.equal(forms[1].input.value, forms[1].exampleUrl);
  assert.equal(document.activeElement, forms[0].input);

  forms[0].example.click();
  forms[1].clear.click();
  assert.equal(forms[1].input.value, "");
  assert.equal(forms[0].input.value, forms[0].exampleUrl);
  assert.equal(document.activeElement, forms[1].input);
});

test("loads without errors when there are no example or clear buttons", () => {
  vm.runInNewContext(source, { document: { querySelectorAll: () => [] } });
});
