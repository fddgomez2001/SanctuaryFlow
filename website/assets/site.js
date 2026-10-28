// The light/dark switch, and the newest installer's version, size and
// fingerprint. Everything written into the page uses textContent; the
// Download buttons always stay on this site's own /download address.
(function () {
  "use strict";

  var REPO = "fddgomez2001/SanctuaryFlow";
  var ASSET = "SanctuaryFlow-Setup-x64.exe";
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

    var version = String(release.tag_name || "").replace(/^v/, "");
    var size = typeof asset.size === "number" && asset.size > 0 ? megabytes(asset.size) : "";
    var updated = new Date(asset.updated_at || release.published_at || "");
    var digest = String(asset.digest || "");
    var sha = /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : "";

    if (version) setText("[data-version]", version);
    if (size) setText("[data-size]", size);
    if (!isNaN(updated.getTime())) setText("[data-updated]", updated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
    setText("[data-sha256]", sha);
    var hashRow = document.querySelector(".release-hash");
    if (hashRow && !sha) hashRow.hidden = true;
    setText("[data-release-line]", ["Free", "Version " + version, size, "Windows 10 and 11, 64-bit"].filter(Boolean).join(" · "));

    var details = document.querySelector("[data-release]");
    if (details && version) details.hidden = false;
  }

  if (window.fetch) {
    window
      .fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
      })
      .then(function (response) {
        if (!response.ok) throw new Error("Release details unavailable: " + response.status);
        return response.json();
      })
      .then(showRelease)
      .catch(function () {
        // The buttons still download the newest installer; only the details are missing.
      });
  }

  // The developer's portrait tilts toward the pointer, with light moving across the gold.
  var tilt = document.querySelector("[data-tilt]");
  var stage = tilt ? tilt.querySelector(".maker-stage") : null;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (tilt && stage && finePointer && !reduceMotion) {
    var frame = 0;
    tilt.addEventListener("pointermove", function (event) {
      var box = tilt.getBoundingClientRect();
      var x = Math.min(0.5, Math.max(-0.5, (event.clientX - box.left) / box.width - 0.5));
      var y = Math.min(0.5, Math.max(-0.5, (event.clientY - box.top) / box.height - 0.5));
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(function () {
        stage.classList.add("is-tilting");
        stage.style.transform = "rotateX(" + (-y * 14).toFixed(2) + "deg) rotateY(" + (x * 18).toFixed(2) + "deg)";
        stage.style.setProperty("--gx", (50 + x * 90).toFixed(1) + "%");
        stage.style.setProperty("--gy", (30 + y * 90).toFixed(1) + "%");
      });
    });
    tilt.addEventListener("pointerleave", function () {
      window.cancelAnimationFrame(frame);
      stage.classList.remove("is-tilting");
      stage.style.transform = "";
      stage.style.removeProperty("--gx");
      stage.style.removeProperty("--gy");
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
