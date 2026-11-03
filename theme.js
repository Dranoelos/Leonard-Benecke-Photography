// Apply a saved choice before the stylesheet paints; first visits start dark.
(() => {
  const root = document.documentElement;
  const key = "photography-theme";
  try {
    root.dataset.theme = localStorage.getItem(key) === "light" ? "light" : "dark";
  } catch {
    root.dataset.theme = "dark";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector("[data-theme-toggle]");
    if (!toggle) return;
    const update = () => {
      const dark = root.dataset.theme === "dark";
      toggle.setAttribute("aria-checked", String(dark));
      toggle.querySelector("[data-theme-label]").textContent = dark ? "Dark" : "Light";
      toggle.title = dark ? "Zum hellen Modus wechseln" : "Zum dunklen Modus wechseln";
    };
    toggle.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(key, root.dataset.theme); } catch { /* Private/file browsing can block storage. */ }
      update();
    });
    update();
  });
})();
