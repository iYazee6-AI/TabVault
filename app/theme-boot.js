// Loaded synchronously from <head>, before the stylesheet: an explicit Light or Dark
// choice (Settings > Appearance) is mirrored into localStorage by app.js, so the first
// paint already uses it. "System" needs no script: the prefers-color-scheme block in
// index.html applies the dark tokens by itself. MV3 extension pages cannot run inline
// scripts, hence a file.
(() => {
  let theme = null;
  try {
    theme = localStorage.getItem("tabvault.theme");
  } catch {
    /* storage unavailable: app.js applies the theme once settings load */
  }
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
})();
