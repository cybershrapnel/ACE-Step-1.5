










// ✅ NCZ PATCH v3 (NO LOCKUP)
// - Fixes infinite MutationObserver loop by:
//   1) removing documentElement subtree childList observer
//   2) only touching btn.textContent when it actually changes
// - Default task_type="cover"
// - Button becomes "Advanced" when a file is selected
// - Advanced modal: cover/repaint + extra key/values
// - Clear upload stops/hides #uploadFilePlayer and restores button text/behavior
// - Fetch patch: forces /release_task POST to multipart when file selected

(() => {
  "use strict";
  if (window.__NCZ_SRC_ADV_V3__) return;
  window.__NCZ_SRC_ADV_V3__ = true;

  const LOG = "[ncz-src-adv-v3]";

  const BTN_ID = "__ncz_source_audio_btn__";
  const PLAYER_ID = "uploadFilePlayer";

  const STYLE_ID   = "__ncz_src_adv_v3_style__";
  const OVERLAY_ID = "__ncz_src_adv_v3_overlay__";
  const MODAL_ID   = "__ncz_src_adv_v3_modal__";

  const STORE_KEY = "NCZ_SRC_AUDIO_ADV_CFG_v3";

  const state = {
    btn: null,
    player: null,
    input: null,

    originalBtnText: null,
    bypassOnce: false,

    file: null,
    fileNameFromTitle: "",
    advancedMode: false,

    playerOrigDisplay: "",

    fields: loadSavedFields(),
originalBtnTitle: null,
ignoreTitleUntil: 0,
  };

  if (!state.fields.task_type) state.fields.task_type = "cover";
  saveFields();

  function loadSavedFields() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : {};
    } catch { return {}; }
  }
  function saveFields() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.fields || {})); } catch {}
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      c === "&" ? "&amp;" :
      c === "<" ? "&lt;" :
      c === ">" ? "&gt;" :
      c === '"' ? "&quot;" : "&#39;"
    ));
  }

  // ---------- Core element discovery ----------
  function findLikelyFileInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    if (!inputs.length) return null;

    const withFile = inputs.find(i => i.files && i.files.length);
    if (withFile) return withFile;

    const hinted = inputs.find(i =>
      /src_audio|source|upload/i.test(i.name || "") ||
      /src_audio|source|upload/i.test(i.id || "")
    );
    if (hinted) return hinted;

    const audioAccept = inputs.find(i => /audio/i.test(i.accept || ""));
    if (audioAccept) return audioAccept;

    return inputs[0] || null;
  }

  function attachCoreRefs() {
    if (!state.btn) {
      const b = document.getElementById(BTN_ID);
      if (b) {
        state.btn = b;
        if (state.originalBtnText == null) state.originalBtnText = b.textContent || "Source Audio";
if (state.originalBtnTitle == null) state.originalBtnTitle = b.getAttribute("title") || "";

        // Capture click ONLY when advancedMode is on
        b.addEventListener("click", (ev) => {
          if (state.bypassOnce) return;
          if (!state.advancedMode) return;
          ev.preventDefault();
          ev.stopPropagation();
          openModal();
        }, true);

        // Observe ONLY this button's title (app seems to set "Selected: ...")
        const titleObs = new MutationObserver(() => detectSelectedFromUI());
        titleObs.observe(b, { attributes: true, attributeFilter: ["title"] });

        console.debug(LOG, "hooked button", b);
      }
    }

    if (!state.player) {
      const p = document.getElementById(PLAYER_ID);
      if (p) {
        state.player = p;
        state.playerOrigDisplay = p.style.display || "";

        const mo = new MutationObserver(() => detectSelectedFromUI());
        mo.observe(p, { attributes: true, attributeFilter: ["src"] });

        p.addEventListener("loadedmetadata", detectSelectedFromUI);
        console.debug(LOG, "hooked player", p);
      }
    }

    if (!state.input) {
      const inp = findLikelyFileInput();
      if (inp) {
        state.input = inp;
        inp.addEventListener("change", () => {
          if (inp.files && inp.files.length) state.file = inp.files[0];
          detectSelectedFromUI();
        });
        console.debug(LOG, "hooked input", inp);
      }
    }

    // always run detection after attach attempt
    detectSelectedFromUI();
  }

  // ---------- Detect selection ----------
  let lastSelectedKey = "";
  function detectSelectedFromUI() {
    const btn = state.btn;
    const player = state.player;

    // title: "Selected: <file>"
    let titleFile = "";
    if (btn) {
      const t = btn.getAttribute("title") || "";
      const m = t.match(/Selected:\s*(.+)$/i);
      if (m) titleFile = (m[1] || "").trim();
    }
if (Date.now() < (state.ignoreTitleUntil || 0)) {
  titleFile = "";
}
    state.fileNameFromTitle = titleFile;

    // player blob
    const hasBlob = !!(player && typeof player.src === "string" && player.src.startsWith("blob:"));

    // update input + file
    const inp = findLikelyFileInput();
    if (inp && inp !== state.input) {
      state.input = inp;
      inp.addEventListener("change", () => {
        if (inp.files && inp.files.length) state.file = inp.files[0];
        detectSelectedFromUI();
      });
    }
    const hasFileObj = !!(state.input && state.input.files && state.input.files.length);
    if (hasFileObj) state.file = state.input.files[0];

    const selected = hasBlob || hasFileObj || !!titleFile;

    // Only react if the "selected-ness" actually changes (prevents churn)
    const key = [
      selected ? "1" : "0",
      hasBlob ? "B" : "-",
      hasFileObj ? "F" : "-",
      state.file?.name || "",
      titleFile || ""
    ].join("|");

    if (key !== lastSelectedKey) {
      lastSelectedKey = key;
      setAdvancedMode(!!selected);

      if (selected && player && player.style.display === "none") {
        player.style.display = state.playerOrigDisplay || "";
      }
    }
  }

  function setBtnTextSafe(text) {
    if (!state.btn) return;
    const cur = state.btn.textContent || "";
    if (cur !== text) state.btn.textContent = text; // ✅ only change if different
  }

  function setAdvancedMode(on) {
    on = !!on;
    if (state.advancedMode === on) {
      // still ensure correct label without spamming mutations
      if (state.btn) {
        if (on) setBtnTextSafe("Advanced");
        else setBtnTextSafe(state.originalBtnText || "Source Audio");
      }
      return;
    }

    state.advancedMode = on;

    if (!state.btn) return;
    if (state.originalBtnText == null) state.originalBtnText = state.btn.textContent || "Source Audio";

    if (on) {
      setBtnTextSafe("Advanced");
      state.btn.setAttribute("data-ncz-adv", "1");
      console.debug(LOG, "Advanced ON", { file: state.file?.name || state.fileNameFromTitle || "(unknown)" });
    } else {
      setBtnTextSafe(state.originalBtnText || "Source Audio");
      state.btn.removeAttribute("data-ncz-adv");
      console.debug(LOG, "Advanced OFF");
    }
  }

  // ---------- Modal UI ----------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#${OVERLAY_ID}{position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:2147483646; display:none;}
#${MODAL_ID}{
  position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(720px, calc(100vw - 24px));
  max-height:min(85vh, calc(100vh - 24px));
  overflow:auto; background:#121726; color:#e9eefc;
  border:1px solid #1e2742; border-radius:16px;
  box-shadow:0 10px 30px rgba(0,0,0,.45);
  z-index:2147483647; display:none;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
}
#${MODAL_ID} .h{display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #1e2742;}
#${MODAL_ID} .h .t{font-size:15px; font-weight:800;}
#${MODAL_ID} .h .x{cursor:pointer; user-select:none; width:32px; height:32px; display:grid; place-items:center; border-radius:10px; border:1px solid #1e2742; background:#0f1320;}
#${MODAL_ID} .b{padding:14px 16px; display:grid; gap:12px;}
#${MODAL_ID} .card{border:1px solid #1e2742; background:#0f1320; border-radius:14px; padding:12px; display:grid; gap:10px;}
#${MODAL_ID} .row{display:flex; gap:10px; align-items:center; flex-wrap:wrap;}
#${MODAL_ID} .btn{cursor:pointer; user-select:none; padding:8px 12px; border-radius:12px; border:1px solid #1e2742; background:#121726; color:#e9eefc; font-weight:700; font-size:13px;}
#${MODAL_ID} .danger{border-color:#5a2430; background:#1a0f14; color:#ffb3c0;}
#${MODAL_ID} .good{border-color:#1f3c2c; background:#0f1a14; color:#a9f5c9;}
#${MODAL_ID} .hint{font-size:12px; color:#a9b3cf; line-height:1.35;}
#${MODAL_ID} input[type="text"]{
  width:min(420px, 100%); padding:8px 10px; border-radius:12px;
  border:1px solid #1e2742; background:#121726; color:#e9eefc; outline:none;
}`.trim();
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureModal() {
    injectStyle();

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.addEventListener("click", closeModal);
      document.body.appendChild(overlay);
    }

    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = MODAL_ID;
      modal.innerHTML = `
        <div class="h">
          <div class="t">Advanced Source Audio</div>
          <div class="x" title="Close">✕</div>
        </div>
        <div class="b">
          <div class="card">
            <div class="row" style="justify-content:space-between">
              <div id="__ncz_src_adv_v3_fileline__">No file selected.</div>
              <div class="row">
                <button class="btn" id="__ncz_src_adv_v3_change__" type="button">Change file</button>
                <button class="btn danger" id="__ncz_src_adv_v3_clear__" type="button">Clear upload</button>
              </div>
            </div>
            <div class="hint">
              If a file is selected, <b>/release_task</b> is forced to <b>multipart</b> and we inject <b>task_type</b>.
            </div>
          </div>

          <div class="card">
            <div class="row">
              <div style="min-width:96px;font-weight:800">task_type</div>
              <label class="row" style="gap:6px;margin:0"><input type="radio" name="__ncz_tt__" value="cover"> <span>cover</span></label>
              <label class="row" style="gap:6px;margin:0"><input type="radio" name="__ncz_tt__" value="repaint"> <span>repaint</span></label>
            </div>
            <div class="hint">Default is <b>cover</b>.</div>
          </div>

          <div class="card">
            <div style="font-weight:900">Extra fields</div>
            <div class="hint">These key/values will be appended to the multipart form.</div>
            <div class="row">
              <input id="__ncz_src_adv_v3_k__" type="text" placeholder="field name (ex: prompt)">
              <input id="__ncz_src_adv_v3_v__" type="text" placeholder="value">
              <button class="btn" id="__ncz_src_adv_v3_add__" type="button">Add</button>
            </div>
            <div id="__ncz_src_adv_v3_list__" class="hint"></div>
          </div>

          <div class="row" style="justify-content:flex-end">
            <button class="btn good" id="__ncz_src_adv_v3_close__" type="button">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector(".x").addEventListener("click", closeModal);
      modal.querySelector("#__ncz_src_adv_v3_close__").addEventListener("click", closeModal);

      modal.querySelector("#__ncz_src_adv_v3_clear__").addEventListener("click", () => {
        clearUpload();
        closeModal();
      });

      modal.querySelector("#__ncz_src_adv_v3_change__").addEventListener("click", () => {
        if (state.input) {
          state.input.click();
        } else if (state.btn) {
          state.bypassOnce = true;
          setTimeout(() => { state.bypassOnce = false; }, 500);
          state.btn.click();
        }
      });

      modal.querySelectorAll('input[name="__ncz_tt__"]').forEach(r => {
        r.addEventListener("change", () => {
          state.fields.task_type = r.value;
          saveFields();
        });
      });

      modal.querySelector("#__ncz_src_adv_v3_add__").addEventListener("click", () => {
        const k = (modal.querySelector("#__ncz_src_adv_v3_k__").value || "").trim();
        const v = (modal.querySelector("#__ncz_src_adv_v3_v__").value || "").trim();
        if (!k) return;

        if (!Array.isArray(state.fields.__kv__)) state.fields.__kv__ = [];
        state.fields.__kv__.push({ k, v });
        saveFields();

        modal.querySelector("#__ncz_src_adv_v3_k__").value = "";
        modal.querySelector("#__ncz_src_adv_v3_v__").value = "";
        renderKV();
      });
    }

    return { overlay, modal };
  }

  function renderKV() {
    const el = document.getElementById("__ncz_src_adv_v3_list__");
    if (!el) return;
    const kv = Array.isArray(state.fields.__kv__) ? state.fields.__kv__ : [];
    if (!kv.length) {
      el.innerHTML = `<span style="color:#a9b3cf">No extra fields added.</span>`;
      return;
    }

    el.innerHTML = kv.map((p, i) => {
      const k = escapeHtml(p.k);
      const v = escapeHtml(p.v ?? "");
      return `
        <div class="row" style="justify-content:space-between">
          <div><b>${k}</b> = <span>${v}</span></div>
          <button class="btn danger" type="button" data-i="${i}">Remove</button>
        </div>
      `;
    }).join("");

    el.querySelectorAll("button[data-i]").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-i"), 10);
        const kv2 = Array.isArray(state.fields.__kv__) ? state.fields.__kv__ : [];
        kv2.splice(i, 1);
        state.fields.__kv__ = kv2;
        saveFields();
        renderKV();
      });
    });
  }

  function refreshModalFileLine() {
    const line = document.getElementById("__ncz_src_adv_v3_fileline__");
    if (!line) return;
    const f = state.file;
    if (f) {
      line.innerHTML = `Selected: <b>${escapeHtml(f.name)}</b> <span style="color:#a9b3cf">(${(f.size/1024/1024).toFixed(2)} MB)</span>`;
    } else if (state.fileNameFromTitle) {
      line.innerHTML = `Selected: <b>${escapeHtml(state.fileNameFromTitle)}</b>`;
    } else {
      line.textContent = "No file selected.";
    }
  }

  function syncTaskTypeRadios() {
    const v = state.fields.task_type || "cover";
    document.querySelectorAll(`#${MODAL_ID} input[name="__ncz_tt__"]`).forEach(r => {
      r.checked = (r.value === v);
    });
  }

  function openModal() {
    const { overlay, modal } = ensureModal();
    overlay.style.display = "block";
    modal.style.display = "block";
    detectSelectedFromUI();
    refreshModalFileLine();
    syncTaskTypeRadios();
    renderKV();
  }

  function closeModal() {
    const overlay = document.getElementById(OVERLAY_ID);
    const modal = document.getElementById(MODAL_ID);
    if (overlay) overlay.style.display = "none";
    if (modal) modal.style.display = "none";
  }

  // ---------- Clear upload ----------
  function clearUpload() {
    console.debug(LOG, "clear upload");
state.ignoreTitleUntil = Date.now() + 1500; // 1.5s is usually plenty

    if (state.input) {
      try {
        state.input.value = "";
      } catch {
        const old = state.input;
        const nu = old.cloneNode(true);
        old.parentNode?.replaceChild(nu, old);
        state.input = nu;
        nu.addEventListener("change", () => {
          if (nu.files && nu.files.length) state.file = nu.files[0];
          detectSelectedFromUI();
        });
      }
    }

    state.file = null;
    state.fileNameFromTitle = "";

    if (state.player) {
      try { state.player.pause(); } catch {}
      try { state.player.currentTime = 0; } catch {}
      try { state.player.removeAttribute("src"); state.player.load(); } catch {}
      state.player.style.display = "none";
    }
// Restore / clear stale "Selected: ..." tooltip so it doesn't re-trigger Advanced
if (state.btn) {
  if (state.originalBtnTitle) state.btn.setAttribute("title", state.originalBtnTitle);
  else state.btn.removeAttribute("title");
}

// Reset key so detect doesn't get stuck
lastSelectedKey = "";
setAdvancedMode(false);

// Re-check after UI settles (some apps update title/player async)
setTimeout(() => detectSelectedFromUI(), 0);
setTimeout(() => detectSelectedFromUI(), 200);





    setAdvancedMode(false);
  }

  // ---------- fetch patch ----------
  const _fetch = window.fetch.bind(window);

  function isReleaseTaskUrl(url) {
    return /release_task/i.test(url);
  }

  function applyFieldsToFormData(fd) {
    fd.set("task_type", state.fields.task_type || "cover");

    const kv = Array.isArray(state.fields.__kv__) ? state.fields.__kv__ : [];
    for (const p of kv) {
      const k = (p?.k || "").trim();
      if (!k) continue;
      fd.set(k, String(p?.v ?? ""));
    }
    return fd;
  }

  async function requestToBody(req) {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    try {
      if (ct.includes("multipart/form-data")) return await req.clone().formData();
      return await req.clone().text();
    } catch { return null; }
  }

  window.fetch = async (input, init) => {
    try {
      const req = (input instanceof Request) ? input : null;
      const url = req ? req.url : (typeof input === "string" ? input : String(input));
      if (!isReleaseTaskUrl(url)) return _fetch(input, init);

      const method = ((init && init.method) || (req && req.method) || "GET").toUpperCase();
      if (method !== "POST") return _fetch(input, init);

      detectSelectedFromUI();

      const headers = new Headers((init && init.headers) || (req && req.headers) || undefined);

      let body = init && "body" in init ? init.body : undefined;
      if (body == null && req) {
        body = await requestToBody(req);
        input = req.url;
        init = { ...(init || {}), method: req.method, headers };
      }

      if (body instanceof FormData) {
        if (state.file) {
          const cur = body.get("src_audio");
          if (!(cur instanceof File)) body.set("src_audio", state.file, state.file.name);
        }
        applyFieldsToFormData(body);
        headers.delete("content-type");
        console.debug(LOG, "release_task multipart keep", {
          task_type: body.get("task_type"),
          file: state.file?.name
        });
        return _fetch(input, { ...(init || {}), headers, body });
      }

      let jsonObj = null;
      if (typeof body === "string") {
        try { jsonObj = JSON.parse(body); } catch {}
      } else if (body && typeof body === "object") {
        jsonObj = body;
      }

      if (jsonObj && state.file) {
        const fd = new FormData();

        for (const [k, v] of Object.entries(jsonObj)) {
          if (k === "src_audio") continue;
          if (v == null) continue;
          fd.append(k, (typeof v === "object") ? JSON.stringify(v) : String(v));
        }

        fd.set("src_audio", state.file, state.file.name);
        applyFieldsToFormData(fd);

        headers.delete("content-type");
        console.debug(LOG, "Switched /release_task to multipart upload", {
          field: "src_audio",
          task_type: fd.get("task_type"),
          file: state.file.name
        });

        return _fetch(input, { ...(init || {}), headers, body: fd });
      }

      return _fetch(input, init);
    } catch (e) {
      console.warn(LOG, "fetch patch error:", e);
      return _fetch(input, init);
    }
  };

  // ---------- Lightweight attach loop (no DOM-wide observer) ----------
  // Try a few times, then stop. If your UI is SPA-swappy and replaces nodes later,
  // you can increase MAX_TRIES.
  let tries = 0;
  const MAX_TRIES = 40; // ~10s at 250ms
  const t = setInterval(() => {
    tries++;
    attachCoreRefs();
    if ((state.btn && state.player) || tries >= MAX_TRIES) clearInterval(t);
  }, 250);

  attachCoreRefs();

  // Console helpers
  window.NCZ_SRC_ADV_V3 = {
    open: () => openModal(),
    close: () => closeModal(),
    clear: () => clearUpload(),
    state
  };

  console.debug(LOG, "Installed. Default task_type=cover. Use NCZ_SRC_ADV_V3.open() to open modal.");
})();

























// ✅ NCZ PATCH: Subscribe / Support modal (3 Monthly tiers + 1 One-time) + CashApp + Patreon
// - FIX: Only loads PayPal SDK ONCE + renders buttons ONCE (tab switching just show/hide)
// - Idempotent (safe to paste multiple times)
// - One-time button reads amount at click-time (no rerender needed)
(() => {
  "use strict";

  // ---------------------------
  // CONFIG (EDIT THESE)
  // ---------------------------
  const PAYPAL_CLIENT_ID = "AbGuHDLZqatL1G4jraYZlty8RdPC0FFaftms558bJ_KLfjCzLoGDr9Q81jxqOlzQnirBuCV304iqLA63"; // <-- your LIVE client-id (public OK)
  const CURRENCY = "USD";

  // 3 monthly tier plan IDs (LIVE plan ids)
  const SUB_PLANS = [
    { label: "$2 / month",  plan_id: "P-0JW29110UP738773HNGL6YWQ" },
    { label: "$5 / month",  plan_id: "P-07489326B5566530MNGL6XXA" },
    { label: "$9.99 / month", plan_id: "P-5YR01837T5049301UNGL55PY" },
  ];

  // One-time support defaults
  const ONE_TIME_DEFAULT = "5.00";
  const ONE_TIME_PRESETS = ["2.00", "5.00", "10.00", "25.00", "50.00"];

  // Other support options
  const CASHAPP_HANDLE = "$nanocheeze";
  const CASHAPP_LINK = "https://cash.app/$nanocheeze";
  const PATREON_LINK = "https://www.patreon.com/hybridtales";

  // Optional: if you want a fallback link shown in the modal (leave "" to hide)
  const FALLBACK_PAYPAL_LINK = "";

  // ---------------------------
  // Constants / IDs
  // ---------------------------
  const SID_ID = "__ncz_leftbar__";
  const ITEM_ID = "__ncz_subscribe_item__";
  const STYLE_ID = "__ncz_subscribe_style__";
  const OVERLAY_ID = "__ncz_subscribe_overlay__";
  const MODAL_ID = "__ncz_subscribe_modal__";
  const MSG_ID = "__ncz_subscribe_msg__";
  const TAB_WRAP_ID = "__ncz_subscribe_tabs__";

  const ONE_TIME_WRAP_ID = "__ncz_pp_onetime_wrap__";
  const SUB_WRAP_ID = "__ncz_pp_sub_wrap__";

  const AMT_INP_ID = "__ncz_pp_amount__";
  const STORE_AMT = "NCZ_UI_PP_AMOUNT";

  const SDK_ID = "__ncz_pp_sdk_single__";

  const side = document.getElementById(SID_ID);
  if (!side) {
    console.warn("[subscribe] leftbar not found yet (#__ncz_leftbar__). Paste this AFTER the leftbar script.");
    return;
  }
  const body = side.querySelector(".__ncz_lb_body__");
  if (!body) return;

  // ---------------------------
  // Styles (once)
  // ---------------------------
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${OVERLAY_ID}{
        position:fixed; inset:0;
        z-index: 1000002;
        background: rgba(0,0,0,.55);
        display:none;
      }
      #${OVERLAY_ID}.__show__{ display:block; }

      #${MODAL_ID}{
        position:fixed;
        z-index: 1000003;
        left:50%; top:50%;
        transform: translate(-50%, -50%);
        width: min(780px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow:auto;

        background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,.60);
        backdrop-filter: blur(10px);
        display:none;
      }
      #${MODAL_ID}.__show__{ display:block; }

      #${MODAL_ID} .__hd__{
        padding: 14px 14px 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: linear-gradient(180deg, rgba(18,23,38,.92), rgba(18,23,38,.35));
        display:flex; align-items:center; justify-content:space-between; gap:10px;
      }
      #${MODAL_ID} .__ttl__{
        font-weight: 900;
        font-size: 14px;
        color: rgba(233,238,252,.96);
        display:flex; align-items:center; gap:10px;
      }
      #${MODAL_ID} .__bd__{ padding: 14px; }
      #${MODAL_ID} .__muted__{ color: rgba(169,179,207,.95); font-size: 12px; line-height:1.5; }

      #${MODAL_ID} .__box__{
        margin-top: 12px;
        border: 1px solid rgba(255,255,255,.09);
        background: rgba(0,0,0,.22);
        border-radius: 14px;
        padding: 12px;
      }

      #${TAB_WRAP_ID}{
        display:flex; gap:8px; flex-wrap:wrap;
        margin-top: 10px;
      }
      #${TAB_WRAP_ID} button{
        padding: 8px 10px;
        border-radius: 12px;
        font-weight: 900;
        font-size: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.08);
        color: rgba(233,238,252,.95);
        cursor:pointer;
      }
      #${TAB_WRAP_ID} button.__on__{
        background: rgba(106,166,255,.20);
        border-color: rgba(106,166,255,.32);
      }

      #${MODAL_ID} .__close__{
        border: 0;
        background: rgba(255,255,255,.08);
        color: rgba(233,238,252,.95);
        padding: 8px 10px;
        border-radius: 12px;
        cursor:pointer;
        font-weight: 900;
        line-height: 1;
      }
      #${MODAL_ID} .__close__:hover{ background: rgba(255,255,255,.12); }

      #${MODAL_ID} input[type="text"]{
        width: 140px;
        background: rgba(7,10,18,.65);
        color: rgba(233,238,252,.95);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        padding: 10px 10px;
        font-size: 13px;
        outline:none;
        font-family: var(--mono, ui-monospace);
      }

      #${MODAL_ID} .__pillbtn__{
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(0,0,0,.18);
        color: rgba(233,238,252,.95);
        padding: 8px 10px;
        border-radius: 999px;
        cursor:pointer;
        font-weight: 900;
        font-size: 12px;
      }
      #${MODAL_ID} .__pillbtn__:hover{ background: rgba(0,0,0,.28); border-color: rgba(106,166,255,.25); }

      #${MSG_ID}{
        margin-top: 10px;
        white-space: pre-wrap;
        font-size: 12px;
        color: rgba(169,179,207,.95);
      }

      /* Tier grid */
      #${MODAL_ID} .__tiergrid__{
        display:grid;
        grid-template-columns: 1fr;
        gap: 10px;
        margin-top: 10px;
      }
      @media (min-width: 680px){
        #${MODAL_ID} .__tiergrid__{ grid-template-columns: 1fr 1fr 1fr; }
      }
      #${MODAL_ID} .__tier__{
        border: 1px solid rgba(255,255,255,.09);
        background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.18));
        border-radius: 14px;
        padding: 10px;
      }
      #${MODAL_ID} .__tier__ .__t__{
        font-weight: 900;
        color: rgba(233,238,252,.96);
        margin-bottom: 8px;
        font-size: 13px;
      }

      /* Fancy support cards */
      #${MODAL_ID} .__supportgrid__{
        margin-top: 12px;
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 640px){
        #${MODAL_ID} .__supportgrid__{ grid-template-columns: 1fr; }
      }
      #${MODAL_ID} .__supportcard__{
        border: 1px solid rgba(255,255,255,.09);
        background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.18));
        border-radius: 14px;
        padding: 12px;
      }
      #${MODAL_ID} .__supportcard__ .__h__{
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        font-weight: 900;
        color: rgba(233,238,252,.96);
        margin-bottom: 6px;
      }
      #${MODAL_ID} .__supportcard__ .__k__{
        font-family: var(--mono, ui-monospace);
        font-weight: 900;
        font-size: 13px;
        color: rgba(233,238,252,.96);
      }
      #${MODAL_ID} .__supportcard__ a{
        color: rgba(106,166,255,.95);
        text-decoration: none;
        font-weight: 900;
      }
      #${MODAL_ID} .__supportcard__ a:hover{ text-decoration: underline; }
      #${MODAL_ID} .__copybtn__{
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(0,0,0,.18);
        color: rgba(233,238,252,.95);
        padding: 6px 10px;
        border-radius: 999px;
        cursor:pointer;
        font-weight: 900;
        font-size: 12px;
        white-space: nowrap;
      }
      #${MODAL_ID} .__copybtn__:hover{ background: rgba(0,0,0,.28); border-color: rgba(106,166,255,.25); }
    `;
    document.head.appendChild(st);
  }

  // ---------------------------
  // Add sidebar item (once)
  // ---------------------------
  if (!document.getElementById(ITEM_ID)) {
    const item = document.createElement("div");
    item.className = "__ncz_lb_item__";
    item.id = ITEM_ID;
    item.title = "Subscribe / Support";
    item.innerHTML = `
      <div class="__ncz_lb_icon__">💳</div>
      <div class="__ncz_lb_labelwrap__" style="min-width:0">
        <div class="__ncz_lb_label__">Subscribe</div>
        <div class="__ncz_lb_hint__">Support the service</div>
      </div>
    `;

    const after = body.querySelector('[data-action="songs"]') || body.querySelector('[data-action="generate"]') || null;
    if (after && after.parentElement === body) body.insertBefore(item, after.nextSibling);
    else body.insertBefore(item, body.firstChild);

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    });
  }

  // ---------------------------
  // Modal creation
  // ---------------------------
  function ensureModal() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.addEventListener("click", closeModal);
      document.body.appendChild(overlay);
    }

    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = MODAL_ID;
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");

      // Monthly default
      modal.innerHTML = `
        <div class="__hd__">
          <div class="__ttl__"><span style="font-size:16px">💳</span> Subscribe / Support</div>
          <button class="__close__" type="button" title="Close">✖</button>
        </div>
        <div class="__bd__">
          <div class="__muted__">
            Everything is free right now — support is voluntary.<br/>
            If you want to help keep this running (capacity, priority queue, storage, compute), pick a monthly tier or do a one-time contribution.
          </div>

          <div id="${TAB_WRAP_ID}">
            <button type="button" data-tab="sub" class="__on__">Monthly</button>
            <button type="button" data-tab="one">One-time</button>
          </div>

          <div class="__box__" data-pane="sub">
            <div class="__muted__" style="font-weight:900; margin-bottom:6px">Choose a monthly tier:</div>
            <div id="${SUB_WRAP_ID}">
              <div class="__tiergrid__" id="__ncz_pp_tier_grid__"></div>
            </div>
          </div>

          <div class="__box__" data-pane="one" style="display:none">
            <div class="__muted__" style="font-weight:900; margin-bottom:6px">One-time support:</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
              <div class="__muted__" style="font-weight:900">Amount (${CURRENCY}):</div>
              <input id="${AMT_INP_ID}" type="text" inputmode="decimal" value="${ONE_TIME_DEFAULT}" />
              <div style="display:flex; gap:8px; flex-wrap:wrap">
                ${ONE_TIME_PRESETS.map(v => `<button type="button" class="__pillbtn__" data-amt="${v}">$${v}</button>`).join("")}
              </div>
            </div>
            <div id="${ONE_TIME_WRAP_ID}" style="margin-top:10px"></div>
            <div class="__muted__" style="margin-top:8px">Thanks! Keep the AI dream alive...</div>
          </div>

          <div class="__box__">
            <div class="__muted__" style="font-weight:900; margin-bottom:8px">Support us either way:</div>
            <div class="__supportgrid__">
              <div class="__supportcard__">
                <div class="__h__">
                  <div>💚 Cash App</div>
                  <button class="__copybtn__" type="button" data-copy="${CASHAPP_HANDLE}">Copy</button>
                </div>
                <div class="__k__">${CASHAPP_HANDLE}</div>
                <div class="__muted__" style="margin-top:6px">
                  Quick support:
                  <a href="${CASHAPP_LINK}" target="_blank" rel="noopener noreferrer">cash.app/${CASHAPP_HANDLE.replace("$","")}</a>
                </div>
              </div>

              <div class="__supportcard__">
                <div class="__h__">
                  <div>🧡 Patreon</div>
                  <a href="${PATREON_LINK}" target="_blank" rel="noopener noreferrer">Open</a>
                </div>
                <div class="__k__">Hybrid Tales</div>
                <div class="__muted__" style="margin-top:6px">
                  Ongoing support + community:
                  <a href="${PATREON_LINK}" target="_blank" rel="noopener noreferrer">patreon.com/hybridtales</a>
                </div>
              </div>
            </div>

            ${FALLBACK_PAYPAL_LINK ? `
              <div class="__muted__" style="margin-top:10px">
                Fallback link:
                <a href="${FALLBACK_PAYPAL_LINK}" target="_blank" rel="noopener noreferrer">${FALLBACK_PAYPAL_LINK}</a>
              </div>
            ` : ""}
          </div>

          <div id="${MSG_ID}"></div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector(".__close__")?.addEventListener("click", closeModal);
      modal.addEventListener("click", (e) => e.stopPropagation());

      // tabs
      modal.querySelectorAll(`#${TAB_WRAP_ID} button[data-tab]`).forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          setTab(btn.getAttribute("data-tab") || "sub");
        });
      });

      // presets
      modal.querySelectorAll(`button[data-amt]`).forEach(b => {
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const v = b.getAttribute("data-amt") || "";
          const inp = document.getElementById(AMT_INP_ID);
          if (inp) {
            inp.value = v;
            try { localStorage.setItem(STORE_AMT, v); } catch {}
            setMsg(`Amount set to $${v} (used when you click PayPal).`);
          }
        });
      });

      // amount persistence
      const amtInp = modal.querySelector(`#${AMT_INP_ID}`);
      if (amtInp) {
        try {
          const saved = localStorage.getItem(STORE_AMT);
          if (saved) amtInp.value = saved;
        } catch {}
        amtInp.addEventListener("change", () => {
          try { localStorage.setItem(STORE_AMT, amtInp.value.trim()); } catch {}
          setMsg(`Amount updated (used when you click PayPal).`);
        });
      }

      // copy buttons
      modal.querySelectorAll(`button[data-copy]`).forEach(b => {
        b.addEventListener("click", async (e) => {
          e.preventDefault();
          const txt = b.getAttribute("data-copy") || "";
          try {
            await navigator.clipboard.writeText(txt);
            setMsg(`✅ Copied: ${txt}`);
            setTimeout(() => setMsg(""), 1200);
          } catch {
            setMsg(`Copy failed — ${txt}`);
          }
        });
      });
    }

    // ESC closes
    if (!window.__nczSubEscBound) {
      window.__nczSubEscBound = true;
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          const ov = document.getElementById(OVERLAY_ID);
          if (ov && ov.classList.contains("__show__")) closeModal();
        }
      });
    }

    return { overlay, modal };
  }

  function openModal() {
    const { overlay, modal } = ensureModal();
    overlay.classList.add("__show__");
    modal.classList.add("__show__");
    setMsg("");

    // Monthly default
    setTab("sub");

    // Load SDK once and render buttons once
    ensurePayPalSdk()
      .then(() => renderButtonsOnce())
      .catch((err) => setMsg(`PayPal SDK failed to load.\n${String(err && err.message || err)}`));
  }

  function closeModal() {
    document.getElementById(OVERLAY_ID)?.classList.remove("__show__");
    document.getElementById(MODAL_ID)?.classList.remove("__show__");
  }

  function setMsg(s) {
    const el = document.getElementById(MSG_ID);
    if (el) el.textContent = String(s || "");
  }

  function setTab(which) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const onePane = modal.querySelector('[data-pane="one"]');
    const subPane = modal.querySelector('[data-pane="sub"]');

    const oneBtn = modal.querySelector(`#${TAB_WRAP_ID} button[data-tab="one"]`);
    const subBtn = modal.querySelector(`#${TAB_WRAP_ID} button[data-tab="sub"]`);

    const isOne = (which === "one");

    if (onePane) onePane.style.display = isOne ? "" : "none";
    if (subPane) subPane.style.display = isOne ? "none" : "";

    oneBtn?.classList.toggle("__on__", isOne);
    subBtn?.classList.toggle("__on__", !isOne);
  }

  // ---------------------------
  // PayPal SDK loader (SINGLE)
  // ---------------------------
  function ensurePayPalSdk() {
    // If another PayPal SDK is already on the page, DO NOT load again.
    if (window.paypal && typeof window.paypal.Buttons === "function") return Promise.resolve(true);

    // already loading?
    if (window.__nczPayPalSingleLoading) return window.__nczPayPalSingleLoading;

    if (!PAYPAL_CLIENT_ID) return Promise.reject(new Error("Missing PAYPAL_CLIENT_ID"));

    // Use subscription intent + vault so createSubscription works.
    // One-time createOrder also works in practice because createOrder runs actions.order.create.
    const src =
      "https://www.paypal.com/sdk/js" +
      `?client-id=${encodeURIComponent(PAYPAL_CLIENT_ID)}` +
      `&currency=${encodeURIComponent(CURRENCY)}` +
      `&components=buttons` +
      `&vault=true&intent=subscription`;

    window.__nczPayPalSingleLoading = new Promise((resolve, reject) => {
      if (document.getElementById(SDK_ID)) return resolve(true);

      const s = document.createElement("script");
      s.id = SDK_ID;
      s.src = src;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error("PayPal SDK script load error."));
      document.head.appendChild(s);
    });

    return window.__nczPayPalSingleLoading;
  }

  // ---------------------------
  // Button rendering (ONCE)
  // ---------------------------
  function getAmount() {
    const inp = document.getElementById(AMT_INP_ID);
    let v = (inp ? inp.value : ONE_TIME_DEFAULT) || ONE_TIME_DEFAULT;
    v = String(v).trim().replace(/[^0-9.]/g, "");
    if (!v || isNaN(Number(v)) || Number(v) <= 0) v = ONE_TIME_DEFAULT;
    return Number(v).toFixed(2);
  }

  function renderButtonsOnce() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    if (modal.dataset.__pp_rendered__ === "1") return;
    modal.dataset.__pp_rendered__ = "1";

    if (!window.paypal || typeof window.paypal.Buttons !== "function") {
      setMsg("PayPal not ready yet…");
      return;
    }

    // 1) Render subscription tier buttons (3)
    const grid = modal.querySelector("#__ncz_pp_tier_grid__");
    if (grid) {
      grid.innerHTML = ""; // build once
      SUB_PLANS.forEach((p, idx) => {
        const planId = (p && p.plan_id) ? String(p.plan_id) : "";
        const label = (p && p.label) ? String(p.label) : `Plan ${idx + 1}`;

        const card = document.createElement("div");
        card.className = "__tier__";
        const btnHostId = `__ncz_pp_sub_btn_${idx}__`;

        card.innerHTML = `
          <div class="__t__">${label}</div>
          <div id="${btnHostId}"></div>
        `;
        grid.appendChild(card);

        if (!planId || planId.includes("REPLACE_WITH")) {
          const host = card.querySelector(`#${btnHostId}`);
          if (host) host.innerHTML = `<div class="__muted__">Missing plan_id for this tier.</div>`;
          return;
        }

        try {
          // Force PayPal funding for subs to avoid “unavailable” card/credit mess
          window.paypal.Buttons({
            fundingSource: window.paypal.FUNDING.PAYPAL,
            style: { layout: "vertical" },

            createSubscription: (data, actions) => {
              setMsg("");
              return actions.subscription.create({ plan_id: planId });
            },

            onApprove: (data) => {
              setMsg(`✅ Subscription created (${label})\nSubscription ID: ${data.subscriptionID}\n(You can close this window now.)`);
            },

            onError: (err) => {
              setMsg(`❌ PayPal error (subscription - ${label}):\n${String(err && err.message || err)}`);
            }
          }).render(`#${btnHostId}`);
        } catch (e) {
          setMsg(`❌ Could not render subscription button (${label}):\n${e.message || e}`);
        }
      });
    }

    // 2) Render one-time button (1) — reads amount at click time
    try {
      window.paypal.Buttons({
        style: { layout: "vertical" },

        createOrder: (data, actions) => {
          setMsg("");
          const amount = getAmount();
          return actions.order.create({
            purchase_units: [{
              amount: { value: amount, currency_code: CURRENCY },
              description: "MEQUAVIS ACE-Step voluntary support (one-time)"
            }]
          });
        },

        onApprove: (data, actions) => {
          return actions.order.capture().then((details) => {
            const name = details?.payer?.name?.given_name || "friend";
            setMsg(`✅ Thank you, ${name}!\nPayment captured.\n(You can close this window now.)`);
          });
        },

        onError: (err) => {
          setMsg(`❌ PayPal error (one-time):\n${String(err && err.message || err)}`);
        }
      }).render(`#${ONE_TIME_WRAP_ID}`);
    } catch (e) {
      setMsg(`❌ Could not render one-time PayPal button:\n${e.message || e}`);
    }
  }

  console.log("[subscribe] Subscribe item + PayPal modal ready (single SDK, one-time render).");
})();



//secondpart of payments

// ✅ NCZ PATCH: Add Crypto support row (BTC/LTC) to the Subscribe / Support modal
// Paste this AFTER your existing Subscribe / Support modal patch.
// Edit BTC_ADDRESS + LTC_ADDRESS below.

(() => {
  "use strict";
  if (window.__NCZ_SUBSCRIBE_CRYPTO_ROW__) return;
  window.__NCZ_SUBSCRIBE_CRYPTO_ROW__ = true;

  // ---------------------------
  // CONFIG (EDIT THESE)
  // ---------------------------
  const BTC_ADDRESS = "1FBN84Rbw612pLpnyFn8orH5JdjaqhUr18";
  const LTC_ADDRESS = "LeWKV2SwbSr1YotCSD99pnTSTA53xcQk2Z";

  // Must match IDs used in your existing patch
  const MODAL_ID = "__ncz_subscribe_modal__";
  const MSG_ID   = "__ncz_subscribe_msg__";

  // Our new style id (separate from your existing style)
  const STYLE_ID = "__ncz_subscribe_crypto_style__";

  // ---------------------------
  // Styles (once)
  // ---------------------------
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${MODAL_ID} .__ncz_crypto_row__{
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(255,255,255,.08);
      }
      #${MODAL_ID} .__ncz_crypto_grid__{
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 640px){
        #${MODAL_ID} .__ncz_crypto_grid__{ grid-template-columns: 1fr; }
      }

      #${MODAL_ID} .__ncz_crypto_card__{
        border: 1px solid rgba(255,255,255,.09);
        background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.18));
        border-radius: 14px;
        padding: 12px;
        position: relative;
        overflow: hidden;
      }

      #${MODAL_ID} .__ncz_crypto_title__{
        font-weight: 900;
        color: rgba(233,238,252,.96);
        display:flex;
        align-items:center;
        gap: 8px;
        margin-bottom: 8px;
      }
      #${MODAL_ID} .__ncz_crypto_badge__{
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(106,166,255,.10);
        color: rgba(233,238,252,.92);
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .2px;
      }

      #${MODAL_ID} .__ncz_crypto_addr__{
        font-family: var(--mono, ui-monospace);
        font-weight: 900;
        font-size: 12.5px;
        color: rgba(233,238,252,.96);
        background: rgba(7,10,18,.45);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        padding: 10px;
        word-break: break-all;
        line-height: 1.35;
      }

      #${MODAL_ID} .__ncz_crypto_copywrap__{
        margin-top: 10px;
        display:flex;
        justify-content: flex-start;
      }
      #${MODAL_ID} .__ncz_crypto_copybtn__{
        width: 100%;
        justify-content: center;
      }
    `;
    document.head.appendChild(st);
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  function setMsg(s) {
    const el = document.getElementById(MSG_ID);
    if (el) el.textContent = String(s || "");
  }

  async function copyText(txt) {
    const t = String(txt || "");
    if (!t) return false;

    // Clipboard API first
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {}

    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  function buildCard({ icon, name, badge, addr }) {
    const card = document.createElement("div");
    card.className = "__ncz_crypto_card__";
    card.innerHTML = `
      <div class="__ncz_crypto_title__">
        <span style="font-size:16px">${icon}</span>
        <span>${name}</span>
        <span class="__ncz_crypto_badge__">${badge}</span>
      </div>
      <div class="__ncz_crypto_addr__">${escapeHtml(addr)}</div>
      <div class="__ncz_crypto_copywrap__">
        <button type="button"
          class="__copybtn__ __ncz_crypto_copybtn__"
          data-crypto-copy="${escapeAttr(addr)}"
          title="Copy ${name} address">
          Copy
        </button>
      </div>
    `;
    return card;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(s) {
    // simple attribute escape
    return String(s || "").replaceAll('"', "&quot;");
  }

  // ---------------------------
  // Inject into modal (once per modal)
  // ---------------------------
  function inject() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return false;
    if (modal.dataset.__ncz_crypto_injected__ === "1") return true;

    // Find the existing support box that contains the CashApp/Patreon grid
    const supportGrid = modal.querySelector(".__supportgrid__");
    const supportBox = supportGrid ? supportGrid.closest(".__box__") : null;
    if (!supportBox) return false;

    // Build crypto row
    const row = document.createElement("div");
    row.className = "__ncz_crypto_row__";
    row.innerHTML = `
      <div class="__muted__" style="font-weight:900; margin-bottom:8px">
        Or support via crypto currency goes a long way!
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "__ncz_crypto_grid__";

    grid.appendChild(buildCard({
      icon: "Ł",
      name: "Litecoin",
      badge: "LTC",
      addr: LTC_ADDRESS
    }));
    grid.appendChild(buildCard({
      icon: "₿",
      name: "Bitcoin",
      badge: "BTC",
      addr: BTC_ADDRESS
    }));

    row.appendChild(grid);
    supportBox.appendChild(row);

    // Click handler for our copy buttons (delegated)
    if (!modal.__nczCryptoCopyBound) {
      modal.__nczCryptoCopyBound = true;
      modal.addEventListener("click", async (e) => {
        const btn = e.target && e.target.closest && e.target.closest("button[data-crypto-copy]");
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const txt = btn.getAttribute("data-crypto-copy") || "";
        const ok = await copyText(txt);
        if (ok) {
          setMsg(`✅ Copied: ${txt}`);
          setTimeout(() => setMsg(""), 1200);
        } else {
          setMsg(`Copy failed — ${txt}`);
        }
      }, true);
    }

    modal.dataset.__ncz_crypto_injected__ = "1";
    console.log("[subscribe][crypto] injected BTC/LTC row.");
    return true;
  }

  // ---------------------------
  // Wait for modal creation (because your modal is created on open)
  // ---------------------------
  const tryInject = () => {
    const done = inject();
    if (done) {
      try { obs.disconnect(); } catch {}
      if (timer) clearInterval(timer);
    }
  };

  const obs = new MutationObserver(tryInject);
  obs.observe(document.documentElement, { childList: true, subtree: true });

  const timer = setInterval(tryInject, 250);
  setTimeout(() => { try { obs.disconnect(); } catch {} clearInterval(timer); }, 20000);

  // immediate attempt
  tryInject();
})();
































// ✅ NCZ PATCH: Per-IP "Artist Name" dropdown + Delete button
// - Inserts UI UNDER the existing "Tip: Make good music!" line (left column)
// - Calls:   GET  /queryUsers      -> expects ["name1","name2"] OR {users:[...]} OR {data:{users:[...]}} etc.
// - Calls:   POST /deleteUser      body: { username: "<selected>" }
// - Select sets your song-gen author field: #__ncz_author_input__
// - Delete shows a confirm modal (Yes/No). Yes deletes on server + removes from dropdown.
// - Shows "(limit 5 users per IP)" under the dropdown.
//
// If your endpoints use different paths or payload keys, edit QUERY_PATH / DELETE_PATH / delete body.

(() => {
  "use strict";
  if (window.__NCZ_IP_USER_PICKER__) return;
  window.__NCZ_IP_USER_PICKER__ = true;

  const STYLE_ID = "__ncz_ip_user_picker_style__";
  const WRAP_ID  = "__ncz_ip_user_picker_wrap__";
  const ROW_ID   = "__ncz_ip_user_picker_row__";
  const SEL_ID   = "__ncz_ip_user_picker_sel__";
  const DEL_ID   = "__ncz_ip_user_picker_del__";
  const NOTE_ID  = "__ncz_ip_user_picker_note__";
  const STAT_ID  = "__ncz_ip_user_picker_stat__";

  const MODAL_ID = "__ncz_ip_user_picker_modal__";
  const MODAL_TXT_ID = "__ncz_ip_user_picker_modal_txt__";
  const MODAL_YES_ID = "__ncz_ip_user_picker_modal_yes__";
  const MODAL_NO_ID  = "__ncz_ip_user_picker_modal_no__";

  const QUERY_PATH  = "/queryUsers";
  const DELETE_PATH = "/deleteUser";

  const PLACEHOLDER_TEXT = "Artist Name";

  const $ = (id) => document.getElementById(id);

  function normBaseUrl(u){
    u = (u || "").trim();
    if(!u) return "http://localhost:8001";
    return u.replace(/\/+$/, "");
  }

  function setStatus(msg){
    const el = $(STAT_ID);
    if(!el) return;
    el.textContent = String(msg || "");
  }

  function getAuthorEl(){
    // Primary: your generator metadata author input
    return document.getElementById("__ncz_author_input__")
      // Optional fallbacks (won't hurt if absent)
      || document.getElementById("author")
      || document.getElementById("metaAuthor")
      || null;
  }

  function setAuthorValue(v){
    const el = getAuthorEl();
    if(!el) return;
    el.value = String(v || "");
    try { el.dispatchEvent(new Event("input", { bubbles:true })); } catch {}
    try { el.dispatchEvent(new Event("change", { bubbles:true })); } catch {}
  }

  // Uses same auth scheme as your main apiFetch (authMode + apiKey)
  async function apiFetch(path, {method="GET", body=null, headers={}} = {}){
    const baseUrl = normBaseUrl($("baseUrl")?.value || "");
    const url = baseUrl + path;

    const authMode = $("authMode")?.value || "none";
    const apiKey = ($("apiKey")?.value || "").trim();

    const hdrs = Object.assign({}, headers);
    if(method !== "GET" && method !== "HEAD") hdrs["Content-Type"] = "application/json";
    if(authMode === "header" && apiKey){
      hdrs["Authorization"] = "Bearer " + apiKey;
    }

    const resp = await fetch(url, {
      method,
      headers: hdrs,
      body: body ? JSON.stringify(body) : null,
    });

    let json = null;
    try { json = await resp.json(); } catch {}

    if(!resp.ok){
      const msg = (json && (json.detail || json.error)) ? (json.detail || json.error) : (`HTTP ${resp.status}`);
      throw new Error(msg);
    }

    // tolerate {code,data} wrappers
    if(json && typeof json === "object" && ("code" in json) && ("data" in json)){
      if(json.code !== 200) throw new Error(json.error || ("API code " + json.code));
      return json.data;
    }

    return json;
  }

  function normalizeUserList(data){
    // Accept: ["a","b"]
    if(Array.isArray(data)){
      return data.map(x => String(x || "").trim()).filter(Boolean);
    }

    // Accept wrappers: {users:[...]} / {data:{users:[...]}} / {items:[...]}
    const users =
      data?.users
      || data?.data?.users
      || data?.items
      || data?.data?.items
      || data?.authors
      || data?.data?.authors
      || null;

    if(Array.isArray(users)){
      return users
        .map(u => (typeof u === "string" ? u : (u?.name || u?.username || u?.author || "")))
        .map(x => String(x || "").trim())
        .filter(Boolean);
    }

    // Accept: {users:[{username:"x"}]}
    if(users && typeof users === "object"){
      const vals = Object.values(users);
      if(Array.isArray(vals)){
        return vals.map(x => String(x || "").trim()).filter(Boolean);
      }
    }

    return [];
  }

  function ensureStyles(){
    if($(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${WRAP_ID}{ margin-top: 10px; }
      #${ROW_ID}{
        display:flex;
        gap:10px;
        align-items:center;
      }
      #${SEL_ID}{ flex: 1 1 auto; min-width: 0; }
      #${DEL_ID}{ flex: 0 0 auto; white-space:nowrap; }

      #${NOTE_ID}{ margin-top: 6px; }
      #${STAT_ID}{ margin-top: 6px; opacity: .9; }

      /* Modal */
      #${MODAL_ID}{
        position: fixed;
        inset: 0;
        z-index: 10000050;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.55);
        backdrop-filter: blur(4px);
      }
      #${MODAL_ID}.__show__{ display:flex; }

      #${MODAL_ID} .__box__{
        width: min(520px, calc(100vw - 30px));
        background: linear-gradient(180deg, rgba(18,23,38,.96), rgba(10,12,18,.96));
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        box-shadow: 0 20px 50px rgba(0,0,0,.55);
        padding: 14px;
      }
      #${MODAL_ID} .__title__{
        font-weight: 900;
        font-size: 14px;
        margin: 0 0 8px;
      }
      #${MODAL_ID} .__txt__{
        margin: 0 0 12px;
        color: rgba(233,238,252,.92);
        font-size: 13px;
        line-height: 1.4;
        white-space: pre-wrap;
      }
      #${MODAL_ID} .__btns__{
        display:flex;
        gap:10px;
        justify-content:flex-end;
        flex-wrap: wrap;
      }
    `;
    document.head.appendChild(st);
  }

  function buildModal(){
    if($(MODAL_ID)) return;

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="__box__" role="dialog" aria-modal="true" aria-label="Confirm delete user">
        <div class="__title__">Release Artist Name?</div>
        <div class="__txt__" id="${MODAL_TXT_ID}"></div>
        <div class="__btns__">
          <button type="button" class="secondary" id="${MODAL_NO_ID}">No</button>
          <button type="button" class="danger" id="${MODAL_YES_ID}">Yes</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // IMPORTANT: do NOT close on backdrop click (only buttons)
    modal.addEventListener("click", (e) => {
      if(e.target === modal){
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  function openModal(text, onYes){
    const modal = $(MODAL_ID);
    const txt = $(MODAL_TXT_ID);
    const yes = $(MODAL_YES_ID);
    const no  = $(MODAL_NO_ID);
    if(!modal || !txt || !yes || !no) return;

    txt.textContent = String(text || "");

    const close = () => {
      modal.classList.remove("__show__");
      // remove previous handler
      try { yes._nczOnYes && yes.removeEventListener("click", yes._nczOnYes); } catch {}
      yes._nczOnYes = null;
    };

    const yesHandler = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await onYes?.();
      close();
    };

    // bind (replace)
    try { yes._nczOnYes && yes.removeEventListener("click", yes._nczOnYes); } catch {}
    yes._nczOnYes = yesHandler;
    yes.addEventListener("click", yesHandler);

    if(no.dataset.__nczBound__ !== "1"){
      no.dataset.__nczBound__ = "1";
      no.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      });
    }

    modal.classList.add("__show__");
  }

  function findTipDiv(){
    const base = $("baseUrl");
    if(!base) return null;

    // Left column container is the div that directly contains baseUrl + tip
    const leftCol = base.closest("div");
    if(!leftCol) return null;

    // Find the "Tip:" line under baseUrl
    const tips = Array.from(leftCol.querySelectorAll(".small"));
    const tip = tips.find(d => /^\s*Tip:/i.test((d.textContent || "").trim()));
    return { leftCol, tip };
  }

  function buildUI(){
    if($(WRAP_ID)) return;

    const found = findTipDiv();
    if(!found || !found.leftCol) return;

    ensureStyles();
    buildModal();

    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;

    const row = document.createElement("div");
    row.id = ROW_ID;

    const sel = document.createElement("select");
    sel.id = SEL_ID;
    sel.setAttribute("aria-label", "Artist Name");
    sel.innerHTML = `<option value="" selected disabled>${PLACEHOLDER_TEXT}</option>`;

    const del = document.createElement("button");
    del.id = DEL_ID;
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.disabled = true;

    row.appendChild(sel);
    row.appendChild(del);

    const note = document.createElement("div");
    note.id = NOTE_ID;
    note.className = "small";
    note.textContent = "(limit 5 users per IP)";

    const stat = document.createElement("div");
    stat.id = STAT_ID;
    stat.className = "small";
    stat.textContent = "";

    wrap.appendChild(row);
    wrap.appendChild(note);
    wrap.appendChild(stat);

    // Insert UNDER the Tip line (or at end of leftCol if tip missing)
    if(found.tip && found.tip.parentElement === found.leftCol){
      found.tip.insertAdjacentElement("afterend", wrap);
    }else{
      found.leftCol.appendChild(wrap);
    }
  }

  function setDeleteEnabled(){
    const sel = $(SEL_ID);
    const del = $(DEL_ID);
    if(!sel || !del) return;
    del.disabled = !sel.value;
  }

  function clearAndSetToFirstUserOrEmpty(){
    const sel = $(SEL_ID);
    if(!sel) return;

    // Find first real option (skip placeholder at index 0)
    const firstReal = Array.from(sel.options).find((o, idx) => idx > 0 && o.value);
    if(firstReal){
      sel.value = firstReal.value;
      setAuthorValue(firstReal.value);
    }else{
      sel.value = "";
      setAuthorValue("");
    }
    setDeleteEnabled();
  }

  function rebuildSelect(users){
    const sel = $(SEL_ID);
    if(!sel) return;

    const authorEl = getAuthorEl();
    const currentAuthor = (authorEl?.value || "").trim();

    // Rebuild options
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.disabled = true;
    ph.textContent = PLACEHOLDER_TEXT;
    sel.appendChild(ph);

    const clean = Array.from(new Set((users || []).map(x => String(x || "").trim()).filter(Boolean)));

    for(const name of clean){
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }

    // Selection rules:
    // - If current author matches a returned user, select it.
    // - Else keep placeholder selected (do NOT overwrite author automatically).
    if(currentAuthor && clean.includes(currentAuthor)){
      sel.value = currentAuthor;
    }else{
      sel.value = ""; // placeholder selected
    }

    setDeleteEnabled();
  }

  let refreshTimer = null;
  function scheduleRefresh(ms=250){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshUsers, ms);
  }

  async function refreshUsers(){
    const sel = $(SEL_ID);
    if(!sel) return;

    setStatus("Loading artist names…");
    try{
      const data = await apiFetch(QUERY_PATH, { method:"GET" });
      const users = normalizeUserList(data);
      rebuildSelect(users);
      setStatus(users.length ? "" : "No saved artist names for this IP.");
    }catch(e){
      setStatus(`Could not load artist names: ${e.message}`);
      // keep whatever is currently in the dropdown
    }
  }

  async function deleteSelectedUser(){
    const sel = $(SEL_ID);
    const del = $(DEL_ID);
    if(!sel || !del) return;

    const name = String(sel.value || "").trim();
    if(!name) return;

    const warnText =
      `This will release the artist name from your IP:\n\n"${name}"\n\nAre you sure?`;

    openModal(warnText, async () => {
      del.disabled = true;
      setStatus("Deleting…");

      try{
        // If your server expects a different key, change {username: name}
        await apiFetch(DELETE_PATH, { method:"POST", body: { username: name } });

        // Remove option locally right away
        const opt = Array.from(sel.options).find(o => o.value === name);
        if(opt) opt.remove();

        // After removal, set author to first remaining user or empty
        clearAndSetToFirstUserOrEmpty();

        setStatus("Deleted.");
        // Optional: re-sync from server to be safe
        scheduleRefresh(150);
      }catch(e){
        setStatus(`Delete failed: ${e.message}`);
        setDeleteEnabled();
      }
    });
  }

  function bindEvents(){
    const sel = $(SEL_ID);
    const del = $(DEL_ID);
    if(!sel || !del) return;

    if(sel.dataset.__nczBound__ !== "1"){
      sel.dataset.__nczBound__ = "1";
      sel.addEventListener("change", () => {
        const v = String(sel.value || "").trim();
        if(v) setAuthorValue(v);
        setDeleteEnabled();
      });
    }

    if(del.dataset.__nczBound__ !== "1"){
      del.dataset.__nczBound__ = "1";
      del.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedUser();
      });
    }

    // Refresh when connection settings change
    const baseUrl = $("baseUrl");
    const apiKey  = $("apiKey");
    const authMode = $("authMode");

    const hookRefresh = () => scheduleRefresh(250);

    if(baseUrl && baseUrl.dataset.__nczUsersHook__ !== "1"){
      baseUrl.dataset.__nczUsersHook__ = "1";
      baseUrl.addEventListener("change", hookRefresh);
      baseUrl.addEventListener("input", hookRefresh);
    }
    if(apiKey && apiKey.dataset.__nczUsersHook__ !== "1"){
      apiKey.dataset.__nczUsersHook__ = "1";
      apiKey.addEventListener("change", hookRefresh);
    }
    if(authMode && authMode.dataset.__nczUsersHook__ !== "1"){
      authMode.dataset.__nczUsersHook__ = "1";
      authMode.addEventListener("change", hookRefresh);
    }
  }

  function init(){
    buildUI();
    bindEvents();
    refreshUsers();
  }

  if(document.readyState === "complete" || document.readyState === "interactive"){
    init();
  }else{
    window.addEventListener("DOMContentLoaded", init, { once:true });
  }
})();






























// ✅ NCZ PATCH: Signature button -> opens modal to upload .txt or type signature
// - Enables #__ncz_signature_btn__ (removes disabled + fixes cursor/opacity/title)
// - Click opens a modal with:
//    • "Upload .txt" button (reads file into textarea)
//    • textarea for manual signature
//    • Set Signature (stores globally) + Cancel (closes)
// - Global storage:
//    window.__NCZ_SIGNATURE_DATA__   (string)
//    window.__nczGetSignature()      (returns current signature string)
//    window.__nczClearSignature()    (clears signature)
// - Optional: if an element #metaSignature exists, it will be kept in sync.

(() => {
  "use strict";
  if (window.__NCZ_SIGNATURE_PATCH__) return;
  window.__NCZ_SIGNATURE_PATCH__ = true;

  const BTN_ID = "__ncz_signature_btn__";
  const STYLE_ID = "__ncz_sig_modal_style__";
  const OVERLAY_ID = "__ncz_sig_overlay__";
  const MODAL_ID = "__ncz_sig_modal__";
  const FILE_ID = "__ncz_sig_file__";
  const TA_ID = "__ncz_sig_textarea__";
  const UPLOAD_BTN_ID = "__ncz_sig_upload_btn__";
  const SET_BTN_ID = "__ncz_sig_set_btn__";
  const CANCEL_BTN_ID = "__ncz_sig_cancel_btn__";
  const CLEAR_BTN_ID = "__ncz_sig_clear_btn__";

  // --- global state + console helpers ---
  if (typeof window.__NCZ_SIGNATURE_DATA__ !== "string") window.__NCZ_SIGNATURE_DATA__ = "";
  window.__nczGetSignature = function () {
    return String(window.__NCZ_SIGNATURE_DATA__ || "");
  };
  window.__nczClearSignature = function () {
    window.__NCZ_SIGNATURE_DATA__ = "";
    const metaSig = document.getElementById("metaSignature");
    if (metaSig) metaSig.value = "";
    return "";
  };

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${OVERLAY_ID}{
        position: fixed;
        inset: 0;
        z-index: 1000005;
        background: rgba(0,0,0,.55);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      #${OVERLAY_ID}.__show__{ display:flex; }

      #${MODAL_ID}{
        width: min(720px, 100%);
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: 0 12px 34px rgba(0,0,0,.45);
        background: linear-gradient(180deg, rgba(18,23,38,.95), rgba(10,12,20,.92));
        overflow: hidden;
      }
      #${MODAL_ID} .__hd__{
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        display:flex;
        align-items:center;
        justify-content: space-between;
        gap: 10px;
      }
      #${MODAL_ID} .__title__{
        font-weight: 900;
        font-size: 13px;
        letter-spacing: .2px;
      }
      #${MODAL_ID} .__bd__{ padding: 14px; }
      #${MODAL_ID} .__hint__{
        border: 1px dashed rgba(255,255,255,.16);
        background: rgba(0,0,0,.18);
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 12px;
        color: rgba(169,179,207,.95);
        line-height: 1.35;
        margin-bottom: 10px;
      }
      #${MODAL_ID} textarea{
        width: 100%;
        min-height: 170px;
        resize: vertical;
        background: rgba(7,10,18,.65);
        color: var(--text, #e9eefc);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        padding: 10px 10px;
        font-size: 13px;
        outline: none;
        line-height: 1.35;
        font-family: var(--mono, ui-monospace);
      }
      #${MODAL_ID} .__row__{
        display:flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items:center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      #${MODAL_ID} .__btnrow__{
        display:flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
        margin-top: 12px;
      }
      #${MODAL_ID} button{
        border: 0;
        background: rgba(106,166,255,.18);
        color: var(--text, #e9eefc);
        padding: 10px 12px;
        border-radius: 12px;
        cursor: pointer;
        font-weight: 900;
        font-size: 13px;
      }
      #${MODAL_ID} button:hover{ background: rgba(106,166,255,.25); }
      #${MODAL_ID} button.secondary{ background: rgba(255,255,255,.08); }
      #${MODAL_ID} button.secondary:hover{ background: rgba(255,255,255,.12); }
      #${MODAL_ID} button.danger{ background: rgba(255,92,122,.16); }
      #${MODAL_ID} button.danger:hover{ background: rgba(255,92,122,.22); }

      /* Keep file input hidden */
      #${FILE_ID}{ display:none !important; }

      /* Make signature button look enabled once we patch it */
      #${BTN_ID}.__ncz_sig_enabled__{
        opacity: 1 !important;
        cursor: pointer !important;
        background: rgba(255,255,255,.10) !important;
      }
      #${BTN_ID}.__ncz_sig_enabled__:hover{
        background: rgba(255,255,255,.14) !important;
      }
    `;
    document.head.appendChild(st);
  }

  function ensureModal() {
    ensureStyles();

    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-hidden", "true");

    overlay.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-label="Signature">
        <div class="__hd__">
          <div class="__title__">Signature</div>
          <button type="button" class="secondary" id="${CANCEL_BTN_ID}" title="Close">✖</button>
        </div>
        <div class="__bd__">
          <div class="__hint__">
            Upload your NanoCheeZe cert (<span style="font-family: var(--mono, ui-monospace);">.txt</span>) or use your own personal signature below.
            <br><span style="opacity:.85">Tip: nothing is uploaded by this UI — it only stores the signature in memory until you use it.</span>
          </div>

          <div class="__row__">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
              <button type="button" id="${UPLOAD_BTN_ID}" class="secondary">Upload .txt</button>
              <button type="button" id="${CLEAR_BTN_ID}" class="secondary" title="Clear textbox">Clear</button>
              <input type="file" id="${FILE_ID}" accept=".txt,text/plain" />
            </div>
            <div class="small" style="color: rgba(169,179,207,.95); font-size:12px;">
              Stored: <span id="__ncz_sig_status__" style="font-family: var(--mono, ui-monospace);">no</span>
            </div>
          </div>

          <textarea id="${TA_ID}" placeholder="Paste or type your signature here..."></textarea>

          <div class="__btnrow__">
            <button type="button" id="${CANCEL_BTN_ID}_2" class="secondary">Cancel</button>
            <button type="button" id="${SET_BTN_ID}">Set Signature</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // bind modal events once
    const file = document.getElementById(FILE_ID);
    const ta = document.getElementById(TA_ID);
    const uploadBtn = document.getElementById(UPLOAD_BTN_ID);
    const setBtn = document.getElementById(SET_BTN_ID);
    const cancel1 = document.getElementById(CANCEL_BTN_ID);
    const cancel2 = document.getElementById(CANCEL_BTN_ID + "_2");
    const clearBtn = document.getElementById(CLEAR_BTN_ID);
    const statusEl = document.getElementById("__ncz_sig_status__");

    function refreshStatus() {
      const cur = String(window.__NCZ_SIGNATURE_DATA__ || "").trim();
      statusEl.textContent = cur ? `yes (${cur.length} chars)` : "no";
    }

    function closeModal() {
      overlay.classList.remove("__show__");
      overlay.setAttribute("aria-hidden", "true");
      refreshStatus();
    }

    function openModal() {
      overlay.classList.add("__show__");
      overlay.setAttribute("aria-hidden", "false");

      // load current signature into box (so user can edit)
      ta.value = String(window.__NCZ_SIGNATURE_DATA__ || "");
      setTimeout(() => ta.focus(), 0);
      refreshStatus();
    }

    // expose open/close if you want them
    window.__nczOpenSignatureModal = openModal;
    window.__nczCloseSignatureModal = closeModal;

    // IMPORTANT: do NOT close on overlay click (only Cancel/Close)
    uploadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      file.click();
    });

    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f) return;

      const reader = new FileReader();
      reader.onload = () => {
        ta.value = String(reader.result || "");
      };
      reader.onerror = () => {
        ta.value = "";
        console.warn("[ncz-signature] failed reading file");
      };
      reader.readAsText(f);
    });

    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      ta.value = "";
      // also clear the file input so re-uploading same file triggers change
      file.value = "";
    });

    function setSignature() {
      const val = String(ta.value || "");
      window.__NCZ_SIGNATURE_DATA__ = val;

      // keep optional #metaSignature in sync if you already use it elsewhere
      const metaSig = document.getElementById("metaSignature");
      if (metaSig) metaSig.value = val;

      refreshStatus();
      closeModal();
    }

    setBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setSignature();
    });

    cancel1.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });
    cancel2.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });

    return overlay;
  }

  function enableAndBindButton(btn) {
    if (!btn) return false;

    // enable it
    btn.removeAttribute("disabled");
    btn.classList.add("__ncz_sig_enabled__");
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.style.removeProperty("pointer-events");
    if ((btn.title || "").toLowerCase().includes("coming soon")) {
      btn.title = "Set your NanoCheeZe signature";
    }

    // bind click once
    if (btn.dataset.__nczSigBound__ === "1") return true;
    btn.dataset.__nczSigBound__ = "1";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ensureModal();
      if (typeof window.__nczOpenSignatureModal === "function") {
        window.__nczOpenSignatureModal();
      }
    });

    return true;
  }

  function tryInit() {
    const btn = document.getElementById(BTN_ID);
    if (btn) {
      enableAndBindButton(btn);
      return true;
    }
    return false;
  }

  // init now or observe until the button appears
  if (tryInit()) return;

  const obs = new MutationObserver(() => {
    if (tryInit()) obs.disconnect();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // just in case: stop observing after a while
  setTimeout(() => obs.disconnect(), 30000);
})();


























// ✅ NCZ PATCH: External URL Browser (V4 - EXACT PLAY + integrated ✕ unmount)
// - Same external browser overlay + mounts + recommended
// - ✅ FIX: Clicking a playable file plays the CORRECT matching song in #songList (no "play first")
// - ✅ Integrated ✕ button on each mount row (removes from localStorage + rerenders)
// - Idempotent + self-cleans old V3.1 injected UI where possible

(() => {
  "use strict";
  if (window.__NCZ_EXT_URL_BROWSER_PATCH_V4__) return;
  window.__NCZ_EXT_URL_BROWSER_PATCH_V4__ = true;

  // -----------------------------
  // CONFIG
  // -----------------------------
  const CFG = {
    // Force your left music pane list
    archiveListElId: "__ncz_music_list__",

    endpoint:
      (location.pathname === "/ace" || location.pathname.startsWith("/ace/"))
        ? "/ace/getExternal"
        : "/getExternal",

    lsKey: "NCZ_EXT_MOUNTS_V1",
    virtualFolderName: "External URL Browser…",
    rootOnly: true,

    playableExt: [".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"],

    recommendedMounts: [
      { name: "XT Development", url: "https://xtdevelopment.net/music/mp3s/" },
      { name: "AlsPlaylistMixedGenre", url: "https://archive.org/download/AlsPlaylistMixedGenre" },
      { name: "RBHipHop", url: "https://archive.org/download/RBHipHop" },
      { name: "thebestofdisco", url: "https://archive.org/download/thebestofdisco" },
      { name: "mediatimeline", url: "https://archive.org/download/mediatimeline" },
    ],

    // Main playlist DOM
    mainSongListId: "songList",

    // exact-play timing
    findPlay: {
      timeoutMs: 6500,
      pollMs: 140
    }
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function ensureStr(v) {
    return (typeof v === "string") ? v : String(v ?? "");
  }

  function normUrl(u) {
    u = ensureStr(u).trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u) && !/^[0-9a-f-]{36}$/i.test(u)) u = "https://" + u;
    return u;
  }

  function safeLabelFromUrl(u) {
    u = ensureStr(u).trim();
    if (!u) return "url";
    try {
      const x = new URL(u);
      const p = x.pathname && x.pathname !== "/" ? x.pathname.replace(/\/+$/,"") : "";
      return x.host + (p ? p : "");
    } catch {
      return u.replace(/^https?:\/\//i, "").replace(/\/+$/,"");
    }
  }

  function fnv1a(str) {
    str = ensureStr(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function loadMounts() {
    try {
      const raw = localStorage.getItem(CFG.lsKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveMounts(mounts) {
    try { localStorage.setItem(CFG.lsKey, JSON.stringify(mounts)); } catch {}
  }

  function upPath(p) {
    p = ensureStr(p).replace(/^\/+/, "").replace(/\/+$/, "");
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return parts.length ? parts.join("/") + "/" : "";
  }

  function joinPath(base, child) {
    base = ensureStr(base).replace(/^\/+/, "");
    child = ensureStr(child).replace(/^\/+/, "");
    if (!base) return child;
    if (!child) return base;
    if (!/\/$/.test(base)) base += "/";
    return base + child;
  }

  function looksPlayable(nameOrUrl) {
    const s = ensureStr(nameOrUrl).toLowerCase();
    return CFG.playableExt.some(ext => s.endsWith(ext));
  }

  function basenameFromPath(p) {
    p = ensureStr(p).replace(/\\/g,"/");
    const b = p.split("/").filter(Boolean).slice(-1)[0] || p;
    return b || "track.mp3";
  }

  function taskIdFromName(name) {
    name = ensureStr(name || "track");
    const i = name.lastIndexOf(".");
    return (i > 0 ? name.slice(0, i) : name) || "track";
  }

  async function postExternal(url, path) {
    const res = await fetch(CFG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, path: path || "" })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`getExternal HTTP ${res.status}${t ? `: ${t.slice(0,200)}` : ""}`);
    }
    return await res.json();
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function clickReal(el) {
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch {}
    try { el.click(); } catch {}
  }

  function nowIso() {
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function urlBasename(u) {
    u = ensureStr(u).trim();
    if (!u) return "";
    try {
      const U = new URL(u, location.origin);
      return decodeURIComponent((U.pathname.split("/").filter(Boolean).pop() || "").trim());
    } catch {
      const noQ = u.split("?")[0].split("#")[0];
      const last = noQ.split("/").filter(Boolean).pop() || "";
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function normKey(u) {
    u = ensureStr(u).trim();
    if (!u) return "";
    return u.split("#")[0].split("?")[0].trim();
  }

  function candidatesFromUrl(u) {
    const out = [];
    const push = (x) => {
      x = ensureStr(x).trim();
      if (!x) return;
      out.push(x);
      out.push(normKey(x));
      try {
        const U = new URL(x, location.origin);
        out.push(U.toString());
        out.push(normKey(U.toString()));
        out.push(U.pathname);
      } catch {}
    };
    push(u);

    const bn = urlBasename(u);
    if (bn) out.push(bn);

    // dedupe
    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const k = ensureStr(s).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      uniq.push(k);
    }
    return uniq;
  }

  function urlsMatch(a, b) {
    const A = candidatesFromUrl(a);
    const B = candidatesFromUrl(b);
    for (const x of A) {
      for (const y of B) {
        if (!x || !y) continue;
        if (x === y) return true;
        if (x.length > 6 && y.length > 6) {
          if (x.endsWith(y) || y.endsWith(x)) return true;
        }
        const xb = urlBasename(x).toLowerCase();
        const yb = urlBasename(y).toLowerCase();
        if (xb && yb && xb === yb) return true;
      }
    }
    return false;
  }

  // -----------------------------
  // ✅ Dark scrollbars
  // -----------------------------
  const STYLE_ID = "__ncz_ext_url_scrollbar_style__";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
.ncz-dark-scroll{
  scrollbar-width: thin;
  scrollbar-color: #2a344a #0b0d12;
}
.ncz-dark-scroll::-webkit-scrollbar{ width:10px; height:10px; }
.ncz-dark-scroll::-webkit-scrollbar-track{ background:#0b0d12; }
.ncz-dark-scroll::-webkit-scrollbar-thumb{
  background:#2a344a;
  border:2px solid #0b0d12;
  border-radius:999px;
}
.ncz-dark-scroll::-webkit-scrollbar-thumb:hover{ background:#3a4766; }
`.trim();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // -----------------------------
  // ✅ Add-to-playlist (safe + minimal)
  // -----------------------------
  function buildItem(url, name) {
    const bn = basenameFromPath(name || url);
    return {
      type: "mp3",
      name: bn,
      path: bn,
      size: 0,
      mtime: (Date.now()/1000)|0,
      file: url,

      task_id: taskIdFromName(bn),
      output_index: 0,
      created_at: nowIso(),
      label: bn,
      prompt: bn,
      author: "",
      title: bn,
      metas: { source: "external_url_browser" }
    };
  }

  async function addToSongsList(url, name) {
    url = ensureStr(url).trim();
    if (!url) return false;

    const label = ensureStr(name).trim() || urlBasename(url) || "External Track";
    const createdAt = nowIso();
    const item = buildItem(url, label);

    // best: your global addSongToList (same as Suno V2)
    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(url, {
          label,
          createdAt,
          meta: item.metas || {},
          downloadName: label,
          serverItem: item
        });
        return true;
      } catch {}
    }

    // optional override hook
    if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      try {
        window.__NCZ_PLAYLIST_ADD_FN__(item);
        return true;
      } catch {}
    }

    // fallback: just open
    try { window.open(url, "_blank", "noopener"); } catch {}
    return false;
  }

  // -----------------------------
  // ✅ EXACT PLAY (core fix)
  // -----------------------------
  function getSongUrlFromObj(it) {
    if (!it) return "";
    if (typeof it === "string") return it;
    if (typeof it !== "object") return "";
    return ensureStr(it.url || it.file || it.href || it.src || "").trim();
  }

  function findIndexInWindowSongs(url) {
    const songs = Array.isArray(window.songs) ? window.songs : null;
    if (!songs) return -1;

    for (let i = 0; i < songs.length; i++) {
      const it = songs[i];
      const candidates = [];

      candidates.push(getSongUrlFromObj(it));

      if (it && typeof it === "object") {
        try { if (it.serverItem) candidates.push(getSongUrlFromObj(it.serverItem)); } catch {}
        try { if (it.meta) candidates.push(getSongUrlFromObj(it.meta)); } catch {}

        for (const k of Object.keys(it)) {
          const v = it[k];
          if (typeof v === "string" && (v.includes("://") || /\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(v))) {
            candidates.push(v);
          }
        }
      }

      for (const c of candidates) {
        if (c && urlsMatch(c, url)) return i;
      }
    }
    return -1;
  }

  function findRowInDomByUrl(url) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;

    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    if (!rows.length) return null;

    // best: href match
    for (const r of rows) {
      const links = Array.from(r.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = ensureStr(a.getAttribute("href") || "").trim();
        if (h && urlsMatch(h, url)) return r;
      }
    }

    // fallback: text contains basename
    const bn = urlBasename(url).toLowerCase();
    if (bn) {
      for (const r of rows) {
        const txt = ensureStr(r.textContent || "").toLowerCase();
        if (txt.includes(bn)) return r;
      }
    }

    return null;
  }

  function clickPlayInRow(row) {
    if (!row) return false;

    const aPlay = Array.from(row.querySelectorAll("a"))
      .find(a => isVisible(a) && ensureStr(a.textContent || "").trim().toLowerCase() === "play");

    if (aPlay) { clickReal(aPlay); return true; }

    const any = Array.from(row.querySelectorAll("a,button"))
      .find(el => isVisible(el) && ensureStr(el.getAttribute("title") || "").toLowerCase().includes("play"));

    if (any) { clickReal(any); return true; }

    return false;
  }

  async function playExactByUrl(url) {
    const t0 = Date.now();

    while (Date.now() - t0 < CFG.findPlay.timeoutMs) {
      const idx = findIndexInWindowSongs(url);
      if (idx >= 0) {
        const root = document.getElementById(CFG.mainSongListId);
        if (root) {
          const row = root.querySelector(`div[data-song-index="${idx}"]`);
          if (row && clickPlayInRow(row)) return true;
        }
      }

      const row2 = findRowInDomByUrl(url);
      if (row2 && clickPlayInRow(row2)) return true;

      await sleep(CFG.findPlay.pollMs);
    }

    return false;
  }

  async function addToSongsListAndPlay(url, name) {
    await addToSongsList(url, name);
    await sleep(50);
    return await playExactByUrl(url);
  }

  // -----------------------------
  // Overlay UI
  // -----------------------------
  const OVERLAY_ID = "__ncz_ext_url_overlay__";
  const LIST_ID = "__ncz_ext_list__";

  let overlay = null;
  let overlayList = null;
  let overlayCrumb = null;
  let overlayMsg = null;

  const state = {
    mode: "mounts",
    currentMount: null,
    path: ""
  };

  function stopAll(e) {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
  }

  function renderRow({ icon, text, subtext, right, onClick }) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
      position:relative;
    `;

    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${icon || ""}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(subtext)}</div>` : ""}
      </div>
      ${right || ""}
    `;

    row.addEventListener("click", (e) => {
      stopAll(e);
      onClick && onClick(e);
    });

    return row;
  }

  function ensureOverlay(hostEl) {
    if (overlay) return;

    ensureStyles();

    const panel = hostEl.parentElement || hostEl;
    const cs = getComputedStyle(panel);
    if (cs.position === "static") panel.style.position = "relative";

    // remove old overlay if it exists (old patch versions)
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
      position:absolute; inset:0;
      background: var(--card, #121726);
      border: 1px solid var(--line, #1e2742);
      border-radius: 12px;
      box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35));
      display:none;
      z-index: 9999;
      overflow:hidden;
    `;

    overlay.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line,#1e2742);">
        <div style="font-weight:700; color:var(--text,#e9eefc);">${escapeHtml(CFG.virtualFolderName)}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="__ncz_ext_close_btn__" type="button" style="padding:6px 10px; border-radius:10px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Close</button>
        </div>
      </div>

      <div style="padding:8px 12px; border-bottom:1px solid var(--line,#1e2742); color:var(--muted,#a9b3cf); font-size:12px;">
        <span id="__ncz_ext_crumb__">Mounts</span>
        <span id="__ncz_ext_msg__" style="float:right; color:var(--warn,#ffd36a);"></span>
      </div>

      <div id="${LIST_ID}" class="ncz-dark-scroll" style="position:absolute; inset:86px 0 0 0; overflow:auto; padding:8px 10px;"></div>

      <div id="__ncz_ext_modal__" style="
        position:absolute; inset:0; display:none;
        background: rgba(0,0,0,.55);
        align-items:center; justify-content:center;
        z-index:10000;
      ">
        <div class="ncz-dark-scroll" style="width:min(560px, 92%); max-height:min(600px, 86%); overflow:auto; background:var(--card,#121726); border:1px solid var(--line,#1e2742); border-radius:14px; box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35)); padding:14px;">
          <div style="font-weight:700; color:var(--text,#e9eefc); margin-bottom:10px;">Add External URL</div>
          <input id="__ncz_ext_url_inp__" type="text" placeholder="https://example.com/music/" style="
            width:100%; box-sizing:border-box;
            padding:10px 12px; border-radius:12px;
            border:1px solid var(--line,#1e2742);
            background:var(--card2,#0f1320); color:var(--text,#e9eefc);
            outline:none;
          " />

          <div id="__ncz_ext_rec_list__" class="ncz-dark-scroll" style="display:none; margin-top:10px; border:1px solid var(--line,#1e2742); border-radius:12px; overflow:auto; max-height:240px; background:var(--card2,#0f1320);"></div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap;">
            <button id="__ncz_ext_showrec_btn__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:var(--card2,#0f1320); color:var(--text,#e9eefc); cursor:pointer;">Recommended</button>
            <button id="__ncz_ext_cancel_btn__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Cancel</button>
            <button id="__ncz_ext_retrieve_btn__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:var(--accent,#6aa6ff); color:#0b0d12; cursor:pointer; font-weight:700;">Retrieve</button>
          </div>

          <div id="__ncz_ext_modal_err__" style="margin-top:10px; color:var(--bad,#ff5c7a); font-size:12px; white-space:pre-wrap;"></div>
        </div>
      </div>
    `;

    panel.appendChild(overlay);

    // ✅ Shield overlay interactions from global monkey-patched handlers
    const shield = (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    [
      "click","dblclick","auxclick","contextmenu",
      "mousedown","mouseup","pointerdown","pointerup",
      "touchstart","touchend"
    ].forEach(evt => overlay.addEventListener(evt, shield, false));

    overlayList = overlay.querySelector("#" + LIST_ID);
    overlayCrumb = overlay.querySelector("#__ncz_ext_crumb__");
    overlayMsg = overlay.querySelector("#__ncz_ext_msg__");

    const modal = overlay.querySelector("#__ncz_ext_modal__");
    const inp = overlay.querySelector("#__ncz_ext_url_inp__");
    const err = overlay.querySelector("#__ncz_ext_modal_err__");
    const recBox = overlay.querySelector("#__ncz_ext_rec_list__");

    function showModal(show) {
      modal.style.display = show ? "flex" : "none";
      err.textContent = "";
      recBox.style.display = "none";
      if (show) {
        inp.value = "";
        setTimeout(() => inp.focus(), 0);
      }
    }

    function buildRecList() {
      recBox.innerHTML = "";
      const recs = CFG.recommendedMounts || [];
      if (!recs.length) {
        const d = document.createElement("div");
        d.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
        d.textContent = "No recommended mounts configured.";
        recBox.appendChild(d);
        return;
      }
      for (const r of recs) {
        const b = document.createElement("button");
        b.type = "button";
        b.style.cssText = `
          width:100%; text-align:left;
          padding:10px 12px;
          border:0;
          border-bottom:1px solid var(--line,#1e2742);
          background:transparent;
          color:var(--text,#e9eefc);
          cursor:pointer;
        `;
        b.innerHTML = `
          <div style="font-weight:700; font-size:13px;">${escapeHtml(r.name || r.url)}</div>
          <div style="font-size:12px; color:var(--muted,#a9b3cf); word-break:break-all;">${escapeHtml(r.url || "")}</div>
        `;
        b.addEventListener("click", async (e) => {
          stopAll(e);
          const u = normUrl(r.url);
          if (!u) return;
          inp.value = u;
          err.textContent = "";
          overlayMsg.textContent = "Loading…";
          try {
            await postExternal(u, "");

            const mounts = loadMounts();
            const id = fnv1a(u);
            const label = safeLabelFromUrl(u);
            if (!mounts.find(m => m && m.id === id)) mounts.unshift({ id, url: u, label, createdAt: Date.now() });
            saveMounts(mounts);

            showModal(false);
            state.mode = "browse";
            state.currentMount = { id, url: u, label };
            state.path = "";
            await renderBrowse();
          } catch (ex) {
            err.textContent = ensureStr(ex && ex.message ? ex.message : ex);
          } finally {
            overlayMsg.textContent = "";
          }
        });
        recBox.appendChild(b);
      }
      const last = recBox.lastElementChild;
      if (last) last.style.borderBottom = "0";
    }

    overlay.querySelector("#__ncz_ext_close_btn__").addEventListener("click", (e) => {
      stopAll(e);
      overlay.style.display = "none";
    });

    overlay.querySelector("#__ncz_ext_showrec_btn__").addEventListener("click", (e) => {
      stopAll(e);
      const show = recBox.style.display !== "block";
      recBox.style.display = show ? "block" : "none";
      if (show) buildRecList();
    });

    overlay.querySelector("#__ncz_ext_cancel_btn__").addEventListener("click", (e) => {
      stopAll(e);
      showModal(false);
    });

    overlay.querySelector("#__ncz_ext_retrieve_btn__").addEventListener("click", async (e) => {
      stopAll(e);
      const raw = inp.value;
      const url = normUrl(raw);
      if (!url) { err.textContent = "Enter a URL."; return; }
      try { new URL(url); } catch { err.textContent = "Invalid URL."; return; }

      err.textContent = "";
      overlayMsg.textContent = "Loading…";

      try {
        await postExternal(url, "");

        const mounts = loadMounts();
        const id = fnv1a(url);
        const label = safeLabelFromUrl(url);
        if (!mounts.find(m => m && m.id === id)) mounts.unshift({ id, url, label, createdAt: Date.now() });
        saveMounts(mounts);

        showModal(false);
        state.mode = "browse";
        state.currentMount = { id, url, label };
        state.path = "";
        await renderBrowse();
      } catch (ex) {
        err.textContent = ensureStr(ex && ex.message ? ex.message : ex);
      } finally {
        overlayMsg.textContent = "";
      }
    });

    renderMounts(showModal);
  }

  function showOverlay(hostEl) {
    ensureOverlay(hostEl);
    overlay.style.display = "block";
    state.mode = "mounts";
    state.currentMount = null;
    state.path = "";
    renderMounts((show) => {
      const m = overlay.querySelector("#__ncz_ext_modal__");
      if (m) m.style.display = show ? "flex" : "none";
    });
  }

  function renderMounts(showModalFn) {
    if (!overlayList) return;

    overlayCrumb.textContent = "Mounts";
    overlayList.innerHTML = "";

    overlayList.appendChild(renderRow({
      icon: "➕",
      text: "Add a URL…",
      subtext: "Fetch a directory listing",
      onClick: () => showModalFn && showModalFn(true)
    }));

    const recs = CFG.recommendedMounts || [];
    if (recs.length) {
      overlayList.appendChild(renderRow({
        icon: "⭐",
        text: "Recommended mounts",
        subtext: "Click any to mount instantly",
        onClick: () => {
          const modal = overlay.querySelector("#__ncz_ext_modal__");
          if (modal) modal.style.display = "flex";
          const btn = overlay.querySelector("#__ncz_ext_showrec_btn__");
          if (btn) btn.click();
        }
      }));
    }

    const mounts = loadMounts();
    if (!mounts.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
      empty.textContent = "No external mounts yet.";
      overlayList.appendChild(empty);
      return;
    }

    for (const m of mounts) {
      const url = normUrl(m && m.url);
      const label = (m && m.label) ? ensureStr(m.label) : (url || "Mount");

      const right = `
        <span class="__ncz_ext_unmount_x__" title="Remove mount" style="
          position:absolute;
          right:10px;
          top:50%;
          transform:translateY(-50%);
          color: var(--bad,#ff5c7a);
          font-weight:900;
          font-size:16px;
          line-height:16px;
          user-select:none;
          cursor:pointer;
          padding:4px 6px;
          border-radius:10px;
        ">✕</span>
      `;

      const row = renderRow({
        icon: "📁",
        text: label,
        subtext: url,
        right,
        onClick: async (e) => {
          const x = e.target && e.target.closest && e.target.closest("span.__ncz_ext_unmount_x__");
          if (x) return; // handled by x listener below

          state.mode = "browse";
          state.currentMount = { id: m.id, url, label };
          state.path = "";
          await renderBrowse();
        }
      });

      const x = row.querySelector("span.__ncz_ext_unmount_x__");
      if (x) {
        x.addEventListener("click", (e) => {
          stopAll(e);
          const mounts2 = loadMounts();
          const next = mounts2.filter(mm => String(mm && mm.id) !== String(m && m.id));
          saveMounts(next);
          renderMounts(showModalFn);
        }, true);

        x.addEventListener("mousedown", stopAll, true);
      }

      // give room for the X
      row.style.paddingRight = "36px";

      overlayList.appendChild(row);
    }
  }

  async function renderBrowse() {
    if (!overlayList || !state.currentMount) return;
    const mount = state.currentMount;

    overlayCrumb.textContent = `${mount.label}${state.path ? " / " + state.path.replace(/\/+$/,"") : ""}`;
    overlayList.innerHTML = "";
    overlayMsg.textContent = "Loading…";

    try {
      const data = await postExternal(mount.url, state.path || "");
      const items = Array.isArray(data.items) ? data.items : [];

      overlayList.appendChild(renderRow({
        icon: "⬅️",
        text: "Back to Mounts",
        subtext: "",
        onClick: () => {
          state.mode = "mounts";
          state.currentMount = null;
          state.path = "";
          renderMounts((show) => {
            const m = overlay.querySelector("#__ncz_ext_modal__");
            if (m) m.style.display = show ? "flex" : "none";
          });
        }
      }));

      if (state.path) {
        overlayList.appendChild(renderRow({
          icon: "⬆️",
          text: "Up",
          subtext: upPath(state.path),
          onClick: async () => {
            state.path = upPath(state.path);
            await renderBrowse();
          }
        }));
      }

      const dirs = items.filter(x => (x.type || x.kind) === "dir");
      const files = items.filter(x => (x.type || x.kind) !== "dir");

      for (const d of dirs) {
        const name = d.name || d.title || d.path || "folder";
        const nextPath = d.path ? ensureStr(d.path) : joinPath(state.path, ensureStr(name).replace(/\/+$/,"") + "/");
        overlayList.appendChild(renderRow({
          icon: "📁",
          text: ensureStr(name).replace(/\/+$/,""),
          subtext: nextPath,
          onClick: async () => {
            state.path = nextPath;
            await renderBrowse();
          }
        }));
      }

      for (const f of files) {
        const name = f.name || f.title || f.path || "file";
        const url = f.url || f.href || f.file || "";
        const playable = (url && looksPlayable(url)) || looksPlayable(name);

        overlayList.appendChild(renderRow({
          icon: playable ? "▶️" : "📄",
          text: ensureStr(name).replace(/^.*\//,""),
          subtext: url || (f.path ? ensureStr(f.path) : ""),
          onClick: async () => {
            if (!url) return;

            if (playable) {
              overlayMsg.textContent = "Adding…";
              const ok = await addToSongsListAndPlay(url, name);
              overlayMsg.textContent = ok ? "Playing" : "Added (couldn’t auto-play)";
              setTimeout(() => { overlayMsg.textContent = ""; }, 1100);
            } else {
              try { window.open(url, "_blank", "noopener"); } catch {}
            }
          }
        }));
      }

      if (!dirs.length && !files.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
        empty.textContent = "No items.";
        overlayList.appendChild(empty);
      }
    } catch (ex) {
      const err = document.createElement("div");
      err.style.cssText = "padding:10px; color:var(--bad,#ff5c7a); font-size:13px; white-space:pre-wrap;";
      err.textContent = `Error: ${ensureStr(ex && ex.message ? ex.message : ex)}`;
      overlayList.appendChild(err);
    } finally {
      overlayMsg.textContent = "";
    }
  }

  // -----------------------------
  // Inject virtual folder into left music list
  // -----------------------------
  function findArchiveListEl() {
    return document.getElementById(CFG.archiveListElId) || null;
  }

  function isAtArchiveRoot(listEl) {
    if (!CFG.rootOnly) return true;
    const dp = listEl.getAttribute("data-path") || (listEl.dataset ? listEl.dataset.path : "") || "";
    if (dp === "" || dp === "/" || dp === "./") return true;
    const txt = listEl.textContent || "";
    if (/\bUp\b|\.\.\//i.test(txt)) return false;
    return true;
  }

  function removeOldUiIfPresent(listEl) {
    try {
      const oldRow = listEl.querySelector("[data-ncz-ext-virtual='1']");
      if (oldRow) oldRow.remove();
    } catch {}
    try {
      const oldRow2 = listEl.querySelector("[data-ncz-ext-virtual-v3='1']");
      if (oldRow2) oldRow2.remove();
    } catch {}
    try {
      const ex = document.getElementById("__ncz_ext_url_overlay__");
      // don't remove if it's the one we created (overlay is null until ensureOverlay)
      if (ex && !overlay) ex.remove();
    } catch {}
  }

  function injectVirtualFolder(listEl) {
    if (!listEl) return;
    if (!isAtArchiveRoot(listEl)) return;

    ensureStyles();
    if (!listEl.classList.contains("ncz-dark-scroll")) listEl.classList.add("ncz-dark-scroll");

    removeOldUiIfPresent(listEl);

    if (listEl.querySelector("[data-ncz-ext-virtual-v4='1']")) return;

    const row = document.createElement("div");
    row.setAttribute("data-ncz-ext-virtual-v4", "1");
    row.className = "__ncz_lb_item__";
    row.title = CFG.virtualFolderName;
    row.style.margin = "0 0 6px 0";

    row.innerHTML = `
      <div class="__ncz_lb_icon__">🌐</div>
      <div class="__ncz_lb_labelwrap__" style="min-width:0">
        <div class="__ncz_lb_label__">${escapeHtml(CFG.virtualFolderName)}</div>
        <div class="__ncz_lb_hint__">Add & browse external directory listings</div>
      </div>
    `;

    const open = (e) => {
      if (e) stopAll(e);
      showOverlay(listEl);
    };

    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    listEl.prepend(row);
  }

  function start() {
    const listEl = findArchiveListEl();
    if (!listEl) {
      console.warn("[NCZ EXT V4] Could not find left music list:", CFG.archiveListElId);
      return;
    }

    injectVirtualFolder(listEl);

    const obs = new MutationObserver(() => injectVirtualFolder(listEl));
    obs.observe(listEl, { childList: true, subtree: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();




























// ✅ NCZ PATCH: Save/Load Playlist (JSON) under the Song List
// - Adds two buttons below the playlist area: "Save playlist" + "Load playlist"
// - Save downloads current *visible* Song List items to a JSON file
// - Load imports a JSON file and APPENDS those songs into the playlist (does NOT wipe)
// - Uses your existing window.addSongToList() so UI + meta merging stays consistent
(() => {
  "use strict";
  if (window.__NCZ_PLAYLIST_SAVELOAD__) return;
  window.__NCZ_PLAYLIST_SAVELOAD__ = true;

  const BOX_ID = "__ncz_playlist_io__";
  const FILE_INPUT_ID = "__ncz_playlist_file__";
  const STYLE_ID = "__ncz_playlist_io_style__";

  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function pad2(n){ return String(n).padStart(2, "0"); }
  function tsForFilename(d = new Date()){
    return (
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) + "_" +
      pad2(d.getHours()) +
      pad2(d.getMinutes()) +
      pad2(d.getSeconds())
    );
  }

  function safeJsonParse(s){
    try { return JSON.parse(s); } catch { return null; }
  }

  function getVisiblePlaylistItems(){
    // Pull DOM order (top -> bottom) so we can preserve the visible ordering on save.
    const list = document.getElementById("songList");
    const songsArr = Array.isArray(window.songs) ? window.songs : [];

    if (!list) return [];
    const rows = $all('[data-song-index]', list); // DOM order: top -> bottom

    const items = [];
    for (const row of rows){
      const idx = Number(row.getAttribute("data-song-index"));
      const s = songsArr[idx];
      if (!s || s.__deleted) continue;

      items.push({
        url: String(s.url || ""),
        label: String(s.label || ""),
        createdAt: String(s.createdAt || ""),
        taskId: String(s.taskId || ""),
        outputIndex: Number.isFinite(Number(s.outputIndex)) ? Number(s.outputIndex) : 0,
        downloadName: String(s.downloadName || ""),
        meta: (s.meta && typeof s.meta === "object") ? s.meta : {},
      });
    }
    return items;
  }

  function downloadJson(obj, filename){
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  async function ensureAppReady(){
    // Wait until your playlist API is exposed
    const maxMs = 12000;
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs){
      if (typeof window.addSongToList === "function") return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  }

  function normalizeImportedPayload(parsed){
    // Accept a few shapes:
    // {items:[...]} | {songs:[...]} | {playlist:[...]} | [...]
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed;

    const maybe =
      (Array.isArray(parsed.items) && parsed.items) ||
      (Array.isArray(parsed.songs) && parsed.songs) ||
      (Array.isArray(parsed.playlist) && parsed.playlist) ||
      (Array.isArray(parsed.data) && parsed.data) ||
      null;

    return maybe || [];
  }

  async function importPlaylistFile(file){
    const ok = await ensureAppReady();
    if (!ok){
      alert("Playlist import: addSongToList() not ready on window yet.");
      return;
    }

    const text = await file.text();
    const parsed = safeJsonParse(text);
    const arr = normalizeImportedPayload(parsed);

    if (!arr.length){
      alert("That JSON file has no playlist items.");
      return;
    }

    // We want to preserve the list order as it appears in the JSON (top->bottom).
    // addSongToList() uses PREPEND, so we must add from bottom->top.
    let added = 0;
    let existing = 0;
    let failed = 0;

    for (let i = arr.length - 1; i >= 0; i--){
      const it = arr[i] || {};
      const url = String(it.url || it.file || it.href || "").trim();
      if (!url) { failed++; continue; }

      const beforeLen = Array.isArray(window.songs) ? window.songs.length : 0;

      try{
        window.addSongToList(url, {
          label: String(it.label || it.caption || ""),
          taskId: String(it.taskId || it.task_id || ""),
          outputIndex: Number.isFinite(Number(it.outputIndex)) ? Number(it.outputIndex) : 0,
          createdAt: String(it.createdAt || it.created_at || ""),
          meta: (it.meta && typeof it.meta === "object") ? it.meta : null,
          downloadName: String(it.downloadName || it.filename || it.name || ""),
          serverItem: null,
        });
      }catch{
        failed++;
        continue;
      }

      const afterLen = Array.isArray(window.songs) ? window.songs.length : beforeLen;
      if (afterLen > beforeLen) added++;
      else existing++;

      // yield occasionally so huge lists don’t freeze UI
      if ((arr.length - 1 - i) % 100 === 99) await new Promise(r => setTimeout(r, 0));
    }

    const msg =
      `Loaded playlist: added ${added}` +
      (existing ? ` (already had ${existing})` : "") +
      (failed ? ` (failed ${failed})` : "") +
      `.`;

    // Prefer your in-page log if present, else alert
    const logEl = document.getElementById("log");
    if (logEl) {
      logEl.className = failed ? "msg warn" : "msg good";
      logEl.textContent = msg;
    } else {
      alert(msg);
    }
  }

  function injectUI(){
    if (document.getElementById(BOX_ID)) return true;

    const list = document.getElementById("songList");
    if (!list) return false;

    const wrap = list.closest(".songListWrap") || list.parentElement;
    if (!wrap) return false;

    // styles (once)
    if (!document.getElementById(STYLE_ID)){
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = `
        #${BOX_ID}{
          margin-top: 10px;
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          align-items:center;
          justify-content:flex-start;
        }
        #${BOX_ID} button{
          /* use your existing button styles; this just ensures consistent sizing */
          padding:10px 12px;
          border-radius:12px;
          font-weight:800;
          font-size:13px;
        }
        #${BOX_ID} .__ncz_hint__{
          font-size:12px;
          color: var(--muted, #a9b3cf);
        }
        #${FILE_INPUT_ID}{ display:none !important; }
      `;
      document.head.appendChild(st);
    }

    const box = document.createElement("div");
    box.id = BOX_ID;

    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.className = "secondary";
    btnSave.textContent = "Save playlist";
    btnSave.title = "Download the current Song List as JSON";

    const btnLoad = document.createElement("button");
    btnLoad.type = "button";
    btnLoad.className = "secondary";
    btnLoad.textContent = "Load playlist";
    btnLoad.title = "Import a JSON playlist and append it to your Song List";

    const hint = document.createElement("div");
    hint.className = "__ncz_hint__";
    hint.textContent = "Load appends to the list (does not clear).";

    const fileInput = document.createElement("input");
    fileInput.id = FILE_INPUT_ID;
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";

    btnSave.addEventListener("click", async (e) => {
      e.preventDefault();

      const ok = await ensureAppReady();
      if (!ok){
        alert("Playlist save: app not ready yet.");
        return;
      }

      const items = getVisiblePlaylistItems();
      if (!items.length){
        alert("No songs in the Song List to save yet.");
        return;
      }

      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        app: "MEQUAVIS ACE-Step AI Music Generator",
        count: items.length,
        items
      };

      downloadJson(payload, `mequavis_playlist_${tsForFilename()}.json`);
    });

    btnLoad.addEventListener("click", (e) => {
      e.preventDefault();
      fileInput.value = ""; // allow loading same file twice
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try{
        await importPlaylistFile(f);
      }catch(err){
        alert("Playlist load failed: " + (err && err.message ? err.message : String(err)));
      }finally{
        fileInput.value = "";
      }
    });

    box.appendChild(btnSave);
    box.appendChild(btnLoad);
    box.appendChild(hint);
    box.appendChild(fileInput);

    // Insert directly under the song list wrap
    wrap.insertAdjacentElement("afterend", box);

    return true;
  }

  function init(){
    if (injectUI()) return;

    // If songList is created later, observe briefly
    const obs = new MutationObserver(() => {
      if (injectUI()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => obs.disconnect(), 15000);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();


















// ✅ NCZ PATCH: Close Music Archive when collapsing Leftbar (uses your working logic)
(() => {
  "use strict";
  if (window.__NCZ_CLOSE_MUSIC_ON_LEFTBAR_COLLAPSE_V1__) return;
  window.__NCZ_CLOSE_MUSIC_ON_LEFTBAR_COLLAPSE_V1__ = true;

  const SID_ID = "__ncz_leftbar__";
  const ACTION = "music";

  // --- your working close logic (unchanged behavior) ---
  function getNodes() {
    const side = document.getElementById(SID_ID);
    const btn =
      side?.querySelector(`.__ncz_lb_body__ [data-action="${ACTION}"]`) ||
      side?.querySelector(`[data-action="${ACTION}"]`) ||
      null;
    return { side, btn };
  }

  function isMusicOpen(side) {
    return !!side && side.classList.contains("__musicmode__");
  }

  function hideMusicNow() {
    const { side, btn } = getNodes();
    if (!side || !btn) return false;

    if (isMusicOpen(side)) {
      btn.click(); // ✅ triggers your existing Hide Music logic
      // console.log("[ncz] Hide Music triggered (collapse hook).");
    }
    return true;
  }

  // --- collapse detection ---
  function looksCollapsed(side) {
    if (!side) return false;

    const cls = String(side.className || "").toLowerCase();
    if (/\b(collapsed|__collapsed__|__closed__|closed|minimized|mini)\b/.test(cls)) return true;

    // common attribute pattern
    const dc = side.getAttribute("data-collapsed");
    if (dc === "1" || dc === "true") return true;

    // width heuristic: icon-only sidebar is usually narrow
    try {
      const w = side.getBoundingClientRect().width;
      if (w > 0 && w < 95) return true;
    } catch {}

    return false;
  }

  // Guard: prevent double-fire spam
  let lastFire = 0;
  function closeOnce() {
    const now = Date.now();
    if (now - lastFire < 200) return;
    lastFire = now;
    hideMusicNow();
  }

  // --- 1) Capture clicks on likely leftbar collapse/toggle controls ---
  const HOT_SELECTORS = [
    `#${SID_ID} [data-action="collapse"]`,
    `#${SID_ID} [data-action="toggle"]`,
    `#${SID_ID} [data-action="leftbar"]`,
    `#${SID_ID} [data-action="sidebar"]`,
    `#${SID_ID} [data-action="menu"]`,
    `#${SID_ID} [title*="collapse" i]`,
    `#${SID_ID} [aria-label*="collapse" i]`,
    `#${SID_ID} [title*="hide" i]`,
    `#${SID_ID} [aria-label*="hide" i]`,
    `#${SID_ID} .__ncz_lb_toggle__`,
    `#${SID_ID} .__ncz_lb_collapse__`,
    `#__ncz_leftbar_toggle__`,
    `[data-ncz-leftbar-toggle]`,
    `[data-action="toggleLeftbar"]`,
    `[data-action="leftbarToggle"]`
  ];

  function isCollapseClickTarget(target) {
    if (!target || target.nodeType !== 1) return false;

    // don't treat clicking the MUSIC button itself as a "collapse"
    try {
      if (target.closest(`.__ncz_lb_body__ [data-action="${ACTION}"]`)) return false;
    } catch {}

    // direct selector matches
    for (const sel of HOT_SELECTORS) {
      try {
        if (target.closest(sel)) return true;
      } catch {}
    }

    // heuristic fallback: id/class/title/aria/text contains collapse/toggle + sidebar/left/menu
    const hot = target.closest("button,a,div") || target;
    const idc = ((hot.id || "") + " " + (hot.className || "")).toLowerCase();
    const meta = (
      (hot.getAttribute("title") || "") + " " +
      (hot.getAttribute("aria-label") || "") + " " +
      (hot.textContent || "")
    ).toLowerCase();

    const a = idc + " " + meta;
    const hasVerb = /\b(collapse|toggle|minimi|close|hide)\b/.test(a);
    const hasNoun = /\b(leftbar|side(bar)?|menu|panel|nav)\b/.test(a);

    return hasVerb && hasNoun;
  }

  // capture phase so we run BEFORE your UI collapses/hides
  function onDocClick(e) {
    const { side } = getNodes();
    if (!side) return;
    if (!isMusicOpen(side)) return;

    if (isCollapseClickTarget(e.target)) {
      closeOnce();
    }
  }

  // --- 2) Observe leftbar for collapse transitions ---
  function watchSideCollapse() {
    const { side } = getNodes();
    if (!side) return false;

    let prev = looksCollapsed(side);

    const obs = new MutationObserver(() => {
      const now = looksCollapsed(side);
      // transition -> collapsed
      if (!prev && now) closeOnce();
      prev = now;
    });

    obs.observe(side, {
      attributes: true,
      attributeFilter: ["class", "style", "data-collapsed"]
    });

    return true;
  }

  // --- 3) Also watch body/html in case collapse is driven there ---
  function watchGlobalCollapse() {
    const { side } = getNodes();
    if (!side) return false;

    const test = () => {
      if (!isMusicOpen(side)) return;
      // if side *now* looks collapsed, close music
      if (looksCollapsed(side)) closeOnce();
    };

    const obs = new MutationObserver(test);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });

    return true;
  }

  function start() {
    // 1) click capture hook
    document.addEventListener("click", onDocClick, true);

    // 2) observers (retry until UI mounts)
    let ok1 = watchSideCollapse();
    let ok2 = watchGlobalCollapse();

    if (!ok1 || !ok2) {
      const obs = new MutationObserver(() => {
        ok1 = ok1 || watchSideCollapse();
        ok2 = ok2 || watchGlobalCollapse();
        if (ok1 && ok2) obs.disconnect();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 10000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

























/* ✅ NCZ PATCH: AI Radio UI (V3b - URL + DownloadLink override w/ restore)
   - Prints mp3 URL in #resultMeta under title line.
   - While Radio ON: sets <a id="downloadLink"> to current radio song.
   - When Radio OFF (or auto-off), restores downloadLink to previous state.
   - Keeps controls visible (progress bar), blocks interaction via overlay.
   - Auto-disables radio if src changes externally.
*/
(() => {
  "use strict";
  if (window.__NCZ_AI_RADIO_UI_PATCH_V3B__) return;
  window.__NCZ_AI_RADIO_UI_PATCH_V3B__ = true;

  const PILL_ID = "__ncz_radio_pill__";
  const DOT_ID  = "__ncz_radio_dot__";
  const TXT_ID  = "__ncz_radio_text__";
  const OVERLAY_ID = "__ncz_radio_lock_overlay__";

  const FETCH_TIMEOUT_MS = 12000;
  const INTERNAL_SRC_GRACE_MS = 1200;
  const SEEK_RETRY_COUNT = 12;
  const SEEK_RETRY_DELAY_MS = 140;

  const $ = (id) => document.getElementById(id);

  function normBaseUrl(u){
    u = (u || "").trim();
    if(!u) return window.location.origin.replace(/\/+$/, "");
    return u.replace(/\/+$/, "");
  }

  // preserve your /ace prefix behavior
  function absFromServerPath(fileOrUrl){
    const s = String(fileOrUrl || "").trim();
    if(!s) return "";
    if(/^https?:\/\//i.test(s)) return s;

    const base = normBaseUrl($("baseUrl")?.value || "");
    try{
      const b = new URL(base.endsWith("/") ? base : base + "/");
      const basePath = b.pathname.replace(/\/+$/, ""); // "" or "/ace"

      if(s.startsWith("/")){
        if(basePath && basePath !== "/" && !s.startsWith(basePath + "/")){
          return b.origin + basePath + s;
        }
        return b.origin + s;
      }

      return new URL(s, b.origin + (basePath || "") + "/").toString();
    }catch{
      const base2 = String(base || "").replace(/\/+$/, "");
      return base2 + "/" + s.replace(/^\/+/, "");
    }
  }

  function urlBasename(u){
    const s = String(u || "").trim();
    if(!s) return "";
    try{
      const U = new URL(s, window.location.origin);
      const last = (U.pathname.split("/").filter(Boolean).pop() || "");
      return decodeURIComponent(last);
    }catch{
      const noQ = s.split("?")[0].split("#")[0];
      const last = (noQ.split("/").filter(Boolean).pop() || "");
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  async function radioFetchJsonTimed(path){
    const baseUrl = normBaseUrl($("baseUrl")?.value || "");
    const url = baseUrl + path;

    const authMode = $("authMode")?.value || "none";
    const apiKey = ($("apiKey")?.value || "").trim();
    const hdrs = {};
    if(authMode === "header" && apiKey) hdrs["Authorization"] = "Bearer " + apiKey;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const t0 = performance.now();
    try{
      const resp = await fetch(url, { method:"GET", headers: hdrs, cache:"no-store", signal: ctrl.signal });
      const text = await resp.text();
      const t1 = performance.now();
      const latencySec = Math.max(0, (t1 - t0) / 2000); // ~half RTT

      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }

      if(!resp.ok){
        const msg = (json && (json.detail || json.error)) ? (json.detail || json.error) : ("HTTP " + resp.status);
        throw new Error(msg);
      }
      return { json, latencySec };
    } finally {
      clearTimeout(t);
    }
  }

  function setRadioPill(state, text){
    const dot = $(DOT_ID);
    const txt = $(TXT_ID);
    if(!dot || !txt) return;

    dot.classList.remove("good","bad","warn");
    if(state === "good") dot.classList.add("good");
    else if(state === "bad") dot.classList.add("bad");
    else dot.classList.add("warn");

    txt.textContent = text;
  }

  function ensureRadioPill(){
    const health = $("healthPill");
    if(!health) return null;

    let pill = $(PILL_ID);
    if(pill) return pill;

    pill = document.createElement("div");
    pill.id = PILL_ID;
    pill.className = "pill";
    pill.setAttribute("role", "button");
    pill.setAttribute("tabindex", "0");
    pill.title = "Toggle AI Radio (shared station)";

    pill.innerHTML = `
      <span class="dot warn" id="${DOT_ID}"></span>
      <span id="${TXT_ID}">Radio: OFF</span>
    `;

    health.parentElement.insertBefore(pill, health);

    const stId = "__ncz_radio_pill_style__";
    if(!document.getElementById(stId)){
      const st = document.createElement("style");
      st.id = stId;
      st.textContent = `
        #${PILL_ID}{ cursor:pointer; user-select:none; }
        #${PILL_ID}:hover{ background: rgba(255,255,255,.10); }
        #${PILL_ID}:active{ transform: translateY(1px); }
      `;
      document.head.appendChild(st);
    }

    return pill;
  }

  function findPlayer(){
    const p = $("player");
    if(!p || p.tagName.toLowerCase() !== "audio") return null;
    return p;
  }

  function findPrevNextButtons(player){
    const wrap = player?.parentElement;
    if(!wrap) return { wrap:null, prev:null, next:null };
    const buttons = Array.from(wrap.querySelectorAll("button"));
    const prev = buttons.find(b => String(b.title || "").includes("Previous track")) || null;
    const next = buttons.find(b => String(b.title || "").includes("Next track")) || null;
    return { wrap, prev, next };
  }

  function ensureLockOverlay(wrap){
    if(!wrap) return null;
    let ov = document.getElementById(OVERLAY_ID);
    if(ov) return ov;

    const cs = getComputedStyle(wrap);
    if(cs.position === "static") wrap.style.position = "relative";

    ov = document.createElement("div");
    ov.id = OVERLAY_ID;
    ov.style.position = "absolute";
    ov.style.inset = "0";
    ov.style.zIndex = "999999";
    ov.style.background = "transparent";
    ov.style.display = "none";
    ov.style.pointerEvents = "auto";
    ov.title = "AI Radio is ON (controls locked)";
    wrap.appendChild(ov);
    return ov;
  }

  const S = window.__NCZ_AI_RADIO_STATE__ = window.__NCZ_AI_RADIO_STATE__ || {
    on: false,
    internalSrcUntil: 0,
    prevState: null,
    currentRadioUrl: "",
    currentRadioTitle: ""
  };

  function markInternalSrcChange(){
    S.internalSrcUntil = Date.now() + INTERNAL_SRC_GRACE_MS;
  }
  function isInternalSrcChange(){
    return Date.now() <= (S.internalSrcUntil || 0);
  }

  function onKeydownCapture(e){
    if(!S.on) return;
    if(e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  async function waitForEventOrTimeout(el, eventName, ms){
    return await new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if(done) return;
        done = true;
        try{ el.removeEventListener(eventName, onEv); }catch{}
        resolve(false);
      }, ms);

      function onEv(){
        if(done) return;
        done = true;
        clearTimeout(t);
        try{ el.removeEventListener(eventName, onEv); }catch{}
        resolve(true);
      }

      el.addEventListener(eventName, onEv, { once:true });
    });
  }

  async function robustSeek(player, target){
    target = Number(target);
    if(!Number.isFinite(target) || target <= 0) return true;

    try{
      if (player.seekable && player.seekable.length === 0){
        console.warn("[aiRadio] player.seekable is empty. Server may not support Range requests -> cannot seek.");
      }
    }catch{}

    for(let i=0; i<SEEK_RETRY_COUNT; i++){
      try{
        if (typeof player.fastSeek === "function") player.fastSeek(target);
        else player.currentTime = target;
      }catch{}

      const cur = Number(player.currentTime || 0);
      if (cur >= (target - 0.75)) return true;

      await waitForEventOrTimeout(player, "canplay", SEEK_RETRY_DELAY_MS);
      await new Promise(r => setTimeout(r, SEEK_RETRY_DELAY_MS));
    }

    const cur2 = Number(player.currentTime || 0);
    const ok = cur2 >= (target - 0.75);
    if(!ok){
      console.warn("[aiRadio] seek did not apply. Wanted:", target, "Got:", cur2, "URL:", player.currentSrc || player.src);
    }
    return ok;
  }

  function computeSeekSeconds(nowPlaying, latencySec, player){
    let seek = Number(nowPlaying?.elapsed);
    if(!Number.isFinite(seek)){
      const dur = Number(nowPlaying?.duration);
      const rem = Number(nowPlaying?.remaining);
      if(Number.isFinite(dur) && Number.isFinite(rem)) seek = Math.max(0, dur - rem);
      else seek = 0;
    }

    seek = Math.max(0, seek + (Number(latencySec) || 0));

    const durServer = Number(nowPlaying?.duration);
    const durPlayer = Number(player?.duration);
    const dur = (Number.isFinite(durServer) && durServer > 0) ? durServer :
                (Number.isFinite(durPlayer) && durPlayer > 0) ? durPlayer : 0;

    if(dur > 1){
      seek = Math.min(seek, Math.max(0, dur - 0.25));
    }
    return seek;
  }

  function updateRadioMetaAndDownload(now, url){
    // 1) Output info box
    const metaBox = $("resultMeta");
    if(metaBox){
      const name = String(now?.title || now?.name || now?.filename || "").trim();
      const author = String(now?.author || "").trim();
      const line = name ? (author ? `${name} — ${author}` : name) : (urlBasename(url) || "Radio");
      metaBox.textContent = `📻 AI Radio\n${line}\n${url}`;
      S.currentRadioTitle = line;
    }

    // 2) Download current link override (ONLY while radio is ON)
    const dl = $("downloadLink");
    if(dl && S.on){
      dl.href = url;

      // set download filename best-effort
      const bn = urlBasename(url);
      if (bn) dl.setAttribute("download", bn);
      else dl.setAttribute("download", "");

      // keep visible text unchanged
      // dl.textContent = "Download current";
    }
  }

  async function loadRadioNowPlaying({ seekToSync }){
    const player = findPlayer();
    if(!player) throw new Error("audio#player not found");

    const { json, latencySec } = await radioFetchJsonTimed("/aiRadio");
    const now = json?.now_playing || null;
    if(!now || !now.file) throw new Error("aiRadio returned no now_playing");

    const url = absFromServerPath(now.file);
    if(!url) throw new Error("Bad now_playing.file");

    S.currentRadioUrl = url;

    markInternalSrcChange();

    await new Promise((resolve, reject) => {
      let done = false;

      const cleanup = () => {
        player.removeEventListener("loadedmetadata", onMeta);
        player.removeEventListener("error", onErr);
      };

      const onErr = () => {
        if(done) return;
        done = true;
        cleanup();
        reject(new Error("Failed to load radio audio"));
      };

      const onMeta = async () => {
        if(done) return;

        await waitForEventOrTimeout(player, "canplay", 700);

        if(seekToSync){
          const seek = computeSeekSeconds(now, latencySec, player);
          await robustSeek(player, seek);
        } else {
          try { player.currentTime = 0; } catch {}
        }

        try{
          const p = player.play();
          if(p && typeof p.catch === "function") p.catch(()=>{});
        }catch{}

        done = true;
        cleanup();
        resolve(true);
      };

      player.addEventListener("loadedmetadata", onMeta);
      player.addEventListener("error", onErr);

      player.preload = "auto";
      player.src = url;
      try { player.load(); } catch {}
    });

    updateRadioMetaAndDownload(now, url);
  }

  async function radioNextNoSeek(){
    await loadRadioNowPlaying({ seekToSync: false });
  }

  function enterRadioMode(){
    const player = findPlayer();
    if(!player) return false;

    const { wrap, prev, next } = findPrevNextButtons(player);
    const overlay = ensureLockOverlay(wrap);
    const dl = $("downloadLink");

    // Save prior state (including download link!)
    S.prevState = {
      controls: !!player.controls,
      prevDisabled: prev ? !!prev.disabled : false,
      nextDisabled: next ? !!next.disabled : false,
      overlayWasVisible: overlay ? (overlay.style.display !== "none") : false,

      dlHref: dl ? String(dl.getAttribute("href") || "") : null,
      dlDownloadAttr: dl ? (dl.getAttribute("download")) : null,
      dlText: dl ? String(dl.textContent || "") : null
    };

    // keep progress bar visible
    player.controls = true;

    // disable buttons
    if(prev) prev.disabled = true;
    if(next) next.disabled = true;

    // block interaction
    if(overlay) overlay.style.display = "block";

    window.addEventListener("keydown", onKeydownCapture, true);
    return true;
  }

  function exitRadioMode(){
    const player = findPlayer();
    if(!player) return false;

    const { prev, next } = findPrevNextButtons(player);
    const overlay = document.getElementById(OVERLAY_ID);
    const dl = $("downloadLink");

    const ps = S.prevState || {};

    player.controls = !!ps.controls;
    if(prev) prev.disabled = !!ps.prevDisabled;
    if(next) next.disabled = !!ps.nextDisabled;
    if(overlay) overlay.style.display = ps.overlayWasVisible ? "block" : "none";

    // ✅ restore downloadLink override
    if(dl){
      if(ps.dlHref != null) dl.setAttribute("href", ps.dlHref);
      else dl.setAttribute("href", "#");

      if(ps.dlDownloadAttr === null || typeof ps.dlDownloadAttr === "undefined"){
        dl.removeAttribute("download");
      } else {
        dl.setAttribute("download", ps.dlDownloadAttr);
      }

      if(ps.dlText != null) dl.textContent = ps.dlText;
    }

    window.removeEventListener("keydown", onKeydownCapture, true);
    return true;
  }

  async function toggleRadio(){
    const player = findPlayer();
    if(!player){
      setRadioPill("bad", "Radio: No player");
      return;
    }

    if(S.on){
      S.on = false;
      exitRadioMode();
      setRadioPill("warn", "Radio: OFF");
      return;
    }

    S.on = true;
    enterRadioMode();
    setRadioPill("warn", "Radio: Syncing…");

    try{
      await loadRadioNowPlaying({ seekToSync: true });
      setRadioPill("good", "Radio: ON");
    }catch(err){
      console.warn("[aiRadio] start failed:", err);
      setRadioPill("bad", "Radio: Error");
    }
  }

  function bindEndedOverride(){
    const player = findPlayer();
    if(!player) return false;

    if(player.dataset.__nczRadioEndedBoundV3B__ === "1") return true;
    player.dataset.__nczRadioEndedBoundV3B__ = "1";

    player.addEventListener("ended", async (e) => {
      if(!S.on) return;

      try{
        e.preventDefault();
        e.stopImmediatePropagation();
      }catch{}

      setRadioPill("warn", "Radio: Loading…");
      try{
        await radioNextNoSeek();
        setRadioPill("good", "Radio: ON");
      }catch(err){
        console.warn("[aiRadio] next failed:", err);
        setRadioPill("bad", "Radio: Error");
      }
    }, true);

    return true;
  }

  function bindSrcChangeWatcher(){
    const player = findPlayer();
    if(!player) return false;

    if(player.dataset.__nczRadioSrcWatchBoundV3B__ === "1") return true;
    player.dataset.__nczRadioSrcWatchBoundV3B__ = "1";

    const mo = new MutationObserver((mutList) => {
      if(!S.on) return;

      for(const m of mutList){
        if(m.type !== "attributes") continue;
        if(m.attributeName !== "src") continue;

        if(!isInternalSrcChange()){
          // user (or other script) changed song -> radio OFF + restore downloadLink override
          S.on = false;
          exitRadioMode();
          setRadioPill("warn", "Radio: OFF");
          return;
        }
      }
    });

    mo.observe(player, { attributes:true, attributeFilter:["src"] });
    return true;
  }

  function init(){
    const pill = ensureRadioPill();
    if(!pill) return false;

    bindEndedOverride();
    bindSrcChangeWatcher();

    // Use CAPTURE to beat any older leftover bindings (but you should still delete old blocks)
    if(pill.dataset.__boundV3B__ !== "1"){
      pill.dataset.__boundV3B__ = "1";

      pill.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleRadio();
      }, true);

      pill.addEventListener("keydown", (e) => {
        if(e.key === "Enter" || e.key === " "){
          e.preventDefault();
          e.stopImmediatePropagation();
          toggleRadio();
        }
      }, true);
    }

    setRadioPill("warn", "Radio: OFF");
    return true;
  }

  if(init()) return;

  const obs = new MutationObserver(() => {
    if(init()) obs.disconnect();
  });
  obs.observe(document.documentElement, { childList:true, subtree:true });
  setTimeout(() => obs.disconnect(), 15000);
})();



/* ✅ NCZ PATCH: AI Radio allow volume, block seeking, RESYNC on resume (Play) — NOT on pause
   - Radio ON:
       • lets native controls be clickable (volume works)
       • blocks seeking (rubber-band back)
       • if user PAUSES: allowed (no forced resume)
       • when user PRESSES PLAY to resume: fetch /aiRadio, swap track if needed, seek to server elapsed, then play
*/
(() => {
  "use strict";
  if (window.__NCZ_AI_RADIO_ALLOW_VOLUME_BLOCK_SEEK_RESYNC_ON_PLAY__) return;
  window.__NCZ_AI_RADIO_ALLOW_VOLUME_BLOCK_SEEK_RESYNC_ON_PLAY__ = true;

  const PLAYER_ID = "player";
  const OVERLAY_ID = "__ncz_radio_lock_overlay__";

  const FETCH_TIMEOUT_MS = 12000;
  const ALLOW_SEEK_WINDOW_MS = 1800;   // allow our own seek without rubber-banding
  const INTERNAL_SRC_GRACE_MS = 1600;  // tells V3b src-watcher "this src change is internal"
  const SEEK_RETRY_COUNT = 10;
  const SEEK_RETRY_DELAY_MS = 140;

  function state(){ return window.__NCZ_AI_RADIO_STATE__ || null; }
  function inRadio(){ return !!(state() && state().on); }

  function getPlayer(){
    const p = document.getElementById(PLAYER_ID);
    return (p && p.tagName && p.tagName.toLowerCase() === "audio") ? p : null;
  }

  function normBaseUrl(u){
    u = (u || "").trim();
    if(!u) return window.location.origin.replace(/\/+$/, "");
    return u.replace(/\/+$/, "");
  }

  function absFromServerPath(fileOrUrl){
    const s = String(fileOrUrl || "").trim();
    if(!s) return "";
    if(/^https?:\/\//i.test(s)) return s;

    const base = normBaseUrl(document.getElementById("baseUrl")?.value || "");
    try{
      const b = new URL(base.endsWith("/") ? base : base + "/");
      const basePath = b.pathname.replace(/\/+$/, "");

      if(s.startsWith("/")){
        if(basePath && basePath !== "/" && !s.startsWith(basePath + "/")){
          return b.origin + basePath + s;
        }
        return b.origin + s;
      }
      return new URL(s, b.origin + (basePath || "") + "/").toString();
    }catch{
      const base2 = String(base || "").replace(/\/+$/, "");
      return base2 + "/" + s.replace(/^\/+/, "");
    }
  }

  function markInternalSrcChange(){
    const st = state();
    if(!st) return;
    st.internalSrcUntil = Date.now() + INTERNAL_SRC_GRACE_MS;
  }

  async function fetchAiRadio(){
    const baseUrl = normBaseUrl(document.getElementById("baseUrl")?.value || "");
    const url = baseUrl + "/aiRadio";

    const authMode = document.getElementById("authMode")?.value || "none";
    const apiKey = (document.getElementById("apiKey")?.value || "").trim();
    const headers = {};
    if(authMode === "header" && apiKey) headers["Authorization"] = "Bearer " + apiKey;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const t0 = performance.now();
    try{
      const resp = await fetch(url, { method:"GET", headers, cache:"no-store", signal: ctrl.signal });
      const text = await resp.text();
      const t1 = performance.now();
      const halfRttSec = Math.max(0, (t1 - t0) / 2000);

      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }

      if(!resp.ok){
        const msg = (json && (json.detail || json.error)) ? (json.detail || json.error) : ("HTTP " + resp.status);
        throw new Error(msg);
      }
      return { json, halfRttSec };
    } finally {
      clearTimeout(t);
    }
  }

  function computeSeek(nowPlaying, halfRttSec, player){
    let seek = Number(nowPlaying?.elapsed);
    if(!Number.isFinite(seek)){
      const dur = Number(nowPlaying?.duration);
      const rem = Number(nowPlaying?.remaining);
      if(Number.isFinite(dur) && Number.isFinite(rem)) seek = Math.max(0, dur - rem);
      else seek = 0;
    }

    seek = Math.max(0, seek + (Number(halfRttSec) || 0));

    const durServer = Number(nowPlaying?.duration);
    const durPlayer = Number(player?.duration);
    const dur = (Number.isFinite(durServer) && durServer > 0) ? durServer :
                (Number.isFinite(durPlayer) && durPlayer > 0) ? durPlayer : 0;

    if(dur > 1){
      seek = Math.min(seek, Math.max(0, dur - 0.25));
    }
    return seek;
  }

  async function waitFor(el, ev, ms){
    return await new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if(done) return;
        done = true;
        try{ el.removeEventListener(ev, on); }catch{}
        resolve(false);
      }, ms);
      function on(){
        if(done) return;
        done = true;
        clearTimeout(t);
        try{ el.removeEventListener(ev, on); }catch{}
        resolve(true);
      }
      el.addEventListener(ev, on, { once:true });
    });
  }

  async function robustSeek(player, target){
    target = Number(target);
    if(!Number.isFinite(target) || target <= 0) return true;

    for(let i=0; i<SEEK_RETRY_COUNT; i++){
      try{
        if(typeof player.fastSeek === "function") player.fastSeek(target);
        else player.currentTime = target;
      }catch{}

      const cur = Number(player.currentTime || 0);
      if(cur >= (target - 0.75)) return true;

      await waitFor(player, "canplay", SEEK_RETRY_DELAY_MS);
      await new Promise(r => setTimeout(r, SEEK_RETRY_DELAY_MS));
    }
    return false;
  }

  function disableOverlaySoVolumeWorks(){
    const ov = document.getElementById(OVERLAY_ID);
    if(!ov) return;

    if(inRadio()){
      // allow native controls (volume)
      ov.style.display = "none";
      ov.style.pointerEvents = "none";
    } else {
      ov.style.pointerEvents = "auto";
      // don't force display; V3b manages it
    }
  }

  async function resyncToServerAndPlay(){
    const player = getPlayer();
    const st = state();
    if(!player || !st || !st.on) return;

    const { json, halfRttSec } = await fetchAiRadio();
    const now = json?.now_playing;
    if(!now || !now.file) throw new Error("aiRadio missing now_playing");

    const wantUrl = absFromServerPath(now.file);
    const curUrl = String(player.currentSrc || player.src || "").trim();

    // swap song if server advanced
    if(wantUrl && curUrl && wantUrl !== curUrl){
      markInternalSrcChange();
      player.src = wantUrl;
      try{ player.load(); }catch{}
      await waitFor(player, "loadedmetadata", 1800);
      await waitFor(player, "canplay", 1400);
    } else {
      await waitFor(player, "canplay", 900);
    }

    // allow our seek without rubber-banding
    _allowSeekUntil = Date.now() + ALLOW_SEEK_WINDOW_MS;

    const seek = computeSeek(now, halfRttSec, player);
    await robustSeek(player, seek);

    // play
    _suppressPlayHandler = true;
    try{
      const p = player.play();
      if(p && typeof p.catch === "function") p.catch(()=>{});
    } finally {
      setTimeout(() => { _suppressPlayHandler = false; }, 250);
    }
  }

  // these are module-level for the handlers
  let _allowSeekUntil = 0;
  let _lastGoodTime = 0;
  let _suppressPlayHandler = false;
  let _syncing = false;

  function bind(player){
    if(player.dataset.__nczRadioAllowVolResyncOnPlayBound__ === "1") return;
    player.dataset.__nczRadioAllowVolResyncOnPlayBound__ = "1";

    // keep last good time during normal playback
    player.addEventListener("timeupdate", () => {
      if(!inRadio()) return;
      if(player.seeking) return;
      const t = Number(player.currentTime || 0);
      if(Number.isFinite(t)) _lastGoodTime = t;
    }, { passive:true });

    // allow internal seeks right after src loads (radio script load)
    player.addEventListener("loadstart", () => {
      if(!inRadio()) return;
      _allowSeekUntil = Date.now() + ALLOW_SEEK_WINDOW_MS;
      try{ _lastGoodTime = Number(player.currentTime || 0) || 0; }catch{ _lastGoodTime = 0; }
    }, { passive:true });

    player.addEventListener("loadedmetadata", () => {
      if(!inRadio()) return;
      _allowSeekUntil = Date.now() + ALLOW_SEEK_WINDOW_MS;
      try{ _lastGoodTime = Number(player.currentTime || 0) || 0; }catch{ _lastGoodTime = 0; }
    }, { passive:true });

    // block seeking (rubber-band) — allows our internal seek window
    player.addEventListener("seeking", () => {
      if(!inRadio()) return;
      if(Date.now() <= _allowSeekUntil) return;

      try{
        const back = Number.isFinite(_lastGoodTime) ? _lastGoodTime : 0;
        if(typeof player.fastSeek === "function") player.fastSeek(back);
        else player.currentTime = back;
      }catch{}
    });

    // ✅ KEY CHANGE: resync ONLY when user resumes (presses Play)
    // We capture the play event, pause immediately, resync, then play.
    player.addEventListener("play", (e) => {
      if(!inRadio()) return;
      if(_suppressPlayHandler) return;
      if(_syncing) return;

      _syncing = true;

      // stop immediate local playback so we can reseek cleanly
      try{ player.pause(); }catch{}

      setTimeout(async () => {
        try{
          // resync to server and resume
          await resyncToServerAndPlay();
        }catch(err){
          // if sync fails, at least allow play
          try{
            _suppressPlayHandler = true;
            const p = player.play();
            if(p && typeof p.catch === "function") p.catch(()=>{});
          }catch{}
          console.warn("[aiRadio] resync-on-play failed:", err);
        } finally {
          _syncing = false;
        }
      }, 0);
    }, true);

    // keep overlay disabled so volume works
    disableOverlaySoVolumeWorks();
    setInterval(disableOverlaySoVolumeWorks, 250);
  }

  function init(){
    const p = getPlayer();
    if(!p) return false;
    bind(p);
    return true;
  }

  if(init()) return;

  const mo = new MutationObserver(() => {
    if(init()) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList:true, subtree:true });
  setTimeout(() => mo.disconnect(), 15000);
})();









/* ✅ NCZ PATCH: AI Radio "Add to Playlist" button (SAFE V2 - no MutationObserver)
   - Adds a button next to the "📻 AI Radio" header inside #resultMeta
   - Click adds the current radio song to Song List using window.addSongToList()
   - No observers (prevents runaway loops); uses a light poll instead
*/
(() => {
  "use strict";
  if (window.__NCZ_AI_RADIO_ADD_TO_PLAYLIST_SAFE_V2__) return;
  window.__NCZ_AI_RADIO_ADD_TO_PLAYLIST_SAFE_V2__ = true;

  const BOX_ID = "resultMeta";
  const HDR_ID = "__ncz_radio_meta_hdr_v2__";
  const BTN_ID = "__ncz_radio_add_btn_v2__";
  const LINES_ID = "__ncz_radio_meta_lines_v2__";

  let lastKey = "";
  let polling = null;

  function $(id){ return document.getElementById(id); }

  function nowIso(){
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function normBaseUrl(u){
    u = (u || "").trim();
    if(!u) return window.location.origin.replace(/\/+$/, "");
    return u.replace(/\/+$/, "");
  }

  // Same /ace prefix logic your app uses
  function absFromServerPath(fileOrUrl){
    const s = String(fileOrUrl || "").trim();
    if(!s) return "";
    if(/^https?:\/\//i.test(s)) return s;

    const base = normBaseUrl(document.getElementById("baseUrl")?.value || "");
    try{
      const b = new URL(base.endsWith("/") ? base : base + "/");
      const basePath = b.pathname.replace(/\/+$/, ""); // "" or "/ace"

      if(s.startsWith("/")){
        if(basePath && basePath !== "/" && !s.startsWith(basePath + "/")){
          return b.origin + basePath + s;
        }
        return b.origin + s;
      }
      return new URL(s, b.origin + (basePath || "") + "/").toString();
    }catch{
      const base2 = String(base || "").replace(/\/+$/, "");
      return base2 + "/" + s.replace(/^\/+/, "");
    }
  }

  function urlBasename(u){
    const s = String(u || "").trim();
    if(!s) return "";
    try{
      const U = new URL(s, window.location.origin);
      const last = (U.pathname.split("/").filter(Boolean).pop() || "");
      return decodeURIComponent(last);
    }catch{
      const noQ = s.split("?")[0].split("#")[0];
      const last = (noQ.split("/").filter(Boolean).pop() || "");
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function splitTitleAuthor(line){
    line = String(line || "").trim();
    if(!line) return { title:"", author:"" };
    const sep = " — ";
    const idx = line.lastIndexOf(sep);
    if(idx > 0){
      return {
        title: line.slice(0, idx).trim(),
        author: line.slice(idx + sep.length).trim()
      };
    }
    return { title: line, author: "" };
  }

  function parseRadioBoxText(raw){
    // Expected V3b format:
    // 📻 AI Radio
    // Title line
    // URL line
    const lines = String(raw || "").split("\n").map(s => String(s||"").trim()).filter(Boolean);
    if(!lines.length) return { titleLine:"", url:"" };

    let titleLine = "";
    let url = "";

    // Title is usually second line
    if(lines[0] === "📻 AI Radio" && lines[1]) titleLine = lines[1];

    // URL: first line that looks like URL or contains .mp3
    for(const l of lines){
      if(/^https?:\/\//i.test(l) || /\.mp3(\?|$)/i.test(l) || l.startsWith("/")){
        // prefer the one that actually looks like a file/url
        url = l;
      }
    }

    return { titleLine, url };
  }

  function getRadioInfo(){
    const st = window.__NCZ_AI_RADIO_STATE__ || {};
    const box = $(BOX_ID);

    let url = String(st.currentRadioUrl || "").trim();
    let titleLine = String(st.currentRadioTitle || "").trim();

    // If state doesn't have it, parse from #resultMeta
    if(box){
      const raw = String(box.textContent || "").trim();
      if(raw.startsWith("📻 AI Radio")){
        const p = parseRadioBoxText(raw);
        if(!titleLine) titleLine = p.titleLine || "";
        if(!url) url = p.url || "";
      }
    }

    url = absFromServerPath(url);

    // fallback titleLine from url
    if(!titleLine && url) titleLine = urlBasename(url) || "Radio";

    const { title, author } = splitTitleAuthor(titleLine);

    return {
      url,
      titleLine,
      title: title || titleLine || "Radio",
      author: author || ""
    };
  }

  function buildUI(box){
    // Already built?
    let hdr = document.getElementById(HDR_ID);
    let lines = document.getElementById(LINES_ID);
    let btn = document.getElementById(BTN_ID);

    if(hdr && lines && btn && box.contains(hdr) && box.contains(lines)) return { hdr, lines, btn };

    // Build fresh
    box.innerHTML = "";

    hdr = document.createElement("div");
    hdr.id = HDR_ID;
    hdr.style.display = "flex";
    hdr.style.alignItems = "center";
    hdr.style.justifyContent = "space-between";
    hdr.style.gap = "10px";
    hdr.style.marginBottom = "6px";

    const left = document.createElement("div");
    left.textContent = "📻 AI Radio";
    left.style.fontWeight = "900";

    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "secondary";
    btn.textContent = "Add to Playlist";
    btn.title = "Add current radio song to Song List";
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "12px";
    btn.style.fontWeight = "900";
    btn.style.fontSize = "12px";
    btn.style.whiteSpace = "nowrap";

    hdr.appendChild(left);
    hdr.appendChild(btn);

    lines = document.createElement("div");
    lines.id = LINES_ID;
    lines.style.whiteSpace = "pre-wrap";
    lines.style.wordBreak = "break-word";
    lines.style.fontFamily = "var(--mono, ui-monospace)";
    lines.style.fontSize = "12px";

    box.appendChild(hdr);
    box.appendChild(lines);

    return { hdr, lines, btn };
  }

  function ensureButtonHandler(btn){
    if(btn.dataset.__bound__ === "1") return;
    btn.dataset.__bound__ = "1";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const addFn = window.addSongToList;
      if(typeof addFn !== "function"){
        alert("addSongToList() is not available on window yet.");
        return;
      }

      const info = getRadioInfo();
      if(!info.url){
        alert("No radio URL detected.");
        return;
      }

      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Adding…";

      try{
        const meta = { title: info.title, author: info.author };

        addFn(info.url, {
          label: "",                 // let meta.title drive the display
          createdAt: nowIso(),
          meta,
          serverItem: { file: info.url, title: meta.title, author: meta.author },
          downloadName: info.url
        });

        btn.textContent = "Added ✓";
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = oldText;
        }, 900);
      }catch(err){
        console.warn("[aiRadio add] failed:", err);
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }, true);
  }

  function tick(){
    const box = $(BOX_ID);
    if(!box) return;

    const raw = String(box.textContent || "").trim();
    if(!raw.startsWith("📻 AI Radio")) return;

    const info = getRadioInfo();
    if(!info.url) return;

    const key = (info.titleLine || info.title) + "\n" + info.url;
    if(key === lastKey && document.getElementById(BTN_ID)) return;
    lastKey = key;

    const ui = buildUI(box);
    ui.lines.textContent = `${info.titleLine || (info.title + (info.author ? " — " + info.author : ""))}\n${info.url}`;
    ensureButtonHandler(ui.btn);
  }

  function init(){
    // light polling; only does anything when resultMeta starts with 📻
    if(polling) clearInterval(polling);
    polling = setInterval(tick, 350);

    // do an immediate pass too
    setTimeout(tick, 0);
  }

  init();
})();





























/* ✅ NCZ PATCH: Result Info Box History (Back/Forward) v3
   - Dark themed scrollbars
   - FIX: Radio snapshots are CLEANED so "Add to Playlist" never gets captured into the text
   - "Add to Playlist" renders as a small footer link at the BOTTOM of the history view (discrete)
   - Polling-based (no MutationObserver recursion)
*/
(() => {
  "use strict";
  if (window.__NCZ_RESULTMETA_HISTORY_NAV_V3__) return;
  window.__NCZ_RESULTMETA_HISTORY_NAV_V3__ = true;

  const BOX_ID = "resultMeta";
  const WRAP_ID = "__ncz_resultmeta_wrap__";
  const BAR_ID  = "__ncz_resultmeta_hist_bar__";
  const OV_ID   = "__ncz_resultmeta_hist_overlay__";
  const OV_TXT  = "__ncz_resultmeta_hist_text__";
  const OV_PRE  = "__ncz_resultmeta_hist_pre__";
  const OV_FOOT = "__ncz_resultmeta_hist_footer__";
  const OV_ADD  = "__ncz_resultmeta_hist_addlink__";

  const BTN_BACK_ID = "__ncz_resultmeta_back__";
  const BTN_FWD_ID  = "__ncz_resultmeta_fwd__";
  const COUNT_ID    = "__ncz_resultmeta_count__";

  const POLL_MS = 350;
  const MAX_HISTORY = 400;

  function $(id){ return document.getElementById(id); }

  function ensureWrap(box){
    let wrap = $(WRAP_ID);
    if (wrap && wrap.contains(box)) return wrap;

    wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    wrap.style.position = "relative";
    wrap.style.width = "100%";

    const parent = box.parentNode;
    parent.insertBefore(wrap, box);
    wrap.appendChild(box);
    return wrap;
  }

  function ensureStyles(){
    const STYLE_ID = "__ncz_resultmeta_hist_style_v3__";
    if ($(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${BAR_ID}{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin: 0 0 8px 0;
      }
      #${BAR_ID} .__left__{
        display:flex;
        align-items:center;
        gap:8px;
      }
      #${BAR_ID} .__count__{
        font-family: var(--mono, ui-monospace);
        font-size: 12px;
        color: var(--muted);
        opacity: .95;
        white-space: nowrap;
      }
      #${BAR_ID} button{
        padding: 6px 10px !important;
        font-size: 12px !important;
        border-radius: 12px !important;
        background: rgba(255,255,255,.08) !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        color: var(--text) !important;
        cursor: pointer !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
      }
      #${BAR_ID} button:hover{ background: rgba(255,255,255,.12) !important; }
      #${BAR_ID} button:disabled{ opacity: .45 !important; cursor:not-allowed !important; }

      /* Overlay sits on top of the real #resultMeta */
      #${OV_ID}{
        position:absolute;
        inset: 0;
        z-index: 5;
        display:none;
        border-radius: 12px;
        background: rgba(0,0,0,.38);
        backdrop-filter: blur(2px);
      }
      #${OV_ID}.__show__{ display:block; }

      /* Scroll container (dark scrollbars) */
      #${OV_TXT}{
        position:absolute;
        inset: 10px;
        overflow:auto;
        font-family: var(--mono, ui-monospace);
        font-size: 12px;
        line-height: 1.35;
        color: rgba(233,238,252,.95);
        padding: 10px 10px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(12,16,26,.78);

        scrollbar-width: thin;                       /* Firefox */
        scrollbar-color: #2a355c #0b0d12;            /* thumb track */
      }
      #${OV_TXT}::-webkit-scrollbar{ width: 12px; height: 12px; }
      #${OV_TXT}::-webkit-scrollbar-track{ background:#0b0d12; border-radius:12px; }
      #${OV_TXT}::-webkit-scrollbar-thumb{
        background: linear-gradient(180deg, #1e2742, #2a355c);
        border-radius: 12px;
        border: 3px solid #0b0d12;
      }
      #${OV_TXT}::-webkit-scrollbar-thumb:hover{
        background: linear-gradient(180deg, #2a355c, #3b4a7d);
      }
      #${OV_TXT}::-webkit-scrollbar-corner{ background:#0b0d12; }

      /* History text */
      #${OV_PRE}{
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      /* Footer row (discrete link at bottom) */
      #${OV_FOOT}{
        display:none;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,.10);
        opacity: .92;
        text-align: right;
      }
      #${OV_FOOT}.__show__{ display:block; }

      #${OV_ADD}{
        color: var(--accent);
        text-decoration: none;
        font-weight: 900;
        font-size: 12px;
        white-space: nowrap;
      }
      #${OV_ADD}:hover{ text-decoration: underline; }
    `;
    document.head.appendChild(st);
  }

  function ensureBar(wrap){
    let bar = $(BAR_ID);
    if (bar) return bar;

    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.innerHTML = `
      <div class="__left__">
        <button id="${BTN_BACK_ID}" type="button" title="Back">⟵</button>
        <button id="${BTN_FWD_ID}"  type="button" title="Forward">⟶</button>
        <span class="__count__" id="${COUNT_ID}">Info 0/0</span>
      </div>
    `;
    wrap.parentNode.insertBefore(bar, wrap);
    return bar;
  }

  function ensureOverlay(wrap){
    let ov = $(OV_ID);
    if (ov) return ov;

    ov = document.createElement("div");
    ov.id = OV_ID;

    const inner = document.createElement("div");
    inner.id = OV_TXT;

    const pre = document.createElement("pre");
    pre.id = OV_PRE;

    const foot = document.createElement("div");
    foot.id = OV_FOOT;

    const a = document.createElement("a");
    a.id = OV_ADD;
    a.href = "#";
    a.textContent = "Add to Playlist";
    foot.appendChild(a);

    inner.appendChild(pre);
    inner.appendChild(foot);

    ov.appendChild(inner);
    wrap.appendChild(ov);

    return ov;
  }

  // --- radio parsing/cleanup ---
  function parseRadioFromText(rawText){
    const t = String(rawText || "");

    // find mp3 URL (absolute preferred)
    let url = "";
    const mAbs = t.match(/https?:\/\/[^\s]+?\.mp3\b/ig);
    if (mAbs && mAbs.length) url = mAbs[0];

    if (!url){
      const mRel = t.match(/\/[^\s]+?\.mp3\b/ig);
      if (mRel && mRel.length) url = mRel[0];
    }
    if (!url) return null;

    // detect radio-ish marker
    const looksRadio = /ai\s*radio/i.test(t) || t.includes("📻");
    if (!looksRadio) return null;

    // label: try to find a non-url line containing ".mp3"
    let label = "";
    const lines = t.replace(/\r\n/g, "\n").split("\n").map(s => s.trim()).filter(Boolean);

    for (const line of lines){
      if (!/\.mp3\b/i.test(line)) continue;
      if (/^https?:\/\//i.test(line)) continue;
      if (/add\s*to\s*playlist/i.test(line)) continue;
      if (/ai\s*radio/i.test(line)) continue;
      label = line;
      break;
    }

    if (!label){
      // fallback to basename from url
      try{
        const u = url.startsWith("http") ? new URL(url) : new URL(url, location.origin);
        label = decodeURIComponent((u.pathname.split("/").pop() || "").trim()) || "Radio song.mp3";
      }catch{
        label = "Radio song.mp3";
      }
    }

    // CLEAN, stable snapshot text (prevents the flattened "AI RadioAdd to Playlist..." junk)
    const cleanText = `📻 AI Radio\n${label}\n${url}`;

    return { url: String(url), label: String(label), cleanText };
  }

  function snapshot(box){
    const raw = String(box.textContent || "").replace(/\r\n/g, "\n");
    const radio = parseRadioFromText(raw);
    if (radio) return { text: radio.cleanText, radio: { url: radio.url, label: radio.label } };
    return { text: raw, radio: null };
  }

  // history state
  const hist = [];
  let idx = -1;
  let lastText = "";

  function pushSnapshot(snap){
    const text = snap.text;

    if (hist.length && hist[hist.length - 1].text === text) return;

    hist.push({ ts: Date.now(), text, radio: snap.radio });

    if (hist.length > MAX_HISTORY){
      const extra = hist.length - MAX_HISTORY;
      hist.splice(0, extra);
      idx = Math.max(0, idx - extra);
    }

    if (idx === hist.length - 2 || idx < 0) idx = hist.length - 1;
  }

  function setFooterLink(entry, overlayShowing){
    const foot = $(OV_FOOT);
    const a = $(OV_ADD);
    if (!foot || !a) return;

    // only show when overlay is showing AND entry has radio data
    const r = entry && entry.radio ? entry.radio : null;
    const show = !!(overlayShowing && r && r.url);

    foot.classList.toggle("__show__", show);
    if (!show){
      a.onclick = null;
      a.removeAttribute("data-url");
      a.removeAttribute("data-label");
      return;
    }

    a.setAttribute("data-url", r.url);
    a.setAttribute("data-label", r.label || "");
    a.textContent = "Add to Playlist";

    if (a.dataset.__bound__ !== "1"){
      a.dataset.__bound__ = "1";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const url = String(a.getAttribute("data-url") || "").trim();
        const label = String(a.getAttribute("data-label") || "").trim();

        if (!url) return;
        if (typeof window.addSongToList !== "function") return;

        try{
          const createdAt = (typeof window.nowIso === "function")
            ? window.nowIso()
            : (new Date().toLocaleString());

          window.addSongToList(url, {
            label: label || "Radio song",
            taskId: "",
            outputIndex: 0,
            createdAt,
            meta: {},
            serverItem: { file: url, url, created_at: createdAt }
          });

          a.textContent = "Added ✓";
          setTimeout(() => { a.textContent = "Add to Playlist"; }, 900);
        }catch{}
      }, true);
    }
  }

  function updateUI(){
    const back = $(BTN_BACK_ID);
    const fwd  = $(BTN_FWD_ID);
    const count = $(COUNT_ID);
    const ov = $(OV_ID);
    const pre = $(OV_PRE);

    if (!back || !fwd || !count || !ov || !pre) return;

    const total = hist.length;
    const atLatest = (idx === total - 1);

    back.disabled = !(total > 0 && idx > 0);
    fwd.disabled  = !(total > 0 && idx < total - 1);

    const pos = total ? (idx + 1) : 0;
    count.textContent = `Info ${pos}/${total}` + (atLatest ? "" : " (history)");

    if (total === 0 || atLatest){
      ov.classList.remove("__show__");
      pre.textContent = "";
      setFooterLink(null, false);
    } else {
      ov.classList.add("__show__");
      const entry = hist[idx];
      pre.textContent = entry.text || "";
      setFooterLink(entry, true);
    }
  }

  function go(delta){
    const total = hist.length;
    if(!total) return;
    const next = idx + delta;
    if(next < 0 || next >= total) return;
    idx = next;
    updateUI();
  }

  function init(){
    const box = $(BOX_ID);
    if(!box) return false;

    ensureStyles();
    const wrap = ensureWrap(box);
    ensureBar(wrap);
    ensureOverlay(wrap);

    const back = $(BTN_BACK_ID);
    const fwd  = $(BTN_FWD_ID);

    if (back && back.dataset.__bound__ !== "1"){
      back.dataset.__bound__ = "1";
      back.addEventListener("click", (e) => { e.preventDefault(); go(-1); }, true);
    }
    if (fwd && fwd.dataset.__bound__ !== "1"){
      fwd.dataset.__bound__ = "1";
      fwd.addEventListener("click", (e) => { e.preventDefault(); go(+1); }, true);
    }

    // seed
    const s0 = snapshot(box);
    lastText = s0.text;
    pushSnapshot(s0);
    idx = hist.length - 1;
    updateUI();

    // poll
    setInterval(() => {
      const box2 = $(BOX_ID);
      if(!box2) return;

      const s = snapshot(box2);
      if (s.text === lastText) return;

      lastText = s.text;
      pushSnapshot(s);
      updateUI();
    }, POLL_MS);

    return true;
  }

  if (init()) return;

  const mo = new MutationObserver(() => {
    if (init()) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList:true, subtree:true });
  setTimeout(() => mo.disconnect(), 15000);
})();












/* ✅ NCZ PATCH (UPDATED): Radio -> advance background video using the SAME internal list
   - Uses window.__nczLyricsVideoList (the API you added inside the lyrics/video script)
     so we are NOT overriding after-the-fact and NOT fetching videos.txt here.
   - On radio ON: advances background video
   - On radio track change (player.src changes while radio ON): advances background video
   - Avoids stomping "hook video" mode (if video is unmuted and controls are shown)
*/
(() => {
  "use strict";
  if (window.__NCZ_RADIO_BGV_NEXT_ON_TRACK_V2__) return;
  window.__NCZ_RADIO_BGV_NEXT_ON_TRACK_V2__ = true;

  const AUDIO_ID = "player";
  const VIDEO_ID = "__ncz_right_lyrics_video__";

  const POLL_MS = 350;

  let lastVideoUrl = "";
  let lastRadioOn = false;
  let lastRadioSongKey = "";

  function getRadioState(){
    return window.__NCZ_AI_RADIO_STATE__ || null;
  }

  function isRadioOn(){
    const st = getRadioState();
    return !!(st && st.on);
  }

  function getAudio(){
    const a = document.getElementById(AUDIO_ID);
    return (a && a.tagName && a.tagName.toLowerCase() === "audio") ? a : null;
  }

  function getVideo(){
    const v = document.getElementById(VIDEO_ID);
    return (v && v.tagName && v.tagName.toLowerCase() === "video") ? v : null;
  }

  function normalizeUrl(u){
    u = String(u || "").trim();
    if(!u) return "";
    try { return new URL(u, location.origin).toString(); } catch { return u; }
  }

  function getRadioSongKey(){
    // Prefer radio state’s known URL, else current audio src
    const st = getRadioState();
    const u1 = normalizeUrl(st && (st.currentRadioUrl || st.nowPlayingUrl || st.url) || "");
    if (u1) return u1;

    const a = getAudio();
    const u2 = normalizeUrl((a && (a.currentSrc || a.src)) || "");
    return u2;
  }

  function videoIsInHookMode(v){
    // Heuristic: hook player script tends to show controls + unmute.
    // If controls are on AND it's unmuted, don't override.
    return !!(v && v.controls && !v.muted);
  }

  // --- Use the REAL internal list (same source as your lyrics picker) ---
  function getPool(){
    try{
      const api = window.__nczLyricsVideoList;
      if (api && typeof api.get === "function"){
        const arr = api.get();
        return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
      }
    }catch{}
    return [];
  }

  function pickNextVideo(pool){
    const arr = (Array.isArray(pool) ? pool : []).filter(Boolean).map(String);
    if (!arr.length) return "";

    if (arr.length === 1) return arr[0];

    // avoid immediate repeat
    for (let k = 0; k < 8; k++){
      const u = arr[(Math.random() * arr.length) | 0];
      if (u && normalizeUrl(u) !== normalizeUrl(lastVideoUrl)) return u;
    }
    return arr[(Math.random() * arr.length) | 0];
  }

  function setVideo(v, url){
    url = String(url || "").trim();
    if(!v || !url) return false;

    // mark it so we can tell it's our background system
    v.dataset.__nczRadioBg__ = "1";

    // enforce background autoplay-safe attributes
    v.controls = false;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;

    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");

    // swap
    if (v.src !== url) v.src = url;
    try { v.load(); } catch {}

    try{
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(()=>{});
    }catch{}

    lastVideoUrl = normalizeUrl(url);
    return true;
  }

  async function advanceVideo(reason){
    const v = getVideo();
    if(!v) return;

    // Don't stomp hook playback
    if (videoIsInHookMode(v)) return;

    // ✅ Prefer the lyrics script's own "playNow" (keeps behavior consistent)
    // This uses the *current* internal VIDEO_URLS (custom/default) so no flicker.
    try{
      const api = window.__nczLyricsVideoList;
      if (api && typeof api.playNow === "function"){
        const ok = api.playNow();
        if (ok){
          // lock background settings (just in case)
          v.controls = false;
          v.loop = true;
          v.muted = true;
          v.playsInline = true;
          v.setAttribute("muted", "");
          v.setAttribute("playsinline", "");
          v.setAttribute("webkit-playsinline", "");

          // update lastVideoUrl from actual element
          setTimeout(() => {
            const cur = normalizeUrl(v.currentSrc || v.src || "");
            if (cur) lastVideoUrl = cur;
          }, 0);
          return;
        }
      }
    }catch{}

    // Fallback: pick directly from the internal pool and set src
    const pool = getPool();
    const next = pickNextVideo(pool);
    if (!next) return;

    setVideo(v, next);
    // console.log("[radio-bgv] next video:", reason, next);
  }

  async function tick(){
    const radioOn = isRadioOn();

    // rising edge: OFF -> ON
    if (radioOn && !lastRadioOn){
      lastRadioOn = true;
      lastRadioSongKey = getRadioSongKey() || "";
      await advanceVideo("radio_on");
      return;
    }

    // falling edge: ON -> OFF (reset)
    if (!radioOn && lastRadioOn){
      lastRadioOn = false;
      lastRadioSongKey = "";
      return;
    }

    if (!radioOn) return;

    // radio ON: detect track changes
    const key = getRadioSongKey() || "";
    if (key && key !== lastRadioSongKey){
      lastRadioSongKey = key;
      await advanceVideo("track_change");
    }
  }

  // start polling
  setInterval(() => { tick().catch(()=>{}); }, POLL_MS);

  // do one immediate check (in case radio already ON)
  tick().catch(()=>{});

  console.log("[ncz-radio-bgv v2] using internal video list (__nczLyricsVideoList)");
})();






















/* ✅ NCZ PATCH V7: #log history = ONE "History" button on the bar, arrows INSIDE the popup
   - Outside: single button "History" + count
   - Inside modal header: ⟵ ⟶ Close (cycles entries)
   - No auto-reopen loops: closing exits history mode
   - Captures ONLY real #log text
*/
(() => {
  "use strict";
  if (window.__NCZ_LOG_HIST_SAME_LINE_V7__) return;
  window.__NCZ_LOG_HIST_SAME_LINE_V7__ = true;

  const LOG_ID = "log";

  // bar UI
  const WRAP_ID  = "__ncz_log_hist_wrap_v7__";
  const OPEN_ID  = "__ncz_log_hist_open_v7__";
  const COUNT_ID = "__ncz_log_hist_count_v7__";

  // modal UI
  const OVL_ID   = "__ncz_log_hist_modal_ovl_v7__";
  const MOD_ID   = "__ncz_log_hist_modal_v7__";
  const HDRL_ID  = "__ncz_log_hist_modal_hdr_l_v7__";
  const BACK_ID  = "__ncz_log_hist_modal_back_v7__";
  const FWD_ID   = "__ncz_log_hist_modal_fwd_v7__";
  const CLOSE_ID = "__ncz_log_hist_modal_close_v7__";
  const TXT_ID   = "__ncz_log_hist_modal_txt_v7__";

  const STYLE_ID = "__ncz_log_hist_style_v7__";

  const POLL_MS = 350;
  const MAX_HISTORY = 800;

  const $ = (id) => document.getElementById(id);

  function ensureStyles(){
    if ($(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* make host history bar a single row */
      .__ncz_histbar_flexfix__{
        display:flex !important;
        align-items:center !important;
        gap:10px !important;
        flex-wrap: nowrap !important;
        width: 100%;
      }

      /* our bar wrap on same line, right side */
      #${WRAP_ID}{
        margin-left: auto !important;
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap: nowrap;
      }

      #${OPEN_ID}{
        padding: 6px 10px !important;
        font-size: 12px !important;
        border-radius: 12px !important;
        background: rgba(255,255,255,.08) !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        color: var(--text) !important;
        cursor: pointer !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
      }
      #${OPEN_ID}:hover{ background: rgba(255,255,255,.12) !important; }

      #${COUNT_ID}{
        font-family: var(--mono, ui-monospace);
        font-size: 12px;
        color: var(--muted);
        opacity: .95;
        white-space: nowrap;
      }

      /* modal overlay */
      #${OVL_ID}{
        position:fixed; inset:0;
        background: rgba(0,0,0,.55);
        z-index: 10000090;
        display:none;
      }
      #${OVL_ID}.__show__{ display:block; }

      /* modal */
      #${MOD_ID}{
        position:fixed;
        left:50%; top:50%;
        transform: translate(-50%, -50%);
        width: min(920px, calc(100vw - 28px));
        max-height: min(72vh, 820px);
        overflow: hidden;
        z-index: 10000091;
        display:none;

        background: rgba(12,16,26,.96);
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 16px;
        box-shadow: 0 20px 70px rgba(0,0,0,.65);
        backdrop-filter: blur(10px);
      }
      #${MOD_ID}.__show__{ display:block; }

      /* header row: left text + right controls */
      #${MOD_ID} .__hdr__{
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255,255,255,.10);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;

        font-family: var(--mono, ui-monospace);
        font-size: 12px;
        color: rgba(233,238,252,.92);
        opacity: .95;
      }

      #${MOD_ID} .__ctrls__{
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap: nowrap;
      }

      #${MOD_ID} button{
        padding: 6px 10px !important;
        font-size: 12px !important;
        border-radius: 12px !important;
        background: rgba(255,255,255,.08) !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        color: var(--text) !important;
        cursor: pointer !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
      }
      #${MOD_ID} button:hover{ background: rgba(255,255,255,.12) !important; }
      #${MOD_ID} button:disabled{ opacity:.45 !important; cursor:not-allowed !important; }

      #${TXT_ID}{
        padding: 14px;
        overflow:auto;
        max-height: calc(min(72vh, 820px) - 46px);
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--mono, ui-monospace);
        font-size: 12px;
        line-height: 1.35;
        color: rgba(233,238,252,.95);
      }
    `;
    document.head.appendChild(st);
  }

  function fmtTime(ms){
    try { return new Date(ms).toLocaleString(); } catch { return ""; }
  }

  // Find your existing Info history bar by structure (not hardcoded id)
  function findInfoHistoryBar(){
    const resultMeta = document.getElementById("resultMeta");
    const wrap = document.getElementById("__ncz_resultmeta_wrap__") || resultMeta?.parentElement || document;

    const idHit =
      wrap.querySelector?.('[id^="__ncz_resultmeta_hist_bar"]') ||
      document.querySelector?.('[id^="__ncz_resultmeta_hist_bar"]');
    if (idHit) return idHit;

    const nodes = Array.from((wrap.querySelectorAll ? wrap.querySelectorAll("*") : []));
    for (const el of nodes){
      const txt = (el.textContent || "");
      if (!txt.includes("Info")) continue;

      const btns = Array.from(el.querySelectorAll("button"));
      if (btns.length < 2) continue;

      let hasL = false, hasR = false;
      for (const b of btns){
        const t = (b.textContent || "").trim();
        if (t === "⟵" || t === "←" || t === "<") hasL = true;
        if (t === "⟶" || t === "→" || t === ">") hasR = true;
      }
      if (hasL && hasR) return el;
    }
    return null;
  }

  function ensureBarButton(){
    const bar = findInfoHistoryBar();
    if (!bar) return false;

    bar.classList.add("__ncz_histbar_flexfix__");

    let wrap = $(WRAP_ID);
    if (!wrap){
      wrap = document.createElement("div");
      wrap.id = WRAP_ID;
      wrap.innerHTML = `
        <button id="${OPEN_ID}" type="button" title="View Log history">History</button>
        <span id="${COUNT_ID}">0</span>
      `;
    }
    if (!bar.contains(wrap)) bar.appendChild(wrap);

    const btn = $(OPEN_ID);
    if (btn && btn.dataset.__bound__ !== "1"){
      btn.dataset.__bound__ = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        openModalAtLatest();
      }, true);
    }

    return true;
  }

  function ensureModal(){
    if (!$(OVL_ID)){
      const ov = document.createElement("div");
      ov.id = OVL_ID;
      document.body.appendChild(ov);
    }
    if (!$(MOD_ID)){
      const m = document.createElement("div");
      m.id = MOD_ID;
      m.innerHTML = `
        <div class="__hdr__">
          <div id="${HDRL_ID}">Log history</div>
          <div class="__ctrls__">
            <button id="${BACK_ID}" type="button" title="Back">⟵</button>
            <button id="${FWD_ID}"  type="button" title="Forward">⟶</button>
            <button id="${CLOSE_ID}" type="button" title="Close">Close</button>
          </div>
        </div>
        <div id="${TXT_ID}"></div>
      `;
      document.body.appendChild(m);
    }

    // bind close once
    const ov = $(OVL_ID);
    const close = $(CLOSE_ID);
    if (ov && ov.dataset.__bound__ !== "1"){
      ov.dataset.__bound__ = "1";
      ov.addEventListener("click", (e) => {
        if (e.target === ov) closeModal();
      });
    }
    if (close && close.dataset.__bound__ !== "1"){
      close.dataset.__bound__ = "1";
      close.addEventListener("click", (e) => {
        e.preventDefault();
        closeModal();
      });
    }

    // bind arrows once
    const back = $(BACK_ID);
    const fwd  = $(FWD_ID);
    if (back && back.dataset.__bound__ !== "1"){
      back.dataset.__bound__ = "1";
      back.addEventListener("click", (e) => { e.preventDefault(); step(-1); }, true);
    }
    if (fwd && fwd.dataset.__bound__ !== "1"){
      fwd.dataset.__bound__ = "1";
      fwd.addEventListener("click", (e) => { e.preventDefault(); step(+1); }, true);
    }

    // Esc closes once
    if (!window.__nczLogHistEscBoundV7__){
      window.__nczLogHistEscBoundV7__ = true;
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
      });
    }
  }

  function showModal(){
    $(OVL_ID)?.classList.add("__show__");
    $(MOD_ID)?.classList.add("__show__");
  }
  function hideModal(){
    $(OVL_ID)?.classList.remove("__show__");
    $(MOD_ID)?.classList.remove("__show__");
  }

  // -------- capture log text (REAL only)
  function readLogText(){
    const log = $(LOG_ID);
    if (!log) return "";
    const clone = log.cloneNode(true);
    return String(clone.textContent || "").replace(/\r\n/g, "\n").trim();
  }

  // -------- state
  const hist = [];
  let idx = -1;
  let navMode = false;   // only true when modal is open
  let lastText = "";

  function push(text){
    if (!text) return;
    if (hist.length && hist[hist.length - 1].text === text) return;

    const wasAtLatest = (idx === hist.length - 1);

    hist.push({ ts: Date.now(), text });

    if (hist.length > MAX_HISTORY){
      const extra = hist.length - MAX_HISTORY;
      hist.splice(0, extra);
      idx = Math.max(0, idx - extra);
    }

    // If user was viewing latest while modal open, follow the stream
    if (navMode && wasAtLatest) idx = hist.length - 1;
    // If modal not open, keep idx at latest
    if (!navMode) idx = hist.length - 1;
  }

  function updateCount(){
    const c = $(COUNT_ID);
    if (c) c.textContent = String(hist.length || 0);
  }

  function renderModal(){
    if (!navMode) return;

    ensureModal();

    const total = hist.length;
    if (!total){
      $(HDRL_ID).textContent = "Log history • 0/0";
      $(TXT_ID).textContent = "";
      $(BACK_ID).disabled = true;
      $(FWD_ID).disabled = true;
      return;
    }

    idx = Math.max(0, Math.min(idx, total - 1));

    const item = hist[idx];
    const hdr = `Log history view • ${fmtTime(item.ts)} • ${idx + 1}/${total}`;

    $(HDRL_ID).textContent = hdr;
    $(TXT_ID).textContent = item.text || "";

    $(BACK_ID).disabled = !(idx > 0);
    $(FWD_ID).disabled  = !(idx < total - 1);
  }

  function openModalAtLatest(){
    ensureModal();
    navMode = true;
    idx = hist.length ? (hist.length - 1) : -1;
    showModal();
    renderModal();
  }

  function closeModal(){
    navMode = false;
    hideModal();
  }

  function step(delta){
    if (!hist.length) return;
    navMode = true;
    idx = Math.max(0, Math.min(idx + delta, hist.length - 1));
    showModal();
    renderModal();
  }

  function tick(){
    ensureBarButton();
    ensureModal();

    const t = readLogText();
    if (t && t !== lastText){
      lastText = t;
      push(t);
    }

    updateCount();
    renderModal();
  }

  function init(){
    ensureStyles();
    ensureModal();

    lastText = readLogText();
    push(lastText);

    tick();
    setInterval(tick, POLL_MS);
  }

  init();
})();




































// ✅ NCZ PATCH: Suno Playlist Browser (V2 - EXACT PLAY)
// - Same UI as V1 (mounts + recommended + browse)
// - ✅ FIX: Clicking a track plays the CORRECT matching song in #songList (no "play first")
// - Idempotent + self-cleans V1 UI if present
//
// Paste this AFTER your External URL Browser patch (or anywhere after #__ncz_music_list__ exists).

(() => {
  "use strict";
  if (window.__NCZ_SUNO_PLAYLIST_BROWSER_V2__) return;
  window.__NCZ_SUNO_PLAYLIST_BROWSER_V2__ = true;

  // -----------------------------
  // CONFIG
  // -----------------------------
  const CFG = {
    archiveListElId: "__ncz_music_list__",

    endpoint:
      (location.pathname === "/ace" || location.pathname.startsWith("/ace/"))
        ? "/ace/sunoPlaylist"
        : "/sunoPlaylist",

    lsKey: "NCZ_SUNO_PLAYLIST_MOUNTS_V1",
    virtualFolderName: "Suno Playlist Browser…",

    recommendedPlaylists: [
      { name: "Recent Mashups", url: "https://suno.com/playlist/bdbc9877-5ac2-409f-9bf4-7bd3d39e9d7b" },
      { name: "remixes of cybershrap's music", url: "16592d90-5090-4c8a-85c8-f4b9a55eb572" },
    ],

    // main playlist DOM
    mainSongListId: "songList",

    // play-find timing
    findPlay: {
      timeoutMs: 6500,
      pollMs: 140
    }
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function normUrl(u) {
    u = String(u || "").trim();
    if (!u) return "";
    // allow raw uuid too
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u)) return u;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  function safeLabelFromPlaylist(u) {
    u = String(u || "").trim();
    if (!u) return "playlist";
    if (/^[0-9a-f-]{36}$/i.test(u)) return u;
    try {
      const x = new URL(u);
      const p = x.pathname.replace(/\/+$/, "");
      return x.host + (p ? p : "");
    } catch {
      return u.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    }
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function loadMounts() {
    try {
      const raw = localStorage.getItem(CFG.lsKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveMounts(mounts) {
    try { localStorage.setItem(CFG.lsKey, JSON.stringify(mounts)); } catch {}
  }

  async function copyText(txt) {
    txt = String(txt || "");
    if (!txt) return false;
    try {
      await navigator.clipboard.writeText(txt);
      return true;
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function clickReal(el) {
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch {}
    try { el.click(); } catch {}
  }

  function nowIso() {
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function urlBasename(u) {
    u = String(u || "").trim();
    if (!u) return "";
    try {
      const U = new URL(u, location.origin);
      return decodeURIComponent((U.pathname.split("/").filter(Boolean).pop() || "").trim());
    } catch {
      const noQ = u.split("?")[0].split("#")[0];
      const last = noQ.split("/").filter(Boolean).pop() || "";
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function normKey(u) {
    u = String(u || "").trim();
    if (!u) return "";
    return u.split("#")[0].split("?")[0].trim();
  }

  function candidatesFromUrl(u) {
    const out = [];
    const push = (x) => {
      x = String(x || "").trim();
      if (!x) return;
      out.push(x);
      out.push(normKey(x));
      try {
        const U = new URL(x, location.origin);
        out.push(U.toString());
        out.push(normKey(U.toString()));
        out.push(U.pathname);
      } catch {}
    };
    push(u);

    // basename candidates
    const bn = urlBasename(u);
    if (bn) out.push(bn);

    // dedupe
    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const k = String(s).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      uniq.push(k);
    }
    return uniq;
  }

  function urlsMatch(a, b) {
    const A = candidatesFromUrl(a);
    const B = candidatesFromUrl(b);
    for (const x of A) {
      for (const y of B) {
        if (!x || !y) continue;
        if (x === y) return true;
        // endswith helps if one side is pathname, other is full URL
        if (x.length > 6 && y.length > 6) {
          if (x.endsWith(y) || y.endsWith(x)) return true;
        }
        // basename strict match
        const xb = urlBasename(x).toLowerCase();
        const yb = urlBasename(y).toLowerCase();
        if (xb && yb && xb === yb) return true;
      }
    }
    return false;
  }

  // -----------------------------
  // Server call
  // -----------------------------
  async function postSunoPlaylist(url) {
    const res = await fetch(CFG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        playlist_url: url,
        playlist: url
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`sunoPlaylist HTTP ${res.status}${t ? `: ${t.slice(0, 240)}` : ""}`);
    }

    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  function normalizePlaylistItems(data) {
    const d = data && typeof data === "object" ? data : {};
    const arr =
      (Array.isArray(d.items) && d.items) ||
      (Array.isArray(d.clips) && d.clips) ||
      (Array.isArray(d.songs) && d.songs) ||
      (Array.isArray(d.playlist_clips) && d.playlist_clips) ||
      (Array.isArray(d.data?.items) && d.data.items) ||
      (Array.isArray(d.data?.clips) && d.data.clips) ||
      (Array.isArray(d.data?.songs) && d.data.songs) ||
      (Array.isArray(d.data?.playlist_clips) && d.data.playlist_clips) ||
      (Array.isArray(d.data) && d.data) ||
      (Array.isArray(d) && d) ||
      [];

    return arr.map((x) => {
      const obj = x && typeof x === "object" ? x : { value: x };
      const clip = obj.clip && typeof obj.clip === "object" ? obj.clip : obj;

      const id =
        clip.id || clip.uuid || clip.clip_id || clip.song_id ||
        obj.id || obj.uuid || obj.clip_id || obj.song_id || "";

      const title =
        clip.title || clip.name || clip.caption || clip.prompt ||
        obj.title || obj.name || obj.caption || "";

      const audio =
        clip.audio_url || clip.audioUrl || clip.audio || clip.file || clip.url || clip.mp3 ||
        obj.audio_url || obj.audioUrl || obj.audio || obj.file || obj.url || obj.mp3 || "";

      const handle =
        clip.handle ||
        clip.user_handle ||
        (clip.user && typeof clip.user === "object" ? (clip.user.handle || clip.user.username || clip.user.name) : "") ||
        obj.handle ||
        obj.user_handle ||
        "";

      const author =
        handle ||
        clip.author || clip.artist ||
        obj.author || obj.artist ||
        "";

      const video_url =
        clip.video_url || clip.videoUrl || clip.video ||
        obj.video_url || obj.videoUrl || obj.video ||
        "";

      const image_large_url =
        clip.image_large_url || clip.imageLargeUrl || clip.image_url || clip.imageUrl ||
        obj.image_large_url || obj.imageLargeUrl || obj.image_url || obj.imageUrl ||
        "";

      return {
        id: String(id || "").trim(),
        title: String(title || "").trim(),
        author: String(author || "").trim(),
        handle: String(handle || "").trim(),
        audio: String(audio || "").trim(),
        video_url: String(video_url || "").trim(),
        image_large_url: String(image_large_url || "").trim(),
        raw: obj
      };
    });
  }

  // -----------------------------
  // ✅ EXACT PLAY (core fix)
  // -----------------------------
  function getSongUrlFromObj(it) {
    if (!it) return "";
    if (typeof it === "string") return it;
    if (typeof it !== "object") return "";
    // common
    return String(it.url || it.file || it.href || it.src || it.downloadName || "").trim();
  }

  function findIndexInWindowSongs(url) {
    const songs = Array.isArray(window.songs) ? window.songs : null;
    if (!songs) return -1;

    for (let i = 0; i < songs.length; i++) {
      const it = songs[i];
      const candidates = [];

      // direct candidates
      candidates.push(getSongUrlFromObj(it));

      // nested candidates
      if (it && typeof it === "object") {
        try {
          if (it.serverItem && typeof it.serverItem === "object") {
            candidates.push(getSongUrlFromObj(it.serverItem));
          }
        } catch {}
        try {
          if (it.meta && typeof it.meta === "object") {
            candidates.push(getSongUrlFromObj(it.meta));
          }
        } catch {}
        // scan shallow keys for url-ish strings
        for (const k of Object.keys(it)) {
          const v = it[k];
          if (typeof v === "string" && (v.includes("://") || /\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(v))) {
            candidates.push(v);
          }
        }
      }

      for (const c of candidates) {
        if (c && urlsMatch(c, url)) return i;
      }
    }
    return -1;
  }

  function findRowInDomByUrl(url) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;

    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    if (!rows.length) return null;

    // best: href match
    for (const r of rows) {
      const links = Array.from(r.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = String(a.getAttribute("href") || "").trim();
        if (h && urlsMatch(h, url)) return r;
      }
    }

    // fallback: full text contains pathname or basename
    const bn = urlBasename(url).toLowerCase();
    const key = normKey(url).toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (key && txt.includes(key)) return r;
      if (bn && txt.includes(bn)) return r;
    }

    return null;
  }

  function clickPlayInRow(row) {
    if (!row) return false;

    // your usual pattern: <a>Play</a>
    const aPlay = Array.from(row.querySelectorAll("a"))
      .find(a => isVisible(a) && (String(a.textContent || "").trim().toLowerCase() === "play"));

    if (aPlay) { clickReal(aPlay); return true; }

    // fallback: any control with title containing play
    const any = Array.from(row.querySelectorAll("a,button"))
      .find(el => isVisible(el) && String(el.getAttribute("title") || "").toLowerCase().includes("play"));

    if (any) { clickReal(any); return true; }

    return false;
  }

  async function playExactByUrl(url) {
    const t0 = Date.now();

    while (Date.now() - t0 < CFG.findPlay.timeoutMs) {
      // 1) via window.songs index => row[data-song-index]
      const idx = findIndexInWindowSongs(url);
      if (idx >= 0) {
        const root = document.getElementById(CFG.mainSongListId);
        if (root) {
          const row = root.querySelector(`div[data-song-index="${idx}"]`);
          if (row && clickPlayInRow(row)) return true;
        }
      }

      // 2) DOM scan fallback
      const row2 = findRowInDomByUrl(url);
      if (row2 && clickPlayInRow(row2)) return true;

      await sleep(CFG.findPlay.pollMs);
    }

    return false;
  }

  async function addToSongsListAndPlay(url, title, meta) {
    url = String(url || "").trim();
    if (!url) return false;

    const label = String(title || "").trim() || urlBasename(url) || "Suno Track";
    const createdAt = nowIso();

    // 1) preferred: window.addSongToList
    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(url, {
          label,
          createdAt,
          meta: (meta && typeof meta === "object") ? meta : {},
          downloadName: label,
          serverItem: meta || null
        });
      } catch {}
    } else if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      // 2) optional override
      try {
        window.__NCZ_PLAYLIST_ADD_FN__({
          file: url,
          url,
          name: label,
          title: label,
          meta: meta || {}
        });
      } catch {}
    } else {
      // 3) no playlist add available — just open
      try { window.open(url, "_blank", "noopener"); } catch {}
      return false;
    }

    // ✅ core: play EXACT (works whether it was newly added or already existed)
    await sleep(50);
    return await playExactByUrl(url);
  }

  // -----------------------------
  // Styles
  // -----------------------------
  const STYLE_ID = "__ncz_suno_pl_scrollbar_style__";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const css = `
.ncz-dark-scroll{
  scrollbar-width: thin;
  scrollbar-color: #2a344a #0b0d12;
}
.ncz-dark-scroll::-webkit-scrollbar{ width:10px; height:10px; }
.ncz-dark-scroll::-webkit-scrollbar-track{ background:#0b0d12; }
.ncz-dark-scroll::-webkit-scrollbar-thumb{
  background:#2a344a;
  border:2px solid #0b0d12;
  border-radius:999px;
}
.ncz-dark-scroll::-webkit-scrollbar-thumb:hover{ background:#3a4766; }
`.trim();

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // -----------------------------
  // Overlay UI
  // -----------------------------
  const OVERLAY_ID = "__ncz_suno_pl_overlay__";
  const LIST_ID = "__ncz_suno_pl_list__";

  let overlay = null;
  let overlayList = null;
  let overlayCrumb = null;
  let overlayMsg = null;

  const state = {
    mode: "mounts",
    currentMount: null,
    playlistData: null
  };

  function renderRow({ icon, text, subtext, right, onClick }) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
    `;

    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${icon || ""}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(subtext)}</div>` : ""}
      </div>
      ${right || ""}
    `;

    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      onClick && onClick(e);
    });

    return row;
  }

  function removeOldV1UiIfPresent(listEl) {
    try {
      const oldRow = listEl.querySelector("[data-ncz-suno-virtual='1']");
      if (oldRow) oldRow.remove();
    } catch {}
    try {
      const oldOverlay = document.getElementById(OVERLAY_ID);
      if (oldOverlay) oldOverlay.remove();
    } catch {}
  }

  function ensureOverlay(hostEl) {
    if (overlay) return;

    ensureStyles();

    const panel = hostEl.parentElement || hostEl;
    const cs = getComputedStyle(panel);
    if (cs.position === "static") panel.style.position = "relative";

    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
      position:absolute; inset:0;
      background: var(--card, #121726);
      border: 1px solid var(--line, #1e2742);
      border-radius: 12px;
      box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35));
      display:none;
      z-index: 9999;
      overflow:hidden;
    `;

    overlay.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line,#1e2742);">
        <div style="font-weight:700; color:var(--text,#e9eefc);">${escapeHtml(CFG.virtualFolderName)}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="__ncz_suno_pl_close__" type="button" style="padding:6px 10px; border-radius:10px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Close</button>
        </div>
      </div>

      <div style="padding:8px 12px; border-bottom:1px solid var(--line,#1e2742); color:var(--muted,#a9b3cf); font-size:12px;">
        <span id="__ncz_suno_pl_crumb__">Mounts</span>
        <span id="__ncz_suno_pl_msg__" style="float:right; color:var(--warn,#ffd36a);"></span>
      </div>

      <div id="${LIST_ID}" class="ncz-dark-scroll" style="position:absolute; inset:86px 0 0 0; overflow:auto; padding:8px 10px;"></div>

      <div id="__ncz_suno_pl_modal__" style="
        position:absolute; inset:0; display:none;
        background: rgba(0,0,0,.55);
        align-items:center; justify-content:center;
        z-index:10000;
      ">
        <div class="ncz-dark-scroll" style="width:min(560px, 92%); max-height:min(600px, 86%); overflow:auto; background:var(--card,#121726); border:1px solid var(--line,#1e2742); border-radius:14px; box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35)); padding:14px;">
          <div style="font-weight:700; color:var(--text,#e9eefc); margin-bottom:10px;">Mount Suno Playlist</div>

          <input id="__ncz_suno_pl_inp__" type="text" placeholder="https://suno.com/playlist/<uuid>  (or just the uuid)" style="
            width:100%; box-sizing:border-box;
            padding:10px 12px; border-radius:12px;
            border:1px solid var(--line,#1e2742);
            background:var(--card2,#0f1320); color:var(--text,#e9eefc);
            outline:none;
          " />

          <div id="__ncz_suno_pl_rec_list__" class="ncz-dark-scroll" style="display:none; margin-top:10px; border:1px solid var(--line,#1e2742); border-radius:12px; overflow:auto; max-height:240px; background:var(--card2,#0f1320);"></div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap;">
            <button id="__ncz_suno_pl_showrec__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:var(--card2,#0f1320); color:var(--text,#e9eefc); cursor:pointer;">Recommended</button>
            <button id="__ncz_suno_pl_cancel__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Cancel</button>
            <button id="__ncz_suno_pl_mount__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:var(--accent,#6aa6ff); color:#0b0d12; cursor:pointer; font-weight:700;">Mount</button>
          </div>

          <div id="__ncz_suno_pl_err__" style="margin-top:10px; color:var(--bad,#ff5c7a); font-size:12px; white-space:pre-wrap;"></div>
        </div>
      </div>
    `;

    panel.appendChild(overlay);

    // Shield overlay interactions (contained)
    const shield = (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    [
      "click","dblclick","auxclick","contextmenu",
      "mousedown","mouseup","pointerdown","pointerup",
      "touchstart","touchend"
    ].forEach(evt => overlay.addEventListener(evt, shield, false));

    overlayList = overlay.querySelector("#" + LIST_ID);
    overlayCrumb = overlay.querySelector("#__ncz_suno_pl_crumb__");
    overlayMsg = overlay.querySelector("#__ncz_suno_pl_msg__");

    const modal = overlay.querySelector("#__ncz_suno_pl_modal__");
    const inp = overlay.querySelector("#__ncz_suno_pl_inp__");
    const err = overlay.querySelector("#__ncz_suno_pl_err__");
    const recBox = overlay.querySelector("#__ncz_suno_pl_rec_list__");

    function showModal(show) {
      modal.style.display = show ? "flex" : "none";
      err.textContent = "";
      recBox.style.display = "none";
      if (show) {
        inp.value = "";
        setTimeout(() => inp.focus(), 0);
      }
    }

    function buildRecList() {
      recBox.innerHTML = "";
      const recs = CFG.recommendedPlaylists || [];
      if (!recs.length) {
        const d = document.createElement("div");
        d.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
        d.textContent = "No recommended playlists configured.";
        recBox.appendChild(d);
        return;
      }

      for (const r of recs) {
        const b = document.createElement("button");
        b.type = "button";
        b.style.cssText = `
          width:100%; text-align:left;
          padding:10px 12px;
          border:0;
          border-bottom:1px solid var(--line,#1e2742);
          background:transparent;
          color:var(--text,#e9eefc);
          cursor:pointer;
        `;
        b.innerHTML = `
          <div style="font-weight:700; font-size:13px;">${escapeHtml(r.name || r.url)}</div>
          <div style="font-size:12px; color:var(--muted,#a9b3cf); word-break:break-all;">${escapeHtml(r.url || "")}</div>
        `;
        b.addEventListener("click", async () => {
          const u = normUrl(r.url);
          if (!u) return;
          inp.value = u;
          err.textContent = "";
          overlayMsg.textContent = "Loading…";
          try {
            const data = await postSunoPlaylist(u);

            const mounts = loadMounts();
            const id = fnv1a(u);
            const label = safeLabelFromPlaylist(u);
            const existing = mounts.find(m => m.id === id);
            if (!existing) mounts.unshift({ id, url: u, label, createdAt: Date.now() });
            saveMounts(mounts);

            modal.style.display = "none";
            state.mode = "browse";
            state.currentMount = { id, url: u, label };
            state.playlistData = data;
            await renderBrowse();
          } catch (e) {
            err.textContent = String(e && e.message ? e.message : e);
          } finally {
            overlayMsg.textContent = "";
          }
        });
        recBox.appendChild(b);
      }

      const last = recBox.lastElementChild;
      if (last) last.style.borderBottom = "0";
    }

    overlay.querySelector("#__ncz_suno_pl_close__").addEventListener("click", (e) => {
      e.preventDefault();
      overlay.style.display = "none";
    });

    overlay.querySelector("#__ncz_suno_pl_showrec__").addEventListener("click", (e) => {
      e.preventDefault();
      const show = recBox.style.display !== "block";
      recBox.style.display = show ? "block" : "none";
      if (show) buildRecList();
    });

    overlay.querySelector("#__ncz_suno_pl_cancel__").addEventListener("click", (e) => {
      e.preventDefault();
      showModal(false);
    });

    overlay.querySelector("#__ncz_suno_pl_mount__").addEventListener("click", async (e) => {
      e.preventDefault();
      const raw = inp.value;
      const url = normUrl(raw);
      if (!url) { err.textContent = "Enter a playlist URL or UUID."; return; }

      err.textContent = "";
      overlayMsg.textContent = "Loading…";

      try {
        const data = await postSunoPlaylist(url);

        const mounts = loadMounts();
        const id = fnv1a(url);
        const label = safeLabelFromPlaylist(url);

        const existing = mounts.find(m => m.id === id);
        if (!existing) {
          mounts.unshift({ id, url, label, createdAt: Date.now() });
          saveMounts(mounts);
        }

        showModal(false);

        state.mode = "browse";
        state.currentMount = { id, url, label };
        state.playlistData = data;
        await renderBrowse();
      } catch (e2) {
        err.textContent = String(e2 && e2.message ? e2.message : e2);
      } finally {
        overlayMsg.textContent = "";
      }
    });

    renderMounts(showModal);
  }

  function showOverlay(hostEl) {
    ensureOverlay(hostEl);
    overlay.style.display = "block";
    state.mode = "mounts";
    state.currentMount = null;
    state.playlistData = null;
    renderMounts((show) => {
      const m = overlay.querySelector("#__ncz_suno_pl_modal__");
      if (m) m.style.display = show ? "flex" : "none";
    });
  }

  function renderMounts(showModalFn) {
    if (!overlayList) return;
    overlayCrumb.textContent = "Mounts";
    overlayList.innerHTML = "";

    overlayList.appendChild(renderRow({
      icon: "➕",
      text: "Mount a playlist…",
      subtext: "Suno playlist URL or UUID (saved)",
      onClick: () => showModalFn && showModalFn(true)
    }));

    const recs = CFG.recommendedPlaylists || [];
    if (recs.length) {
      overlayList.appendChild(renderRow({
        icon: "⭐",
        text: "Recommended playlists",
        subtext: "One-click mount",
        onClick: () => {
          const modal = overlay.querySelector("#__ncz_suno_pl_modal__");
          if (modal) modal.style.display = "flex";
          const btn = overlay.querySelector("#__ncz_suno_pl_showrec__");
          if (btn) btn.click();
        }
      }));
    }

    const mounts = loadMounts();
    if (!mounts.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
      empty.textContent = "No Suno playlist mounts yet.";
      overlayList.appendChild(empty);
      return;
    }

    for (const m of mounts) {
      const right = `
        <span class="__ncz_suno_unmount__" title="Remove mount" style="
          margin-left:10px;
          color: var(--bad,#ff5c7a);
          font-weight:900;
          font-size:16px;
          line-height:16px;
          user-select:none;
          cursor:pointer;
          padding:4px 6px;
          border-radius:10px;
        ">✕</span>
      `;

      const row = renderRow({
        icon: "🎶",
        text: m.label || m.url,
        subtext: m.url,
        right,
        onClick: async (e) => {
          const x = e.target && e.target.closest && e.target.closest("span.__ncz_suno_unmount__");
          if (x) return;

          state.mode = "browse";
          state.currentMount = { id: m.id, url: m.url, label: m.label || m.url };
          overlayMsg.textContent = "Loading…";
          try {
            const data = await postSunoPlaylist(m.url);
            state.playlistData = data;
            await renderBrowse();
          } catch (err) {
            overlayList.innerHTML = "";
            const d = document.createElement("div");
            d.style.cssText = "padding:10px; color:var(--bad,#ff5c7a); font-size:13px; white-space:pre-wrap;";
            d.textContent = `Error loading playlist:\n${String(err && err.message ? err.message : err)}`;
            overlayList.appendChild(d);
          } finally {
            overlayMsg.textContent = "";
          }
        }
      });

      const x = row.querySelector("span.__ncz_suno_unmount__");
      if (x) {
        x.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();

          const mounts2 = loadMounts();
          const next = mounts2.filter(mm => String(mm.id) !== String(m.id));
          saveMounts(next);

          renderMounts(showModalFn);
        }, true);

        x.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }, true);
      }

      overlayList.appendChild(row);
    }
  }

  async function renderBrowse() {
    if (!overlayList || !state.currentMount) return;

    const mount = state.currentMount;
    const data = state.playlistData || {};

    overlayCrumb.textContent = `${mount.label || "Playlist"}`;
    overlayList.innerHTML = "";

    overlayList.appendChild(renderRow({
      icon: "⬅️",
      text: "Back to Mounts",
      subtext: "",
      onClick: () => {
        state.mode = "mounts";
        state.currentMount = null;
        state.playlistData = null;
        renderMounts((show) => {
          const m = overlay.querySelector("#__ncz_suno_pl_modal__");
          if (m) m.style.display = show ? "flex" : "none";
        });
      }
    }));

    overlayList.appendChild(renderRow({
      icon: "🔄",
      text: "Refresh playlist",
      subtext: "Re-fetch from server",
      onClick: async () => {
        overlayMsg.textContent = "Loading…";
        try {
          const d2 = await postSunoPlaylist(mount.url);
          state.playlistData = d2;
          await renderBrowse();
        } catch {
          const ok = await copyText(String(mount.url || ""));
          overlayMsg.textContent = ok ? "Refresh failed (copied mount URL)" : "Refresh failed";
          setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
        } finally {
          setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
        }
      }
    }));

    const items = normalizePlaylistItems(data);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px; white-space:pre-wrap;";
      empty.textContent =
        "No clips returned.\n\nIf your endpoint only returns UUIDs, clicking will copy them.";
      overlayList.appendChild(empty);
      return;
    }

    overlayList.appendChild(renderRow({
      icon: "ℹ️",
      text: `Tracks: ${items.length}`,
      subtext: "Click: play exact match in main playlist (or copy UUID if no audio)",
      onClick: async () => {
        const ok = await copyText(JSON.stringify(items.map(x => x.id).filter(Boolean)));
        overlayMsg.textContent = ok ? "Copied UUID list (JSON)" : "Copy failed";
        setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
      }
    }));

    for (const it of items) {
      const hasAudio = !!it.audio;
      const icon = hasAudio ? "▶️" : "📎";
      const title = it.title || (it.id ? `Clip ${it.id}` : "Clip");
      const sub = it.id ? it.id : (hasAudio ? it.audio : "");

      overlayList.appendChild(renderRow({
        icon,
        text: title,
        subtext: sub,
        onClick: async () => {
          if (hasAudio) {
              const meta = {
                source: "suno_playlist",
                clip_id: it.id,
                title: it.title,
                author: it.author,
                handle: it.handle,
                video_url: it.video_url,
                image_large_url: it.image_large_url,
                raw: it.raw
              };

            overlayMsg.textContent = "Adding…";
            const ok = await addToSongsListAndPlay(it.audio, title, meta);
            overlayMsg.textContent = ok ? "Playing" : "Added (couldn’t auto-play)";
            setTimeout(() => { overlayMsg.textContent = ""; }, 1100);
          } else {
            const ok = await copyText(it.id || "");
            overlayMsg.textContent = ok ? "Copied clip UUID" : "Copy failed";
            setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
          }
        }
      }));
    }
  }

  // -----------------------------
  // Inject virtual row into left music list
  // -----------------------------
  function findArchiveListEl() {
    return document.getElementById(CFG.archiveListElId) || null;
  }

  function injectVirtualRow(listEl) {
    if (!listEl) return;

    // remove old V1 UI if present so we don't stack duplicates
    removeOldV1UiIfPresent(listEl);

    if (listEl.querySelector("[data-ncz-suno-virtual-v2='1']")) return;

    ensureStyles();
    if (!listEl.classList.contains("ncz-dark-scroll")) listEl.classList.add("ncz-dark-scroll");

    const row = document.createElement("div");
    row.setAttribute("data-ncz-suno-virtual-v2", "1");
    row.className = "__ncz_lb_item__";
    row.title = "Suno Playlist Browser…";
    row.style.margin = "0 0 6px 0";

    row.innerHTML = `
      <div class="__ncz_lb_icon__">☀️</div>
      <div class="__ncz_lb_labelwrap__" style="min-width:0">
        <div class="__ncz_lb_label__">${escapeHtml(CFG.virtualFolderName)}</div>
        <div class="__ncz_lb_hint__">Mount & browse Suno playlists</div>
      </div>
    `;

    const open = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      }
      showOverlay(listEl);
    };

    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    listEl.prepend(row);
  }

  function start() {
    const listEl = findArchiveListEl();
    if (!listEl) {
      console.warn("[NCZ SUNO V2] Could not find left music list element:", CFG.archiveListElId);
      return;
    }

    injectVirtualRow(listEl);

    // re-inject if list is rebuilt
    const obs = new MutationObserver(() => injectVirtualRow(listEl));
    obs.observe(listEl, { childList: true, subtree: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();





// ✅ NCZ PATCH: Suno Browser labels = "author - title" (V1)
// - Modifies your Suno Playlist Browser (V2 - EXACT PLAY) behavior ONLY at render time
// - No structural changes to overlay
// - Shows track text as: "author - title" (like Producer browser)
// - Falls back gracefully if author/title missing
//
// Paste AFTER your Suno Playlist Browser V2 patch.

(() => {
  "use strict";
  if (window.__NCZ_SUNO_BROWSER_AUTHOR_TITLE_LABELS_V1__) return;
  window.__NCZ_SUNO_BROWSER_AUTHOR_TITLE_LABELS_V1__ = true;

  const OVERLAY_ID = "__ncz_suno_pl_overlay__";
  const LIST_ID = "__ncz_suno_pl_list__";

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function iconFromRow(btn){
    try {
      const iconDiv = btn.querySelector('div[style*="width:22px"]') || btn.firstElementChild;
      return (iconDiv?.textContent || "").trim();
    } catch { return ""; }
  }

  function titleNodeFromRow(btn){
    try {
      const main = btn.children && btn.children[1];
      return main && main.children && main.children[0] ? main.children[0] : null;
    } catch { return null; }
  }

  function subNodeFromRow(btn){
    try {
      const main = btn.children && btn.children[1];
      return main && main.children && main.children[1] ? main.children[1] : null;
    } catch { return null; }
  }

  function textOf(el){
    return String(el && el.textContent ? el.textContent : "").trim();
  }

  function clean(s){ return String(s || "").trim(); }

  function buildLabel(author, title){
    author = clean(author);
    title = clean(title);
    if (author && title) return `${author} - ${title}`;
    return title || author || "";
  }

  // Try to pull author/title for this row from:
  // 1) meta stored on the added playlist item (window.songs) if available
  // 2) data attributes (rare)
  // 3) parse from existing "title" if it already contains " - "
  function inferAuthorTitleFromRow(btn){
    const titleText = textOf(titleNodeFromRow(btn));
    if (!titleText) return { author:"", title:"" };

    // already in "a - b" form
    const m = titleText.match(/^\s*(.+?)\s+-\s+(.+?)\s*$/);
    if (m) return { author: clean(m[1]), title: clean(m[2]) };

    return { author:"", title: titleText };
  }

  function tryGetMetaFromWindowSongs(uuidOrAudio){
    try {
      const songs = Array.isArray(window.songs) ? window.songs : [];
      const needle = String(uuidOrAudio || "").trim();
      if (!needle) return null;

      for (const it of songs) {
        if (!it || typeof it !== "object") continue;

        const meta = (it.meta && typeof it.meta === "object") ? it.meta : null;
        const serverItem = (it.serverItem && typeof it.serverItem === "object") ? it.serverItem : null;

        const cand = [
          it.url, it.file, it.href, it.src,
          serverItem && (serverItem.url || serverItem.file || serverItem.href || serverItem.src),
          meta && (meta.url || meta.file || meta.href || meta.src || meta.audio_url || meta.audioUrl),
        ].filter(Boolean).map(x => String(x));

        // cheap contains match
        const hit = cand.some(c => c === needle || c.includes(needle) || needle.includes(c));
        if (!hit) continue;

        // author/handle keys you might be storing
        const author =
          (meta && (meta.author || meta.handle || meta.artist)) ||
          (serverItem && (serverItem.author || serverItem.handle || serverItem.artist)) ||
          "";

        const title =
          (meta && (meta.title || meta.name)) ||
          (serverItem && (serverItem.title || serverItem.name)) ||
          "";

        return { author: clean(author), title: clean(title) };
      }
    } catch {}
    return null;
  }

  function rewriteVisibleTrackRows(){
    const ov = document.getElementById(OVERLAY_ID);
    if (!ov || !isVisible(ov)) return;

    const list = ov.querySelector("#" + LIST_ID);
    if (!list) return;

    const btns = Array.from(list.querySelectorAll("button"));

    for (const b of btns) {
      // Only affect actual track rows (▶️)
      const ic = iconFromRow(b);
      if (!ic.includes("▶")) continue;

      // Don't touch header rows (Back/Refresh/Tracks)
      const tAll = (b.textContent || "").toLowerCase();
      if (tAll.includes("back to mounts") || tAll.includes("refresh playlist") || tAll.includes("tracks:")) continue;

      const titleEl = titleNodeFromRow(b);
      const subEl = subNodeFromRow(b);
      if (!titleEl) continue;

      // prevent double-processing
      if (b.getAttribute("data-ncz-suno-label-fixed") === "1") continue;

      // Attempt meta lookup (subtext may be uuid or audio url)
      const sub = textOf(subEl);
      const meta = tryGetMetaFromWindowSongs(sub) || null;

      let author = meta ? meta.author : "";
      let title = meta ? meta.title : "";

      if (!author || !title) {
        const inf = inferAuthorTitleFromRow(b);
        // if we have author from meta but not title, keep meta author
        author = author || inf.author;
        title = title || inf.title;
      }

      const label = buildLabel(author, title);
      if (label) {
        titleEl.textContent = label;
        b.setAttribute("data-ncz-suno-label-fixed", "1");
      }
    }
  }

  // Poll lightly while overlay is open
  setInterval(() => {
    rewriteVisibleTrackRows();
  }, 250);

  // Also do a short burst on load
  (async () => {
    for (let i = 0; i < 40; i++) {
      rewriteVisibleTrackRows();
      await sleep(200);
    }
  })();
})();























// ✅ NCZ UI: Tiny "Load Video List" text + modal (uses REAL internal list via window.__nczLyricsVideoList)
(() => {
  "use strict";
  if (window.__NCZ_VIDEO_LIST_UI_V5__) return;
  window.__NCZ_VIDEO_LIST_UI_V5__ = true;

  const CARD_ID  = "__ncz_right_lyrics_card__";
  const HDR_SEL  = ".__h__";

  const STYLE_ID   = "__ncz_vidlist_ui_v5_style__";
  const LINK_ID    = "__ncz_vidlist_ui_v5_link__";
  const OVERLAY_ID = "__ncz_vidlist_ui_v5_overlay__";
  const MODAL_ID   = "__ncz_vidlist_ui_v5_modal__";

  const $ = (id) => document.getElementById(id);

  function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }
  function isHttp(u){ return /^https?:\/\/\S+/i.test(String(u||"").trim()); }

  function uniq(list){
    const out = [];
    const seen = new Set();
    for(const x of (list||[])){
      const v = String(x||"").trim();
      if(!v || !isHttp(v)) continue;
      const k = v.toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  function parseList(text){
    const t = String(text||"").trim();
    if(!t) return [];
    if(t.startsWith("[") && t.endsWith("]")){
      const j = safeJsonParse(t);
      if(Array.isArray(j)) return uniq(j);
    }
    return uniq(
      t.split(/\r?\n/)
       .map(l=>l.trim())
       .filter(l=>l && !l.startsWith("#") && !l.startsWith("//"))
       .map(l=>l.split(/\s+/)[0].trim())
    );
  }

  function ensureStyles(){
    if ($(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${CARD_ID} ${HDR_SEL}{
        display:flex !important;
        align-items:center !important;
        justify-content:space-between !important;
        gap:10px !important;
      }
      #${LINK_ID}{
        font-size: 11px !important;
        font-weight: 900 !important;
        opacity: .85 !important;
        color: rgba(233,238,252,.92) !important;
        text-decoration: none !important;
        padding: 4px 6px !important;
        border-radius: 10px !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        background: rgba(255,255,255,.06) !important;
        white-space: nowrap !important;
      }
      #${LINK_ID}:hover{ opacity:1 !important; background: rgba(255,255,255,.10) !important; }

      #${OVERLAY_ID}{
        position:fixed; inset:0;
        z-index:100000000;
        background: rgba(0,0,0,.55);
        display:none;
      }
      #${OVERLAY_ID}.__show__{ display:block; }

      #${MODAL_ID}{
        position:fixed;
        left:50%; top:50%;
        transform: translate(-50%, -50%);
        z-index:100000001;

        width:min(820px, 94vw);
        max-height:min(82vh, 820px);
        overflow:auto;
        display:none;

        border-radius:16px;
        border:1px solid rgba(255,255,255,.12);
        box-shadow: 0 18px 60px rgba(0,0,0,.60);
        background: rgba(12,16,26,.96);
        backdrop-filter: blur(10px);
        color: rgba(233,238,252,.95);
      }
      #${MODAL_ID}.__show__{ display:block; }

      #${MODAL_ID} .__hd__{
        display:flex; align-items:center; justify-content:space-between; gap:12px;
        padding:14px 14px 12px;
        border-bottom:1px solid rgba(255,255,255,.08);
        background: linear-gradient(180deg, rgba(18,23,38,.85), rgba(18,23,38,.35));
      }
      #${MODAL_ID} .__title__{ font-weight:1000; font-size:14px; }
      #${MODAL_ID} .__close__{
        border:0; background: rgba(255,255,255,.08);
        color: rgba(233,238,252,.95);
        padding: 8px 10px; border-radius:12px;
        cursor:pointer; font-weight:1000; line-height:1;
      }
      #${MODAL_ID} .__close__:hover{ background: rgba(255,255,255,.12); }
      #${MODAL_ID} .__bd__{ padding:14px; font-size:13px; line-height:1.45; }

      #${MODAL_ID} .__card__{
        border:1px solid rgba(255,255,255,.08);
        background: rgba(0,0,0,.22);
        border-radius:12px;
        padding:12px;
        margin-top:10px;
      }
      #${MODAL_ID} .__row__{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px; }

      #${MODAL_ID} textarea{
        width:100%;
        min-height:210px;
        resize:vertical;
        background: rgba(7,10,18,.65);
        color: rgba(233,238,252,.95);
        border:1px solid rgba(255,255,255,.12);
        border-radius:12px;
        padding:10px;
        font-size:13px;
        outline:none;
        font-family: var(--mono, ui-monospace);
      }

      #${MODAL_ID} input[type="text"]{
        width:min(520px, 100%);
        background: rgba(7,10,18,.65);
        color: rgba(233,238,252,.95);
        border:1px solid rgba(255,255,255,.12);
        border-radius:12px;
        padding:9px 10px;
        font-size:13px;
        outline:none;
      }

      #${MODAL_ID} .__btn__{
        border:0;
        background: rgba(106,166,255,.18);
        color: rgba(233,238,252,.95);
        padding:9px 10px;
        border-radius:12px;
        cursor:pointer;
        font-weight:1000;
        font-size:12px;
      }
      #${MODAL_ID} .__btn__:hover{ background: rgba(106,166,255,.25); }

      #${MODAL_ID} .__btn2__{
        border:0;
        background: rgba(255,255,255,.10);
        color: rgba(233,238,252,.95);
        padding:9px 10px;
        border-radius:12px;
        cursor:pointer;
        font-weight:1000;
        font-size:12px;
      }
      #${MODAL_ID} .__btn2__:hover{ background: rgba(255,255,255,.14); }

      #${MODAL_ID} .__btnDanger__{
        border:0;
        background: rgba(255,92,122,.16);
        color: rgba(255,235,240,.98);
        padding:9px 10px;
        border-radius:12px;
        cursor:pointer;
        font-weight:1000;
        font-size:12px;
      }
      #${MODAL_ID} .__btnDanger__:hover{ background: rgba(255,92,122,.22); }

      #${MODAL_ID} .__mono__{ font-family: var(--mono, ui-monospace); }
      #${MODAL_ID} .__muted__{ color: rgba(169,179,207,.95); }
    `;
    document.head.appendChild(st);
  }

  function findHdr(){
    const card = $(CARD_ID);
    return card ? card.querySelector(HDR_SEL) : null;
  }

  function ensureModal(){
    ensureStyles();

    let overlay = $(OVERLAY_ID);
    if(!overlay){
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.addEventListener("click", (e)=>{ if(e.target === overlay) hide(); });
      document.body.appendChild(overlay);
    }

    let modal = $(MODAL_ID);
    if(!modal){
      modal = document.createElement("div");
      modal.id = MODAL_ID;
      modal.innerHTML = `
        <div class="__hd__">
          <div class="__title__">Load Video List</div>
          <button type="button" class="__close__" id="__ncz_vl_close__">✕</button>
        </div>
        <div class="__bd__">
          <div class="__muted__">One URL per line (or paste a JSON array).</div>

          <div class="__card__">
            <textarea id="__ncz_vl_text__" spellcheck="false"></textarea>

            <div class="__row__">
              <input type="file" id="__ncz_vl_file__" accept=".txt,.list,.m3u,.m3u8,application/json,text/plain" style="display:none">
              <button type="button" class="__btn2__" id="__ncz_vl_upload__">Upload .txt</button>

              <button type="button" class="__btn__" id="__ncz_vl_use__">Use This List</button>
              <button type="button" class="__btn2__" id="__ncz_vl_default__">Use Default</button>

              <button type="button" class="__btnDanger__" id="__ncz_vl_clear__">Clear Custom</button>
              <button type="button" class="__btn2__" id="__ncz_vl_close2__">Close</button>
            </div>

            <div class="__muted__" style="margin-top:10px;">
              Status: <span class="__mono__" id="__ncz_vl_status__">—</span>
            </div>
          </div>

          <div class="__card__">
            <div style="font-weight:1000; margin-bottom:6px;">Optional: fetch from URL</div>
            <div class="__row__">
              <input type="text" id="__ncz_vl_url__" placeholder="https://your-site.com/myvideos.txt">
              <button type="button" class="__btn2__" id="__ncz_vl_fetch__">Fetch</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const txtEl = modal.querySelector("#__ncz_vl_text__");
      const statusEl = modal.querySelector("#__ncz_vl_status__");
      const setStatus = (s)=>{ if(statusEl) statusEl.textContent = String(s||"—"); };

      const apiOk = () => (window.__nczLyricsVideoList && typeof window.__nczLyricsVideoList.set === "function");

      function fill(){
        if(!apiOk()){
          setStatus("Missing API. Did you add the __nczLyricsVideoList patch inside the lyrics script?");
          if(txtEl) txtEl.value = "";
          return;
        }
        const cur = window.__nczLyricsVideoList.get();
        if(txtEl) txtEl.value = (cur || []).join("\n");
        setStatus(cur.length ? `Loaded current list (${cur.length})` : "List is empty.");
      }
      modal.__fill__ = fill;

      const close = () => hide();
      modal.querySelector("#__ncz_vl_close__")?.addEventListener("click",(e)=>{e.preventDefault(); close();});
      modal.querySelector("#__ncz_vl_close2__")?.addEventListener("click",(e)=>{e.preventDefault(); close();});

      const fileEl = modal.querySelector("#__ncz_vl_file__");
      modal.querySelector("#__ncz_vl_upload__")?.addEventListener("click",(e)=>{e.preventDefault(); fileEl?.click?.();});
      fileEl?.addEventListener("change", ()=>{
        const f = fileEl.files && fileEl.files[0];
        if(!f) return;
        const r = new FileReader();
        r.onload = ()=>{ if(txtEl) txtEl.value = String(r.result||""); setStatus(`Loaded ${f.name}`); };
        r.onerror = ()=> setStatus("File read failed.");
        r.readAsText(f);
      });

      modal.querySelector("#__ncz_vl_use__")?.addEventListener("click",(e)=>{
        e.preventDefault();
        if(!apiOk()){ setStatus("Missing API patch."); return; }
        const urls = parseList(String(txtEl?.value||""));
        if(!urls.length){ setStatus("No valid http(s) URLs found."); return; }
        window.__nczLyricsVideoList.set(urls, { persist:true });
        window.__nczLyricsVideoList.playNow?.();
        setStatus(`Using custom list (${urls.length})`);
      });

      modal.querySelector("#__ncz_vl_default__")?.addEventListener("click",(e)=>{
        e.preventDefault();
        if(!apiOk()){ setStatus("Missing API patch."); return; }
        window.__nczLyricsVideoList.useDefault({ clearStored:true });
        window.__nczLyricsVideoList.playNow?.();
        const n = window.__nczLyricsVideoList.get().length;
        setStatus(`Using default list (${n})`);
      });

      modal.querySelector("#__ncz_vl_clear__")?.addEventListener("click",(e)=>{
        e.preventDefault();
        if(!apiOk()){ setStatus("Missing API patch."); return; }
        // Clear custom by reverting to default + clearing storage (your init will apply custom if present)
        window.__nczLyricsVideoList.useDefault({ clearStored:true });
        window.__nczLyricsVideoList.playNow?.();
        setStatus("Cleared custom (back to default).");
      });

      modal.querySelector("#__ncz_vl_fetch__")?.addEventListener("click", async (e)=>{
        e.preventDefault();
        if(!apiOk()){ setStatus("Missing API patch."); return; }
        const u = String(modal.querySelector("#__ncz_vl_url__")?.value || "").trim();
        if(!isHttp(u)){ setStatus("Enter a valid http(s) URL first."); return; }

        setStatus("Fetching…");
        try{
          const bust = (u.includes("?") ? "&" : "?") + "v=" + Date.now();
          const res = await fetch(u + bust, { cache:"no-store" });
          if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const text = await res.text();
          if(txtEl) txtEl.value = text;

          const urls = parseList(text);
          if(!urls.length){ setStatus("Fetched OK, but no valid URLs found."); return; }

          window.__nczLyricsVideoList.set(urls, { persist:true });
          window.__nczLyricsVideoList.playNow?.();
          setStatus(`Fetched + using custom list (${urls.length})`);
        }catch(err){
          setStatus(`Fetch failed: ${err?.message || String(err)}`);
        }
      });

      window.addEventListener("keydown",(e)=>{ if(e.key==="Escape") hide(); });
    }

    return { overlay: $(OVERLAY_ID), modal: $(MODAL_ID) };
  }

  function show(){
    const { overlay, modal } = ensureModal();
    modal?.__fill__?.();
    overlay.classList.add("__show__");
    modal.classList.add("__show__");
  }

  function hide(){
    $(OVERLAY_ID)?.classList.remove("__show__");
    $(MODAL_ID)?.classList.remove("__show__");
  }

  // Inject the tiny link and keep it alive if your script overwrites header.textContent
  function ensureLink(){
    ensureStyles();
    const h = findHdr();
    if(!h) return false;

    if (h.querySelector && h.querySelector(`#${LINK_ID}`)) return true;

    const titleText = (h.textContent || "").trim() || "Song Lyrics";
    h.textContent = "";

    const left = document.createElement("span");
    left.textContent = titleText;

    const link = document.createElement("a");
    link.id = LINK_ID;
    link.href = "#";
    link.textContent = "Load Video List";
    link.addEventListener("click",(e)=>{ e.preventDefault(); show(); });

    h.appendChild(left);
    h.appendChild(link);
    return true;
  }

  function bindHdrObserver(){
    const h = findHdr();
    if(!h) return false;
    if(h.dataset.__nczVidListUiV5Bound === "1") return true;
    h.dataset.__nczVidListUiV5Bound = "1";

    const mo = new MutationObserver(() => { ensureLink(); });
    mo.observe(h, { childList:true, characterData:true, subtree:true });
    return true;
  }

  // init now / late
  if (ensureLink()) bindHdrObserver();

  const domMO = new MutationObserver(() => {
    if (ensureLink()) { bindHdrObserver(); domMO.disconnect(); }
  });
  domMO.observe(document.documentElement, { childList:true, subtree:true });
  setTimeout(()=>{ try{ domMO.disconnect(); }catch{} }, 15000);

  console.log("[ncz-vidlist-ui v5] ready");
})();

// ✅ NCZ HOTFIX: "Clear Custom" -> "Clear" + actually clears the textarea (does NOT change the active list)
// Paste AFTER the v5 video list UI patch.
(() => {
  "use strict";
  if (window.__NCZ_VIDLIST_CLEAR_HOTFIX__) return;
  window.__NCZ_VIDLIST_CLEAR_HOTFIX__ = true;

  const BTN_ID  = "__ncz_vl_clear__";
  const TXT_ID  = "__ncz_vl_text__";
  const FILE_ID = "__ncz_vl_file__";
  const STAT_ID = "__ncz_vl_status__";

  function setLabelIfFound() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return false;
    btn.textContent = "Clear";
    btn.title = "Clear the text editor (does not change the current list)";
    return true;
  }

  // Rename when it appears
  if (!setLabelIfFound()) {
    const mo = new MutationObserver(() => {
      if (setLabelIfFound()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { try { mo.disconnect(); } catch {} }, 15000);
  }

  // Capture click BEFORE the button’s own handler; prevent the old “revert” logic.
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest(`#${BTN_ID}`) : null;
    if (!btn) return;

    // stop the original handler on the button
    e.preventDefault();
    e.stopPropagation();

    const txt = document.getElementById(TXT_ID);
    const file = document.getElementById(FILE_ID);
    const stat = document.getElementById(STAT_ID);

    if (txt) {
      txt.value = "";
      txt.dispatchEvent(new Event("input", { bubbles: true }));
      txt.dispatchEvent(new Event("change", { bubbles: true }));
      try { txt.focus(); } catch {}
    }
    if (file) file.value = "";

    if (stat) stat.textContent = "Cleared editor text.";
  }, true);

  console.log("[ncz] clear button hotfix installed");
})();






























// ✅ NCZ PATCH: "Loop" checkbox in Video List popup (robust injector)
// - Default ON
// - If OFF: play a new random video on ended
// - Uses internal list: window.__nczLyricsVideoList.get()
// - Avoids hook mode (controls && !muted)
// Paste AFTER your Video List UI patch + lyrics script
(() => {
  "use strict";
  if (window.__NCZ_VIDEO_LOOP_TOGGLE_V3__) return;
  window.__NCZ_VIDEO_LOOP_TOGGLE_V3__ = true;

  const VIDEO_ID = "__ncz_right_lyrics_video__";

  // Anchors inside your popup (these exist in your v5 UI)
  const USE_BTN_ID   = "__ncz_vl_use__";
  const CLOSE_BTN_ID = "__ncz_vl_close2__";
  const TEXTAREA_ID  = "__ncz_vl_text__";

  const LOOP_KEY = "NCZ_UI_VIDEO_LOOP_ENABLED"; // "1" default, "0" off

  const WRAP_ID  = "__ncz_vl_loop_wrap_v3__";
  const CHK_ID   = "__ncz_vl_loop_chk_v3__";
  const STYLE_ID = "__ncz_vl_loop_style_v3__";

  const $ = (id) => document.getElementById(id);

  function guard(fn){
    try { return fn(); } catch (e) { console.warn("[ncz-loop v3] error:", e); return null; }
  }

  function ensureDefault(){
    try{
      const v = localStorage.getItem(LOOP_KEY);
      if (v !== "0" && v !== "1") localStorage.setItem(LOOP_KEY, "1");
    }catch{}
  }

  function getLoopEnabled(){
    try { return localStorage.getItem(LOOP_KEY) !== "0"; } catch {}
    return true;
  }

  function setLoopEnabled(on){
    try { localStorage.setItem(LOOP_KEY, on ? "1" : "0"); } catch {}
  }

  function getVideo(){
    const v = $(VIDEO_ID);
    return (v && v.tagName && v.tagName.toLowerCase() === "video") ? v : null;
  }

  function isHookMode(v){
    return !!(v && v.controls && !v.muted);
  }

  function normalizeUrl(u){
    u = String(u || "").trim();
    if(!u) return "";
    try { return new URL(u, location.origin).toString(); } catch { return u; }
  }

  function getPool(){
    try{
      const api = window.__nczLyricsVideoList;
      if (api && typeof api.get === "function"){
        const arr = api.get();
        if (Array.isArray(arr)) return arr.filter(Boolean).map(String);
      }
    }catch{}
    return [];
  }

  let lastVideoUrl = "";

  function pickNext(pool){
    const arr = (Array.isArray(pool) ? pool : []).filter(Boolean).map(String);
    if (!arr.length) return "";
    if (arr.length === 1) return arr[0];

    const avoid = normalizeUrl(lastVideoUrl);
    for (let k=0; k<10; k++){
      const u = arr[(Math.random() * arr.length) | 0];
      if (u && normalizeUrl(u) !== avoid) return u;
    }
    return arr[(Math.random() * arr.length) | 0];
  }

  function applyLoopSetting(v){
    if (!v) return;
    if (isHookMode(v)) return;

    const on = getLoopEnabled();
    v.loop = !!on;
    if (on) v.setAttribute("loop", "");
    else v.removeAttribute("loop");
  }

  function ensureEndedHandler(v){
    if (!v) return;
    if (v.dataset.__nczLoopEndedV3__ === "1") return;
    v.dataset.__nczLoopEndedV3__ = "1";

    v.addEventListener("ended", () => {
      try{
        if (getLoopEnabled()) return; // only when loop OFF
        if (isHookMode(v)) return;

        const pool = getPool();
        const next = pickNext(pool);
        if (!next) return;

        // keep loop OFF
        v.loop = false;
        v.removeAttribute("loop");

        v.src = next;
        try { v.load(); } catch {}
        try{
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(()=>{});
        }catch{}

        lastVideoUrl = normalizeUrl(next);
      }catch{}
    });
  }

  // Re-apply loop setting when a new video loads (NO attribute observers -> no feedback loop)
  function ensureReapplyOnLoad(v){
    if (!v) return;
    if (v.dataset.__nczLoopLoadV3__ === "1") return;
    v.dataset.__nczLoopLoadV3__ = "1";

    const re = () => applyLoopSetting(v);
    v.addEventListener("loadstart", re);
    v.addEventListener("loadedmetadata", re);
    v.addEventListener("canplay", re);
    v.addEventListener("play", re);
  }

  function ensureStyles(){
    if ($(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${WRAP_ID}{
        display:flex;
        align-items:center;
        gap:8px;
        padding: 6px 10px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.06);
        user-select:none;
        cursor:pointer;
      }
      #${WRAP_ID}:hover{ background: rgba(255,255,255,.10); }
      #${WRAP_ID} input{
        width:14px;
        height:14px;
        cursor:pointer;
      }
      #${WRAP_ID} span{
        font-size:12px;
        font-weight:900;
        color: rgba(233,238,252,.92);
        line-height:1;
        white-space:nowrap;
      }
    `;
    document.head.appendChild(st);
  }

  // Find the popup button row reliably (no modal-id assumption)
  function findButtonRow(){
    const useBtn = $(USE_BTN_ID);
    if (useBtn && useBtn.parentElement) return useBtn.parentElement;

    // fallback: textarea exists => find row within same modal/card
    const ta = $(TEXTAREA_ID);
    if (ta){
      const modalish = ta.closest("div[id]") || ta.closest("div");
      const u = modalish ? modalish.querySelector(`#${USE_BTN_ID}`) : null;
      if (u && u.parentElement) return u.parentElement;
    }
    return null;
  }

  function injectCheckbox(){
    const row = findButtonRow();
    if (!row) return false;

    if ($(CHK_ID) || row.querySelector(`#${CHK_ID}`)) return true;

    ensureStyles();

    const wrap = document.createElement("label");
    wrap.id = WRAP_ID;
    wrap.setAttribute("for", CHK_ID);

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = CHK_ID;
    chk.checked = getLoopEnabled();

    const txt = document.createElement("span");
    txt.textContent = "Loop";

    wrap.appendChild(chk);
    wrap.appendChild(txt);

    // place before Close if present, else near end
    const close2 = $(CLOSE_BTN_ID);
    if (close2 && close2.parentElement === row) row.insertBefore(wrap, close2);
    else row.appendChild(wrap);

    // bind toggle
    chk.addEventListener("change", () => {
      setLoopEnabled(!!chk.checked);

      const v = getVideo();
      if (v) {
        // track current
        const cur = normalizeUrl(v.currentSrc || v.src || "");
        if (cur) lastVideoUrl = cur;

        applyLoopSetting(v);
        ensureEndedHandler(v);
        ensureReapplyOnLoad(v);
      }
    });

    return true;
  }

  // init
  ensureDefault();

  // Apply behavior to existing video if present
  guard(() => {
    const v = getVideo();
    if (!v) return;
    const cur = normalizeUrl(v.currentSrc || v.src || "");
    if (cur) lastVideoUrl = cur;
    applyLoopSetting(v);
    ensureEndedHandler(v);
    ensureReapplyOnLoad(v);
  });

  // Inject when popup exists (it’s created on demand)
  // We watch DOM until we successfully inject once, then disconnect.
  const mo = new MutationObserver(() => {
    if (injectCheckbox()) {
      // keep checkbox state synced if popup is reopened and rebuilt
      // (modal usually persists, so this is enough)
    }
  });
  mo.observe(document.documentElement, { childList:true, subtree:true });

  // Try immediately too (in case modal is already open)
  injectCheckbox();

  console.log("[ncz-loop v3] ready (Loop checkbox injects when popup exists)");
})();






























// ✅ NCZ PATCH: Prime videos by REAL SongList Play → THEN start Radio (V1)
// - First user interaction:
//    1) Blocks scripted radio toggles (so nothing can start radio early)
//    2) Clicks the FIRST visible SongList row's "Play" link (real app handler path)
//       (this is what normally wakes your video system)
//    3) Waits DELAY_BEFORE_RADIO_MS
//    4) Starts Radio (programmatic pill click allowed only at that moment)
// - No injected audio src. No playNow loops. No observers.
//
// 🔧 EDIT THIS ONLY:
const DELAY_BEFORE_RADIO_MS = 2;

(() => {
  "use strict";
  if (window.__NCZ_PRIME_VIDEO_THEN_RADIO_V1__) return;
  window.__NCZ_PRIME_VIDEO_THEN_RADIO_V1__ = true;

  const PILL_ID   = "__ncz_radio_pill__";
  const SONGROOT_ID = "songList";
  const VIDEO_ID  = "__ncz_right_lyrics_video__";

  const EVENTS = ["pointerdown","mousedown","touchstart","keydown","wheel"];
  const RETRY_EVERY_MS = 200;
  const PRIME_RETRY_MAX_MS = 4500;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);

  const isRadioOn = () => !!(window.__NCZ_AI_RADIO_STATE__ && window.__NCZ_AI_RADIO_STATE__.on);

  // ----------------------------
  // HARD BLOCK: prevent other scripts from toggling radio early
  // ----------------------------
  let allowProgrammaticRadio = false;

  function wrapPillClickIfPresent() {
    const pill = $(PILL_ID);
    if (!pill) return false;
    if (pill.__nczWrappedPrimeVideoV1__ === "1") return true;
    pill.__nczWrappedPrimeVideoV1__ = "1";

    const orig = pill.click.bind(pill);
    pill.__nczOrigClickPrimeVideoV1__ = orig;

    // Block pill.click() unless we allow it
    pill.click = function () {
      if (!allowProgrammaticRadio) return;
      return orig();
    };

    // Also block untrusted dispatched clicks unless allowed
    pill.addEventListener("click", (e) => {
      if (allowProgrammaticRadio) return;
      if (e && e.isTrusted) return; // always allow real human click
      try { e.preventDefault(); } catch {}
      try { e.stopPropagation(); } catch {}
      try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
    }, true);

    return true;
  }

  // ----------------------------
  // REAL "Play" click primer (SongList)
  // ----------------------------
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  };

  const clickReal = (el) => {
    try {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    } catch {}
    try { el.click(); } catch {}
  };

  function findFirstSongListPlayLink() {
    const root = $(SONGROOT_ID);
    if (!root) return null;

    // your rows are div[data-song-index]
    const rows = Array.from(root.children).filter(n =>
      n && n.nodeType === 1 && n.matches("div[data-song-index]")
    );

    const row = rows.find(isVisible) || rows[0];
    if (!row) return null;

    const playLink = Array.from(row.querySelectorAll("a"))
      .find(a => (a.textContent || "").trim().toLowerCase() === "play" && isVisible(a));

    return playLink || null;
  }

  // Optional helper: if no songs exist, try to click an "Add default" type button (best-effort)
  function tryClickAddDefaultSong() {
    const candidates = Array.from(document.querySelectorAll("button,a"))
      .filter(el => isVisible(el));

    const hit = candidates.find(el => {
      const t = ((el.textContent || "") + " " + (el.title || "")).toLowerCase();
      return /add/.test(t) && /default/.test(t) && /(song|track|playlist|list)/.test(t);
    });

    if (hit) {
      clickReal(hit);
      return true;
    }
    return false;
  }

  async function primeByRealPlayClick() {
    // 1) try immediate play click
    let link = findFirstSongListPlayLink();
    if (link) {
      clickReal(link);
      return true;
    }

    // 2) if no song rows yet, try "add default", then retry
    tryClickAddDefaultSong();

    const t0 = Date.now();
    while (Date.now() - t0 < PRIME_RETRY_MAX_MS) {
      await sleep(RETRY_EVERY_MS);
      link = findFirstSongListPlayLink();
      if (link) {
        clickReal(link);
        return true;
      }
    }
    return false;
  }

  function videoLooksAlive() {
    const v = $(VIDEO_ID);
    if (!v || v.tagName.toLowerCase() !== "video") return false;
    const src = String(v.currentSrc || v.src || "").trim();
    return !!src;
  }

  async function waitForVideoWake(ms = 1200) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (videoLooksAlive()) return true;
      await sleep(120);
    }
    return false;
  }

  function startRadioNow() {
    if (isRadioOn()) return true;

    wrapPillClickIfPresent();
    const pill = $(PILL_ID);
    if (!pill) return false;

    allowProgrammaticRadio = true;
    try {
      // Use original click if we captured it
      if (typeof pill.__nczOrigClickPrimeVideoV1__ === "function") pill.__nczOrigClickPrimeVideoV1__();
      else pill.click();
    } finally {
      setTimeout(() => { allowProgrammaticRadio = false; }, 500);
    }
    return true;
  }

  // ----------------------------
  // One-shot on first user interaction
  // ----------------------------
  let fired = false;

  function disarm(handler) {
    for (const ev of EVENTS) {
      try { window.removeEventListener(ev, handler, true); } catch {}
    }
  }

  const handler = async (e) => {
    if (fired) return;

    // Wrap pill ASAP so other scripts can't start it early
    wrapPillClickIfPresent();
    allowProgrammaticRadio = false;

    // If pill isn't present yet, don't consume the one-shot—let next interaction handle it
    if (!$(PILL_ID)) return;

    fired = true;
    disarm(handler);

    if (isRadioOn()) return;

    // ✅ PRIME: click the real SongList "Play" path
    const primed = await primeByRealPlayClick();

    // Give your video system a moment to wake (no loops)
    if (primed) await waitForVideoWake(1400);

    // ✅ THEN: wait your configured delay and start radio
    setTimeout(() => {
      startRadioNow();
    }, Number(DELAY_BEFORE_RADIO_MS) || 0);
  };

  for (const ev of EVENTS) window.addEventListener(ev, handler, true);

  // Also keep wrapping pill if SPA rebuilds it
  const tWrap = setInterval(() => { if (wrapPillClickIfPresent()) {} }, 300);
  setTimeout(() => { try { clearInterval(tWrap); } catch {} }, 15000);

  console.log("[ncz] PrimeVideo→Radio V1 installed. Delay =", DELAY_BEFORE_RADIO_MS, "ms");
})();

























// ✅ NCZ PATCH: Preserve \n line breaks in chat messages
(() => {
  "use strict";
  const STYLE_ID = "__ncz_chat_preserve_newlines__";
  if (document.getElementById(STYLE_ID)) return;

  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
    #__ncz_chat_log__ span.__txt__{
      white-space: pre-wrap; /* preserves \n as line breaks */
    }
  `;
  document.head.appendChild(st);
})();























































// ✅ NCZ PATCH: Producer.ai Playlist Browser (V1 - EXACT PLAY)
// - Mounts + recommended + browse (same vibe as your Suno V2)
// - Calls: https://xtdevelopment.net/ace/playlist (POST)
// - Expects: result.uuids[] (or similar) from server
// - Builds audio URL as:
//   https://storage.googleapis.com/producer-app-public/clips/<UUID>.mp3
// - Click a track => adds to Song List + plays the EXACT matching row (no "play first")
//
// Paste this AFTER your External URL Browser patch (or anywhere after #__ncz_music_list__ exists).

(() => {
  "use strict";
  if (window.__NCZ_PRODUCER_PLAYLIST_BROWSER_V1__) return;
  window.__NCZ_PRODUCER_PLAYLIST_BROWSER_V1__ = true;

  // -----------------------------
  // CONFIG
  // -----------------------------
  const CFG = {
    archiveListElId: "__ncz_music_list__",

    // ✅ Your endpoint (absolute as requested)
    endpoint: "https://xtdevelopment.net/ace/playlist",

    // where Producer clips live
    clipBaseUrl: "https://storage.googleapis.com/producer-app-public/clips/",

    lsKey: "NCZ_PRODUCER_PLAYLIST_MOUNTS_V1",
    virtualFolderName: "Producer.ai Playlist Browser…",

    recommendedPlaylists: [
      { name: "deephouse by cob", url: "https://www.producer.ai/playlist/5886cc32-4d5c-4e86-acba-8ad399b1545b" },
    ],

    // main playlist DOM
    mainSongListId: "songList",

    // exact-play timing
    findPlay: { timeoutMs: 6500, pollMs: 140 },

    // server defaults
    timeout_s: 120,
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function isUuid36(x) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x || "").trim());
  }

  function normalizeProducerPlaylistUrl(raw) {
    raw = String(raw || "").trim();
    if (!raw) return "";

    // allow raw UUID (playlist id)
    if (isUuid36(raw)) return `https://www.producer.ai/playlist/${raw}`;

    // allow without scheme
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

    return raw;
  }

  function safeLabelFromPlaylist(u) {
    u = String(u || "").trim();
    if (!u) return "playlist";
    if (isUuid36(u)) return u;
    try {
      const x = new URL(u);
      const p = x.pathname.replace(/\/+$/, "");
      return x.host + (p ? p : "");
    } catch {
      return u.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    }
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function loadMounts() {
    try {
      const raw = localStorage.getItem(CFG.lsKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveMounts(mounts) {
    try { localStorage.setItem(CFG.lsKey, JSON.stringify(mounts)); } catch {}
  }

  async function copyText(txt) {
    txt = String(txt || "");
    if (!txt) return false;
    try {
      await navigator.clipboard.writeText(txt);
      return true;
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function clickReal(el) {
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch {}
    try { el.click(); } catch {}
  }

  function nowIso() {
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function urlBasename(u) {
    u = String(u || "").trim();
    if (!u) return "";
    try {
      const U = new URL(u, location.origin);
      return decodeURIComponent((U.pathname.split("/").filter(Boolean).pop() || "").trim());
    } catch {
      const noQ = u.split("?")[0].split("#")[0];
      const last = noQ.split("/").filter(Boolean).pop() || "";
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function normKey(u) {
    u = String(u || "").trim();
    if (!u) return "";
    return u.split("#")[0].split("?")[0].trim();
  }

  function candidatesFromUrl(u) {
    const out = [];
    const push = (x) => {
      x = String(x || "").trim();
      if (!x) return;
      out.push(x);
      out.push(normKey(x));
      try {
        const U = new URL(x, location.origin);
        out.push(U.toString());
        out.push(normKey(U.toString()));
        out.push(U.pathname);
      } catch {}
    };
    push(u);

    const bn = urlBasename(u);
    if (bn) out.push(bn);

    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const k = String(s).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      uniq.push(k);
    }
    return uniq;
  }

  function urlsMatch(a, b) {
    const A = candidatesFromUrl(a);
    const B = candidatesFromUrl(b);
    for (const x of A) {
      for (const y of B) {
        if (!x || !y) continue;
        if (x === y) return true;
        if (x.length > 6 && y.length > 6) {
          if (x.endsWith(y) || y.endsWith(x)) return true;
        }
        const xb = urlBasename(x).toLowerCase();
        const yb = urlBasename(y).toLowerCase();
        if (xb && yb && xb === yb) return true;
      }
    }
    return false;
  }

  // -----------------------------
  // Server call
  // -----------------------------
  async function postProducerPlaylist(playlistUrl, force = false) {
    const res = await fetch(CFG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: playlistUrl,
        timeout_s: CFG.timeout_s,
        force: !!force
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`producerPlaylist HTTP ${res.status}${t ? `: ${t.slice(0, 240)}` : ""}`);
    }

    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

function pickUuidsArray(data) {
  const d = data && typeof data === "object" ? data : {};
  // supports: { result: { uuids:[...] } }  OR  { result: { songs:[{uuid,title,artist}] } }  OR  top-level variants
  const candidates = [
    d.result?.songs,
    d.result?.uuids,
    d.result?.clips,

    d.songs,
    d.uuids,
    d.clips,

    d.data?.result?.songs,
    d.data?.result?.uuids,
    d.data?.songs,
    d.data?.uuids,

    d.data,
    d
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

  function getPlaylistTitle(data) {
    const d = data && typeof data === "object" ? data : {};
    return (
      String(d.result?.title || d.title || d.result?.name || d.name || "").trim()
    );
  }

 function normalizePlaylistItems(data) {
  const arr = pickUuidsArray(data);

  const clean = (s) => String(s || "").trim();

  // If server ever returns objects, handle those too
  return arr.map((x) => {
    // Old/simple format: ["uuid", "uuid", ...]
    if (typeof x === "string") {
      const uuid = x.trim();
      const audio = uuid ? (CFG.clipBaseUrl + uuid + ".m4a") : "";
      const short = uuid ? uuid.slice(0, 8) : "";
      return {
        id: uuid,
        title: short ? `Clip ${short}` : "Clip",
        author: "",
        audio,
        raw: x
      };
    }

    // New format: { uuid, title, artist } (or similar keys)
    const obj = x && typeof x === "object" ? x : { value: x };

    const uuid = clean(obj.uuid || obj.id || obj.clip_uuid || obj.clipId || "");
    const audio =
      clean(obj.audio || obj.audio_url || obj.audioUrl || obj.url) ||
      (uuid ? (CFG.clipBaseUrl + uuid + ".m4a") : "");

    const songTitle = clean(obj.title || obj.name);
    const artist = clean(obj.artist || obj.author || obj.user || obj.username);

    // ✅ THIS is the change: "artist - title"
    const displayTitle =
      (artist && songTitle) ? `${artist} - ${songTitle}`
      : (songTitle || artist || (uuid ? `Clip ${uuid.slice(0, 8)}` : "Clip"));

    return {
      id: uuid,
      title: displayTitle,   // <-- used in overlay + Song List label
      author: artist,        // <-- kept if you ever want it later
      audio,
      raw: obj
    };
  }).filter(it => it && it.id);
}

  // -----------------------------
  // ✅ EXACT PLAY (same core as your Suno V2)
  // -----------------------------
  function getSongUrlFromObj(it) {
    if (!it) return "";
    if (typeof it === "string") return it;
    if (typeof it !== "object") return "";
    return String(it.url || it.file || it.href || it.src || it.downloadName || "").trim();
  }

  function findIndexInWindowSongs(url) {
    const songs = Array.isArray(window.songs) ? window.songs : null;
    if (!songs) return -1;

    for (let i = 0; i < songs.length; i++) {
      const it = songs[i];
      const candidates = [];

      candidates.push(getSongUrlFromObj(it));

      if (it && typeof it === "object") {
        try {
          if (it.serverItem && typeof it.serverItem === "object") {
            candidates.push(getSongUrlFromObj(it.serverItem));
          }
        } catch {}
        try {
          if (it.meta && typeof it.meta === "object") {
            candidates.push(getSongUrlFromObj(it.meta));
          }
        } catch {}

        for (const k of Object.keys(it)) {
          const v = it[k];
          if (typeof v === "string" && (v.includes("://") || /\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(v))) {
            candidates.push(v);
          }
        }
      }

      for (const c of candidates) {
        if (c && urlsMatch(c, url)) return i;
      }
    }
    return -1;
  }

  function findRowInDomByUrl(url) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;

    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    if (!rows.length) return null;

    for (const r of rows) {
      const links = Array.from(r.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = String(a.getAttribute("href") || "").trim();
        if (h && urlsMatch(h, url)) return r;
      }
    }

    const bn = urlBasename(url).toLowerCase();
    const key = normKey(url).toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (key && txt.includes(key)) return r;
      if (bn && txt.includes(bn)) return r;
    }

    return null;
  }

  function clickPlayInRow(row) {
    if (!row) return false;

    const aPlay = Array.from(row.querySelectorAll("a"))
      .find(a => isVisible(a) && (String(a.textContent || "").trim().toLowerCase() === "play"));

    if (aPlay) { clickReal(aPlay); return true; }

    const any = Array.from(row.querySelectorAll("a,button"))
      .find(el => isVisible(el) && String(el.getAttribute("title") || "").toLowerCase().includes("play"));

    if (any) { clickReal(any); return true; }

    return false;
  }

  async function playExactByUrl(url) {
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.findPlay.timeoutMs) {
      const idx = findIndexInWindowSongs(url);
      if (idx >= 0) {
        const root = document.getElementById(CFG.mainSongListId);
        if (root) {
          const row = root.querySelector(`div[data-song-index="${idx}"]`);
          if (row && clickPlayInRow(row)) return true;
        }
      }

      const row2 = findRowInDomByUrl(url);
      if (row2 && clickPlayInRow(row2)) return true;

      await sleep(CFG.findPlay.pollMs);
    }
    return false;
  }

  async function addToSongsListAndPlay(url, title, meta) {
    url = String(url || "").trim();
    if (!url) return false;

    const label = String(title || "").trim() || urlBasename(url) || "Producer Clip";
    const createdAt = nowIso();

    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(url, {
          label,
          createdAt,
          meta: (meta && typeof meta === "object") ? meta : {},
          downloadName: label,
          serverItem: meta || null
        });
      } catch {}
    } else if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      try {
        window.__NCZ_PLAYLIST_ADD_FN__({
          file: url,
          url,
          name: label,
          title: label,
          meta: meta || {}
        });
      } catch {}
    } else {
      try { window.open(url, "_blank", "noopener"); } catch {}
      return false;
    }

    await sleep(50);
    return await playExactByUrl(url);
  }

  // -----------------------------
  // Styles (dark scrollbars)
  // -----------------------------
  const STYLE_ID = "__ncz_producer_pl_scrollbar_style__";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const css = `
.ncz-dark-scroll{
  scrollbar-width: thin;
  scrollbar-color: #2a344a #0b0d12;
}
.ncz-dark-scroll::-webkit-scrollbar{ width:10px; height:10px; }
.ncz-dark-scroll::-webkit-scrollbar-track{ background:#0b0d12; }
.ncz-dark-scroll::-webkit-scrollbar-thumb{
  background:#2a344a;
  border:2px solid #0b0d12;
  border-radius:999px;
}
.ncz-dark-scroll::-webkit-scrollbar-thumb:hover{ background:#3a4766; }
`.trim();

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // -----------------------------
  // Overlay UI
  // -----------------------------
  const OVERLAY_ID = "__ncz_producer_pl_overlay__";
  const LIST_ID = "__ncz_producer_pl_list__";

  let overlay = null;
  let overlayList = null;
  let overlayCrumb = null;
  let overlayMsg = null;

  const state = { mode: "mounts", currentMount: null, playlistData: null };

  function renderRow({ icon, text, subtext, right, onClick }) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
    `;

    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${icon || ""}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(subtext)}</div>` : ""}
      </div>
      ${right || ""}
    `;

    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      onClick && onClick(e);
    });

    return row;
  }

  function ensureOverlay(hostEl) {
    if (overlay) return;

    ensureStyles();

    const panel = hostEl.parentElement || hostEl;
    const cs = getComputedStyle(panel);
    if (cs.position === "static") panel.style.position = "relative";

    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
      position:absolute; inset:0;
      background: var(--card, #121726);
      border: 1px solid var(--line, #1e2742);
      border-radius: 12px;
      box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35));
      display:none;
      z-index: 9999;
      overflow:hidden;
    `;

    overlay.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line,#1e2742);">
        <div style="font-weight:700; color:var(--text,#e9eefc);">${escapeHtml(CFG.virtualFolderName)}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="__ncz_producer_pl_close__" type="button" style="padding:6px 10px; border-radius:10px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Close</button>
        </div>
      </div>

      <div style="padding:8px 12px; border-bottom:1px solid var(--line,#1e2742); color:var(--muted,#a9b3cf); font-size:12px;">
        <span id="__ncz_producer_pl_crumb__">Mounts</span>
        <span id="__ncz_producer_pl_msg__" style="float:right; color:var(--warn,#ffd36a);"></span>
      </div>

      <div id="${LIST_ID}" class="ncz-dark-scroll" style="position:absolute; inset:86px 0 0 0; overflow:auto; padding:8px 10px;"></div>

      <div id="__ncz_producer_pl_modal__" style="
        position:absolute; inset:0; display:none;
        background: rgba(0,0,0,.55);
        align-items:center; justify-content:center;
        z-index:10000;
      ">
        <div class="ncz-dark-scroll" style="width:min(560px, 92%); max-height:min(600px, 86%); overflow:auto; background:var(--card,#121726); border:1px solid var(--line,#1e2742); border-radius:14px; box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35)); padding:14px;">
          <div style="font-weight:700; color:var(--text,#e9eefc); margin-bottom:10px;">Mount Producer.ai Playlist</div>

          <input id="__ncz_producer_pl_inp__" type="text" placeholder="https://www.producer.ai/playlist/<uuid>  (or just the uuid)" style="
            width:100%; box-sizing:border-box;
            padding:10px 12px; border-radius:12px;
            border:1px solid var(--line,#1e2742);
            background:var(--card2,#0f1320); color:var(--text,#e9eefc);
            outline:none;
          " />

          <div id="__ncz_producer_pl_rec_list__" class="ncz-dark-scroll" style="display:none; margin-top:10px; border:1px solid var(--line,#1e2742); border-radius:12px; overflow:auto; max-height:240px; background:var(--card2,#0f1320);"></div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap;">
            <button id="__ncz_producer_pl_showrec__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:var(--card2,#0f1320); color:var(--text,#e9eefc); cursor:pointer;">Recommended</button>
            <button id="__ncz_producer_pl_cancel__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Cancel</button>
            <button id="__ncz_producer_pl_mount__" type="button" style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742); background:var(--accent,#6aa6ff); color:#0b0d12; cursor:pointer; font-weight:700;">Mount</button>
          </div>

          <div id="__ncz_producer_pl_err__" style="margin-top:10px; color:var(--bad,#ff5c7a); font-size:12px; white-space:pre-wrap;"></div>
        </div>
      </div>
    `;

    panel.appendChild(overlay);

    // shield overlay interactions
    const shield = (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    [
      "click","dblclick","auxclick","contextmenu",
      "mousedown","mouseup","pointerdown","pointerup",
      "touchstart","touchend"
    ].forEach((evt) => overlay.addEventListener(evt, shield, false));

    overlayList = overlay.querySelector("#" + LIST_ID);
    overlayCrumb = overlay.querySelector("#__ncz_producer_pl_crumb__");
    overlayMsg = overlay.querySelector("#__ncz_producer_pl_msg__");

    const modal = overlay.querySelector("#__ncz_producer_pl_modal__");
    const inp = overlay.querySelector("#__ncz_producer_pl_inp__");
    const err = overlay.querySelector("#__ncz_producer_pl_err__");
    const recBox = overlay.querySelector("#__ncz_producer_pl_rec_list__");

    function showModal(show) {
      modal.style.display = show ? "flex" : "none";
      err.textContent = "";
      recBox.style.display = "none";
      if (show) {
        inp.value = "";
        setTimeout(() => inp.focus(), 0);
      }
    }

    function buildRecList() {
      recBox.innerHTML = "";
      const recs = CFG.recommendedPlaylists || [];
      if (!recs.length) {
        const d = document.createElement("div");
        d.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
        d.textContent = "No recommended playlists configured.";
        recBox.appendChild(d);
        return;
      }

      for (const r of recs) {
        const b = document.createElement("button");
        b.type = "button";
        b.style.cssText = `
          width:100%; text-align:left;
          padding:10px 12px;
          border:0;
          border-bottom:1px solid var(--line,#1e2742);
          background:transparent;
          color:var(--text,#e9eefc);
          cursor:pointer;
        `;
        b.innerHTML = `
          <div style="font-weight:700; font-size:13px;">${escapeHtml(r.name || r.url)}</div>
          <div style="font-size:12px; color:var(--muted,#a9b3cf); word-break:break-all;">${escapeHtml(r.url || "")}</div>
        `;
        b.addEventListener("click", async () => {
          const u = normalizeProducerPlaylistUrl(r.url);
          if (!u) return;

          inp.value = u;
          err.textContent = "";
          overlayMsg.textContent = "Loading…";

          try {
            const data = await postProducerPlaylist(u, false);

            const mounts = loadMounts();
            const id = fnv1a(u);
            const label = safeLabelFromPlaylist(u);
            const existing = mounts.find((m) => m.id === id);
            if (!existing) mounts.unshift({ id, url: u, label, createdAt: Date.now() });
            saveMounts(mounts);

            modal.style.display = "none";
            state.mode = "browse";
            state.currentMount = { id, url: u, label };
            state.playlistData = data;
            await renderBrowse();
          } catch (e) {
            err.textContent = String(e && e.message ? e.message : e);
          } finally {
            overlayMsg.textContent = "";
          }
        });
        recBox.appendChild(b);
      }

      const last = recBox.lastElementChild;
      if (last) last.style.borderBottom = "0";
    }

    overlay.querySelector("#__ncz_producer_pl_close__").addEventListener("click", (e) => {
      e.preventDefault();
      overlay.style.display = "none";
    });

    overlay.querySelector("#__ncz_producer_pl_showrec__").addEventListener("click", (e) => {
      e.preventDefault();
      const show = recBox.style.display !== "block";
      recBox.style.display = show ? "block" : "none";
      if (show) buildRecList();
    });

    overlay.querySelector("#__ncz_producer_pl_cancel__").addEventListener("click", (e) => {
      e.preventDefault();
      showModal(false);
    });

    overlay.querySelector("#__ncz_producer_pl_mount__").addEventListener("click", async (e) => {
      e.preventDefault();
      const raw = inp.value;
      const url = normalizeProducerPlaylistUrl(raw);
      if (!url) { err.textContent = "Enter a Producer playlist URL or UUID."; return; }

      err.textContent = "";
      overlayMsg.textContent = "Loading…";

      try {
        const data = await postProducerPlaylist(url, false);

        const mounts = loadMounts();
        const id = fnv1a(url);
        const label = safeLabelFromPlaylist(url);

        const existing = mounts.find((m) => m.id === id);
        if (!existing) {
          mounts.unshift({ id, url, label, createdAt: Date.now() });
          saveMounts(mounts);
        }

        showModal(false);

        state.mode = "browse";
        state.currentMount = { id, url, label };
        state.playlistData = data;
        await renderBrowse();
      } catch (e2) {
        err.textContent = String(e2 && e2.message ? e2.message : e2);
      } finally {
        overlayMsg.textContent = "";
      }
    });

    renderMounts(showModal);
  }

  function showOverlay(hostEl) {
    ensureOverlay(hostEl);
    overlay.style.display = "block";
    state.mode = "mounts";
    state.currentMount = null;
    state.playlistData = null;
    renderMounts((show) => {
      const m = overlay.querySelector("#__ncz_producer_pl_modal__");
      if (m) m.style.display = show ? "flex" : "none";
    });
  }

  function renderMounts(showModalFn) {
    if (!overlayList) return;
    overlayCrumb.textContent = "Mounts";
    overlayList.innerHTML = "";

    overlayList.appendChild(renderRow({
      icon: "➕",
      text: "Mount a playlist…",
      subtext: "Producer.ai playlist URL or UUID (saved)",
      onClick: () => showModalFn && showModalFn(true)
    }));

    const recs = CFG.recommendedPlaylists || [];
    if (recs.length) {
      overlayList.appendChild(renderRow({
        icon: "⭐",
        text: "Recommended playlists",
        subtext: "One-click mount",
        onClick: () => {
          const modal = overlay.querySelector("#__ncz_producer_pl_modal__");
          if (modal) modal.style.display = "flex";
          const btn = overlay.querySelector("#__ncz_producer_pl_showrec__");
          if (btn) btn.click();
        }
      }));
    }

    const mounts = loadMounts();
    if (!mounts.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
      empty.textContent = "No Producer.ai playlist mounts yet.";
      overlayList.appendChild(empty);
      return;
    }

    for (const m of mounts) {
      const right = `
        <span class="__ncz_producer_unmount__" title="Remove mount" style="
          margin-left:10px;
          color: var(--bad,#ff5c7a);
          font-weight:900;
          font-size:16px;
          line-height:16px;
          user-select:none;
          cursor:pointer;
          padding:4px 6px;
          border-radius:10px;
        ">✕</span>
      `;

      const row = renderRow({
        icon: "🎧",
        text: m.label || m.url,
        subtext: m.url,
        right,
        onClick: async (e) => {
          const x = e.target && e.target.closest && e.target.closest("span.__ncz_producer_unmount__");
          if (x) return;

          state.mode = "browse";
          state.currentMount = { id: m.id, url: m.url, label: m.label || m.url };
          overlayMsg.textContent = "Loading…";
          try {
            const data = await postProducerPlaylist(m.url, false);
            state.playlistData = data;
            await renderBrowse();
          } catch (err) {
            overlayList.innerHTML = "";
            const d = document.createElement("div");
            d.style.cssText = "padding:10px; color:var(--bad,#ff5c7a); font-size:13px; white-space:pre-wrap;";
            d.textContent = `Error loading playlist:\n${String(err && err.message ? err.message : err)}`;
            overlayList.appendChild(d);
          } finally {
            overlayMsg.textContent = "";
          }
        }
      });

      const x = row.querySelector("span.__ncz_producer_unmount__");
      if (x) {
        x.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();

          const mounts2 = loadMounts();
          const next = mounts2.filter((mm) => String(mm.id) !== String(m.id));
          saveMounts(next);

          renderMounts(showModalFn);
        }, true);

        x.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }, true);
      }

      overlayList.appendChild(row);
    }
  }

  async function renderBrowse() {
    if (!overlayList || !state.currentMount) return;

    const mount = state.currentMount;
    const data = state.playlistData || {};
    const playlistTitle = getPlaylistTitle(data);

    overlayCrumb.textContent = playlistTitle ? `${playlistTitle}` : `${mount.label || "Playlist"}`;
    overlayList.innerHTML = "";

    overlayList.appendChild(renderRow({
      icon: "⬅️",
      text: "Back to Mounts",
      subtext: "",
      onClick: () => {
        state.mode = "mounts";
        state.currentMount = null;
        state.playlistData = null;
        renderMounts((show) => {
          const m = overlay.querySelector("#__ncz_producer_pl_modal__");
          if (m) m.style.display = show ? "flex" : "none";
        });
      }
    }));

    overlayList.appendChild(renderRow({
      icon: "🔄",
      text: "Refresh playlist",
      subtext: "Re-fetch from server (force)",
      onClick: async () => {
        overlayMsg.textContent = "Loading…";
        try {
          const d2 = await postProducerPlaylist(mount.url, true);
          state.playlistData = d2;
          await renderBrowse();
        } catch {
          const ok = await copyText(String(mount.url || ""));
          overlayMsg.textContent = ok ? "Refresh failed (copied mount URL)" : "Refresh failed";
          setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
        } finally {
          setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
        }
      }
    }));

    const items = normalizePlaylistItems(data);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px; white-space:pre-wrap;";
      empty.textContent =
        "No UUIDs returned.\n\nIf the endpoint response format changed, paste the JSON and I'll adapt the parser.";
      overlayList.appendChild(empty);
      return;
    }

    overlayList.appendChild(renderRow({
      icon: "ℹ️",
      text: `Tracks: ${items.length}`,
      subtext: "Click: add + exact-play in main Song List",
      onClick: async () => {
        const ok = await copyText(JSON.stringify(items.map((x) => x.id)));
        overlayMsg.textContent = ok ? "Copied UUID list (JSON)" : "Copy failed";
        setTimeout(() => { overlayMsg.textContent = ""; }, 1200);
      }
    }));

    for (const it of items) {
      const uuid = it.id;
      const audio = it.audio; // already constructed
      const title = it.title || (uuid ? `Clip ${uuid.slice(0, 8)}` : "Clip");
      const sub = uuid;

      overlayList.appendChild(renderRow({
        icon: "▶️",
        text: title,
        subtext: sub,
        onClick: async () => {
          const meta = {
            source: "producer_playlist",
            clip_uuid: uuid,
            playlist_url: mount.url,
            playlist_title: playlistTitle || "",
            raw: it.raw
          };

          overlayMsg.textContent = "Adding…";
          const ok = await addToSongsListAndPlay(audio, title, meta);
          overlayMsg.textContent = ok ? "Playing" : "Added (couldn’t auto-play)";
          setTimeout(() => { overlayMsg.textContent = ""; }, 1100);
        }
      }));
    }
  }

  // -----------------------------
  // Inject virtual row into left music list
  // -----------------------------
  function findArchiveListEl() {
    return document.getElementById(CFG.archiveListElId) || null;
  }

  function injectVirtualRow(listEl) {
    if (!listEl) return;
    if (listEl.querySelector("[data-ncz-producer-virtual-v1='1']")) return;

    ensureStyles();
    if (!listEl.classList.contains("ncz-dark-scroll")) listEl.classList.add("ncz-dark-scroll");

    const row = document.createElement("div");
    row.setAttribute("data-ncz-producer-virtual-v1", "1");
    row.className = "__ncz_lb_item__";
    row.title = "Producer.ai Playlist Browser…";
    row.style.margin = "0 0 6px 0";

    row.innerHTML = `
      <div class="__ncz_lb_icon__">🎧</div>
      <div class="__ncz_lb_labelwrap__" style="min-width:0">
        <div class="__ncz_lb_label__">${escapeHtml(CFG.virtualFolderName)}</div>
        <div class="__ncz_lb_hint__">Mount & browse Producer.ai playlists</div>
      </div>
    `;

    const open = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      }
      showOverlay(listEl);
    };

    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    listEl.prepend(row);
  }

  function start() {
    const listEl = findArchiveListEl();
    if (!listEl) {
      console.warn("[NCZ PRODUCER V1] Could not find left music list element:", CFG.archiveListElId);
      return;
    }

    injectVirtualRow(listEl);

    // re-inject if list is rebuilt
    const obs = new MutationObserver(() => injectVirtualRow(listEl));
    obs.observe(listEl, { childList: true, subtree: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();


























// ✅ NCZ PATCH: Producer Browser — "All Known" MASTER row UNDER "Recommended playlists" (MAIN LIST) (V2)
// - ONE patch (replaces the two earlier ones)
// - Puts "All Known" as its own row in the MAIN overlay list, directly UNDER "Recommended playlists"
// - NOT inside the Recommended dropdown, NOT stored as a mount
// - Click "All Known" -> loads GET /ace/producer/all and shows a playlist browse view using the SAME row style
// - Track click = SAME behavior as playlist tracks: add + EXACT-PLAY (no + buttons)
//
// Paste AFTER your existing "NCZ Producer.ai Playlist Browser (V1 - EXACT PLAY)" patch.

(() => {
  "use strict";
  if (window.__NCZ_PRODUCER_ALL_KNOWN_UNDER_RECOMMENDED_V2__) return;
  window.__NCZ_PRODUCER_ALL_KNOWN_UNDER_RECOMMENDED_V2__ = true;

  const CFG = {
    // If blank, auto: `${location.origin}/ace/producer/all`
    allKnownUrl: "",

    // Producer overlay ids (from your base Producer browser patch)
    overlayId: "__ncz_producer_pl_overlay__",
    listId: "__ncz_producer_pl_list__",
    crumbId: "__ncz_producer_pl_crumb__",
    msgId: "__ncz_producer_pl_msg__",
    errId: "__ncz_producer_pl_err__",
    modalId: "__ncz_producer_pl_modal__",

    // Main Song List DOM
    mainSongListId: "songList",

    // Producer clips
    clipBaseUrl: "https://storage.googleapis.com/producer-app-public/clips/",

    // Exact-play timing (match your Producer V1)
    findPlay: { timeoutMs: 6500, pollMs: 140 },
  };

  const ROW_ATTR = "data-ncz-producer-all-known-under-recommended-v2";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function resolveAllKnownUrl() {
    const explicit = String(CFG.allKnownUrl || "").trim();
    if (explicit) return explicit;
    try {
      const u = new URL(location.href);
      return `${u.origin}/ace/producer/all`;
    } catch {}
    return "https://xtdevelopment.net/ace/producer/all";
  }

  async function fetchAllKnown() {
    const url = resolveAllKnownUrl();
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`AllKnown HTTP ${res.status}${t ? `: ${t.slice(0, 240)}` : ""}`);
    }
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function clickReal(el) {
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch {}
    try { el.click(); } catch {}
  }

  function nowIso() {
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function urlBasename(u) {
    u = String(u || "").trim();
    if (!u) return "";
    try {
      const U = new URL(u, location.origin);
      return decodeURIComponent((U.pathname.split("/").filter(Boolean).pop() || "").trim());
    } catch {
      const noQ = u.split("?")[0].split("#")[0];
      const last = noQ.split("/").filter(Boolean).pop() || "";
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function normKey(u) {
    u = String(u || "").trim();
    if (!u) return "";
    return u.split("#")[0].split("?")[0].trim();
  }

  function candidatesFromUrl(u) {
    const out = [];
    const push = (x) => {
      x = String(x || "").trim();
      if (!x) return;
      out.push(x);
      out.push(normKey(x));
      try {
        const U = new URL(x, location.origin);
        out.push(U.toString());
        out.push(normKey(U.toString()));
        out.push(U.pathname);
      } catch {}
    };
    push(u);

    const bn = urlBasename(u);
    if (bn) out.push(bn);

    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const k = String(s).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      uniq.push(k);
    }
    return uniq;
  }

  function urlsMatch(a, b) {
    const A = candidatesFromUrl(a);
    const B = candidatesFromUrl(b);
    for (const x of A) {
      for (const y of B) {
        if (!x || !y) continue;
        if (x === y) return true;
        if (x.length > 6 && y.length > 6) {
          if (x.endsWith(y) || y.endsWith(x)) return true;
        }
        const xb = urlBasename(x).toLowerCase();
        const yb = urlBasename(y).toLowerCase();
        if (xb && yb && xb === yb) return true;
      }
    }
    return false;
  }

  // -----------------------------
  // SAME ROW STYLE AS YOUR BASE PATCH
  // -----------------------------
  function renderRow({ icon, text, subtext, right, onClick }) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
    `;
    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${icon || ""}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(subtext)}</div>` : ""}
      </div>
      ${right || ""}
    `;
    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      onClick && onClick(e);
    }, true);
    return row;
  }

  // -----------------------------
  // EXACT PLAY (same logic as your Producer V1)
  // -----------------------------
  function getSongUrlFromObj(it) {
    if (!it) return "";
    if (typeof it === "string") return it;
    if (typeof it !== "object") return "";
    return String(it.url || it.file || it.href || it.src || it.downloadName || "").trim();
  }

  function findIndexInWindowSongs(url) {
    const songs = Array.isArray(window.songs) ? window.songs : null;
    if (!songs) return -1;

    for (let i = 0; i < songs.length; i++) {
      const it = songs[i];
      const candidates = [];

      candidates.push(getSongUrlFromObj(it));

      if (it && typeof it === "object") {
        try {
          if (it.serverItem && typeof it.serverItem === "object") {
            candidates.push(getSongUrlFromObj(it.serverItem));
          }
        } catch {}
        try {
          if (it.meta && typeof it.meta === "object") {
            candidates.push(getSongUrlFromObj(it.meta));
          }
        } catch {}
        for (const k of Object.keys(it)) {
          const v = it[k];
          if (typeof v === "string" && (v.includes("://") || /\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(v))) {
            candidates.push(v);
          }
        }
      }

      for (const c of candidates) {
        if (c && urlsMatch(c, url)) return i;
      }
    }
    return -1;
  }

  function findRowInDomByUrl(url) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;

    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    if (!rows.length) return null;

    for (const r of rows) {
      const links = Array.from(r.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = String(a.getAttribute("href") || "").trim();
        if (h && urlsMatch(h, url)) return r;
      }
    }

    const bn = urlBasename(url).toLowerCase();
    const key = normKey(url).toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (key && txt.includes(key)) return r;
      if (bn && txt.includes(bn)) return r;
    }
    return null;
  }

  function clickPlayInRow(row) {
    if (!row) return false;

    const aPlay = Array.from(row.querySelectorAll("a"))
      .find(a => isVisible(a) && (String(a.textContent || "").trim().toLowerCase() === "play"));

    if (aPlay) { clickReal(aPlay); return true; }

    const any = Array.from(row.querySelectorAll("a,button"))
      .find(el => isVisible(el) && String(el.getAttribute("title") || "").toLowerCase().includes("play"));

    if (any) { clickReal(any); return true; }

    return false;
  }

  async function playExactByUrl(url) {
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.findPlay.timeoutMs) {
      const idx = findIndexInWindowSongs(url);
      if (idx >= 0) {
        const root = document.getElementById(CFG.mainSongListId);
        if (root) {
          const row = root.querySelector(`div[data-song-index="${idx}"]`);
          if (row && clickPlayInRow(row)) return true;
        }
      }

      const row2 = findRowInDomByUrl(url);
      if (row2 && clickPlayInRow(row2)) return true;

      await sleep(CFG.findPlay.pollMs);
    }
    return false;
  }

  function findRowByTextFallback(uuid, label) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;
    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    const u = String(uuid || "").toLowerCase();
    const l = String(label || "").toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (u && txt.includes(u)) return r;
      if (l && txt.includes(l)) return r;
    }
    return null;
  }

  async function addToSongsListAndPlay(url, title, meta, uuidForFallback) {
    url = String(url || "").trim();
    if (!url) return false;

    const label = String(title || "").trim() || urlBasename(url) || "Producer Clip";
    const createdAt = nowIso();

    let added = false;

    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(url, {
          label,
          createdAt,
          meta: (meta && typeof meta === "object") ? meta : {},
          downloadName: label,
          serverItem: meta || null
        });
        added = true;
      } catch {}
    } else if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      try {
        window.__NCZ_PLAYLIST_ADD_FN__({
          file: url,
          url,
          name: label,
          title: label,
          meta: meta || {}
        });
        added = true;
      } catch {}
    } else {
      try { window.open(url, "_blank", "noopener"); } catch {}
      return false;
    }

    if (!added) return false;

    // Give UI time to render
    await sleep(80);

    // First: exact url match
    let ok = await playExactByUrl(url);
    if (ok) return true;

    // Fallback: click play in a row that contains uuid/label
    const r = findRowByTextFallback(uuidForFallback, label);
    if (r && clickPlayInRow(r)) return true;

    return false;
  }

  // -----------------------------
  // "All Known" view (browse) — looks/behaves like your playlist browse
  // -----------------------------
  function clean(s) { return String(s || "").trim(); }

  function normalizeAllKnownItems(data) {
    const d = data && typeof data === "object" ? data : {};
    const arr =
      (Array.isArray(d.result?.songs) && d.result.songs) ||
      (Array.isArray(d.songs) && d.songs) ||
      [];

    return arr.map((x) => {
      const obj = x && typeof x === "object" ? x : {};
      const uuid = clean(obj.uuid || obj.id || "");
      if (!uuid) return null;

      const artist = clean(obj.artist || obj.author || obj.user || obj.username || "");
      const title = clean(obj.title || obj.name || "");
      const displayTitle =
        (artist && title) ? `${artist} - ${title}` :
        (title || artist || `Clip ${uuid.slice(0, 8)}`);

      // match your Producer patch (.m4a)
      const audio = CFG.clipBaseUrl + uuid + ".m4a";
      return { uuid, title: displayTitle, audio };
    }).filter(Boolean);
  }

  function getParts() {
    const overlay = document.getElementById(CFG.overlayId);
    if (!overlay) return null;

    const list = overlay.querySelector("#" + CFG.listId);
    const crumb = overlay.querySelector("#" + CFG.crumbId);
    const msg = overlay.querySelector("#" + CFG.msgId);
    const err = overlay.querySelector("#" + CFG.errId);
    const modal = overlay.querySelector("#" + CFG.modalId);

    if (!list || !crumb) return null;
    return { overlay, list, crumb, msg, err, modal };
  }

  let _saved = null; // { crumbText, nodes[] }

  function saveCurrentView(parts) {
    if (_saved || !parts) return;
    const nodes = Array.from(parts.list.childNodes);
    _saved = { crumbText: String(parts.crumb.textContent || ""), nodes };
    for (const n of nodes) parts.list.removeChild(n);
  }

  function restoreView(parts) {
    if (!parts || !_saved) return;
    while (parts.list.firstChild) parts.list.removeChild(parts.list.firstChild);
    for (const n of _saved.nodes) parts.list.appendChild(n);
    parts.crumb.textContent = _saved.crumbText || "Mounts";
    if (parts.msg) parts.msg.textContent = "";
    if (parts.err) parts.err.textContent = "";
    _saved = null;
  }

  async function openAllKnownView() {
    const parts = getParts();
    if (!parts) return;

    // If mount modal is open, close it
    if (parts.modal) parts.modal.style.display = "none";
    if (parts.err) parts.err.textContent = "";

    saveCurrentView(parts);

    parts.crumb.textContent = "All Known";
    if (parts.msg) parts.msg.textContent = "Loading…";

    try {
      const data = await fetchAllKnown();
      const items = normalizeAllKnownItems(data);

      while (parts.list.firstChild) parts.list.removeChild(parts.list.firstChild);

      parts.list.appendChild(renderRow({
        icon: "⬅️",
        text: "Back to Mounts",
        subtext: "",
        onClick: () => restoreView(parts)
      }));

      parts.list.appendChild(renderRow({
        icon: "🔄",
        text: "Refresh All Known",
        subtext: resolveAllKnownUrl(),
        onClick: async () => {
          if (parts.msg) parts.msg.textContent = "Loading…";
          // re-open reloads list (keeps saved snapshot)
          try { await openAllKnownView(); } catch {}
        }
      }));

      parts.list.appendChild(renderRow({
        icon: "ℹ️",
        text: `Tracks: ${items.length}`,
        subtext: "Click: add + exact-play in main Song List",
        onClick: () => {}
      }));

      if (!items.length) {
        parts.list.appendChild(renderRow({
          icon: "⚠️",
          text: "No songs returned",
          subtext: "Your /producer/all endpoint returned empty.",
          onClick: () => {}
        }));
      } else {
        for (const it of items) {
          parts.list.appendChild(renderRow({
            icon: "▶️",
            text: it.title,
            subtext: it.uuid,
            onClick: async () => {
              const meta = {
                source: "producer_all_known",
                clip_uuid: it.uuid
              };
              if (parts.msg) parts.msg.textContent = "Adding…";
              const ok = await addToSongsListAndPlay(it.audio, it.title, meta, it.uuid);
              if (parts.msg) parts.msg.textContent = ok ? "Playing" : "Added (couldn’t auto-play)";
              setTimeout(() => { if (parts.msg) parts.msg.textContent = ""; }, 1100);
            }
          }));
        }
      }

    } catch (e) {
      // restore mounts view on failure
      if (parts.err) parts.err.textContent = String(e && e.message ? e.message : e);
      restoreView(parts);
    } finally {
      if (parts.msg) parts.msg.textContent = "";
    }
  }

  // -----------------------------
  // Inject "All Known" row UNDER "Recommended playlists" in MAIN list
  // -----------------------------
  function cleanupOldButtons(overlay) {
    try {
      // kill old versions if you still have them pasted
      overlay.querySelectorAll('[data-ncz-producer-all-known-v1="1"]').forEach(el => el.remove());
      overlay.querySelectorAll('[data-ncz-producer-all-known-mounts-v1="1"]').forEach(el => el.remove());
      overlay.querySelectorAll('[data-ncz-producer-all-known-under-rec-v1="1"]').forEach(el => el.remove());
    } catch {}
  }

  function findRecommendedRow(listEl) {
    const btns = Array.from(listEl.querySelectorAll("button"));
    // match the mounts list row text
    return btns.find(b => (String(b.textContent || "").toLowerCase().includes("recommended playlists")));
  }

  function injectAllKnownRow() {
    const parts = getParts();
    if (!parts) return false;

    cleanupOldButtons(parts.overlay);

    // only inject when we are on mounts view (crumb says Mounts)
    const crumb = String(parts.crumb.textContent || "").trim().toLowerCase();
    if (crumb && crumb !== "mounts") return false;

    // already inserted?
    if (parts.list.querySelector(`button[${ROW_ATTR}="1"]`)) return true;

    const recRow = findRecommendedRow(parts.list);
    if (!recRow) return false; // mounts list not ready yet

    const row = renderRow({
      icon: "🎧",
      text: "All Known",
      subtext: "Master list (everything we’ve scraped)",
      onClick: openAllKnownView
    });
    row.setAttribute(ROW_ATTR, "1");

    // insert directly under Recommended row
    if (recRow.nextSibling) parts.list.insertBefore(row, recRow.nextSibling);
    else parts.list.appendChild(row);

    return true;
  }

  function hookOverlay() {
    const parts = getParts();
    if (!parts) return false;

    // keep re-injecting if mounts rerenders
    const obs = new MutationObserver(() => injectAllKnownRow());
    obs.observe(parts.list, { childList: true, subtree: false });

    // initial
    injectAllKnownRow();
    return true;
  }

  // overlay created only when user opens Producer browser
  const bodyObs = new MutationObserver(() => {
    hookOverlay();
  });
  bodyObs.observe(document.documentElement || document.body, { childList: true, subtree: true });

  // retry briefly (for slow loads)
  (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (hookOverlay()) break;
      await sleep(250);
    }
  })();

})();



























// ✅ NCZ PATCH: "Add all songs" as a FAKE LIST ITEM row (External + Suno + Producer) — SAFE V4
// - NO header modifications
// - NO MutationObserver
// - Adds ONE extra row inside each explorer list
// - External: adds all playable ▶️ items currently visible in CURRENT directory list
// - Suno: fetches FULL mounted playlist from /sunoPlaylist and adds all audio_url tracks
// - Producer: adds all ▶️ tracks currently visible in the Producer browser list (playlist OR All Known view)
// - Uses your existing addSongToList() and does NOT auto-play (same behavior as your other Add All)
//
// Paste AFTER the explorer scripts.

(() => {
  "use strict";
  if (window.__NCZ_ADDALL_FAKE_ITEM_V4__) return;
  window.__NCZ_ADDALL_FAKE_ITEM_V4__ = true;

  const EXT = {
    overlayId: "__ncz_ext_url_overlay__",
    listId: "__ncz_ext_list__",
    msgId: "__ncz_ext_msg__",
    rowId: "__ncz_ext_addall_row__",
  };

  const SUNO = {
    overlayId: "__ncz_suno_pl_overlay__",
    listId: "__ncz_suno_pl_list__",
    msgId: "__ncz_suno_pl_msg__",
    crumbId: "__ncz_suno_pl_crumb__",
    mountsLsKey: "NCZ_SUNO_PLAYLIST_MOUNTS_V1",
    rowId: "__ncz_suno_addall_row__",
  };

  const PRO = {
    overlayId: "__ncz_producer_pl_overlay__",
    listId: "__ncz_producer_pl_list__",
    msgId: "__ncz_producer_pl_msg__",
    crumbId: "__ncz_producer_pl_crumb__",
    rowId: "__ncz_producer_addall_row__",
    clipBaseUrl: "https://storage.googleapis.com/producer-app-public/clips/",
  };

  const SUNO_ENDPOINT =
    (location.pathname === "/ace" || location.pathname.startsWith("/ace/"))
      ? "/ace/sunoPlaylist"
      : "/sunoPlaylist";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el){
    if (!el || el.nodeType !== 1) return false;
    if (el.style && el.style.display === "none") return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
    } catch {}
    return true;
  }

  function stopAll(e){
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
  }

  function escapeHtml(s){
    return String(s || "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  // Build a row that visually matches your explorer renderRow()
  function buildFakeRow({ id, icon, text, subtext }) {
    const row = document.createElement("button");
    row.type = "button";
    row.id = id;
    row.setAttribute("data-ncz-fakeitem", "1");
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
    `;
    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${escapeHtml(icon || "")}</div>
      <div style="flex:1;">
        <div style="font-weight:800; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px;">${escapeHtml(subtext)}</div>` : ""}
      </div>
    `;
    return row;
  }

  function iconFromRow(btn){
    try {
      const iconDiv = btn.querySelector('div[style*="width:22px"]') || btn.firstElementChild;
      return (iconDiv?.textContent || "").trim();
    } catch { return ""; }
  }

  function titleFromRow(btn){
    try {
      const main = btn.children && btn.children[1];
      const t = main && main.children && main.children[0];
      return (t?.textContent || "").trim();
    } catch { return ""; }
  }

  function subtextFromRow(btn){
    try {
      const main = btn.children && btn.children[1];
      const sub = main && main.children && main.children[1];
      return (sub?.textContent || "").trim();
    } catch { return ""; }
  }

  function looksPlayable(u){
    const s = String(u || "").toLowerCase();
    return (
      s.endsWith(".mp3") || s.includes(".mp3?") ||
      s.endsWith(".m4a") || s.includes(".m4a?") ||
      s.endsWith(".wav") || s.endsWith(".ogg") ||
      s.endsWith(".flac") || s.endsWith(".aac")
    );
  }

  function existingUrlSet(){
    const s = new Set();
    try {
      const arr = Array.isArray(window.songs) ? window.songs : [];
      for (const it of arr) {
        const u = it && (it.url || it.file || it.href || it.src);
        if (u) s.add(String(u));
      }
    } catch {}
    return s;
  }

  function setMsg(msgEl, s){
    if (!msgEl) return;
    msgEl.textContent = String(s || "");
  }

  async function addMany(items, msgEl, btnEl){
    // items: [{url,label,meta}]
    if (typeof window.addSongToList !== "function") {
      setMsg(msgEl, "addSongToList() missing.");
      setTimeout(() => setMsg(msgEl, ""), 1400);
      return;
    }

    items = Array.isArray(items) ? items : [];
    if (!items.length) {
      setMsg(msgEl, "No songs found here.");
      setTimeout(() => setMsg(msgEl, ""), 1200);
      return;
    }

    const existed = existingUrlSet();
    let added=0, skipped=0, failed=0;

    const oldTxt = btnEl ? (btnEl.textContent || "") : "";
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "Adding…";
    }
    setMsg(msgEl, `Adding ${items.length}…`);

    // add bottom->top so prepend-style UIs keep order
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i] || {};
      const url = String(it.url || "").trim();
      if (!url) { failed++; continue; }
      if (existed.has(url)) { skipped++; continue; }

      try {
        window.addSongToList(url, {
          label: String(it.label || ""),
          createdAt: (() => { try { return new Date().toLocaleString(); } catch { return ""; } })(),
          meta: (it.meta && typeof it.meta === "object") ? it.meta : {},
          downloadName: String(it.label || ""),
          serverItem: it.meta || null,
        });
        existed.add(url);
        added++;
      } catch {
        failed++;
      }

      if ((items.length - i) % 40 === 0) await sleep(0);
    }

    setMsg(
      msgEl,
      `Added ${added}` +
      (skipped ? ` (skipped ${skipped})` : "") +
      (failed ? ` (failed ${failed})` : "") +
      `.`
    );
    setTimeout(() => setMsg(msgEl, ""), 1600);

    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = oldTxt || "Add all songs";
    }
  }

  // ============================================================
  // External: collect from CURRENT DOM list (▶️ rows)
  // ============================================================
  function collectExternalVisible(listEl){
    const btns = Array.from(listEl.querySelectorAll("button"));
    const out = [];
    const seen = new Set();

    for (const b of btns) {
      if (b.id === EXT.rowId) continue;

      const ic = iconFromRow(b);
      if (!ic.includes("▶")) continue;

      const url = subtextFromRow(b);
      if (!url) continue;
      if (!/^https?:\/\//i.test(url) && !looksPlayable(url)) continue;

      const label = titleFromRow(b) || (String(url).split("/").pop() || "track");
      const key = String(url).trim();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ url: key, label, meta: { source: "external_browser" } });
    }
    return out;
  }

  function findInsertAfterNavButtons(listEl, rowId){
    // Put add-all row AFTER Back/Up rows if present.
    const btns = Array.from(listEl.querySelectorAll("button"));
    let lastNav = null;

    for (const b of btns) {
      if (b.id === rowId) continue;
      const ic = iconFromRow(b);
      const t = (b.textContent || "").toLowerCase();

      const isNav =
        ic.includes("⬅") || ic.includes("⬆") ||
        t.includes("back to mounts") ||
        t.trim() === "up";

      if (isNav) lastNav = b;
      else break;
    }
    return lastNav;
  }

  function ensureExternalAddAllRow(){
    const ov = document.getElementById(EXT.overlayId);
    if (!ov || !isVisible(ov)) return;

    const list = ov.querySelector("#" + EXT.listId);
    if (!list) return;

    if (list.querySelector("#" + EXT.rowId)) return;

    const msgEl = ov.querySelector("#" + EXT.msgId);

    const row = buildFakeRow({
      id: EXT.rowId,
      icon: "📥",
      text: "Add all songs in this folder",
      subtext: "Adds all visible playable tracks to Song List",
    });

    row.addEventListener("click", async (e) => {
      stopAll(e);
      const items = collectExternalVisible(list);
      await addMany(items, msgEl, row);
    }, true);

    const after = findInsertAfterNavButtons(list, EXT.rowId);
    if (after && after.parentElement === list) after.insertAdjacentElement("afterend", row);
    else list.prepend(row);
  }

  // ============================================================
  // Suno: fetch ALL from server (playlist)
  // ============================================================
  function extractUuid(s){
    const m = String(s || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : "";
  }

  function getMountedSunoUrl(){
    const ov = document.getElementById(SUNO.overlayId);
    if (!ov) return "";

    const crumb = ov.querySelector("#" + SUNO.crumbId);
    const crumbText = (crumb && crumb.textContent) ? crumb.textContent.trim() : "";
    if (!crumbText) return "";

    // 1) exact label match from mounts LS
    try {
      const raw = localStorage.getItem(SUNO.mountsLsKey);
      const mounts = raw ? JSON.parse(raw) : [];
      if (Array.isArray(mounts)) {
        const hit = mounts.find(m => m && String(m.label || "").trim() === crumbText);
        if (hit && hit.url) return String(hit.url).trim();
      }
    } catch {}

    // 2) fallback: if crumb contains UUID, just use that
    const uuid = extractUuid(crumbText);
    return uuid || "";
  }

  async function fetchSunoPlaylistAll(mountUrl){
    const res = await fetch(SUNO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: mountUrl, playlist_url: mountUrl, playlist: mountUrl })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`sunoPlaylist HTTP ${res.status}${t ? `: ${t.slice(0,200)}` : ""}`);
    }

    const d = await res.json().catch(() => ({}));
    const data = (d && typeof d === "object") ? d : {};

    const items =
      (Array.isArray(data.items) && data.items) ||
      (Array.isArray(data.data?.items) && data.data.items) ||
      [];

    const rows =
      items.length ? null :
      ((Array.isArray(data.playlist_clips) && data.playlist_clips) ||
       (Array.isArray(data.data?.playlist_clips) && data.data.playlist_clips) ||
       []);

    const out = [];
    const seen = new Set();

    if (items.length) {
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const url = String(it.audio_url || it.audioUrl || it.audio || it.file || it.url || "").trim();
        if (!url) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const title = String(it.title || it.name || it.caption || "").trim();
        out.push({ url, label: title, meta: { source: "suno_playlist", title } });
      }
    } else if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const clip = (row.clip && typeof row.clip === "object") ? row.clip : row;
        const url = String(clip.audio_url || clip.audioUrl || clip.audio || clip.file || clip.url || "").trim();
        if (!url) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const title = String(clip.title || clip.name || clip.caption || "").trim();
        out.push({ url, label: title, meta: { source: "suno_playlist", title } });
      }
    }

    return out;
  }

  function ensureSunoAddAllRow(){
    const ov = document.getElementById(SUNO.overlayId);
    if (!ov || !isVisible(ov)) return;

    const list = ov.querySelector("#" + SUNO.listId);
    if (!list) return;

    if (list.querySelector("#" + SUNO.rowId)) return;

    const msgEl = ov.querySelector("#" + SUNO.msgId);

    const row = buildFakeRow({
      id: SUNO.rowId,
      icon: "📥",
      text: "Add all songs in this playlist",
      subtext: "Fetches from server and adds every track to Song List",
    });

    row.addEventListener("click", async (e) => {
      stopAll(e);

      const mountUrl = getMountedSunoUrl();
      if (!mountUrl) {
        setMsg(msgEl, "No mounted playlist detected.");
        setTimeout(() => setMsg(msgEl, ""), 1400);
        return;
      }

      row.disabled = true;
      setMsg(msgEl, "Loading playlist…");
      try {
        const items = await fetchSunoPlaylistAll(mountUrl);
        row.disabled = false;
        setMsg(msgEl, "");
        await addMany(items, msgEl, row);
      } catch (err) {
        row.disabled = false;
        setMsg(msgEl, String(err && err.message ? err.message : err));
        setTimeout(() => setMsg(msgEl, ""), 1800);
      }
    }, true);

    list.prepend(row);
  }

  // ============================================================
  // Producer: collect from CURRENT Producer overlay list (▶️ rows)
  // ============================================================
  function extractProducerUuid(s){
    const m = String(s || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0].toLowerCase() : "";
  }

  function collectProducerVisible(listEl){
    const btns = Array.from(listEl.querySelectorAll("button"));
    const out = [];
    const seen = new Set();

    for (const b of btns) {
      if (b.id === PRO.rowId) continue;

      const ic = iconFromRow(b);
      if (!ic.includes("▶")) continue;

      // Producer track row subtext is UUID in your browser UI
      const uuid = extractProducerUuid(subtextFromRow(b));
      if (!uuid) continue;

      const url = PRO.clipBaseUrl + uuid + ".m4a";
      if (seen.has(url)) continue;
      seen.add(url);

      const label = titleFromRow(b) || ("Clip " + uuid.slice(0, 8));
      out.push({
        url,
        label,
        meta: { source: "producer_browser", clip_uuid: uuid }
      });
    }

    return out;
  }

  function findInsertAfterProducerHeaderRows(listEl){
    // For Producer browse screens, header rows are: Back ⬅️, Refresh 🔄, Tracks ℹ️
    const btns = Array.from(listEl.querySelectorAll("button"));
    let lastHeader = null;

    for (const b of btns) {
      if (b.id === PRO.rowId) continue;

      const ic = iconFromRow(b);
      const t = (b.textContent || "").toLowerCase();

      const isHeader =
        ic.includes("⬅") || ic.includes("🔄") || ic.includes("ℹ") ||
        t.includes("back to mounts") ||
        t.includes("refresh") ||
        t.includes("tracks:");

      if (isHeader) lastHeader = b;
      else break; // header rows are at the top
    }
    return lastHeader;
  }

  function ensureProducerAddAllRow(){
    const ov = document.getElementById(PRO.overlayId);
    if (!ov || !isVisible(ov)) return;

    const list = ov.querySelector("#" + PRO.listId);
    if (!list) return;

    if (list.querySelector("#" + PRO.rowId)) return;

    const msgEl = ov.querySelector("#" + PRO.msgId);
    const crumbEl = ov.querySelector("#" + PRO.crumbId);
    const crumb = (crumbEl && crumbEl.textContent) ? crumbEl.textContent.trim() : "";

    const row = buildFakeRow({
      id: PRO.rowId,
      icon: "📥",
      text: "Add all songs in this list",
      subtext: crumb ? `Adds all visible tracks from: ${crumb}` : "Adds all visible tracks to Song List",
    });

    row.addEventListener("click", async (e) => {
      stopAll(e);
      const items = collectProducerVisible(list).map(it => ({
        url: it.url,
        label: it.label,
        meta: Object.assign({}, it.meta, { view: crumb || "" })
      }));
      await addMany(items, msgEl, row);
    }, true);

    const after = findInsertAfterProducerHeaderRows(list);
    if (after && after.parentElement === list) after.insertAdjacentElement("afterend", row);
    else list.prepend(row);
  }

  // ============================================================
  // Polling only while overlays exist
  // ============================================================
  setInterval(() => {
    ensureExternalAddAllRow();
    ensureSunoAddAllRow();
    ensureProducerAddAllRow();
  }, 350);
})();



































// ✅ NCZ PATCH: Suno Playlist Browser — "All Suno" MASTER row UNDER "Recommended playlists" (MAIN LIST) (V1)
// - Puts "All Suno" as its own row in the MAIN Suno overlay list, directly UNDER "Recommended playlists"
// - NOT inside the Recommended dropdown, NOT stored as a mount
// - Click "All Suno" -> loads GET /ace/suno/all (or /suno/all) and shows a browse view in the SAME overlay list
// - Track click = add + EXACT-PLAY (same behavior style as your other browsers)
// - IMPORTANT: /suno/all should return result.items[] with audio_url (or this patch will show a warning)
//
// Paste AFTER your existing Suno Playlist Browser patch.

(() => {
  "use strict";
  if (window.__NCZ_SUNO_ALL_KNOWN_UNDER_RECOMMENDED_V1__) return;
  window.__NCZ_SUNO_ALL_KNOWN_UNDER_RECOMMENDED_V1__ = true;

  const CFG = {
    // If blank, auto based on /ace prefix:
    //   /ace -> /ace/suno/all
    //   else -> /suno/all
    allKnownUrl: "",

    // Suno overlay ids (match your other Suno patches)
    overlayId: "__ncz_suno_pl_overlay__",
    listId: "__ncz_suno_pl_list__",
    crumbId: "__ncz_suno_pl_crumb__",
    msgId: "__ncz_suno_pl_msg__",

    // optional (some versions have these; patch tolerates missing)
    errId: "__ncz_suno_pl_err__",
    modalId: "__ncz_suno_pl_modal__",

    // Main Song List DOM
    mainSongListId: "songList",

    // Exact-play timing
    findPlay: { timeoutMs: 6500, pollMs: 140 },
  };

  const ROW_ATTR = "data-ncz-suno-all-known-under-recommended-v1";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function resolveAllKnownUrl() {
    const explicit = String(CFG.allKnownUrl || "").trim();
    if (explicit) return explicit;

    const isAce = (location.pathname === "/ace" || location.pathname.startsWith("/ace/"));
    return isAce ? "/ace/suno/all" : "/suno/all";
  }

  async function fetchAllKnown() {
    const url = resolveAllKnownUrl();
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`AllSuno HTTP ${res.status}${t ? `: ${t.slice(0, 240)}` : ""}`);
    }
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function clickReal(el) {
    try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch {}
    try { el.click(); } catch {}
  }

  function nowIso() {
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function urlBasename(u) {
    u = String(u || "").trim();
    if (!u) return "";
    try {
      const U = new URL(u, location.origin);
      return decodeURIComponent((U.pathname.split("/").filter(Boolean).pop() || "").trim());
    } catch {
      const noQ = u.split("?")[0].split("#")[0];
      const last = noQ.split("/").filter(Boolean).pop() || "";
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function normKey(u) {
    u = String(u || "").trim();
    if (!u) return "";
    return u.split("#")[0].split("?")[0].trim();
  }

  function candidatesFromUrl(u) {
    const out = [];
    const push = (x) => {
      x = String(x || "").trim();
      if (!x) return;
      out.push(x);
      out.push(normKey(x));
      try {
        const U = new URL(x, location.origin);
        out.push(U.toString());
        out.push(normKey(U.toString()));
        out.push(U.pathname);
      } catch {}
    };
    push(u);

    const bn = urlBasename(u);
    if (bn) out.push(bn);

    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const k = String(s).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      uniq.push(k);
    }
    return uniq;
  }

  function urlsMatch(a, b) {
    const A = candidatesFromUrl(a);
    const B = candidatesFromUrl(b);
    for (const x of A) {
      for (const y of B) {
        if (!x || !y) continue;
        if (x === y) return true;
        if (x.length > 6 && y.length > 6) {
          if (x.endsWith(y) || y.endsWith(x)) return true;
        }
        const xb = urlBasename(x).toLowerCase();
        const yb = urlBasename(y).toLowerCase();
        if (xb && yb && xb === yb) return true;
      }
    }
    return false;
  }

  // -----------------------------
  // Row style: match your explorers
  // -----------------------------
  function renderRow({ icon, text, subtext, right, onClick }) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
    `;
    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${escapeHtml(icon || "")}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(subtext)}</div>` : ""}
      </div>
      ${right || ""}
    `;
    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      onClick && onClick(e);
    }, true);
    return row;
  }

  // -----------------------------
  // Exact play (same approach you use elsewhere)
  // -----------------------------
  function getSongUrlFromObj(it) {
    if (!it) return "";
    if (typeof it === "string") return it;
    if (typeof it !== "object") return "";
    return String(it.url || it.file || it.href || it.src || it.downloadName || "").trim();
  }

  function findIndexInWindowSongs(url) {
    const songs = Array.isArray(window.songs) ? window.songs : null;
    if (!songs) return -1;

    for (let i = 0; i < songs.length; i++) {
      const it = songs[i];
      const candidates = [];

      candidates.push(getSongUrlFromObj(it));

      if (it && typeof it === "object") {
        try { if (it.serverItem && typeof it.serverItem === "object") candidates.push(getSongUrlFromObj(it.serverItem)); } catch {}
        try { if (it.meta && typeof it.meta === "object") candidates.push(getSongUrlFromObj(it.meta)); } catch {}

        for (const k of Object.keys(it)) {
          const v = it[k];
          if (typeof v === "string" && (v.includes("://") || /\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(v))) {
            candidates.push(v);
          }
        }
      }

      for (const c of candidates) {
        if (c && urlsMatch(c, url)) return i;
      }
    }
    return -1;
  }

  function findRowInDomByUrl(url) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;

    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    if (!rows.length) return null;

    for (const r of rows) {
      const links = Array.from(r.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = String(a.getAttribute("href") || "").trim();
        if (h && urlsMatch(h, url)) return r;
      }
    }

    const bn = urlBasename(url).toLowerCase();
    const key = normKey(url).toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (key && txt.includes(key)) return r;
      if (bn && txt.includes(bn)) return r;
    }
    return null;
  }

  function clickPlayInRow(row) {
    if (!row) return false;

    const aPlay = Array.from(row.querySelectorAll("a"))
      .find(a => isVisible(a) && (String(a.textContent || "").trim().toLowerCase() === "play"));
    if (aPlay) { clickReal(aPlay); return true; }

    const any = Array.from(row.querySelectorAll("a,button"))
      .find(el => isVisible(el) && String(el.getAttribute("title") || "").toLowerCase().includes("play"));
    if (any) { clickReal(any); return true; }

    return false;
  }

  async function playExactByUrl(url) {
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.findPlay.timeoutMs) {
      const idx = findIndexInWindowSongs(url);
      if (idx >= 0) {
        const root = document.getElementById(CFG.mainSongListId);
        if (root) {
          const row = root.querySelector(`div[data-song-index="${idx}"]`);
          if (row && clickPlayInRow(row)) return true;
        }
      }

      const row2 = findRowInDomByUrl(url);
      if (row2 && clickPlayInRow(row2)) return true;

      await sleep(CFG.findPlay.pollMs);
    }
    return false;
  }

  function findRowByTextFallback(uuid, label) {
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;
    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    const u = String(uuid || "").toLowerCase();
    const l = String(label || "").toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (u && txt.includes(u)) return r;
      if (l && txt.includes(l)) return r;
    }
    return null;
  }

  async function addToSongsListAndPlay(url, title, meta, uuidForFallback) {
    url = String(url || "").trim();
    if (!url) return false;

    const label = String(title || "").trim() || urlBasename(url) || "Suno Track";
    const createdAt = nowIso();

    let added = false;

    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(url, {
          label,
          createdAt,
          meta: (meta && typeof meta === "object") ? meta : {},
          downloadName: label,
          serverItem: meta || null
        });
        added = true;
      } catch {}
    } else if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      try {
        window.__NCZ_PLAYLIST_ADD_FN__({
          file: url,
          url,
          name: label,
          title: label,
          meta: meta || {}
        });
        added = true;
      } catch {}
    } else {
      try { window.open(url, "_blank", "noopener"); } catch {}
      return false;
    }

    if (!added) return false;

    await sleep(80);

    let ok = await playExactByUrl(url);
    if (ok) return true;

    const r = findRowByTextFallback(uuidForFallback, label);
    if (r && clickPlayInRow(r)) return true;

    return false;
  }

  // -----------------------------
  // Normalize All Suno response
  // -----------------------------
  function clean(s) { return String(s || "").trim(); }

  function normalizeAllSunoItems(data) {
    const d = data && typeof data === "object" ? data : {};
    const res = d.result && typeof d.result === "object" ? d.result : d;

    // Prefer items[] with audio_url (recommended)
    const arrItems =
      (Array.isArray(res.items) && res.items) ||
      (Array.isArray(d.items) && d.items) ||
      null;

    // Fallback songs[] (uuid/title/artist) — NOT playable unless your server includes audio_url somewhere
    const arrSongs =
      (Array.isArray(res.songs) && res.songs) ||
      (Array.isArray(d.songs) && d.songs) ||
      [];

    const out = [];

    if (Array.isArray(arrItems)) {
      for (const it of arrItems) {
        if (!it || typeof it !== "object") continue;
        const uuid = clean(it.id || it.uuid || it.clip_id || it.song_id || "");
        if (!uuid) continue;

        const title = clean(it.title || it.name || "");
        const artist = clean(it.author || it.artist || it.user || it.username || "");
        const audio = clean(it.audio_url || it.audioUrl || it.audio || it.file || it.url || "");

        const displayTitle =
          (artist && title) ? `${artist} - ${title}` :
          (title || artist || `Suno ${uuid.slice(0, 8)}`);

        out.push({ uuid, title: displayTitle, audio });
      }
      return out;
    }

    for (const it of arrSongs) {
      if (!it || typeof it !== "object") continue;
      const uuid = clean(it.uuid || it.id || "");
      if (!uuid) continue;
      const title = clean(it.title || it.name || "");
      const artist = clean(it.artist || it.author || it.user || it.username || "");
      const displayTitle =
        (artist && title) ? `${artist} - ${title}` :
        (title || artist || `Suno ${uuid.slice(0, 8)}`);
      out.push({ uuid, title: displayTitle, audio: "" });
    }
    return out;
  }

  // -----------------------------
  // Overlay navigation
  // -----------------------------
  function getParts() {
    const overlay = document.getElementById(CFG.overlayId);
    if (!overlay) return null;

    const list = overlay.querySelector("#" + CFG.listId);
    const crumb = overlay.querySelector("#" + CFG.crumbId);
    const msg = overlay.querySelector("#" + CFG.msgId);
    const err = overlay.querySelector("#" + CFG.errId);
    const modal = overlay.querySelector("#" + CFG.modalId);

    if (!list || !crumb) return null;
    return { overlay, list, crumb, msg, err, modal };
  }

  let _saved = null; // { crumbText, nodes[] }

  function saveCurrentView(parts) {
    if (_saved || !parts) return;
    const nodes = Array.from(parts.list.childNodes);
    _saved = { crumbText: String(parts.crumb.textContent || ""), nodes };
    for (const n of nodes) parts.list.removeChild(n);
  }

  function restoreView(parts) {
    if (!parts || !_saved) return;
    while (parts.list.firstChild) parts.list.removeChild(parts.list.firstChild);
    for (const n of _saved.nodes) parts.list.appendChild(n);
    parts.crumb.textContent = _saved.crumbText || "Mounts";
    if (parts.msg) parts.msg.textContent = "";
    if (parts.err) parts.err.textContent = "";
    _saved = null;
  }

  async function openAllSunoView() {
    const parts = getParts();
    if (!parts) return;

    // close modal if present
    if (parts.modal) parts.modal.style.display = "none";
    if (parts.err) parts.err.textContent = "";

    saveCurrentView(parts);

    parts.crumb.textContent = "All Suno";
    if (parts.msg) parts.msg.textContent = "Loading…";

    try {
      const data = await fetchAllKnown();
      const items = normalizeAllSunoItems(data);

      while (parts.list.firstChild) parts.list.removeChild(parts.list.firstChild);

      parts.list.appendChild(renderRow({
        icon: "⬅️",
        text: "Back to Mounts",
        subtext: "",
        onClick: () => restoreView(parts)
      }));

      parts.list.appendChild(renderRow({
        icon: "🔄",
        text: "Refresh All Suno",
        subtext: resolveAllKnownUrl(),
        onClick: async () => {
          if (parts.msg) parts.msg.textContent = "Loading…";
          try { await openAllSunoView(); } catch {}
        }
      }));

      parts.list.appendChild(renderRow({
        icon: "ℹ️",
        text: `Tracks: ${items.length}`,
        subtext: "Click: add + exact-play in main Song List",
        onClick: () => {}
      }));

      if (!items.length) {
        parts.list.appendChild(renderRow({
          icon: "⚠️",
          text: "No songs returned",
          subtext: "Your /suno/all endpoint returned empty.",
          onClick: () => {}
        }));
      } else {
        // If server didn't include audio_url, warn once
        const missingAudio = items.some(x => !String(x.audio || "").trim());
        if (missingAudio) {
          parts.list.appendChild(renderRow({
            icon: "⚠️",
            text: "Server missing audio_url",
            subtext: "Update /suno/all to return result.items[] with audio_url so tracks can play.",
            onClick: () => {}
          }));
        }

        for (const it of items) {
          parts.list.appendChild(renderRow({
            icon: "▶️",
            text: it.title,
            subtext: it.uuid,
            onClick: async () => {
              const audio = String(it.audio || "").trim();
              if (!audio) {
                if (parts.msg) parts.msg.textContent = "No audio_url for this track.";
                setTimeout(() => { if (parts.msg) parts.msg.textContent = ""; }, 1200);
                return;
              }
              const meta = { source: "suno_all_known", suno_uuid: it.uuid };
              if (parts.msg) parts.msg.textContent = "Adding…";
              const ok = await addToSongsListAndPlay(audio, it.title, meta, it.uuid);
              if (parts.msg) parts.msg.textContent = ok ? "Playing" : "Added (couldn’t auto-play)";
              setTimeout(() => { if (parts.msg) parts.msg.textContent = ""; }, 1100);
            }
          }));
        }
      }

    } catch (e) {
      if (parts.err) parts.err.textContent = String(e && e.message ? e.message : e);
      restoreView(parts);
    } finally {
      if (parts.msg) parts.msg.textContent = "";
    }
  }

  // -----------------------------
  // Inject row UNDER "Recommended playlists" on Mounts view
  // -----------------------------
  function findRecommendedRow(listEl) {
    const btns = Array.from(listEl.querySelectorAll("button"));
    return btns.find(b => {
      const t = String(b.textContent || "").toLowerCase();
      return t.includes("recommended") && t.includes("playlist");
    });
  }

  function injectAllSunoRow() {
    const parts = getParts();
    if (!parts) return false;

    const crumb = String(parts.crumb.textContent || "").trim().toLowerCase();
    if (crumb && crumb !== "mounts") return false;

    if (parts.list.querySelector(`button[${ROW_ATTR}="1"]`)) return true;

    const recRow = findRecommendedRow(parts.list);
    if (!recRow) return false;

    const row = renderRow({
      icon: "🎵",
      text: "All Suno",
      subtext: "Master list (everything we’ve seen)",
      onClick: openAllSunoView
    });
    row.setAttribute(ROW_ATTR, "1");

    if (recRow.nextSibling) parts.list.insertBefore(row, recRow.nextSibling);
    else parts.list.appendChild(row);

    return true;
  }

  function hookOverlay() {
    const parts = getParts();
    if (!parts) return false;

    // keep re-injecting if mounts rerenders
    const obs = new MutationObserver(() => injectAllSunoRow());
    obs.observe(parts.list, { childList: true, subtree: false });

    injectAllSunoRow();
    return true;
  }

  // overlay created only when user opens Suno browser
  const bodyObs = new MutationObserver(() => { hookOverlay(); });
  bodyObs.observe(document.documentElement || document.body, { childList: true, subtree: true });

  (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (hookOverlay()) break;
      await sleep(250);
    }
  })();

})();




// ✅ NCZ PATCH: SunoPlaylist response compat shim (adds legacy playlist_clips from result.items) (V1)
// Fixes "No clips returned" in mounted playlists after server switched to result.items/result.songs shape.
// Paste AFTER your existing Suno Playlist Browser patches.
(() => {
  "use strict";
  if (window.__NCZ_SUNO_PLAYLIST_COMPAT_SHIM_V1__) return;
  window.__NCZ_SUNO_PLAYLIST_COMPAT_SHIM_V1__ = true;

  const CFG = {
    debug: true, // set false to silence logs
  };

  const log = (...a) => { if (CFG.debug) console.log("[NCZ SunoCompat]", ...a); };

  const origFetch = window.fetch;
  if (typeof origFetch !== "function") return;

  function isSunoPlaylistReq(input) {
    try {
      const url = (typeof input === "string") ? input : (input && input.url) ? input.url : "";
      if (!url) return false;
      const U = new URL(url, location.origin);
      const p = U.pathname || "";
      return p === "/sunoPlaylist" || p === "/ace/sunoPlaylist" || p.endsWith("/sunoPlaylist");
    } catch {
      return false;
    }
  }

  function cleanStr(v) {
    return (typeof v === "string") ? v.trim() : (v == null ? "" : String(v).trim());
  }

  function ensureLegacyShape(obj) {
    if (!obj || typeof obj !== "object") return obj;

    const result = (obj.result && typeof obj.result === "object") ? obj.result : null;
    if (!result) return obj;

    // already has clips? leave it
    const existingTop = Array.isArray(obj.playlist_clips) ? obj.playlist_clips : null;
    const existingRes = Array.isArray(result.playlist_clips) ? result.playlist_clips : null;
    if ((existingTop && existingTop.length) || (existingRes && existingRes.length)) return obj;

    const items = Array.isArray(result.items) ? result.items : (Array.isArray(obj.items) ? obj.items : null);
    const songs = Array.isArray(result.songs) ? result.songs : (Array.isArray(obj.songs) ? obj.songs : []);

    if (!items || !items.length) {
      // nothing to build from
      return obj;
    }

    // map songs by uuid for fallback fields (audio_url/video_url/etc)
    const songById = new Map();
    for (const s of songs) {
      if (!s || typeof s !== "object") continue;
      const u = cleanStr(s.uuid || s.id);
      if (u) songById.set(u, s);
    }

    const playlist_clips = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || typeof it !== "object") continue;

      const id = cleanStr(it.id || it.uuid || it.clip_id || it.song_id);
      if (!id) continue;

      const s = songById.get(id) || null;

      const title = cleanStr(it.title || (s && s.title) || "");
      const handle = cleanStr(it.handle || it.author || (s && (s.handle || s.artist)) || "");
      const audio_url = cleanStr(it.audio_url || (s && s.audio_url) || it.audioUrl || it.audio || it.file || it.url || "");
      const video_url = cleanStr(it.video_url || (s && s.video_url) || it.videoUrl || it.video || "");
      const image_large_url = cleanStr(it.image_large_url || (s && s.image_large_url) || it.imageLargeUrl || it.image_url || it.imageUrl || "");

      playlist_clips.push({
        clip: {
          id,
          title,
          // legacy-friendly fields:
          handle,
          user_handle: handle,
          display_name: handle,
          audio_url,
          audioUrl: audio_url,
          video_url,
          videoUrl: video_url,
          image_large_url,
          imageLargeUrl: image_large_url,
        },
        relative_index: i,
      });
    }

    // Inject legacy fields where old browser expects them
    obj.playlist_clips = playlist_clips;
    result.playlist_clips = playlist_clips;

    // also make sure these exist (some old code checks top-level)
    if (!Array.isArray(obj.items)) obj.items = items;
    if (!Array.isArray(obj.uuids)) obj.uuids = Array.isArray(result.uuids) ? result.uuids : playlist_clips.map(r => r.clip.id);
    if (typeof obj.count !== "number") obj.count = playlist_clips.length;

    // playlist_meta fallback
    if (!obj.playlist_meta || typeof obj.playlist_meta !== "object") {
      obj.playlist_meta = { title: cleanStr(result.title || "") };
    }

    log("Injected legacy playlist_clips:", playlist_clips.length);
    return obj;
  }

  window.fetch = async function (input, init) {
    const intercept = isSunoPlaylistReq(input);
    const res = await origFetch.call(this, input, init);

    if (!intercept) return res;

    // We must rebuild the Response if we read the body.
    let txt = "";
    try {
      txt = await res.text();
    } catch (e) {
      return res;
    }

    // Try JSON -> patch -> reserialize
    try {
      const data = JSON.parse(txt);
      const patched = ensureLegacyShape(data);
      const outTxt = JSON.stringify(patched);

      const headers = new Headers(res.headers || {});
      if (!headers.get("content-type")) headers.set("content-type", "application/json");

      return new Response(outTxt, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    } catch (e) {
      // not JSON or something weird: return original text body
      const headers = new Headers(res.headers || {});
      return new Response(txt, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
  };

  log("Installed SunoPlaylist compat shim.");
})();















// ✅ NCZ PATCH: Suno Browser — show AUTHOR in the TRACK ROW TEXT (V1)
// - Does NOT touch info boxes
// - Only changes the displayed label in the Suno overlay list
// - Works by: (1) intercept fetch to cache uuid->author/title, (2) mutate DOM rows that contain a UUID
(() => {
  "use strict";
  if (window.__NCZ_SUNO_BROWSER_SHOW_AUTHOR_V1__) return;
  window.__NCZ_SUNO_BROWSER_SHOW_AUTHOR_V1__ = true;

  const CFG = {
    overlayId: "__ncz_suno_pl_overlay__",
    listId: "__ncz_suno_pl_list__",
    // label format
    joiner: " - ", // change to " — " or " :: " if you want
    log: true,
  };

  const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // global cache so you can inspect it
  const STORE = (window.__NCZ_SUNO_TRACK_MAP__ ||= {
    byUuid: {},   // uuid -> { author, title, audio_url }
    lastIngestTs: 0,
  });

  const clean = (v) => (v == null ? "" : String(v).trim());
  const lower = (s) => clean(s).toLowerCase();

  function isSunoApiUrl(u) {
    u = clean(u);
    if (!u) return false;
    // match any of these endpoints regardless of prefix
    return (
      u.includes("/sunoPlaylist") ||
      u.includes("/suno/all")
    );
  }

  function ingest(payload) {
    try {
      const d = payload && typeof payload === "object" ? payload : {};
      const res = (d.result && typeof d.result === "object") ? d.result : d;

      const items = Array.isArray(res.items) ? res.items : null;
      const songs = Array.isArray(res.songs) ? res.songs : null;

      let n = 0;

      const upsert = (it) => {
        if (!it || typeof it !== "object") return;
        const uuid = clean(it.id || it.uuid || it.clip_id || it.song_id || it.songId);
        if (!uuid || !UUID_RX.test(uuid)) return;

        const title = clean(it.title || it.name || it.caption);
        const author =
          clean(it.author) ||
          clean(it.handle) ||
          clean(it.artist) ||
          clean(it.user) ||
          clean(it.username) ||
          clean(it.display_name) ||
          clean(it.displayName) ||
          "";

        const audio_url = clean(it.audio_url || it.audioUrl || it.audio || it.file || it.url || "");

        const key = lower(uuid);
        const cur = STORE.byUuid[key] || {};
        STORE.byUuid[key] = {
          author: author || cur.author || "",
          title: title || cur.title || "",
          audio_url: audio_url || cur.audio_url || "",
        };
        n++;
      };

      if (items) items.forEach(upsert);
      else if (songs) songs.forEach(upsert);

      STORE.lastIngestTs = Date.now();

      if (CFG.log) {
        console.log("[NCZ SUNO] ingested", n, "tracks; map size =", Object.keys(STORE.byUuid).length);
      }
    } catch (e) {
      if (CFG.log) console.warn("[NCZ SUNO] ingest failed", e);
    }
  }

  function findOverlayList() {
    const overlay = document.getElementById(CFG.overlayId);
    if (!overlay) return null;
    return overlay.querySelector("#" + CFG.listId) || null;
  }

  function pickTitleNode(btn) {
    // Heuristic: most of your rows are button > (icon div) + (content div) where first child is title line.
    const content =
      btn.querySelector('div[style*="flex:1"]') ||
      btn.querySelector("div:nth-child(2)") ||
      btn;
    const titleLine =
      content.querySelector('div[style*="font-weight"]') ||
      content.querySelector("div") ||
      content;
    return titleLine;
  }

  function decorateList() {
    const list = findOverlayList();
    if (!list) return;

    const buttons = Array.from(list.querySelectorAll("button"));
    for (const b of buttons) {
      if (b.dataset && b.dataset.nczSunoAuthDecorated === "1") continue;

      const txt = clean(b.textContent);
      const m = txt.match(UUID_RX);
      if (!m) continue; // only touch rows that contain a UUID (track rows)

      const uuid = m[0];
      const rec = STORE.byUuid[lower(uuid)];
      if (!rec) continue;

      const author = clean(rec.author);
      const title = clean(rec.title);
      if (!author && !title) continue;

      const label =
        (author && title) ? (author + CFG.joiner + title) :
        (author ? (author + CFG.joiner + (title || ("Suno " + uuid.slice(0, 8)))) :
                  (title || ("Suno " + uuid.slice(0, 8))));

      // avoid double-prepending if it already has author in the title line
      const node = pickTitleNode(b);
      const curLine = clean(node.textContent);
      if (curLine && curLine.toLowerCase().startsWith(author.toLowerCase() + CFG.joiner.trim().toLowerCase())) {
        b.dataset.nczSunoAuthDecorated = "1";
        continue;
      }

      node.textContent = label;
      b.dataset.nczSunoAuthDecorated = "1";
    }
  }

  // ---- fetch interceptor (build the map)
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);

    try {
      const input = args[0];
      const url = (typeof input === "string") ? input : (input && input.url) ? input.url : "";
      if (isSunoApiUrl(url)) {
        const clone = res.clone();
        clone.json().then(ingest).then(() => decorateList()).catch(() => {});
      }
    } catch {}

    return res;
  };

  // ---- watch overlay list for re-renders
  const rootObs = new MutationObserver(() => decorateList());
  rootObs.observe(document.documentElement || document.body, { childList: true, subtree: true });

  // initial attempt loop (if overlay is already open)
  (async () => {
    for (let i = 0; i < 120; i++) {
      decorateList();
      await new Promise(r => setTimeout(r, 250));
    }
  })();

  if (CFG.log) console.log("[NCZ SUNO] show-author patch installed");
})();





























// ✅ NCZ PATCH: Suno Browser — FIX "Add All" for MASTER view (All Suno / Suno Playlist) (V1)
// - When Add All is clicked while viewing "All Suno" (or a playlist browse view),
//   we add tracks from the CURRENT VIEW instead of requiring a mounted playlist.
// - Does NOT change your mounts logic; only bypasses the "No playlist mounted" gate for master view.
//
// Also exposes:
//   window.__nczSunoAddAllFromCurrentView__()  // manual trigger
(() => {
  "use strict";
  if (window.__NCZ_SUNO_ADD_ALL_MASTER_FIX_V1__) return;
  window.__NCZ_SUNO_ADD_ALL_MASTER_FIX_V1__ = true;

  const CFG = {
    overlayId: "__ncz_suno_pl_overlay__",
    listId: "__ncz_suno_pl_list__",
    crumbId: "__ncz_suno_pl_crumb__",
    msgId: "__ncz_suno_pl_msg__",
    log: true,
  };

  const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  const clean = (v) => (v == null ? "" : String(v).trim());
  const lower = (s) => clean(s).toLowerCase();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function getParts() {
    const overlay = document.getElementById(CFG.overlayId);
    if (!overlay) return null;
    const list = overlay.querySelector("#" + CFG.listId);
    const crumb = overlay.querySelector("#" + CFG.crumbId);
    const msg = overlay.querySelector("#" + CFG.msgId);
    if (!list || !crumb) return null;
    return { overlay, list, crumb, msg };
  }

  // -----------------------------
  // Track the "current view" items as they load (from server response)
  // We store a normalized list with audio_url so Add-All can work.
  // -----------------------------
  const STATE = (window.__NCZ_SUNO_BROWSER_STATE__ ||= {
    lastViewKey: "",
    lastItems: [], // [{uuid,title,author,handle,audio_url,video_url,image_large_url}]
    lastTs: 0,
  });

  function normalizeFromResponse(data) {
    const d = (data && typeof data === "object") ? data : {};
    const res = (d.result && typeof d.result === "object") ? d.result : d;

    const items = Array.isArray(res.items) ? res.items : (Array.isArray(d.items) ? d.items : null);
    const songs = Array.isArray(res.songs) ? res.songs : (Array.isArray(d.songs) ? d.songs : null);

    const out = [];

    const push = (it) => {
      if (!it || typeof it !== "object") return;
      const uuid = clean(it.id || it.uuid || it.clip_id || it.song_id || it.songId);
      if (!uuid || !UUID_RX.test(uuid)) return;

      const title = clean(it.title || it.name || it.caption);
      const author = clean(it.author || it.artist || it.handle || it.user || it.username || it.display_name || it.displayName);
      const handle = clean(it.handle || it.artist || it.author || it.user || it.username);

      const audio_url = clean(it.audio_url || it.audioUrl || it.audio || it.file || it.url || "");
      const video_url = clean(it.video_url || it.videoUrl || it.video || "");
      const image_large_url = clean(it.image_large_url || it.imageLargeUrl || it.image_url || it.imageUrl || "");

      out.push({ uuid, title, author, handle, audio_url, video_url, image_large_url });
    };

    if (items) items.forEach(push);
    else if (songs) songs.forEach(push);

    return out;
  }

  function sniffIsSunoBrowserCall(url) {
    url = clean(url);
    if (!url) return false;
    return url.includes("/sunoPlaylist") || url.includes("/suno/all");
  }

  // fetch sniffer (captures the latest items when you load All Suno or a playlist)
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);
    try {
      const input = args[0];
      const url = (typeof input === "string") ? input : (input && input.url) ? input.url : "";
      if (sniffIsSunoBrowserCall(url)) {
        const clone = res.clone();
        clone.json().then((json) => {
          const items = normalizeFromResponse(json);
          if (items && items.length) {
            const parts = getParts();
            const crumbTxt = parts ? clean(parts.crumb.textContent) : "";
            STATE.lastViewKey = crumbTxt || clean(url);
            STATE.lastItems = items;
            STATE.lastTs = Date.now();
            if (CFG.log) console.log("[NCZ SUNO] captured view items:", items.length, "view=", STATE.lastViewKey);
          }
        }).catch(() => {});
      }
    } catch {}
    return res;
  };

  // -----------------------------
  // Add logic (uses your existing addSongToList / __NCZ_PLAYLIST_ADD_FN__)
  // -----------------------------
  function addOne(audio_url, label, metaObj) {
    let ok = false;
    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(audio_url, {
          label,
          createdAt: new Date().toLocaleString(),
          meta: metaObj || {},
          downloadName: label,
          serverItem: metaObj || null,
        });
        ok = true;
      } catch {}
    } else if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      try {
        window.__NCZ_PLAYLIST_ADD_FN__({
          file: audio_url,
          url: audio_url,
          name: label,
          title: label,
          meta: metaObj || {},
        });
        ok = true;
      } catch {}
    }
    return ok;
  }

  function buildLabel(it) {
    const author = clean(it.author || it.handle);
    const title = clean(it.title);
    if (author && title) return `${author} - ${title}`;
    return title || author || `Suno ${String(it.uuid || "").slice(0, 8)}`;
  }

  async function addAllFromCurrentView() {
    const parts = getParts();
    if (!parts) return { ok: false, reason: "overlay_not_open" };

    const crumb = lower(parts.crumb.textContent);
    // We ONLY override when you're NOT on Mounts view
    if (!crumb || crumb === "mounts") return { ok: false, reason: "on_mounts_view" };

    // Prefer the last captured items list (from the fetch sniffer)
    let items = Array.isArray(STATE.lastItems) ? STATE.lastItems.slice() : [];

    // Fallback: try to reconstruct from DOM UUIDs + the global map if you have it
    if (!items.length && window.__NCZ_SUNO_TRACK_MAP__ && window.__NCZ_SUNO_TRACK_MAP__.byUuid) {
      const map = window.__NCZ_SUNO_TRACK_MAP__.byUuid;
      const btns = Array.from(parts.list.querySelectorAll("button"));
      for (const b of btns) {
        const m = clean(b.textContent).match(UUID_RX);
        if (!m) continue;
        const uuid = m[0].toLowerCase();
        const rec = map[uuid];
        if (!rec) continue;
        items.push({
          uuid,
          title: clean(rec.title),
          author: clean(rec.author),
          handle: clean(rec.author),
          audio_url: clean(rec.audio_url),
          video_url: "",
          image_large_url: "",
        });
      }
    }

    // Still nothing?
    if (!items.length) {
      if (parts.msg) parts.msg.textContent = "No clips returned.";
      return { ok: false, reason: "no_items" };
    }

    // Add all
    let added = 0;
    let missingAudio = 0;

    if (parts.msg) parts.msg.textContent = "Adding all…";

    for (const it of items) {
      const audio = clean(it.audio_url);
      if (!audio) { missingAudio++; continue; }
      const label = buildLabel(it);
      const meta = {
        source: "suno_browser_add_all_current_view",
        suno_uuid: clean(it.uuid),
        author: clean(it.author),
        handle: clean(it.handle),
        title: clean(it.title),
      };
      if (addOne(audio, label, meta)) added++;
      // tiny yield so you don't freeze UI
      if ((added % 30) === 0) await sleep(0);
    }

    const msg = `Added ${added} track(s)` + (missingAudio ? ` (missing audio_url: ${missingAudio})` : "");
    if (parts.msg) parts.msg.textContent = msg;
    setTimeout(() => { try { if (parts.msg) parts.msg.textContent = ""; } catch {} }, 1400);

    if (CFG.log) console.log("[NCZ SUNO] Add-All current view:", { added, missingAudio, view: clean(parts.crumb.textContent) });
    return { ok: true, added, missingAudio };
  }

  window.__nczSunoAddAllFromCurrentView__ = addAllFromCurrentView;

  // -----------------------------
  // Hijack the existing "Add All" button click ONLY when in a non-mount view
  // -----------------------------
  function findAddAllButton(overlay) {
    const btns = Array.from(overlay.querySelectorAll("button,a"));
    // match visible control whose label/title indicates add all
    return btns.find(el => {
      if (!isVisible(el)) return false;
      const t = lower(el.textContent);
      const tt = lower(el.getAttribute("title"));
      return (t.includes("add all") || tt.includes("add all"));
    }) || null;
  }

  function hookOverlayOnce() {
    const parts = getParts();
    if (!parts) return false;

    if (parts.overlay.dataset.nczAddAllMasterFixV1 === "1") return true;
    parts.overlay.dataset.nczAddAllMasterFixV1 = "1";

    parts.overlay.addEventListener("click", async (e) => {
      const parts2 = getParts();
      if (!parts2) return;

      // only intervene when NOT on Mounts view
      const crumb = lower(parts2.crumb.textContent);
      if (!crumb || crumb === "mounts") return;

      const target = e.target;
      const addAllEl = findAddAllButton(parts2.overlay);
      if (!addAllEl) return;

      // click may be on a child node; check containment
      if (!(target === addAllEl || (addAllEl.contains && addAllEl.contains(target)))) return;

      // intercept and run our add-all
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      await addAllFromCurrentView();
    }, true);

    if (CFG.log) console.log("[NCZ SUNO] Add-All master fix hooked");
    return true;
  }

  // Watch for overlay creation
  const obs = new MutationObserver(() => hookOverlayOnce());
  obs.observe(document.documentElement || document.body, { childList: true, subtree: true });

  // Try immediately too
  hookOverlayOnce();
})();



































// ✅ NCZ HOTFIX: Suno Browser "unstick" — ALWAYS opens (rebuild overlay fresh) (V1)
// - Captures clicks on the Suno virtual row BEFORE the old handler
// - Deletes any stale/disconnected Suno overlay and recreates it
// - Uses SAME overlay IDs as your existing Suno browser so other patches still hook
// - Mounts stored in: NCZ_SUNO_PLAYLIST_MOUNTS_V1 (same as your v2)
// - Track click: add to Song List + exact-play (same behavior style)

(() => {
  "use strict";
  if (window.__NCZ_SUNO_UNSTICK_OPEN_V1__) return;
  window.__NCZ_SUNO_UNSTICK_OPEN_V1__ = true;

  const MUSIC_LIST_ID = "__ncz_music_list__";

  // Keep SAME ids your other Suno patches expect
  const OVERLAY_ID = "__ncz_suno_pl_overlay__";
  const LIST_ID    = "__ncz_suno_pl_list__";
  const CRUMB_ID   = "__ncz_suno_pl_crumb__";
  const MSG_ID     = "__ncz_suno_pl_msg__";

  const CLOSE_BTN_ID = "__ncz_suno_pl_close__";

  const MODAL_ID   = "__ncz_suno_pl_modal__";
  const INP_ID     = "__ncz_suno_pl_inp__";
  const ERR_ID     = "__ncz_suno_pl_err__";
  const REC_BOX_ID = "__ncz_suno_pl_rec_list__";
  const SHOWREC_ID = "__ncz_suno_pl_showrec__";
  const CANCEL_ID  = "__ncz_suno_pl_cancel__";
  const MOUNT_ID   = "__ncz_suno_pl_mount__";

  const LS_KEY = "NCZ_SUNO_PLAYLIST_MOUNTS_V1";

  const CFG = {
    endpoint:
      (location.pathname === "/ace" || location.pathname.startsWith("/ace/"))
        ? "/ace/sunoPlaylist"
        : "/sunoPlaylist",

    virtualFolderName: "Suno Playlist Browser…",

    recommendedPlaylists: [
      { name: "Recent Mashups", url: "https://suno.com/playlist/bdbc9877-5ac2-409f-9bf4-7bd3d39e9d7b" },
      { name: "remixes of cybershrap's music", url: "16592d90-5090-4c8a-85c8-f4b9a55eb572" },
    ],

    // main playlist DOM
    mainSongListId: "songList",

    // exact-play timing
    findPlay: { timeoutMs: 6500, pollMs: 140 },
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function stopAll(e){
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
  }

  function escHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function ensureStyles(){
    const STYLE_ID = "__ncz_suno_unstick_style_v1__";
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.ncz-dark-scroll{
  scrollbar-width: thin;
  scrollbar-color: #2a344a #0b0d12;
}
.ncz-dark-scroll::-webkit-scrollbar{ width:10px; height:10px; }
.ncz-dark-scroll::-webkit-scrollbar-track{ background:#0b0d12; }
.ncz-dark-scroll::-webkit-scrollbar-thumb{
  background:#2a344a;
  border:2px solid #0b0d12;
  border-radius:999px;
}
.ncz-dark-scroll::-webkit-scrollbar-thumb:hover{ background:#3a4766; }
    `.trim();
    document.head.appendChild(st);
  }

  function normUrl(u){
    u = String(u || "").trim();
    if (!u) return "";
    // allow raw uuid
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u)) return u;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  function fnv1a(str) {
    str = String(str || "");
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function safeLabelFromPlaylist(u) {
    u = String(u || "").trim();
    if (!u) return "playlist";
    if (/^[0-9a-f-]{36}$/i.test(u)) return u;
    try {
      const x = new URL(u);
      const p = x.pathname.replace(/\/+$/, "");
      return x.host + (p ? p : "");
    } catch {
      return u.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    }
  }

  function loadMounts(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveMounts(mounts){
    try { localStorage.setItem(LS_KEY, JSON.stringify(mounts)); } catch {}
  }

  function isVisible(el){
    if (!el || el.nodeType !== 1) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    } catch {
      return true;
    }
  }

  function clickReal(el){
    try { el.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window })); } catch {}
    try { el.click(); } catch {}
  }

  function nowIso(){
    try { return new Date().toLocaleString(); } catch { return ""; }
  }

  function urlBasename(u){
    u = String(u || "").trim();
    if (!u) return "";
    try {
      const U = new URL(u, location.origin);
      return decodeURIComponent((U.pathname.split("/").filter(Boolean).pop() || "").trim());
    } catch {
      const noQ = u.split("?")[0].split("#")[0];
      const last = noQ.split("/").filter(Boolean).pop() || "";
      try { return decodeURIComponent(last); } catch { return last; }
    }
  }

  function normKey(u){
    u = String(u || "").trim();
    if (!u) return "";
    return u.split("#")[0].split("?")[0].trim();
  }

  function candidatesFromUrl(u){
    const out = [];
    const push = (x) => {
      x = String(x || "").trim();
      if (!x) return;
      out.push(x);
      out.push(normKey(x));
      try {
        const U = new URL(x, location.origin);
        out.push(U.toString());
        out.push(normKey(U.toString()));
        out.push(U.pathname);
      } catch {}
    };
    push(u);
    const bn = urlBasename(u);
    if (bn) out.push(bn);

    const seen = new Set();
    const uniq = [];
    for (const s of out) {
      const k = String(s).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      uniq.push(k);
    }
    return uniq;
  }

  function urlsMatch(a, b){
    const A = candidatesFromUrl(a);
    const B = candidatesFromUrl(b);
    for (const x of A) {
      for (const y of B) {
        if (!x || !y) continue;
        if (x === y) return true;
        if (x.length > 6 && y.length > 6) {
          if (x.endsWith(y) || y.endsWith(x)) return true;
        }
        const xb = urlBasename(x).toLowerCase();
        const yb = urlBasename(y).toLowerCase();
        if (xb && yb && xb === yb) return true;
      }
    }
    return false;
  }

  async function postSunoPlaylist(url){
    const res = await fetch(CFG.endpoint, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ url, playlist_url:url, playlist:url })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`sunoPlaylist HTTP ${res.status}${t ? `: ${t.slice(0,240)}` : ""}`);
    }
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  }

  function normalizePlaylistItems(data){
    const d = (data && typeof data === "object") ? data : {};
    const res = (d.result && typeof d.result === "object") ? d.result : d;

    // accept: result.items, items, playlist_clips (legacy), clips/songs
    const items =
      (Array.isArray(res.items) && res.items) ||
      (Array.isArray(d.items) && d.items) ||
      null;

    const clipsLegacy =
      (Array.isArray(res.playlist_clips) && res.playlist_clips) ||
      (Array.isArray(d.playlist_clips) && d.playlist_clips) ||
      null;

    const songs =
      (Array.isArray(res.songs) && res.songs) ||
      (Array.isArray(d.songs) && d.songs) ||
      null;

    const out = [];

    const pull = (obj) => {
      const o = (obj && typeof obj === "object") ? obj : {};
      const id = String(o.id || o.uuid || o.clip_id || o.song_id || "").trim();
      const title = String(o.title || o.name || o.caption || o.prompt || "").trim();
      const handle = String(o.handle || o.user_handle || o.artist || o.author || "").trim();
      const author =
        handle ||
        String(o.user?.handle || o.user?.username || o.user?.name || "").trim() ||
        String(o.username || o.display_name || o.displayName || "").trim();

      const audio =
        String(o.audio_url || o.audioUrl || o.audio || o.file || o.url || o.mp3 || "").trim();

      const video_url = String(o.video_url || o.videoUrl || o.video || "").trim();
      const image_large_url = String(o.image_large_url || o.imageLargeUrl || o.image_url || o.imageUrl || "").trim();

      if (!audio) return null;

      return {
        id,
        title,
        author,
        handle,
        audio,
        video_url,
        image_large_url,
        raw: obj
      };
    };

    if (items && items.length) {
      for (const it of items) {
        const x = pull(it);
        if (x) out.push(x);
      }
      return out;
    }

    if (clipsLegacy && clipsLegacy.length) {
      for (const row of clipsLegacy) {
        const clip = (row && row.clip && typeof row.clip === "object") ? row.clip : row;
        const x = pull(clip);
        if (x) out.push(x);
      }
      return out;
    }

    if (songs && songs.length) {
      for (const it of songs) {
        const x = pull(it);
        if (x) out.push(x);
      }
      return out;
    }

    return out;
  }

  // -----------------------------
  // Exact-play in main Song List
  // -----------------------------
  function getSongUrlFromObj(it){
    if (!it) return "";
    if (typeof it === "string") return it;
    if (typeof it !== "object") return "";
    return String(it.url || it.file || it.href || it.src || it.downloadName || "").trim();
  }

  function findIndexInWindowSongs(url){
    const songs = Array.isArray(window.songs) ? window.songs : null;
    if (!songs) return -1;

    for (let i = 0; i < songs.length; i++) {
      const it = songs[i];
      const candidates = [];

      candidates.push(getSongUrlFromObj(it));

      if (it && typeof it === "object") {
        try { if (it.serverItem) candidates.push(getSongUrlFromObj(it.serverItem)); } catch {}
        try { if (it.meta) candidates.push(getSongUrlFromObj(it.meta)); } catch {}
        for (const k of Object.keys(it)) {
          const v = it[k];
          if (typeof v === "string" && (v.includes("://") || /\.(mp3|m4a|wav|ogg|flac|aac)(\?|$)/i.test(v))) {
            candidates.push(v);
          }
        }
      }

      for (const c of candidates) {
        if (c && urlsMatch(c, url)) return i;
      }
    }
    return -1;
  }

  function findRowInDomByUrl(url){
    const root = document.getElementById(CFG.mainSongListId);
    if (!root) return null;

    const rows = Array.from(root.querySelectorAll("div[data-song-index]"));
    if (!rows.length) return null;

    for (const r of rows) {
      const links = Array.from(r.querySelectorAll("a[href]"));
      for (const a of links) {
        const h = String(a.getAttribute("href") || "").trim();
        if (h && urlsMatch(h, url)) return r;
      }
    }

    const bn = urlBasename(url).toLowerCase();
    const key = normKey(url).toLowerCase();
    for (const r of rows) {
      const txt = String(r.textContent || "").toLowerCase();
      if (key && txt.includes(key)) return r;
      if (bn && txt.includes(bn)) return r;
    }
    return null;
  }

  function clickPlayInRow(row){
    if (!row) return false;

    const aPlay = Array.from(row.querySelectorAll("a"))
      .find(a => isVisible(a) && String(a.textContent || "").trim().toLowerCase() === "play");
    if (aPlay) { clickReal(aPlay); return true; }

    const any = Array.from(row.querySelectorAll("a,button"))
      .find(el => isVisible(el) && String(el.getAttribute("title") || "").toLowerCase().includes("play"));
    if (any) { clickReal(any); return true; }

    return false;
  }

  async function playExactByUrl(url){
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.findPlay.timeoutMs) {
      const idx = findIndexInWindowSongs(url);
      if (idx >= 0) {
        const root = document.getElementById(CFG.mainSongListId);
        if (root) {
          const row = root.querySelector(`div[data-song-index="${idx}"]`);
          if (row && clickPlayInRow(row)) return true;
        }
      }

      const row2 = findRowInDomByUrl(url);
      if (row2 && clickPlayInRow(row2)) return true;

      await sleep(CFG.findPlay.pollMs);
    }
    return false;
  }

  async function addToSongsListAndPlay(url, title, meta){
    url = String(url || "").trim();
    if (!url) return false;

    const label = String(title || "").trim() || urlBasename(url) || "Suno Track";
    const createdAt = nowIso();

    if (typeof window.addSongToList === "function") {
      try {
        window.addSongToList(url, {
          label,
          createdAt,
          meta: (meta && typeof meta === "object") ? meta : {},
          downloadName: label,
          serverItem: meta || null
        });
      } catch {
        // if addSongToList exists but threw, fallback open
        try { window.open(url, "_blank", "noopener"); } catch {}
        return false;
      }
    } else {
      try { window.open(url, "_blank", "noopener"); } catch {}
      return false;
    }

    await sleep(60);
    return await playExactByUrl(url);
  }

  // -----------------------------
  // Overlay UI (rebuild each open)
  // -----------------------------
  function renderRow({ icon, text, subtext, onClick, rightHtml }){
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = `
      width:100%;
      text-align:left;
      display:flex;
      gap:10px;
      align-items:center;
      padding:10px 10px;
      margin:0 0 6px 0;
      border-radius:12px;
      border:1px solid var(--line,#1e2742);
      background: var(--card2,#0f1320);
      color: var(--text,#e9eefc);
      cursor:pointer;
      position:relative;
    `;
    row.innerHTML = `
      <div style="width:22px; text-align:center; opacity:.9;">${escHtml(icon || "")}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:800; line-height:1.1;">${escHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(subtext)}</div>` : ""}
      </div>
      ${rightHtml || ""}
    `;
    row.addEventListener("click", (e) => {
      stopAll(e);
      onClick && onClick(e);
    }, true);
    return row;
  }

  function getHost(){
    const listEl = document.getElementById(MUSIC_LIST_ID);
    if (!listEl) return null;

    const panel = listEl.parentElement || listEl;
    try {
      const cs = getComputedStyle(panel);
      if (cs.position === "static") panel.style.position = "relative";
    } catch {}
    return { listEl, panel };
  }

  function killExistingOverlay(){
    const old = document.getElementById(OVERLAY_ID);
    if (old) {
      try { old.remove(); } catch {}
    }
  }

  function buildOverlay(panel){
    ensureStyles();
    killExistingOverlay();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
      position:absolute; inset:0;
      background: var(--card, #121726);
      border: 1px solid var(--line, #1e2742);
      border-radius: 12px;
      box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35));
      display:none;
      z-index: 9999;
      overflow:hidden;
    `;

    overlay.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line,#1e2742);">
        <div style="font-weight:900; color:var(--text,#e9eefc);">${escHtml(CFG.virtualFolderName)}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="${CLOSE_BTN_ID}" type="button"
            style="padding:6px 10px; border-radius:10px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">
            Close
          </button>
        </div>
      </div>

      <div style="padding:8px 12px; border-bottom:1px solid var(--line,#1e2742); color:var(--muted,#a9b3cf); font-size:12px;">
        <span id="${CRUMB_ID}">Mounts</span>
        <span id="${MSG_ID}" style="float:right; color:var(--warn,#ffd36a);"></span>
      </div>

      <div id="${LIST_ID}" class="ncz-dark-scroll"
        style="position:absolute; inset:86px 0 0 0; overflow:auto; padding:8px 10px;"></div>

      <div id="${MODAL_ID}" style="
        position:absolute; inset:0; display:none;
        background: rgba(0,0,0,.55);
        align-items:center; justify-content:center;
        z-index:10000;
      ">
        <div class="ncz-dark-scroll"
          style="width:min(560px, 92%); max-height:min(600px, 86%);
                 overflow:auto; background:var(--card,#121726);
                 border:1px solid var(--line,#1e2742); border-radius:14px;
                 box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35)); padding:14px;">
          <div style="font-weight:900; color:var(--text,#e9eefc); margin-bottom:10px;">Mount Suno Playlist</div>

          <input id="${INP_ID}" type="text"
            placeholder="https://suno.com/playlist/&lt;uuid&gt;  (or just the uuid)"
            style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:12px;
                   border:1px solid var(--line,#1e2742);
                   background:var(--card2,#0f1320); color:var(--text,#e9eefc); outline:none;" />

          <div id="${REC_BOX_ID}" class="ncz-dark-scroll"
            style="display:none; margin-top:10px; border:1px solid var(--line,#1e2742);
                   border-radius:12px; overflow:auto; max-height:240px; background:var(--card2,#0f1320);"></div>

          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap;">
            <button id="${SHOWREC_ID}" type="button"
              style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742);
                     background:var(--card2,#0f1320); color:var(--text,#e9eefc); cursor:pointer;">
              Recommended
            </button>
            <button id="${CANCEL_ID}" type="button"
              style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742);
                     background:transparent; color:var(--text,#e9eefc); cursor:pointer;">
              Cancel
            </button>
            <button id="${MOUNT_ID}" type="button"
              style="padding:8px 12px; border-radius:12px; border:1px solid var(--line,#1e2742);
                     background:var(--accent,#6aa6ff); color:#0b0d12; cursor:pointer; font-weight:900;">
              Mount
            </button>
          </div>

          <div id="${ERR_ID}" style="margin-top:10px; color:var(--bad,#ff5c7a); font-size:12px; white-space:pre-wrap;"></div>
        </div>
      </div>
    `;

    // Shield overlay clicks from your global "force close" stuff
    const shield = (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    ["click","dblclick","auxclick","contextmenu","mousedown","mouseup","pointerdown","pointerup","touchstart","touchend"]
      .forEach(evt => overlay.addEventListener(evt, shield, false));

    panel.appendChild(overlay);
    return overlay;
  }

  function $(id, root=document){ return root.getElementById ? root.getElementById(id) : document.getElementById(id); }

  function setMsg(overlay, s){
    const el = overlay.querySelector("#" + MSG_ID);
    if (el) el.textContent = String(s || "");
  }

  function showModal(overlay, show){
    const modal = overlay.querySelector("#" + MODAL_ID);
    const err = overlay.querySelector("#" + ERR_ID);
    const rec = overlay.querySelector("#" + REC_BOX_ID);
    if (!modal) return;
    modal.style.display = show ? "flex" : "none";
    if (err) err.textContent = "";
    if (rec) rec.style.display = "none";
    if (show) {
      const inp = overlay.querySelector("#" + INP_ID);
      if (inp) { inp.value = ""; setTimeout(() => inp.focus(), 0); }
    }
  }

  function buildRecList(overlay, onPick){
    const recBox = overlay.querySelector("#" + REC_BOX_ID);
    if (!recBox) return;
    recBox.innerHTML = "";

    const recs = CFG.recommendedPlaylists || [];
    if (!recs.length) {
      const d = document.createElement("div");
      d.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
      d.textContent = "No recommended playlists configured.";
      recBox.appendChild(d);
      return;
    }

    for (const r of recs) {
      const b = document.createElement("button");
      b.type = "button";
      b.style.cssText = `
        width:100%; text-align:left;
        padding:10px 12px;
        border:0;
        border-bottom:1px solid var(--line,#1e2742);
        background:transparent;
        color:var(--text,#e9eefc);
        cursor:pointer;
      `;
      b.innerHTML = `
        <div style="font-weight:900; font-size:13px;">${escHtml(r.name || r.url)}</div>
        <div style="font-size:12px; color:var(--muted,#a9b3cf); word-break:break-all;">${escHtml(r.url || "")}</div>
      `;
      b.addEventListener("click", (e) => {
        stopAll(e);
        onPick && onPick(r.url);
      }, true);
      recBox.appendChild(b);
    }

    const last = recBox.lastElementChild;
    if (last) last.style.borderBottom = "0";
  }

  async function mountAndBrowse(overlay, url){
    const err = overlay.querySelector("#" + ERR_ID);
    const inp = overlay.querySelector("#" + INP_ID);

    url = normUrl(url);
    if (!url) { if (err) err.textContent = "Enter a playlist URL or UUID."; return; }

    if (inp) inp.value = url;

    setMsg(overlay, "Loading…");
    if (err) err.textContent = "";

    try {
      const data = await postSunoPlaylist(url);

      // store mount (same key as your v2)
      const mounts = loadMounts();
      const id = fnv1a(url);
      const label = safeLabelFromPlaylist(url);
      if (!mounts.find(m => m && String(m.id) === String(id))) {
        mounts.unshift({ id, url, label, createdAt: Date.now() });
        saveMounts(mounts);
      }

      showModal(overlay, false);
      await renderBrowse(overlay, { id, url, label }, data);
    } catch (e) {
      if (err) err.textContent = String(e && e.message ? e.message : e);
    } finally {
      setMsg(overlay, "");
    }
  }

  function renderMounts(overlay){
    const list = overlay.querySelector("#" + LIST_ID);
    const crumb = overlay.querySelector("#" + CRUMB_ID);
    if (!list || !crumb) return;

    crumb.textContent = "Mounts";
    list.innerHTML = "";

    list.appendChild(renderRow({
      icon: "➕",
      text: "Mount a playlist…",
      subtext: "Suno playlist URL or UUID (saved)",
      onClick: () => showModal(overlay, true)
    }));

    if ((CFG.recommendedPlaylists || []).length) {
      list.appendChild(renderRow({
        icon: "⭐",
        text: "Recommended playlists",
        subtext: "One-click mount",
        onClick: () => {
          showModal(overlay, true);
          const recBox = overlay.querySelector("#" + REC_BOX_ID);
          if (recBox) {
            recBox.style.display = "block";
            buildRecList(overlay, (u) => mountAndBrowse(overlay, u));
          }
        }
      }));
    }

    const mounts = loadMounts();
    if (!mounts.length) {
      const d = document.createElement("div");
      d.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px;";
      d.textContent = "No Suno playlist mounts yet.";
      list.appendChild(d);
      return;
    }

    for (const m of mounts) {
      const right = `
        <span class="__ncz_suno_unmount__" title="Remove mount" style="
          position:absolute;
          right:10px;
          top:50%;
          transform:translateY(-50%);
          color: var(--bad,#ff5c7a);
          font-weight:900;
          font-size:16px;
          line-height:16px;
          user-select:none;
          cursor:pointer;
          padding:4px 6px;
          border-radius:10px;
        ">✕</span>
      `;

      const row = renderRow({
        icon: "☀️",
        text: m.label || m.url,
        subtext: m.url,
        rightHtml: right,
        onClick: async (e) => {
          const x = e.target && e.target.closest && e.target.closest("span.__ncz_suno_unmount__");
          if (x) return;

          setMsg(overlay, "Loading…");
          try {
            const data = await postSunoPlaylist(m.url);
            await renderBrowse(overlay, { id: m.id, url: m.url, label: m.label || m.url }, data);
          } catch (err) {
            list.innerHTML = "";
            const d = document.createElement("div");
            d.style.cssText = "padding:10px; color:var(--bad,#ff5c7a); font-size:13px; white-space:pre-wrap;";
            d.textContent = `Error loading playlist:\n${String(err && err.message ? err.message : err)}`;
            list.appendChild(d);
          } finally {
            setMsg(overlay, "");
          }
        }
      });

      const x = row.querySelector("span.__ncz_suno_unmount__");
      if (x) {
        x.addEventListener("click", (e) => {
          stopAll(e);
          const mounts2 = loadMounts().filter(mm => String(mm && mm.id) !== String(m && m.id));
          saveMounts(mounts2);
          renderMounts(overlay);
        }, true);

        x.addEventListener("mousedown", stopAll, true);
      }

      // give room for the X
      row.style.paddingRight = "36px";

      list.appendChild(row);
    }
  }

  async function renderBrowse(overlay, mount, data){
    const list = overlay.querySelector("#" + LIST_ID);
    const crumb = overlay.querySelector("#" + CRUMB_ID);
    if (!list || !crumb) return;

    crumb.textContent = String(mount && (mount.label || mount.url) || "Playlist");
    list.innerHTML = "";

    list.appendChild(renderRow({
      icon: "⬅️",
      text: "Back to Mounts",
      subtext: "",
      onClick: () => renderMounts(overlay)
    }));

    list.appendChild(renderRow({
      icon: "🔄",
      text: "Refresh playlist",
      subtext: "Re-fetch from server",
      onClick: async () => {
        setMsg(overlay, "Loading…");
        try {
          const d2 = await postSunoPlaylist(mount.url);
          await renderBrowse(overlay, mount, d2);
        } catch (e) {
          setMsg(overlay, "Refresh failed");
          setTimeout(() => setMsg(overlay, ""), 1200);
        } finally {
          setTimeout(() => setMsg(overlay, ""), 1200);
        }
      }
    }));

    const items = normalizePlaylistItems(data);

    list.appendChild(renderRow({
      icon: "ℹ️",
      text: `Tracks: ${items.length}`,
      subtext: "Click: add + exact-play in Song List",
      onClick: () => {}
    }));

    if (!items.length) {
      const d = document.createElement("div");
      d.style.cssText = "padding:10px; color:var(--muted,#a9b3cf); font-size:13px; white-space:pre-wrap;";
      d.textContent = "No playable clips returned (no audio_url).";
      list.appendChild(d);
      return;
    }

    for (const it of items) {
      const title = it.author && it.title ? `${it.author} - ${it.title}` : (it.title || it.author || (it.id ? `Clip ${it.id}` : "Clip"));
      list.appendChild(renderRow({
        icon: "▶️",
        text: title,
        subtext: it.id || it.audio,
        onClick: async () => {
          const meta = {
            source: "suno_playlist",
            clip_id: it.id || "",
            title: it.title || "",
            author: it.author || "",
            handle: it.handle || "",
            video_url: it.video_url || "",
            image_large_url: it.image_large_url || "",
            raw: it.raw || null
          };

          setMsg(overlay, "Adding…");
          const ok = await addToSongsListAndPlay(it.audio, title, meta);
          setMsg(overlay, ok ? "Playing" : "Added (couldn’t auto-play)");
          setTimeout(() => setMsg(overlay, ""), 1100);
        }
      }));
    }
  }

  function bindOverlayHandlers(overlay){
    const closeBtn = overlay.querySelector("#" + CLOSE_BTN_ID);
    const modal = overlay.querySelector("#" + MODAL_ID);
    const inp = overlay.querySelector("#" + INP_ID);
    const err = overlay.querySelector("#" + ERR_ID);
    const recBox = overlay.querySelector("#" + REC_BOX_ID);

    const showRecBtn = overlay.querySelector("#" + SHOWREC_ID);
    const cancelBtn  = overlay.querySelector("#" + CANCEL_ID);
    const mountBtn   = overlay.querySelector("#" + MOUNT_ID);

    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        stopAll(e);
        overlay.style.display = "none";
      }, true);
    }

    if (showRecBtn) {
      showRecBtn.addEventListener("click", (e) => {
        stopAll(e);
        if (!recBox) return;
        const show = recBox.style.display !== "block";
        recBox.style.display = show ? "block" : "none";
        if (show) buildRecList(overlay, (u) => mountAndBrowse(overlay, u));
      }, true);
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", (e) => {
        stopAll(e);
        showModal(overlay, false);
      }, true);
    }

    if (mountBtn) {
      mountBtn.addEventListener("click", async (e) => {
        stopAll(e);
        const raw = inp ? inp.value : "";
        if (err) err.textContent = "";
        await mountAndBrowse(overlay, raw);
      }, true);
    }

    // Clicking modal backdrop closes modal (but not overlay)
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) stopAll(e), showModal(overlay, false);
      }, true);
    }
  }

  function openSunoOverlay(){
    const host = getHost();
    if (!host || !host.panel) return;

    // ✅ Important: ALWAYS rebuild so stale closure refs can’t break it
    const overlay = buildOverlay(host.panel);
    bindOverlayHandlers(overlay);

    overlay.style.display = "block";
    renderMounts(overlay);
  }

  // -----------------------------
  // Capture clicks on the existing Suno virtual row and override the old handler
  // -----------------------------
  function isSunoVirtualRowTarget(t){
    if (!t || t.nodeType !== 1) return false;
    try {
      return !!t.closest('[data-ncz-suno-virtual-v2="1"],[data-ncz-suno-virtual="1"],[data-ncz-suno-virtual-v3="1"]');
    } catch {
      return false;
    }
  }

  document.addEventListener("click", (e) => {
    if (!isSunoVirtualRowTarget(e.target)) return;
    stopAll(e);
    openSunoOverlay();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (!(e.key === "Enter" || e.key === " ")) return;
    if (!isSunoVirtualRowTarget(e.target)) return;
    stopAll(e);
    openSunoOverlay();
  }, true);

  console.log("[NCZ] Suno Unstick Open V1 installed (rebuild overlay every open).");
})();



































