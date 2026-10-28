// Applies the visitor's remembered light or dark choice before the page is drawn.
// Without a choice the page follows the system setting (see site.css).
try {
  var saved = window.localStorage.getItem("sf-theme");
  if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
} catch (e) {
  // Storage can be blocked (private windows); the system setting is used instead.
}
