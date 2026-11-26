document.querySelectorAll("button[data-example-url], button[data-clear-guid]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.form.elements.namedItem("guid");
    input.value = button.dataset.exampleUrl ?? "";
    input.focus();
  });
});
