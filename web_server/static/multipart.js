










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
            <div class="__muted__" style="margin-top:8px">Tip: amount is read when you click PayPal — no reload needed.</div>
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



























// ✅ NCZ PATCH: External URL Browser "virtual folder" for Archive (V3.1)
// Fixes:
// - Dark scrollbars
// - Recommended mounts (one-click mount)
// - ✅ External MP3/M4A now ADDS to Songs List playlist (arrays + render)
// - ✅ NEW: Instead of direct play(), we click the FIRST songList item's "Play" link
//         (your real UI handler drives playback + highlight)
//
// OPTIONAL (strongest/cleanest):
// If you know your real add function, set it once anywhere:
//   window.__NCZ_PLAYLIST_ADD_FN__ = (item) => yourRealAddFn(item);
//
// NOTE:
// This assumes your newly-added items appear at the TOP of #songList
// (so "click first Play" hits the new item).

(() => {
  "use strict";
  if (window.__NCZ_EXT_URL_BROWSER_PATCH_V31__) return;
  window.__NCZ_EXT_URL_BROWSER_PATCH_V31__ = true;

  // -----------------------------
  // CONFIG (adjust if needed)
  // -----------------------------
  const CFG = {
    archiveListSelectors: [
      "#__ncz_archive_list__",
      "#__ncz_left_archive_list__",
      "#archiveList",
      "[data-ncz-archive-list]",
      "[data-archive-list]"
    ],

    // Songs List / Playlist container guesses (add yours here)
    playlistSelectors: [
      "#songList",                 // ✅ your known ID
      "#__ncz_songlist__",
      "#__ncz_songlist_list__",
      "#__ncz_song_list__",
      "#__ncz_playlist__",
      "#__ncz_queue__",
      "[data-ncz-playlist]"
    ],

    endpoint: "/getExternal",
    lsKey: "NCZ_EXT_MOUNTS_V1",
    rootOnly: true,
    virtualFolderName: "External URL Browser…",

    playableExt: [".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"],

    // Recommended mounts (edit these)
    recommendedMounts: [
      { name: "XT Development", url: "https://xtdevelopment.net/music/mp3s/" },
       { name: "AlsPlaylistMixedGenre", url: "https://archive.org/download/AlsPlaylistMixedGenre" },
{ name: "RBHipHop", url: "https://archive.org/download/RBHipHop" },
    ],

    // Optional events your app *might* listen to
    playlistEvents: ["ncz-playlist-add", "ncz-archive-add", "NCZ_PLAYLIST_ADD"],

    // ✅ Auto-click-first-play behavior
    clickFirst: {
      ROOT_ID: "songList",
      RETRY_FOR_MS: 6000,
      RETRY_EVERY_MS: 200
    }
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

function findArchiveListEl() {
  // ✅ Force the real archive list container in your left music pane
  const el = document.getElementById("__ncz_music_list__");
  return el || null;
}

  function findPlaylistEl() {
    for (const sel of CFG.playlistSelectors) {
      const el = $(sel);
      if (el) return el;
    }
    // heuristic fallback
    const candidates = $$("div,ul,section").filter(el => {
      const id = (el.id || "").toLowerCase();
      if (!/(song|play|queue|list)/i.test(id)) return false;
      return el.children && el.children.length >= 1;
    });
    return candidates[0] || null;
  }

  function playlistCount() {
    const el = findPlaylistEl();
    if (!el) return -1;
    return (el.children ? el.children.length : -1);
  }

  function normUrl(u) {
    u = String(u || "").trim();
    if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  function safeLabelFromUrl(u) {
    try {
      const x = new URL(u);
      const p = x.pathname && x.pathname !== "/" ? x.pathname.replace(/\/+$/,"") : "";
      return (x.host + (p ? p : ""));
    } catch {
      return u.replace(/^https?:\/\//i, "").replace(/\/+$/,"");
    }
  }

  function fnv1a(str) {
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
    p = String(p || "");
    p = p.replace(/^\/+/, "");
    p = p.replace(/\/+$/, "");
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return parts.length ? parts.join("/") + "/" : "";
  }

  function joinPath(base, child) {
    base = String(base || "");
    child = String(child || "");
    base = base.replace(/^\/+/, "");
    child = child.replace(/^\/+/, "");
    if (!base) return child;
    if (!child) return base;
    if (!/\/$/.test(base)) base += "/";
    return base + child;
  }

  function looksPlayable(nameOrUrl) {
    const s = String(nameOrUrl || "").toLowerCase();
    return CFG.playableExt.some(ext => s.endsWith(ext));
  }

  function basenameFromPath(p) {
    p = String(p || "").replace(/\\/g,"/");
    const b = p.split("/").filter(Boolean).slice(-1)[0] || p;
    return b || "track.mp3";
  }

  function taskIdFromName(name) {
    name = String(name || "track");
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
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // -----------------------------
  // ✅ CLICK FIRST "Play" (your method) — callable per-add
  // -----------------------------
  const __NCZ_CLICK_FIRST_GUARD__ = new Map(); // key -> ts (prevents double triggers)

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
    } catch (_) {}
    try { el.click(); } catch (_) {}
  };

  function clickFirstPlayOnce() {
    const root = document.getElementById(CFG.clickFirst.ROOT_ID);
    if (!root) return false;

    const rows = Array.from(root.children).filter((n) =>
      n && n.nodeType === 1 && n.matches("div[data-song-index]")
    );
    const firstRow = rows.find(isVisible) || rows[0];
    if (!firstRow) return false;

    const playLink = Array.from(firstRow.querySelectorAll("a"))
      .find(a => (a.textContent || "").trim().toLowerCase() === "play" && isVisible(a));

    if (!playLink) return false;

    console.log("[NCZ] clickFirstPlay =>", firstRow.getAttribute("data-song-index"));
    clickReal(playLink);
    return true;
  }

  function triggerClickFirstPlay(key) {
    key = String(key || "default");
    const now = Date.now();
    const last = __NCZ_CLICK_FIRST_GUARD__.get(key) || 0;
    if (now - last < 250) return; // ignore rapid duplicates
    __NCZ_CLICK_FIRST_GUARD__.set(key, now);

    const start = Date.now();
    let done = false;

    const tryIt = () => {
      if (done) return true;
      if (clickFirstPlayOnce()) { done = true; return true; }
      return false;
    };

    // immediate try
    if (tryIt()) return;

    // retry loop
    const timer = setInterval(() => {
      if (tryIt()) {
        clearInterval(timer);
        if (obs) obs.disconnect();
      } else if (Date.now() - start >= CFG.clickFirst.RETRY_FOR_MS) {
        clearInterval(timer);
        if (obs) obs.disconnect();
      }
    }, CFG.clickFirst.RETRY_EVERY_MS);

    // also watch rebuilds
    const obs = new MutationObserver(() => {
      if (tryIt()) {
        clearInterval(timer);
        obs.disconnect();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // -----------------------------
  // ✅ Playlist add (REAL fix) — EXACTLY ONCE
  // -----------------------------
  function buildArchiveLikeItem(url, name) {
    const bn = basenameFromPath(name || url);
    return {
      type: "mp3",
      name: bn,
      path: bn,
      size: 0,
      mtime: (Date.now()/1000)|0,
      file: url,

      // "archive-like" fields used by many of your scripts
      task_id: taskIdFromName(bn),
      output_index: 0,
      created_at: "",
      label: "",
      prompt: "",
      author: "",
      title: bn,
      metas: {}
    };
  }

  let _playlistCache = null;

  function scanForPlaylistTargets() {
    // cache for 10s (avoid heavy scans per click)
    const now = Date.now();
    if (_playlistCache && (now - _playlistCache.ts) < 10000) return _playlistCache;

    const arrays = [];
    const renderFns = [];
    const addFns = [];

    function considerObj(obj, prefix) {
      if (!obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        const name = prefix ? `${prefix}.${k}` : k;

        if (Array.isArray(v) && /(song|play|queue|list)/i.test(k)) {
          const sample = v.slice(0, 5);
          const ok =
            (sample.length === 0) ||
            (sample.every(x => typeof x === "string") && sample.some(x => looksPlayable(x))) ||
            (sample.some(x => x && typeof x === "object" && (x.file || x.url || x.src)));

          if (ok) arrays.push({ owner: obj, key: k, name });
        }

        if (typeof v === "function") {
          if (/(add).*?(song|play|queue|list)/i.test(k)) addFns.push({ owner: obj, key: k, fn: v, name });
          if (/(render|update|refresh).*?(song|play|queue|list)/i.test(k)) renderFns.push({ owner: obj, key: k, fn: v, name });
        }
      }
    }

    considerObj(window, "");
    considerObj(window.NCZ, "NCZ");
    considerObj(window.__NCZ__, "__NCZ__");

    _playlistCache = { ts: now, arrays, renderFns, addFns };
    return _playlistCache;
  }

  const __NCZ_EXT_ADD_GUARD__ = new Map(); // urlKey -> ts

  function _nczKeyUrl(u) { return String(u || "").trim(); }

  function _arrHasUrl(arr, urlKey) {
    if (!Array.isArray(arr)) return false;
    for (const it of arr) {
      if (!it) continue;
      if (typeof it === "string") {
        if (_nczKeyUrl(it) === urlKey) return true;
      } else if (typeof it === "object") {
        const f = it.file || it.url || it.href || it.src || "";
        if (_nczKeyUrl(f) === urlKey) return true;
      }
    }
    return false;
  }

  function _anyArrayHasUrl(arrays, urlKey) {
    for (const a of arrays || []) {
      try {
        const arr = a && a.owner ? a.owner[a.key] : null;
        if (_arrHasUrl(arr, urlKey)) return true;
      } catch {}
    }
    return false;
  }

  function _scrubObjectObject(arrays) {
    const badStr = (s) => {
      s = String(s || "").trim().toLowerCase();
      return (
        s === "[object object]" ||
        s === "object object" ||
        s === "undefined" ||
        s === "null" ||
        s === ""
      );
    };

    for (const a of arrays || []) {
      try {
        const arr = a.owner[a.key];
        if (!Array.isArray(arr) || !arr.length) continue;

        for (let i = arr.length - 1; i >= 0; i--) {
          const it = arr[i];
          if (typeof it === "string" && badStr(it)) arr.splice(i, 1);
        }

        for (let i = arr.length - 1; i >= 0; i--) {
          const it = arr[i];
          if (!it || typeof it !== "object") continue;
          const f = it.file || it.url || it.href || it.src || "";
          const n = it.name || it.title || it.label || "";
          if (!f && badStr(n)) arr.splice(i, 1);
        }
      } catch {}
    }
  }

  function _pickBestAddFn(addFns) {
    const score = (n) => {
      n = String(n || "").toLowerCase();
      let s = 0;
      if (n.includes("songlist")) s += 50;
      if (n.includes("playlist")) s += 45;
      if (n.includes("queue")) s += 25;
      if (n.includes("add")) s += 10;
      if (n.includes("render") || n.includes("refresh") || n.includes("update")) s -= 50;
      if (n.includes("event") || n.includes("listener")) s -= 20;
      return s;
    };

    const list = (addFns || []).slice().sort((a, b) => score(b.name) - score(a.name));
    return list[0] || null;
  }

  function _pickBestArray(arrays) {
    let best = null;
    let bestScore = -1;

    for (const a of arrays || []) {
      try {
        const arr = a.owner[a.key];
        if (!Array.isArray(arr)) continue;

        let s = 0;
        const k = String(a.key || "").toLowerCase();
        if (k.includes("songlist")) s += 50;
        if (k.includes("playlist")) s += 45;
        if (k.includes("queue")) s += 25;
        if (k.includes("list")) s += 10;

        const sample = arr.find(x => x != null);
        if (sample && typeof sample === "object" && (sample.file || sample.url || sample.src)) s += 20;
        if (typeof sample === "string") s += 5;

        if (s > bestScore) { bestScore = s; best = a; }
      } catch {}
    }
    return best;
  }

  async function addToSongsListExact(url, name) {
    const urlKey = _nczKeyUrl(url);
    if (!urlKey) return false;

    const now = Date.now();
    const last = __NCZ_EXT_ADD_GUARD__.get(urlKey) || 0;
    if (now - last < 350) return true;
    __NCZ_EXT_ADD_GUARD__.set(urlKey, now);

    const item = buildArchiveLikeItem(url, name);
    const beforeUI = playlistCount();

    const scan = scanForPlaylistTargets();

    if (_anyArrayHasUrl(scan.arrays, urlKey)) return true;

    // 0) User override (preferred) — ONLY ONCE
    if (typeof window.__NCZ_PLAYLIST_ADD_FN__ === "function") {
      try { window.__NCZ_PLAYLIST_ADD_FN__(item); } catch {}
      await sleep(30);
      _scrubObjectObject(scan.arrays);
      if (playlistCount() > beforeUI || _anyArrayHasUrl(scan.arrays, urlKey)) return true;
    }

    // 1) Try ONE best add function — ONLY ONCE
    const bestAdd = _pickBestAddFn(scan.addFns);
    if (bestAdd && typeof bestAdd.fn === "function") {
      try {
        bestAdd.fn.call(bestAdd.owner, url, name, item);
      } catch {}
      await sleep(30);
      _scrubObjectObject(scan.arrays);
      if (playlistCount() > beforeUI || _anyArrayHasUrl(scan.arrays, urlKey)) return true;
    }

    // 2) Fallback: push into ONE best playlist array (NOT ALL)
    const target = _pickBestArray(scan.arrays);
    if (target) {
      try {
        const arr = target.owner[target.key];
        if (Array.isArray(arr) && !_arrHasUrl(arr, urlKey)) {
          const sample = arr.find(x => x != null);
          if (!sample) {
            arr.push(item);
          } else if (typeof sample === "string") {
            arr.push(url);
          } else {
            arr.push(item);
          }
        }
      } catch {}
    }

    // Render ONCE
    await sleep(50);
    const r = scan.renderFns[0];
    if (r && typeof r.fn === "function") {
      try { r.fn.call(r.owner); } catch {}
    }

    await sleep(30);
    _scrubObjectObject(scan.arrays);

    return (playlistCount() > beforeUI) || _anyArrayHasUrl(scan.arrays, urlKey);
  }

  // ✅ CHANGED: add only, then click-first-play (NO direct audio.play here)
  async function addToSongsListAndPlay(url, name) {
    const added = await addToSongsListExact(url, name);

    // Let UI finish inserting the new row at the top
    await sleep(60);

    // Fire your "click first Play" (this drives highlight + playback)
    triggerClickFirstPlay(String(url || ""));

    if (!added) {
      console.warn("[NCZ EXT] Could not confirm playlist UI updated, but still triggered click-first-play.", { url, name });
    }
  }

  // -----------------------------
  // Overlay UI
  // -----------------------------
  let overlay = null;
  let overlayList = null;
  let overlayCrumb = null;
  let overlayMsg = null;

  const state = {
    mode: "mounts",
    currentMount: null,
    path: ""
  };

  function ensureOverlay(hostEl) {
    if (overlay) return;

    ensureStyles();

    const panel = hostEl.parentElement || hostEl;
    const cs = getComputedStyle(panel);
    if (cs.position === "static") panel.style.position = "relative";

    overlay = document.createElement("div");
    overlay.id = "__ncz_ext_url_overlay__";
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
        <div style="font-weight:700; color:var(--text,#e9eefc);">${CFG.virtualFolderName}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">

          <button id="__ncz_ext_close_btn__" type="button" style="padding:6px 10px; border-radius:10px; border:1px solid var(--line,#1e2742); background:transparent; color:var(--text,#e9eefc); cursor:pointer;">Close</button>
        </div>
      </div>

      <div style="padding:8px 12px; border-bottom:1px solid var(--line,#1e2742); color:var(--muted,#a9b3cf); font-size:12px;">
        <span id="__ncz_ext_crumb__">Mounts</span>
        <span id="__ncz_ext_msg__" style="float:right; color:var(--warn,#ffd36a);"></span>
      </div>

      <div id="__ncz_ext_list__" class="ncz-dark-scroll" style="position:absolute; inset:86px 0 0 0; overflow:auto; padding:8px 10px;"></div>

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

    overlayList = overlay.querySelector("#__ncz_ext_list__");
    overlayCrumb = overlay.querySelector("#__ncz_ext_crumb__");
    overlayMsg = overlay.querySelector("#__ncz_ext_msg__");

    const modal = overlay.querySelector("#__ncz_ext_modal__");
    const inp = overlay.querySelector("#__ncz_ext_url_inp__");
    const err = overlay.querySelector("#__ncz_ext_modal_err__");
    const recBox = overlay.querySelector("#__ncz_ext_rec_list__");

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
        b.addEventListener("click", async () => {
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
            const existing = mounts.find(m => m.id === id);
            if (!existing) mounts.unshift({ id, url: u, label, createdAt: Date.now() });
            saveMounts(mounts);

            modal.style.display = "none";
            state.mode = "browse";
            state.currentMount = { id, url: u, label };
            state.path = "";
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

    function showModal(show) {
      modal.style.display = show ? "flex" : "none";
      err.textContent = "";
      recBox.style.display = "none";
      if (show) {
        inp.value = "";
        setTimeout(() => inp.focus(), 0);
      }
    }

    overlay.querySelector("#__ncz_ext_close_btn__").addEventListener("click", () => {
      overlay.style.display = "none";
    });



    overlay.querySelector("#__ncz_ext_showrec_btn__").addEventListener("click", () => {
      const show = recBox.style.display !== "block";
      recBox.style.display = show ? "block" : "none";
      if (show) buildRecList();
    });

    overlay.querySelector("#__ncz_ext_cancel_btn__").addEventListener("click", () => {
      showModal(false);
    });

    overlay.querySelector("#__ncz_ext_retrieve_btn__").addEventListener("click", async () => {
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

        const existing = mounts.find(m => m.id === id);
        if (!existing) {
          mounts.unshift({ id, url, label, createdAt: Date.now() });
          saveMounts(mounts);
        }

        showModal(false);

        state.mode = "browse";
        state.currentMount = { id, url, label };
        state.path = "";
        await renderBrowse();
      } catch (e) {
        err.textContent = String(e && e.message ? e.message : e);
      } finally {
        overlayMsg.textContent = "";
      }
    });

    renderMounts();
  }

  function showOverlay(hostEl) {
    ensureOverlay(hostEl);
    overlay.style.display = "block";
    state.mode = "mounts";
    state.currentMount = null;
    state.path = "";
    renderMounts();
  }

  function renderRow({ icon, text, subtext, onClick }) {
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
      <div style="flex:1;">
        <div style="font-weight:700; line-height:1.1;">${escapeHtml(text || "")}</div>
        ${subtext ? `<div style="font-size:12px; color:var(--muted,#a9b3cf); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(subtext)}</div>` : ""}
      </div>
    `;
    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      onClick && onClick(e);
    });
    return row;
  }

  function renderMounts() {
    if (!overlayList) return;
    overlayCrumb.textContent = "Mounts";
    overlayList.innerHTML = "";

    overlayList.appendChild(renderRow({
      icon: "➕",
      text: "Add a URL…",
      subtext: "Fetch a directory listing",
      onClick: () => overlay.querySelector("#__ncz_ext_modal__").style.display = "flex"
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
  if (btn) btn.click(); // toggles + builds the rec list
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
      overlayList.appendChild(renderRow({
        icon: "📁",
        text: m.label || m.url,
        subtext: m.url,
        onClick: async () => {
          state.mode = "browse";
          state.currentMount = { id: m.id, url: m.url, label: m.label || m.url };
          state.path = "";
          await renderBrowse();
        }
      }));
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
          renderMounts();
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
        const nextPath = d.path ? String(d.path) : joinPath(state.path, name.replace(/\/+$/,"") + "/");
        overlayList.appendChild(renderRow({
          icon: "📁",
          text: name.replace(/\/+$/,""),
          subtext: nextPath,
          onClick: async () => {
            state.path = nextPath;
            await renderBrowse();
          }
        }));
      }

      for (const f of files) {
        const name = f.name || f.title || f.path || "file";
        const url = f.url || f.href || "";
        const playable = (url && looksPlayable(url)) || looksPlayable(name);

        overlayList.appendChild(renderRow({
          icon: playable ? "▶️" : "📄",
          text: String(name).replace(/^.*\//,""),
          subtext: url || (f.path ? String(f.path) : ""),
          onClick: async () => {
            if (!url) return;
            if (playable) {
              await addToSongsListAndPlay(url, name);
            } else {
              window.open(url, "_blank", "noopener");
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
    } catch (e) {
      const err = document.createElement("div");
      err.style.cssText = "padding:10px; color:var(--bad,#ff5c7a); font-size:13px; white-space:pre-wrap;";
      err.textContent = `Error: ${String(e && e.message ? e.message : e)}`;
      overlayList.appendChild(err);
    } finally {
      overlayMsg.textContent = "";
    }
  }

  // -----------------------------
  // Inject the fake folder into the Archive list
  // -----------------------------
  function isAtArchiveRoot(listEl) {
    if (!CFG.rootOnly) return true;

    const dp = listEl.getAttribute("data-path") || (listEl.dataset ? listEl.dataset.path : "") || "";
    if (dp === "" || dp === "/" || dp === "./") return true;

    const txt = listEl.textContent || "";
    if (/\bUp\b|\.\.\//i.test(txt)) return false;

    return true;
  }

  function findArchiveListEl() {
  // ✅ Force the real archive list container in your left music pane
  const el = document.getElementById("__ncz_music_list__");
  return el || null;
}

// --- REPLACE injectVirtualFolder(listEl) WITH THIS ---
function injectVirtualFolder(listEl) {
  if (!listEl) return;
  if (!isAtArchiveRoot(listEl)) return;

  ensureStyles();
  if (!listEl.classList.contains("ncz-dark-scroll")) listEl.classList.add("ncz-dark-scroll");

  // already injected?
  if (listEl.querySelector("[data-ncz-ext-virtual='1']")) return;

  // ✅ Build it like your other leftbar items (same structure/classes)
  const row = document.createElement("div");
  row.setAttribute("data-ncz-ext-virtual", "1");
  row.className = "__ncz_lb_item__";
  row.title = "External URL Browser…";
  row.style.margin = "0 0 6px 0"; // keep spacing like your lists

  row.innerHTML = `
    <div class="__ncz_lb_icon__">🌐</div>
    <div class="__ncz_lb_labelwrap__" style="min-width:0">
      <div class="__ncz_lb_label__">${escapeHtml(CFG.virtualFolderName)}</div>
      <div class="__ncz_lb_hint__">Add & browse external directory listings</div>
    </div>
  `;

  const open = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    showOverlay(listEl); // overlay anchors to music pane
  };

  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") open(e);
  });
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  // ✅ NO insertBefore (avoids NotFoundError + weird DOM rebuild issues)
  listEl.prepend(row);
}

  function start() {
    const listEl = findArchiveListEl();
    if (!listEl) {
      console.warn("[NCZ EXT] Could not find archive list element. Set CFG.archiveListSelectors.");
      return;
    }

    injectVirtualFolder(listEl);

    const obs = new MutationObserver(() => {
      injectVirtualFolder(listEl);
    });
    obs.observe(listEl, { childList: true, subtree: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();




















// ✅ NCZ PATCH: Add ✕ unmount button to each saved mount row (removes from LS + UI)
(() => {
  "use strict";
  if (window.__NCZ_EXT_UNMOUNT_X_PATCH__) return;
  window.__NCZ_EXT_UNMOUNT_X_PATCH__ = true;

  const OVERLAY_ID = "__ncz_ext_url_overlay__";
  const LIST_ID = "__ncz_ext_list__";
  const LS_KEY = "NCZ_EXT_MOUNTS_V1";

  const norm = (u) => String(u || "").trim().replace(/\/+$/, "");

  function loadMounts() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveMounts(mounts) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(mounts)); } catch {}
  }

  function removeMountByUrl(url) {
    const key = norm(url);
    if (!key) return false;
    const mounts = loadMounts();
    const next = mounts.filter(m => norm(m && m.url) !== key);
    if (next.length === mounts.length) return false;
    saveMounts(next);
    return true;
  }

  function stopAll(e) {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
  }

  function getUrlFromBtn(btn) {
    const txt = (btn && btn.textContent) ? btn.textContent : "";
    const m = txt.match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : "";
  }

  function isMountRow(btn) {
    if (!btn || btn.nodeType !== 1) return false;
    if (!btn.matches("button")) return false;
    // mount rows use icon 📁 as the first little icon div
    const iconDiv = btn.querySelector("div[style*='width:22px']");
    const icon = (iconDiv && iconDiv.textContent) ? iconDiv.textContent.trim() : "";
    if (!icon.includes("📁")) return false;
    // should contain a URL in the subtext
    return /https?:\/\//i.test(btn.textContent || "");
  }

  function decorateMountRows() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    const list = overlay.querySelector("#" + LIST_ID);
    if (!list) return;

    const buttons = Array.from(list.querySelectorAll("button"));
    for (const btn of buttons) {
      if (!isMountRow(btn)) continue;
      if (btn.querySelector("span.__ncz_unmount_x__")) continue;

      // make space for the X
      btn.style.position = btn.style.position || "relative";
      // ensure right padding so it doesn't overlap content
      if (!/padding-right/i.test(btn.getAttribute("style") || "")) {
        btn.style.paddingRight = "36px";
      }

      const x = document.createElement("span");
      x.className = "__ncz_unmount_x__";
      x.textContent = "✕";
      x.title = "Remove mount";
      x.setAttribute("role", "button");
      x.style.cssText = `
        position:absolute;
        right:10px;
        top:50%;
        transform:translateY(-50%);
        font-weight:900;
        font-size:16px;
        line-height:16px;
        color: var(--bad, #ff5c7a);
        opacity: .95;
        cursor:pointer;
        user-select:none;
      `;

      x.addEventListener("click", (e) => {
        stopAll(e);

        const url = getUrlFromBtn(btn);
        if (!url) return;

        const ok = removeMountByUrl(url);
        if (ok) {
          // remove row immediately from UI
          btn.remove();
        } else {
          // fallback: still remove from UI if LS didn't match
          btn.remove();
        }
      }, true);

      // also swallow mousedown so the button doesn't "press" underneath
      x.addEventListener("mousedown", stopAll, true);

      btn.appendChild(x);
    }
  }

  function start() {
    // decorate now (if overlay already exists)
    decorateMountRows();

    // watch for overlay/list rebuilds
    const obs = new MutationObserver(() => {
      decorateMountRows();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
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

