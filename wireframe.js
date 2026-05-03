(() => {
  const tabs = [...document.querySelectorAll(".tab")];
  const views = [...document.querySelectorAll(".view")];
  const steps = [...document.querySelectorAll(".step")];
  const stepPanels = [...document.querySelectorAll(".step-panel")];

  function showView(name) {
    views.forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  }

  function showStep(stepNumber) {
    steps.forEach((s) => s.classList.toggle("active", s.dataset.step === String(stepNumber)));
    stepPanels.forEach((p) => p.classList.toggle("active", p.id === `step-${stepNumber}`));
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      showView(tab.dataset.view);
    });
  });

  steps.forEach((step) => {
    step.addEventListener("click", () => showStep(step.dataset.step));
  });

  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => showStep(btn.dataset.next));
  });
  document.querySelectorAll("[data-prev]").forEach((btn) => {
    btn.addEventListener("click", () => showStep(btn.dataset.prev));
  });

  showView("home");
  showStep(1);
})();
