// ==UserScript==
// @name         ACE-Step Gradio - Auto Next
// @namespace    ncz-mequavis
// @version      1.0
// @description  Clicks the "Next ▶" button whenever it's enabled (checks every 10s).
// @match        *://*/*
// @run-at       document-idle
// ==/UserScript==

//run this with autogen enabled and it will click the next button automatically. checks every ten seconds to see if it is disabled.
//run this with the auto_queue.py script to run a live radio station.
//all outputs are stored in the /gradio_outputs/ folder

(() => {
  "use strict";

  const INTERVAL_MS = 10_000;

  function findNextButton() {
    // Prefer exact text match on button content
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => (b.textContent || "").includes("Next ▶")) || null;
  }

  function isDisabled(btn) {
    // Handle native disabled + aria-disabled + class-based disabled states
    const native = btn.disabled === true || btn.hasAttribute("disabled");
    const aria = (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true";
    const cls = (btn.className || "").toLowerCase().includes("disabled");
    return native || aria || cls;
  }

  function tick() {
    const btn = findNextButton();
    if (!btn) return;

    if (!isDisabled(btn)) {
      btn.click();
      console.log("[AutoNext] Clicked:", btn);
    } else {
      console.log("[AutoNext] Button disabled, waiting…");
    }
  }

  // Start
  console.log("[AutoNext] Running. Checking every", INTERVAL_MS / 1000, "seconds.");
  setInterval(tick, INTERVAL_MS);
  tick();
})();
