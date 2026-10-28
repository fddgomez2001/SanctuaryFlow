// The light/dark switch, and the newest release's details from GitHub.
// Everything written into the page uses textContent; links are only ever
// pointed at this project's own GitHub release downloads.
(function () {
  "use strict";

  var REPO = "fddgomez2001/SanctuaryFlow";
  var ASSET = "SanctuaryFlow-Setup-x64.exe";
  var DOWNLOAD_PREFIX = "https://github.com/" + REPO + "/releases/download/";
  var root = document.documentElement;

  // Light / dark
  var toggle = document.querySelector("[data-theme-toggle]");
  var systemDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function currentTheme() {
    var chosen = root.getAttribute("data-theme");
    if (chosen === "light" || chosen === "dark") return chosen;
    return systemDark && systemDark.matches ? "dark" : "light";
  }
  function labelToggle() {
    if (!toggle) return;
    toggle.setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        window.localStorage.setItem("sf-theme", next);
      } catch (e) {
        // Not remembered when storage is blocked; the switch still works for this visit.
      }
      labelToggle();
    });
  }
  if (systemDark && systemDark.addEventListener) systemDark.addEventListener("change", labelToggle);
  labelToggle();

  // Release details
  function setText(selector, text) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }
  function megabytes(bytes) {
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function showRelease(release) {
    var assets = Array.isArray(release.assets) ? release.assets : [];
    var asset = null;
    for (var i = 0; i < assets.length; i++) if (assets[i] && assets[i].name === ASSET) asset = assets[i];
    if (!asset) return;

    var url = String(asset.browser_download_url || "");
    if (url.indexOf(DOWNLOAD_PREFIX) === 0) {
      var links = document.querySelectorAll("[data-download]");
      for (var j = 0; j < links.length; j++) links[j].setAttribute("href", url);
    }

    var version = String(release.tag_name || "").replace(/^v/, "");
    var size = typeof asset.size === "number" && asset.size > 0 ? megabytes(asset.size) : "";
    var updated = new Date(asset.updated_at || release.published_at || "");
    var digest = String(asset.digest || "");
    var sha = /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : "";

    if (version) setText("[data-version]", version);
    if (size) setText("[data-size]", size);
    if (!isNaN(updated.getTime())) setText("[data-updated]", updated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
    setText("[data-sha256]", sha || "Listed in SHA256SUMS.txt on the release page");
    var copy = document.querySelector("[data-copy-hash]");
    if (copy && !sha) copy.hidden = true;
    setText("[data-release-line]", ["Version " + version, size, "Windows 10 and 11, 64-bit"].filter(Boolean).join(" · "));

    var details = document.querySelector("[data-release]");
    var fallback = document.querySelector("[data-release-fallback]");
    if (details && version) details.hidden = false;
    if (fallback && version) fallback.hidden = true;
  }

  if (window.fetch) {
    window
      .fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
      })
      .then(function (response) {
        if (!response.ok) throw new Error("GitHub answered " + response.status);
        return response.json();
      })
      .then(showRelease)
      .catch(function () {
        // The buttons still download the newest installer; only the details are missing.
      });
  }

  // Copy the SHA-256
  var copyButton = document.querySelector("[data-copy-hash]");
  if (copyButton) {
    copyButton.addEventListener("click", function () {
      var code = document.querySelector("[data-sha256]");
      var text = code ? code.textContent : "";
      if (!text || !navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        copyButton.textContent = "Copied";
        window.setTimeout(function () {
          copyButton.textContent = "Copy";
        }, 1600);
      });
    });
  }
})();
