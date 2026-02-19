




//chat
// -----------------------------
// NCZ Chat Panel + Leftbar Toggle
// -----------------------------
(() => {
  "use strict";

  const SID_ID = "__ncz_leftbar__";
  const CHAT_ACTION = "chat";

  const STORE_OPEN = "NCZ_UI_CHAT_OPEN";
  const STORE_ROOM = "NCZ_UI_CHAT_ROOM";

  const STYLE_ID = "__ncz_chat_styles__";
  const PANEL_ID = "__ncz_chat_panel__";
  const LOG_ID   = "__ncz_chat_log__";
  const INP_ID   = "__ncz_chat_input__";
  const SEND_ID  = "__ncz_chat_send__";
  const ROOM_ID  = "__ncz_chat_room__";
  const NAME_ID  = "__ncz_chat_name__";
  const STAT_ID  = "__ncz_chat_stat__";

  const POLL_MS = 25000;

  const $id = (id) => document.getElementById(id);

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[c]));
  }

  function normBaseUrl(u){
    u = String(u || "").trim();
    if(!u) return (window.location.origin || "").replace(/\/+$/,"");
    return u.replace(/\/+$/, "");
  }

  function getAuthorName(){
    const el = $id("__ncz_author_input__")
      || document.querySelector('input[name="author"]')
      || document.querySelector('input[data-role="author"]');
    const v = (el && el.value) ? String(el.value).trim() : "";
    return v || "anon";
  }

  function fmtTime(ts){
    // ts can be ms or ISO. Prefer ms if numeric.
    try{
      if(typeof ts === "number") return new Date(ts).toLocaleString();
      // ISO string
      return new Date(String(ts)).toLocaleString();
    }catch{
      return "";
    }
  }

  function linkifyAllowed(text){
    // Only auto-linkify youtube.com, suno.com, soundcloud.com
    const raw = String(text || "");
    const esc = escapeHtml(raw);

    // Find URLs in the *escaped* string.
    // We’ll validate domains in a second pass.
    return esc.replace(
      /\bhttps?:\/\/[^\s<]+/gi,
      (url) => {
        // url is escaped already, so decode for checking domain safely
        const unesc = url
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        let host = "";
        try{
          host = (new URL(unesc)).hostname.toLowerCase();
        }catch{
          return url;
        }

        const ok =
          host === "youtube.com" || host.endsWith(".youtube.com") ||
          host === "youtu.be" ||
          host === "suno.com" || host.endsWith(".suno.com") ||
          host === "soundcloud.com" || host.endsWith(".soundcloud.com");

        if(!ok) return url;

        // Keep original escaped url for href/text
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      }
    );
  }

  async function apiFetch(path, { method="GET", body=null } = {}){
    const baseUrl = normBaseUrl($id("baseUrl")?.value);
    const url = baseUrl + path;

    const authMode = $id("authMode")?.value || "none";
    const apiKey = String($id("apiKey")?.value || "").trim();

    const headers = {};
    if(method !== "GET" && method !== "HEAD") headers["Content-Type"] = "application/json";
    if(authMode === "header" && apiKey) headers["Authorization"] = "Bearer " + apiKey;

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });

    let json = null;
    try { json = await resp.json(); } catch {}

    if(!resp.ok){
      const msg = (json && (json.detail || json.error)) ? (json.detail || json.error) : (`HTTP ${resp.status}`);
      throw new Error(msg);
    }

    // tolerate {code,data}
    if(json && typeof json === "object" && ("code" in json) && ("data" in json)){
      if(json.code !== 200) throw new Error(json.error || ("API code " + json.code));
      return json.data;
    }

    return json;
  }

  function ensureStyles(){
    if($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${PANEL_ID}{
        border:1px solid rgba(255,255,255,.10);
        background: rgba(0,0,0,.18);
        border-radius: 14px;
        padding: 10px;
        margin: 0 0 12px 0;
      }
      #${PANEL_ID} .__hdr__{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:wrap;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .__hdr__ .__left__{
        display:flex; align-items:center; gap:10px; flex-wrap:wrap;
      }
      #${PANEL_ID} .__title__{
        font-weight: 900;
        font-size: 13px;
      }
      #${PANEL_ID} .__meta__{
        font-size: 12px;
        color: rgba(169,179,207,.95);
        font-family: var(--mono);
      }
      #${LOG_ID}{
        height: 240px;
        overflow:auto;
        border:1px solid rgba(255,255,255,.10);
        background: rgba(7,10,18,.55);
        border-radius: 12px;
        padding: 10px;
      }
      #${LOG_ID} .__msg__{
        padding: 8px 8px;
        border-bottom: 1px solid rgba(255,255,255,.06);
        line-height: 1.35;
        font-size: 13px;
        word-break: break-word;
      }
      #${LOG_ID} .__msg__:last-child{ border-bottom: 0; }
      #${LOG_ID} .__ts__{
        color: rgba(169,179,207,.95);
        font-family: var(--mono);
        font-size: 11px;
        margin-right: 8px;
      }
      #${LOG_ID} .__who__{
        font-weight: 900;
        margin-right: 6px;
      }
      #${LOG_ID} .__reply__{
        margin-left: 10px;
        padding: 4px 8px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.06);
        cursor: pointer;
        font-weight: 900;
        font-size: 12px;
      }
      #${LOG_ID} .__reply__:hover{ background: rgba(255,255,255,.10); }

      #${PANEL_ID} .__bottom__{
        display:flex;
        gap:10px;
        align-items:center;
        margin-top: 10px;
      }
      #${INP_ID}{
        flex: 1 1 auto;
        width: 100%;
      }
      #${SEND_ID}{
        flex: 0 0 auto;
        white-space: nowrap;
      }

      #${PANEL_ID} select{
        min-width: 120px;
      }
    `;
    document.head.appendChild(st);
  }

  function ensureLeftbarItem(){
    const side = $id(SID_ID);
    if(!side) return null;
    const body = side.querySelector(".__ncz_lb_body__");
    if(!body) return null;

    let item = body.querySelector(`[data-action="${CHAT_ACTION}"]`);
    if(item) return item;

    item = document.createElement("div");
    item.className = "__ncz_lb_item__ __ncz_lb_mainitem__";
    item.setAttribute("data-action", CHAT_ACTION);
    item.title = "Show Chat";
    item.innerHTML = `
      <div class="__ncz_lb_icon__">💬</div>
      <div class="__ncz_lb_labelwrap__" style="min-width:0">
        <div class="__ncz_lb_label__" data-role="chatLabel">Show Chat</div>
        <div class="__ncz_lb_hint__" data-role="chatHint">Open chat</div>
      </div>
    `;

    // Insert right after "View Music" if present, else at top
    const viewMusic = body.querySelector('[data-action="music"]');
    if(viewMusic && viewMusic.nextSibling) body.insertBefore(item, viewMusic.nextSibling);
    else body.insertBefore(item, body.firstChild);

    return item;
  }

  function findInsertAnchor(container){
    // User requested: above song title area
    const titleEl = $id("__ncz_songtitle_input__");
    if(titleEl){
      // try the nearest label or a wrapping div
      const lab = container.querySelector(`label[for="__ncz_songtitle_input__"]`);
      if(lab) return lab;
      const wrap = titleEl.closest("div");
      if(wrap) return wrap;
    }
    // fallback: top of container
    return container.firstChild;
  }

  function ensurePanel(){
    let panel = $id(PANEL_ID);
    if(panel) return panel;

    ensureStyles();

    // Put it inside the left "Create a generation task" card body
    const baseUrl = $id("baseUrl");
    const leftBd = baseUrl ? baseUrl.closest(".bd") : null;
    if(!leftBd) return null;

    panel = document.createElement("div");
    panel.id = PANEL_ID;

    const savedRoom = clampRoom(loadRoom());

    panel.innerHTML = `
      <div class="__hdr__">
        <div class="__left__">
          <div class="__title__">Chat</div>
          <div class="__meta__">Name: <span id="${NAME_ID}"></span></div>
          <div class="__meta__" id="${STAT_ID}">—</div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
          <label class="small" style="margin:0; display:flex; align-items:center; gap:8px">
            Room
            <select id="${ROOM_ID}">
              ${Array.from({length:13}, (_,i)=>i+1).map(n => `<option value="${n}" ${n===savedRoom?"selected":""}>${n}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>

      <div id="${LOG_ID}"></div>

      <div class="__bottom__">
        <input id="${INP_ID}" type="text" placeholder="Type a message…" />
        <button id="${SEND_ID}" type="button">Send</button>
      </div>
      <div class="small" style="margin-top:8px; color:rgba(169,179,207,.95)">
        Links auto-clickable only for youtube.com, suno.com, soundcloud.com
      </div>
    `;

    const anchor = findInsertAnchor(leftBd);
    leftBd.insertBefore(panel, anchor || null);

    return panel;
  }

  function clampRoom(n){
    n = Number(n);
    if(!Number.isFinite(n)) return 1;
    n = Math.trunc(n);
    if(n < 1) n = 1;
    if(n > 13) n = 13;
    return n;
  }

  function loadRoom(){
    try{
      const v = localStorage.getItem(STORE_ROOM);
      return v ? Number(v) : 1;
    }catch{ return 1; }
  }

  function saveRoom(n){
    try{ localStorage.setItem(STORE_ROOM, String(clampRoom(n))); }catch{}
  }

  function loadOpen(){
    try{ return localStorage.getItem(STORE_OPEN) === "1"; }catch{ return false; }
  }

  function saveOpen(v){
    try{ localStorage.setItem(STORE_OPEN, v ? "1" : "0"); }catch{}
  }

  function isNearBottom(el){
    const gap = 140; // px
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < gap;
  }

  function appendMessageRow(logEl, msg){
    const ts = fmtTime(msg.ts || msg.time || msg.created_at || msg.id);
    const who = String(msg.author || "anon").trim() || "anon";
    const text = String(msg.message || "").trim();

    const row = document.createElement("div");
    row.className = "__msg__";
    row.setAttribute("data-author", who);

    const htmlMsg = linkifyAllowed(text);

    row.innerHTML = `
      <span class="__ts__">${escapeHtml(ts)}</span>
      <span class="__who__">${escapeHtml(who)}</span>
      <span class="__txt__">: ${htmlMsg}</span>
      <button type="button" class="__reply__" title="Reply">↩</button>
    `;

    const replyBtn = row.querySelector("button.__reply__");
    if(replyBtn){
      replyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const inp = $id(INP_ID);
        if(!inp) return;
        const name = row.getAttribute("data-author") || "";
        const pre = name ? ("@" + name + " ") : "@ ";
        // avoid duplicating if user already typed the same prefix at start
        const cur = String(inp.value || "");
        inp.value = pre + cur.replace(/^@\S+\s+/, "");
        inp.focus();
        // move cursor to end
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch {}
      });
    }

    logEl.appendChild(row);
  }

  // ---- state ----
  let open = false;
  let pollTimer = null;
  let lastId = 0;
  let inFlight = false;

  function setSidebarLabel(item, isOpen){
    const lab = item.querySelector('[data-role="chatLabel"]');
    const hint = item.querySelector('[data-role="chatHint"]');
    if(lab) lab.textContent = isOpen ? "Hide Chat" : "Show Chat";
    if(hint) hint.textContent = isOpen ? "Close chat" : "Open chat";
    item.title = isOpen ? "Hide Chat" : "Show Chat";
  }

  async function fetchMessages({ reset=false } = {}){
    if(inFlight) return;
    inFlight = true;

    const logEl = $id(LOG_ID);
    const statEl = $id(STAT_ID);
    const roomSel = $id(ROOM_ID);

    try{
      if(!logEl || !roomSel) return;

      const room = clampRoom(roomSel.value);
      const near = isNearBottom(logEl);

      // If reset, ask for last N messages (after_id=0)
      const after = reset ? 0 : (Number(lastId) || 0);

      if(statEl) statEl.textContent = "Syncing…";

      const data = await apiFetch(`/chat/messages?room=${room}&after_id=${after}&limit=80`, { method:"GET" });
      const msgs = Array.isArray(data?.messages) ? data.messages : (Array.isArray(data) ? data : []);

      if(reset) logEl.innerHTML = "";

      let maxId = Number(lastId) || 0;

      for(const m of msgs){
        appendMessageRow(logEl, m);
        const mid = Number(m.id);
        if(Number.isFinite(mid)) maxId = Math.max(maxId, mid);
      }

      lastId = maxId;

      if(near) logEl.scrollTop = logEl.scrollHeight;

      if(statEl){
        statEl.textContent = msgs.length ? `Updated (${msgs.length} new)` : "Up to date";
      }
    }catch(e){
      if(statEl) statEl.textContent = "Offline / error";
      // keep quiet in UI beyond the stat text
      console.warn("[chat] fetch failed:", e.message);
    } finally {
      inFlight = false;
    }
  }

  async function sendMessage(){
    const inp = $id(INP_ID);
    const roomSel = $id(ROOM_ID);
    const statEl = $id(STAT_ID);
    const logEl = $id(LOG_ID);

    if(!inp || !roomSel || !logEl) return;

    const msg = String(inp.value || "").trim();
    if(!msg) return;

    const room = clampRoom(roomSel.value);
    const author = getAuthorName();

    try{
      if(statEl) statEl.textContent = "Sending…";
      inp.disabled = true;

      const resp = await apiFetch("/chat/send", {
        method:"POST",
        body: { room, author, message: msg }
      });

      // Optimistic append: server may return {message:{...}} or the message itself
      const m = resp?.message || resp;
      if(m && typeof m === "object"){
        appendMessageRow(logEl, m);
        const mid = Number(m.id);
        if(Number.isFinite(mid)) lastId = Math.max(lastId, mid);

        logEl.scrollTop = logEl.scrollHeight;
      } else {
        // fallback: hard refresh
        await fetchMessages({ reset:false });
      }

      inp.value = "";
      if(statEl) statEl.textContent = "Sent";
    }catch(e){
      if(statEl) statEl.textContent = "Send failed";
      console.warn("[chat] send failed:", e.message);
    } finally {
      inp.disabled = false;
      inp.focus();
    }
  }

  function startPolling(){
    stopPolling();
    pollTimer = setInterval(() => {
      if(!open) return;
      if(document.hidden) return;
      fetchMessages({ reset:false });
    }, POLL_MS);
  }

  function stopPolling(){
    if(pollTimer){
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function setOpen(nextOpen){
    const panel = ensurePanel();
    const item = ensureLeftbarItem();
    if(!panel || !item) return;

    open = !!nextOpen;

    panel.style.display = open ? "block" : "none";
    setSidebarLabel(item, open);
    saveOpen(open);

    // Update visible name
    const nameEl = $id(NAME_ID);
    if(nameEl) nameEl.textContent = getAuthorName();

    if(open){
      const roomSel = $id(ROOM_ID);
      const room = clampRoom(roomSel ? roomSel.value : loadRoom());
      saveRoom(room);

      lastId = 0;
      fetchMessages({ reset:true });
      startPolling();
      // immediate poll once more after short delay (helps first-open)
      setTimeout(() => fetchMessages({ reset:false }), 400);
    } else {
      stopPolling();
    }
  }

  // ---- init wiring ----
  function init(){
    const item = ensureLeftbarItem();
    const panel = ensurePanel();
    if(!item || !panel) return;

    // default hidden unless saved open
    const wasOpen = loadOpen();
    setOpen(!!wasOpen);

    // bind sidebar click
    if(item.dataset.__nczBound__ !== "1"){
      item.dataset.__nczBound__ = "1";
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Toggle open/close
        setOpen(!open);
      });
    }

    // room change
    const roomSel = $id(ROOM_ID);
    if(roomSel && roomSel.dataset.__nczBound__ !== "1"){
      roomSel.dataset.__nczBound__ = "1";
      roomSel.addEventListener("change", () => {
        const r = clampRoom(roomSel.value);
        saveRoom(r);
        lastId = 0;
        fetchMessages({ reset:true });
      });
    }

    // send button + enter-to-send
    const sendBtn = $id(SEND_ID);
    const inp = $id(INP_ID);

    if(sendBtn && sendBtn.dataset.__nczBound__ !== "1"){
      sendBtn.dataset.__nczBound__ = "1";
      sendBtn.addEventListener("click", (e) => {
        e.preventDefault();
        sendMessage();
      });
    }

    if(inp && inp.dataset.__nczBound__ !== "1"){
      inp.dataset.__nczBound__ = "1";
      inp.addEventListener("keydown", (e) => {
        if(e.key === "Enter" && !e.shiftKey){
          e.preventDefault();
          sendMessage();
        }
      });
    }

    // Keep name display synced (author field may change)
    const authorEl = $id("__ncz_author_input__");
    if(authorEl && authorEl.dataset.__nczChatBound__ !== "1"){
      authorEl.dataset.__nczChatBound__ = "1";
      authorEl.addEventListener("input", () => {
        const nameEl = $id(NAME_ID);
        if(nameEl) nameEl.textContent = getAuthorName();
      });
    }

    console.log("[ncz-chat] ready");
  }

  // boot
  if(document.readyState === "complete") init();
  else window.addEventListener("load", init, { once:true });

})();


















//all space resizer
// draggable chat (FIXED + RELIABLE)
// Chat height drag-resizer (bottom bar) + make #__ncz_chat_log__ fill usable space
// ✅ Fixes show/hide: does NOT force display/min-height on wrapper (no more "can't hide")
// ✅ Fixes "randomly doesn't run": retries until chat mounts + re-inits if SPA remounts
(() => {
  "use strict";

  // Prevent double-install if this file gets loaded twice
  if (window.__NCZ_CHAT_RESIZER_INSTALLED__) return;
  window.__NCZ_CHAT_RESIZER_INSTALLED__ = true;

  // --------------------
  // CONFIG
  // --------------------
  const CHAT_SEL = ""; // optional: set to your chat wrapper selector if you know it

  const STORE_KEY = "NCZ_CHAT_HEIGHT_PX";
  const STYLE_ID  = "__ncz_chat_resizer_style__";
  const HANDLE_ID = "__ncz_chat_resizer_handle__";

  const MIN_H = 180; // px (only used while dragging / clamping)
  const MAX_PADDING_FROM_BOTTOM = 24; // px

  // Retry behavior (fixes “random”)
  const BOOT_TIMEOUT_MS = 15000; // how long we wait for the UI to mount
  const BOOT_INTERVAL_MS = 250;  // retry frequency while waiting

  // Internal
  const STATE = {
    chatEl: null,
    logEl: null,
    wrapperMO: null,
    bodyMO: null,
    retryTimer: null,
    lastInitAt: 0,
  };

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* Wrapper becomes flex-column, but ✅ DO NOT force display or min-height */
      .__ncz_chat_resizable__{
        flex-direction: column;
        overflow: hidden;
      }

      /* Make chat log consume remaining space */
      #__ncz_chat_log__{
        flex: 1 1 auto !important;
        min-height: 0 !important; /* critical for scroll in flex children */
        overflow-y: auto !important;
      }

      /* Drag handle */
      #${HANDLE_ID}{
        flex: 0 0 auto;
        height: 12px;
        cursor: ns-resize;
        user-select: none;
        touch-action: none;
        opacity: .9;
        background: linear-gradient(to bottom, rgba(255,255,255,0.06), rgba(0,0,0,0.0));
        border-top: 1px solid rgba(255,255,255,0.10);
      }
      #${HANDLE_ID}::after{
        content:"";
        display:block;
        margin: 4px auto 0 auto;
        width: 58px;
        height: 3px;
        border-radius: 999px;
        background: rgba(255,255,255,0.28);
        box-shadow: 0 1px 0 rgba(0,0,0,0.25);
      }

      body.__ncz_resizing_chat__{
        user-select:none !important;
        cursor:ns-resize !important;
      }
    `;
    document.head.appendChild(st);
  }

  function pickChatWrapper() {
    if (CHAT_SEL) return document.querySelector(CHAT_SEL);

    // Prefer: wrapper around #__ncz_chat_log__
    const log = document.getElementById("__ncz_chat_log__");
    if (log && log.parentElement) return log.parentElement;

    // Fallbacks
    const candidates = [
      "#__ncz_chat__",
      "#__ncz_chat_panel__",
      "#__ncz_chat_wrap__",
      "#chat",
      "#chatPanel",
      ".__chat__",
      ".__chat_panel__",
      "[data-chat]",
      "[data-ncz-chat]",
      "[id*='chat']",
      "[class*='chat']",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 80) return el;
    }
    return null;
  }

  function getMaxHeight(chatEl) {
    const r = chatEl.getBoundingClientRect();
    const max = Math.floor(window.innerHeight - r.top - MAX_PADDING_FROM_BOTTOM);
    return Math.max(MIN_H, max);
  }

  function ensureFlexWhenVisible(chatEl) {
    // ✅ Respect hide: if hidden, do nothing
    const disp = getComputedStyle(chatEl).display;
    if (disp === "none") return;

    // If it's visible, ensure it's a flex column layout.
    // We avoid !important so hide/show can still win.
    if (disp !== "flex") chatEl.style.display = "flex";
    chatEl.style.flexDirection = "column";
    chatEl.style.overflow = "hidden";
  }

  function detachObservers() {
    try { STATE.wrapperMO?.disconnect(); } catch {}
    try { STATE.bodyMO?.disconnect(); } catch {}
    STATE.wrapperMO = null;
    STATE.bodyMO = null;
  }

  function isAttached(el) {
    return !!(el && el.isConnected && document.documentElement.contains(el));
  }

  function init() {
    const chatEl = pickChatWrapper();
    const logEl = document.getElementById("__ncz_chat_log__");

    // If UI not mounted yet, signal "try again"
    if (!chatEl || !logEl) return false;

    addStyles();

    // Mark wrapper
    chatEl.classList.add("__ncz_chat_resizable__");

    // Ensure wrapper positioning (safe)
    const cs = getComputedStyle(chatEl);
    if (cs.position === "static") chatEl.style.position = "relative";

    // ✅ Only enforce flex if it's currently visible
    ensureFlexWhenVisible(chatEl);

    // Restore saved wrapper height (but don't block hide/collapse)
    const saved = parseInt(localStorage.getItem(STORE_KEY) || "", 10);
    if (Number.isFinite(saved) && saved > 0) {
      if (getComputedStyle(chatEl).display !== "none") {
        chatEl.style.height = `${Math.round(clamp(saved, MIN_H, getMaxHeight(chatEl)))}px`;
      }
    }

    // Add handle (only once)
    let handle = document.getElementById(HANDLE_ID);
    if (!handle) {
      handle = document.createElement("div");
      handle.id = HANDLE_ID;
      handle.title = "Drag to resize chat height";
      chatEl.appendChild(handle);
    } else {
      chatEl.appendChild(handle); // keep at bottom
    }

    // Prevent duplicate binding if init runs more than once
    if (handle.dataset.nczBound === "1") {
      // still refresh “keep at bottom” and flex if visible
      ensureFlexWhenVisible(chatEl);
    } else {
      handle.dataset.nczBound = "1";

      let resizing = false;
      let startY = 0;
      let startH = 0;

      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();

        // If hidden, ignore drags
        if (getComputedStyle(chatEl).display === "none") return;

        resizing = true;
        startY = e.clientY;

        const h = parseInt(getComputedStyle(chatEl).height, 10);
        startH = Number.isFinite(h) ? h : chatEl.getBoundingClientRect().height;

        document.body.classList.add("__ncz_resizing_chat__");
        handle.setPointerCapture?.(e.pointerId);

        // Ensure we're flex while resizing
        ensureFlexWhenVisible(chatEl);
      });

      handle.addEventListener("pointermove", (e) => {
        if (!resizing) return;
        const dy = e.clientY - startY; // down = taller
        const next = clamp(startH + dy, MIN_H, getMaxHeight(chatEl));
        chatEl.style.height = `${Math.round(next)}px`;
      });

      function endResize() {
        if (!resizing) return;
        resizing = false;
        document.body.classList.remove("__ncz_resizing_chat__");

        const h = parseInt(getComputedStyle(chatEl).height, 10);
        if (Number.isFinite(h) && h > 0) localStorage.setItem(STORE_KEY, String(h));
      }

      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("pointercancel", endResize);

      handle.addEventListener("dblclick", () => {
        localStorage.removeItem(STORE_KEY);
        chatEl.style.height = "";
      });

      // Watch for your show/hide code toggling visibility, and re-apply flex ONLY when visible
      const mo = new MutationObserver(() => {
        ensureFlexWhenVisible(chatEl);
      });
      mo.observe(chatEl, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
      STATE.wrapperMO = mo;
    }

    // Track what we attached to
    STATE.chatEl = chatEl;
    STATE.logEl = logEl;
    STATE.lastInitAt = Date.now();

    // Also watch for remounts / DOM swaps (SPA) and re-init if needed
    if (!STATE.bodyMO) {
      let pending = false;
      const bodyMo = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
          pending = false;

          // If our wrapper/log got replaced or detached, re-run init
          const curChat = STATE.chatEl;
          const curLog  = STATE.logEl;

          const stillOk =
            isAttached(curChat) &&
            isAttached(curLog) &&
            curChat.contains(curLog) &&
            document.getElementById(HANDLE_ID);

          if (!stillOk) {
            // detach wrapper observer; we’ll reattach on next init success
            try { STATE.wrapperMO?.disconnect(); } catch {}
            STATE.wrapperMO = null;
            // attempt re-init (will succeed when DOM is stable)
            bootWithRetry();
          }
        }, 200);
      });
      bodyMo.observe(document.body, { childList: true, subtree: true });
      STATE.bodyMO = bodyMo;
    }

    console.log("[NCZ chat resizer] Attached:", { wrapper: chatEl, log: logEl });
    return true;
  }

  function bootWithRetry() {
    // If we already have a retry loop running, don't start another
    if (STATE.retryTimer) return;

    const start = Date.now();

    const tick = () => {
      try {
        if (init()) {
          // success — stop retry loop
          clearTimeout(STATE.retryTimer);
          STATE.retryTimer = null;
          return;
        }
      } catch (e) {
        console.warn("[NCZ chat resizer] init error:", e);
      }

      if (Date.now() - start > BOOT_TIMEOUT_MS) {
        console.warn("[NCZ chat resizer] Gave up waiting for chat to mount. Set CHAT_SEL if your wrapper is custom.");
        clearTimeout(STATE.retryTimer);
        STATE.retryTimer = null;
        return;
      }

      STATE.retryTimer = setTimeout(tick, BOOT_INTERVAL_MS);
    };

    STATE.retryTimer = setTimeout(tick, 0);
  }

  function boot() {
    // Debounce: avoid spamming init if multiple events fire
    if (Date.now() - STATE.lastInitAt < 150) return;
    bootWithRetry();
  }

  // Run after DOM is ready (and again on full load as a safety net)
  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else window.addEventListener("DOMContentLoaded", boot);

  window.addEventListener("load", boot, { once: true });
})();
















//random button
// ✅ Random Mode toggle (Song List)
// - Adds a "Random" button next to your existing Reverse button
// - When ON: Next/Prev + ended => random track from window.songs (skips deleted)
// - When OFF: restores original listeners (does NOT autoplay)
(() => {
  "use strict";

  const BTN_ID = "__ncz_songlist_random_btn__";
  const STYLE_ID = "__ncz_songlist_random_style__";

  // shared state (survives hot reloads)
  const state = (window.__nczRandomModeState ||= {
    enabled: false,
    origNext: null,
    origPrev: null,
  });

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${BTN_ID}{
        padding: 6px 10px;
        border-radius: 10px;
        font-weight: 800;
        font-size: 12px;
        background: rgba(255,255,255,.08);
      }
      #${BTN_ID}:hover{ background: rgba(255,255,255,.12); }

      /* ON state */
      #${BTN_ID}.__on__{
        background: rgba(255,211,106,.18) !important;
        border: 1px solid rgba(255,211,106,.35) !important;
      }
      #${BTN_ID}.__on__:hover{
        background: rgba(255,211,106,.26) !important;
      }
    `;
    document.head.appendChild(st);
  }

  function txt(el){ return (el?.textContent || "").trim().toLowerCase(); }

  function findReverseButton() {
    // Search within the Queue & Song List card first
    const scope = document.getElementById("resultBox") || document.body;

    const btns = Array.from(scope.querySelectorAll("button"));
    // common cases: text "Reverse", title contains reverse, id contains reverse
    return btns.find(b => {
      const t = txt(b);
      const id = String(b.id || "").toLowerCase();
      const title = String(b.title || "").toLowerCase();
      return t === "reverse" || t.includes("reverse") || title.includes("reverse") || id.includes("reverse");
    }) || null;
  }

  function findSongListLabel() {
    const scope = document.getElementById("resultBox") || document.body;
    const smalls = Array.from(scope.querySelectorAll(".small"));
    return smalls.find(el => txt(el) === "song list") || null;
  }

  function setBtnUi(btn) {
    if (!btn) return;
    btn.classList.toggle("__on__", !!state.enabled);
    btn.textContent = state.enabled ? "Random: ON" : "Random";
    btn.title = state.enabled
      ? "Random mode is ON (Next/Prev/Ended => random). Click to turn OFF."
      : "Random mode is OFF. Click to turn ON + play a random song.";
  }

  function getSongsArray() {
    return Array.isArray(window.songs) ? window.songs : [];
  }

  function getPlayableIndices() {
    const arr = getSongsArray();
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!s || s.__deleted) continue;
      if (s.url) out.push(i);
    }
    return out;
  }

  function currentIndex() {
    const arr = getSongsArray();

    // 1) global index if valid
    const gi = (typeof window.currentSongIndex === "number") ? window.currentSongIndex : -1;
    if (gi >= 0 && gi < arr.length && arr[gi] && !arr[gi].__deleted) return gi;

    // 2) match player src
    const player = document.getElementById("player");
    const src = (player && (player.currentSrc || player.src) || "").trim();
    if (!src) return -1;

    const hit = arr.findIndex(s => s && !s.__deleted && s.url === src);
    return hit;
  }

  function pickRandomIndex() {
    const idxs = getPlayableIndices();
    if (!idxs.length) return -1;

    const cur = currentIndex();
    let pick = idxs[Math.floor(Math.random() * idxs.length)];

    // try not to repeat if possible
    if (idxs.length > 1) {
      let tries = 0;
      while (pick === cur && tries < 12) {
        pick = idxs[Math.floor(Math.random() * idxs.length)];
        tries++;
      }
    }
    return pick;
  }

  function playRandom({ autoplay = true } = {}) {
    const load = window.loadIntoMainPlayer;
    if (typeof load !== "function") return false;

    const i = pickRandomIndex();
    if (i < 0) return false;

    // Force "new/song list" mode for navigation semantics
    try { window.__nczLastPlaylist = "new"; } catch {}

    load(i, !!autoplay);
    return true;
  }

  function enableRandomMode(btn) {
    if (state.enabled) return;

    state.enabled = true;

    // save originals (so we can restore exactly)
    state.origNext = (typeof window.__nczPlayNext === "function") ? window.__nczPlayNext : null;
    state.origPrev = (typeof window.__nczPlayPrev === "function") ? window.__nczPlayPrev : null;

    // override router functions (these are what your Next/Prev buttons + ended handler use)
    window.__nczPlayNext = function(_opts = {}) {
      return playRandom({ autoplay: true });
    };
    window.__nczPlayPrev = function(_opts = {}) {
      return playRandom({ autoplay: true });
    };

    setBtnUi(btn);

    // ✅ On enable: immediately play a random track
    playRandom({ autoplay: true });
  }

  function disableRandomMode(btn) {
    if (!state.enabled) return;

    state.enabled = false;

    // restore originals
    if (state.origNext) window.__nczPlayNext = state.origNext;
    else { try { delete window.__nczPlayNext; } catch { window.__nczPlayNext = undefined; } }

    if (state.origPrev) window.__nczPlayPrev = state.origPrev;
    else { try { delete window.__nczPlayPrev; } catch { window.__nczPlayPrev = undefined; } }

    state.origNext = null;
    state.origPrev = null;

    setBtnUi(btn);

    // ✅ On disable: DO NOT start a new track (toggle only)
  }

  function mountButton() {
    ensureStyles();

    // idempotent
    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = BTN_ID;
      btn.type = "button";
      btn.className = "secondary";
    }

    setBtnUi(btn);

    // place it next to Reverse if possible
    const reverseBtn = findReverseButton();
    if (reverseBtn && reverseBtn.parentElement) {
      // keep it tight next to reverse
      btn.style.marginLeft = "8px";
      reverseBtn.insertAdjacentElement("afterend", btn);
    } else {
      // fallback: put it next to the "Song List" label
      const label = findSongListLabel();
      if (label && label.parentElement) {
        btn.style.marginLeft = "10px";
        label.insertAdjacentElement("afterend", btn);
      } else {
        // last resort: append into resultBox
        (document.getElementById("resultBox") || document.body).appendChild(btn);
      }
    }

    if (btn.dataset.__nczBound__ !== "1") {
      btn.dataset.__nczBound__ = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!state.enabled) enableRandomMode(btn);
        else disableRandomMode(btn);
      });
    }

    // if script reloads while enabled, reflect UI state
    setBtnUi(btn);
    return true;
  }

  // Try now; if reverse button gets injected later, observe briefly and mount then
  if (mountButton()) return;

  const obs = new MutationObserver(() => {
    if (mountButton()) obs.disconnect();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => obs.disconnect(), 15000);
})();


// NCZ: Add green ▶ next to ↩ reply when a message contains a suno.com UUID link.
// ✅ FIXES:
//   - Prevents "double add" behind-the-scenes (dedupes by UUID, does NOT create a second song entry)
//   - Uses taskId as REAL Suno song link: https://suno.com/song/<uuid>
//   - Linkifies the displayed taskId in the playlist row to be clickable
(() => {
  "use strict";

  const CHAT_LOG_ID = "__ncz_chat_log__";

  const SUNO_CDN_BASE  = "https://cdn1.suno.ai";
  const SUNO_SONG_BASE = "https://suno.com/song/";
  const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

  const STYLE_ID   = "__ncz_chat_suno_play_styles__";
  const BTN_CLASS  = "__ncz_chat_suno_play__";
  const SCAN_DEBOUNCE_MS = 80;

  // uuid -> blobUrl
  const blobCache = new Map();

  // last played info (used by your NaN patcher elsewhere)
  window.__nczLastSunoChat = window.__nczLastSunoChat || null;

  const $id = (id) => document.getElementById(id);

  function addStylesOnce() {
    if ($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${CHAT_LOG_ID} .${BTN_CLASS}{
        margin-left: 8px;
        padding: 4px 8px;
        border-radius: 10px;
        border: 1px solid rgba(75,227,138,.55);
        background: rgba(75,227,138,.12);
        color: rgba(75,227,138,1);
        cursor: pointer;
        font-weight: 900;
        font-size: 12px;
      }
      #${CHAT_LOG_ID} .${BTN_CLASS}:hover{
        background: rgba(75,227,138,.18);
        border-color: rgba(75,227,138,.85);
      }
      #${CHAT_LOG_ID} .${BTN_CLASS}[disabled]{
        opacity: .55;
        cursor: progress;
      }

      /* clickable taskId link inside playlist row */
      a.__ncz_suno_songlink__{
        color: rgba(106,166,255,1);
        text-decoration: underline;
        cursor: pointer;
        word-break: break-all;
        overflow-wrap: anywhere;
      }
      a.__ncz_suno_songlink__:hover{ opacity:.95; }
    `;
    document.head.appendChild(st);
  }

  function debounce(fn, ms) {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function extractUuidFromLink(a) {
    const href = a.getAttribute("href") || "";
    const m = href.match(UUID_RE);
    return m ? m[0] : null;
  }

  function isSunoDomain(a) {
    try {
      const u = new URL(a.href);
      const h = (u.hostname || "").toLowerCase();
      return h === "suno.com" || h.endsWith(".suno.com");
    } catch {
      return (a.getAttribute("href") || "").toLowerCase().includes("suno.com");
    }
  }

  function buildCdnUrl(uuid) {
    return `${SUNO_CDN_BASE}/${uuid}.mp3`;
  }

  function buildSongPage(uuid) {
    return `${SUNO_SONG_BASE}${uuid}`;
  }

  async function getBlobUrl(uuid) {
    const cached = blobCache.get(uuid);
    if (cached) return cached;

    const url = buildCdnUrl(uuid);
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    blobCache.set(uuid, blobUrl);
    return blobUrl;
  }

  function pickMainPlayerEl() {
    return (
      document.getElementById("player") ||
      document.querySelector("#__ncz_audio__") ||
      document.querySelector("audio") ||
      document.querySelector("video") ||
      null
    );
  }

  function playViaMainSystem(index) {
    const load = window.loadIntoMainPlayer;
    if (typeof load === "function") {
      try { window.__nczLastPlaylist = "new"; } catch {}
      try {
        load(index, true);
        return true;
      } catch (e) {
        console.warn("[NCZ suno-play] loadIntoMainPlayer failed:", e);
      }
    }

    // fallback: set the main player element src
    const player = pickMainPlayerEl();
    const s = (Array.isArray(window.songs) && window.songs[index]) ? window.songs[index] : null;
    const src = (s && (s.url || s.src)) ? (s.url || s.src) : "";
    if (!player || !src) return false;

    try {
      player.src = src;
      if (typeof player.load === "function") player.load();
      const p = player.play?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
      return true;
    } catch (e) {
      console.warn("[NCZ suno-play] fallback play failed:", e);
      return false;
    }
  }

  // ---- song lookup / dedupe in window.songs without breaking parallel arrays ----
  function songUuidOf(s){
    if (!s) return "";
    return String(
      s.__chat_suno_uuid || s.suno_uuid || s.uuid || s.id || ""
    );
  }

  function findSongIndicesByUuid(uuid){
    const out = [];
    const arr = Array.isArray(window.songs) ? window.songs : [];
    for (let i = 0; i < arr.length; i++){
      if (songUuidOf(arr[i]) === uuid) out.push(i);
    }
    return out;
  }

  function findSongIndexByUrl(url){
    const arr = Array.isArray(window.songs) ? window.songs : [];
    for (let i = 0; i < arr.length; i++){
      const s = arr[i];
      const u = (s && (s.url || s.src)) ? (s.url || s.src) : "";
      if (u === url) return i;
    }
    return -1;
  }

  function softDisableSongEntry(i){
    // Do NOT splice arrays (could break your meta symmetry).
    // Just make it non-playable and ignorable.
    try{
      const s = window.songs[i];
      if (!s) return;
      s.__deleted = true;
      s.url = "";
      s.src = "";
      s.__ncz_soft_disabled = true;
    }catch{}
  }

  function ensureSingleSongEntry(uuid, blobUrl, taskIdUrl, cdnUrl){
    if (!Array.isArray(window.songs)) window.songs = [];

    // If playlist add already inserted into songs, prefer that entry
    let idxByUuid = findSongIndicesByUuid(uuid);
    if (!idxByUuid.length) {
      const idxByUrl = findSongIndexByUrl(blobUrl);
      if (idxByUrl >= 0) idxByUuid = [idxByUrl];
    }

    // If none exist, create ONE entry
    if (!idxByUuid.length) {
      const songObj = {
        title: `Suno: ${uuid}.mp3`,
        name:  `Suno: ${uuid}.mp3`,
        filename: `${uuid}.mp3`,
        file: `${uuid}.mp3`,

        url: blobUrl,
        src: blobUrl,

        id: uuid,
        uuid,
        suno_uuid: uuid,
        __chat_suno_uuid: uuid,
        __chat_suno_blob: blobUrl,
        __chat_added: true,
        __source: "suno-chat",

        // Use REAL link as "taskId" so your UI shows something useful
        taskId: taskIdUrl,
        task_id: taskIdUrl,
        outputIndex: 0,
        output_index: 0,

        output_url: cdnUrl,
        output: cdnUrl,
        out: cdnUrl,
        result_url: cdnUrl,
        song_page: taskIdUrl,
      };

      window.songs.push(songObj);
      return window.songs.length - 1;
    }

    // Keep first as canonical, soft-disable the rest
    const keep = idxByUuid[0];
    for (let k = 1; k < idxByUuid.length; k++){
      softDisableSongEntry(idxByUuid[k]);
    }

    // Patch canonical entry fields
    try{
      const s = window.songs[keep];
      s.__deleted = false;
      s.__chat_suno_uuid = uuid;
      s.suno_uuid = uuid;
      s.uuid = uuid;
      s.id = uuid;

      s.url = blobUrl;
      s.src = blobUrl;
      s.__chat_suno_blob = blobUrl;

      s.taskId = taskIdUrl;
      s.task_id = taskIdUrl;
      s.outputIndex = 0;
      s.output_index = 0;

      s.output_url = cdnUrl;
      s.output = cdnUrl;
      s.song_page = taskIdUrl;

      s.__source = "suno-chat";
    }catch{}

    return keep;
  }

  // ---------- playlist DOM tagging + linkify taskId ----------
  let _cachedSongListEl = null;

  function pickSongListEl() {
    if (_cachedSongListEl && document.contains(_cachedSongListEl)) return _cachedSongListEl;

    const direct = [
      "#songList", "#songsList", "#__ncz_song_list__", "#__ncz_songs_list__", "#__ncz_songlist__",
      "[id*='song'][id*='list']",
    ];
    for (const sel of direct) {
      const el = document.querySelector(sel);
      if (el) { _cachedSongListEl = el; return el; }
    }

    const scope = document.getElementById("resultBox") || document.body;
    const labels = Array.from(scope.querySelectorAll(".small, div, span, label, h1, h2, h3, h4, h5"));
    const lab = labels.find(n => (n.textContent || "").trim().toLowerCase() === "song list");
    if (lab) {
      const card = lab.closest(".__card__") || lab.closest(".card") || lab.closest("section") || lab.parentElement;
      if (card) {
        const pots = Array.from(card.querySelectorAll("div, ul, ol"));
        const scrollish = pots.find(x => {
          const cs = getComputedStyle(x);
          return (cs.overflowY === "auto" || cs.overflowY === "scroll") && x.children.length >= 1;
        });
        _cachedSongListEl = scrollish || card;
        return _cachedSongListEl;
      }
    }

    return null;
  }

  function linkifyTaskIdWithin(el, uuid) {
    if (!el) return;
    const href = buildSongPage(uuid);

    // Find leaf nodes that contain either the old "suno:<uuid>" OR the URL OR the uuid itself.
    const leafs = Array.from(el.querySelectorAll("*")).filter(n => n.childElementCount === 0);
    for (const n of leafs) {
      const t = (n.textContent || "").trim();
      if (!t) continue;

      // Only rewrite the "task id looking" bit, not your whole row
      const looksLikeTask =
        t === href ||
        t === (`suno:${uuid}`) ||
        (t.includes(uuid) && (t.includes("suno:") || t.includes("task") || t.includes("Task") || t.includes("id")));

      if (!looksLikeTask) continue;

      n.textContent = "";
      const a = document.createElement("a");
      a.className = "__ncz_suno_songlink__";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = href;

      // don't trigger row click-to-play
      a.addEventListener("click", (e) => e.stopPropagation());

      n.appendChild(a);
      break;
    }
  }

  function tagPlaylistEl(el, uuid, taskIdUrl, outputIndex, blobUrl, cdnUrl) {
    if (!el || el.nodeType !== 1) return;

    el.setAttribute("data-suno-uuid", uuid);

    // store ids in likely variants
    el.setAttribute("data-task-id", taskIdUrl);
    el.setAttribute("data-taskid", taskIdUrl);
    el.setAttribute("data-task", taskIdUrl);

    el.setAttribute("data-output-index", String(outputIndex));
    el.setAttribute("data-outputindex", String(outputIndex));
    el.setAttribute("data-outindex", String(outputIndex));
    el.setAttribute("data-out-idx", String(outputIndex));

    el.setAttribute("data-blob-url", blobUrl);
    el.setAttribute("data-cdn-url", cdnUrl);

    linkifyTaskIdWithin(el, uuid);
  }

  function tagMostLikelyNewPlaylistChild(uuid, taskIdUrl, outputIndex, blobUrl, cdnUrl) {
    const list = pickSongListEl();
    if (!list) return;

    // ONLY consider direct children (prevents tagging a big container/card)
    const kids = Array.from(list.children || []);
    if (!kids.length) return;

    // Find a child that clearly references this uuid or blobUrl/cdnUrl/taskIdUrl
    let best = null;
    for (let i = kids.length - 1; i >= 0; i--) {
      const el = kids[i];
      const t = (el && el.textContent) ? el.textContent : "";
      if (!t) continue;
      if (t.includes(uuid) || t.includes(blobUrl) || t.includes(cdnUrl) || t.includes(taskIdUrl)) {
        best = el;
        break;
      }
    }
    if (!best) return;

    tagPlaylistEl(best, uuid, taskIdUrl, outputIndex, blobUrl, cdnUrl);
  }

  // ---------- Register with your REAL playlist system ----------
  function registerWithRealPlaylist(uuid, blobUrl) {
    const cdnUrl = buildCdnUrl(uuid);
    const taskIdUrl = buildSongPage(uuid);
    const outputIndex = 0;

    // If already registered, do NOT re-add (prevents duplicates)
    const already =
      (Array.isArray(window.songs) && findSongIndicesByUuid(uuid).length > 0) ||
      (pickSongListEl() && pickSongListEl().querySelector && pickSongListEl().querySelector(`[data-suno-uuid="${uuid}"]`));

    if (already) return { ok: true, taskIdUrl, cdnUrl, outputIndex, el: null };

    if (typeof window.addSongToList === "function") {
      try {
        const ret = window.addSongToList(blobUrl, {
          label: `Suno: ${uuid}.mp3`,
          createdAt: new Date().toLocaleString(),
          taskId: taskIdUrl,        // ✅ REAL link instead of fake uuid
          outputIndex: outputIndex,
          meta: {
            source: "suno-chat",
            uuid,
            cdnUrl,
            songPage: taskIdUrl,
          }
        });

        // If addSongToList returns a DOM element, tag/linkify it; else tag most-likely new child
        if (ret && ret.nodeType === 1) {
          tagPlaylistEl(ret, uuid, taskIdUrl, outputIndex, blobUrl, cdnUrl);
          return { ok: true, taskIdUrl, cdnUrl, outputIndex, el: ret };
        } else {
          setTimeout(() => tagMostLikelyNewPlaylistChild(uuid, taskIdUrl, outputIndex, blobUrl, cdnUrl), 0);
          return { ok: true, taskIdUrl, cdnUrl, outputIndex, el: null };
        }
      } catch (e) {
        console.warn("[NCZ suno-play] addSongToList failed:", e);
      }
    }

    return { ok: false, taskIdUrl, cdnUrl, outputIndex, el: null };
  }

  // ---------- CHAT BUTTON INSERT ----------
  function ensurePlayButton(rowEl, uuid) {
    if (!rowEl || !uuid) return;

    if (rowEl.querySelector(`button.${BTN_CLASS}`)) return;
    if (rowEl.getAttribute("data-ncz-suno-play") === "1") return;

    const replyBtn = rowEl.querySelector("button.__reply__");
    if (!replyBtn) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.title = "Add to Song List + play in main player";
    btn.textContent = "▶";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        btn.disabled = true;
        btn.textContent = "…";

        const blobUrl = await getBlobUrl(uuid);
        const cdnUrl  = buildCdnUrl(uuid);
        const taskIdUrl = buildSongPage(uuid);

        // store last-played info for your NaN patchers
        window.__nczLastSunoChat = { uuid, cdnUrl, blobUrl };

        // ✅ Register with real playlist (BUT ONLY ONCE)
        registerWithRealPlaylist(uuid, blobUrl);

        // ✅ Ensure there is ONLY ONE playable entry in window.songs for this UUID
        const idx = ensureSingleSongEntry(uuid, blobUrl, taskIdUrl, cdnUrl);

        // play
        playViaMainSystem(idx);

        btn.textContent = "▶";
      } catch (err) {
        console.warn("[NCZ suno-play] add/play failed:", err);
        btn.textContent = "!";
        setTimeout(() => (btn.textContent = "▶"), 900);
      } finally {
        btn.disabled = false;
      }
    });

    replyBtn.insertAdjacentElement("afterend", btn);

    rowEl.setAttribute("data-ncz-suno-play", "1");
    rowEl.setAttribute("data-ncz-suno-uuid", uuid);
  }

  function scan() {
    const log = $id(CHAT_LOG_ID);
    if (!log) return;

    const rows = Array.from(log.querySelectorAll("div.__msg__"));
    for (const row of rows) {
      // cleanup duplicates
      const dups = row.querySelectorAll(`button.${BTN_CLASS}`);
      if (dups.length > 1) {
        for (let i = 1; i < dups.length; i++) dups[i].remove();
      }

      const links = Array.from(row.querySelectorAll("a[href]"));
      for (const a of links) {
        if (!isSunoDomain(a)) continue;
        const uuid = extractUuidFromLink(a);
        if (!uuid) continue;
        ensurePlayButton(row, uuid);
        break;
      }
    }
  }

  function init() {
    addStylesOnce();

    const log = $id(CHAT_LOG_ID);
    if (!log) {
      const mo = new MutationObserver(() => {
        const l = $id(CHAT_LOG_ID);
        if (l) {
          mo.disconnect();
          init();
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }

    scan();

    const mo = new MutationObserver(debounce(scan, SCAN_DEBOUNCE_MS));
    mo.observe(log, { childList: true, subtree: true });

    console.log("[NCZ suno-play] dedupe + real taskId link enabled");
  }

  init();
})();



// ✅ Default song on page load (no server fetch)
(() => {
  "use strict";

  const DEFAULT_SONG = "/archive/api_audio/Artists/Shrap/MEQUAVIS%20Simulation%20Containment%20System%20Theme%20Song%20V2%20(v5%20Cover%20V2).mp3";
  const DEFAULT_LABEL = "⭐";

  function tryAdd() {
    if (typeof window.addSongToList !== "function") return false;

    // addSongToList() already de-dupes by URL, so safe even if this runs twice
    window.addSongToList(DEFAULT_SONG, {
      label: DEFAULT_LABEL,
      createdAt: new Date().toLocaleString(),
      outputIndex: 0,
      taskId: "",
      meta: { title: "MEQUAVIS Simulation Containment Theme Song", author: "Shrap" }
    });

    return true;
  }

  function run() {
    if (tryAdd()) return;

    // wait until your main app script exposes addSongToList
    const mo = new MutationObserver(() => {
      if (tryAdd()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();



// ✅ NCZ Suno Download Fix (SAFE)
// - Only triggers on real "Download" controls (a/button that looks like download)
// - If the click is for a Suno song (row data-uuid OR current song is Suno),
//   it downloads https://cdn1.suno.ai/<uuid>.mp3 and names it "<uuid>.mp3"
// - Does NOT hijack other buttons.
// - Avoids recursion via e.isTrusted guard.
(() => {
  "use strict";

  const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const CDN_BASE = "https://cdn1.suno.ai";

  const cache = new Map(); // uuid -> Promise<Blob>

  const firstUuid = (s) => {
    const m = String(s || "").match(UUID_RE);
    return m ? m[0] : "";
  };

  function looksLikeDownloadControl(el) {
    if (!el || !(el instanceof Element)) return false;

    const tag = (el.tagName || "").toUpperCase();
    if (tag !== "A" && tag !== "BUTTON") return false;

    const txt = (el.textContent || "").trim().toLowerCase();
    const title = (el.getAttribute("title") || "").trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
    const cls = (el.className || "").toString().toLowerCase();

    // Strong signals
    if (tag === "A" && el.hasAttribute("download")) return true;

    // Text/title/class signals (tight-ish)
    const hit =
      txt === "download" || txt.includes("download") ||
      title.includes("download") ||
      aria.includes("download") ||
      cls.includes("download");

    return hit;
  }

  function getUuidFromRowOrNearby(target) {
    if (!target || !(target instanceof Element)) return "";

    // 1) your Suno injected rows
    const row = target.closest(".__ncz_chat_suno_songrow__, [data-uuid]");
    if (row) {
      const du = firstUuid(row.getAttribute("data-uuid") || "");
      if (du) return du;

      // title/sub lines often contain "<uuid>.mp3"
      const u1 = firstUuid(row.querySelector(".__title__")?.textContent || "");
      if (u1) return u1;

      const u2 = firstUuid(row.querySelector(".__sub__")?.textContent || "");
      if (u2) return u2;

      const u3 = firstUuid(row.textContent || "");
      if (u3) return u3;
    }

    return "";
  }

  function getUuidFromCurrentSong() {
    // Prefer your stored last suno click
    if (window.__nczLastSunoChat && window.__nczLastSunoChat.uuid) {
      const u = firstUuid(window.__nczLastSunoChat.uuid);
      if (u) return u;
    }

    const songs = Array.isArray(window.songs) ? window.songs : [];

    // 1) currentSongIndex -> check if it looks like a suno-chat song
    if (typeof window.currentSongIndex === "number") {
      const i = window.currentSongIndex | 0;
      const s = songs[i];
      if (s) {
        const u =
          firstUuid(s.__chat_suno_uuid) ||
          firstUuid(s.suno_uuid) ||
          firstUuid(s.uuid) ||
          firstUuid(s.id) ||
          firstUuid(s.filename) ||
          firstUuid(s.title);
        if (u) return u;
      }
    }

    // 2) match player src to songs array
    const player = document.getElementById("player") || document.querySelector("audio,video");
    const src = (player && (player.currentSrc || player.src) || "").trim();
    if (src) {
      const hit = songs.find((s) => s && (s.url === src || s.src === src || s.__chat_suno_blob === src));
      if (hit) {
        const u =
          firstUuid(hit.__chat_suno_uuid) ||
          firstUuid(hit.suno_uuid) ||
          firstUuid(hit.uuid) ||
          firstUuid(hit.id) ||
          firstUuid(hit.filename) ||
          firstUuid(hit.title);
        if (u) return u;
      }
    }

    return "";
  }

  async function fetchCdnBlob(uuid) {
    if (cache.has(uuid)) return cache.get(uuid);

    const p = (async () => {
      const url = `${CDN_BASE}/${uuid}.mp3`;
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(`Suno CDN HTTP ${res.status}`);
      return await res.blob();
    })();

    cache.set(uuid, p);
    return p;
  }

  function forceDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  document.addEventListener("click", async (e) => {
    // ✅ avoid recursion from synthetic clicks
    if (!e.isTrusted) return;

    const t = e.target;
    if (!(t instanceof Element)) return;

    // ✅ only if user clicked a real download control
    const ctl = t.closest("a,button");
    if (!looksLikeDownloadControl(ctl)) return;

    // Resolve Suno UUID: first try row, then current song
    const uuid = getUuidFromRowOrNearby(t) || getUuidFromCurrentSong();
    if (!uuid) return; // not a Suno case -> do nothing

    // Take over ONLY for Suno download
    e.preventDefault();
    e.stopPropagation();

    try {
      const blob = await fetchCdnBlob(uuid);
      forceDownloadBlob(blob, `${uuid}.mp3`);
    } catch (err) {
      console.warn("[NCZ Suno Download Fix] failed:", err);
    }
  }, true);

  console.log("[NCZ Suno Download Fix] active");
})();



// NCZ Song List Resizer (HANDLE AS SIBLING BELOW WRAPPER)
// - Keeps .songListWrap as the scroll container (auto-scroll scripts keep working)
// - ✅ Handle is NOT inside the scrollable div (so it won't scroll away)
// - No viewport max clamp (only MIN_H)
// - Strong restore + persistence (fights late scripts that stomp height)
(() => {
  "use strict";

  // If you had older versions, this lets the newest one win.
  const VERSION = 10;
  if ((window.__NCZ_SONGLIST_RESIZER_VERSION__ || 0) >= VERSION) return;
  window.__NCZ_SONGLIST_RESIZER_VERSION__ = VERSION;

  // --------------------
  // CONFIG
  // --------------------
  const LIST_ID   = "songList";        // used to find the correct wrapper
  const WRAP_SEL  = ".songListWrap";   // fallback if LIST_ID isn't found

  const STORE_KEY = "NCZ_SONGLIST_HEIGHT_PX";

  const STYLE_ID  = "__ncz_songlist_resizer_style__";
  const HANDLE_ID = "__ncz_songlist_resizer_handle__";

  const HANDLE_H = 12;  // px
  const MIN_H = 140;    // px
  const PERSIST_EVERY_MS = 250;

  const BOOT_TIMEOUT_MS  = 15000;
  const BOOT_INTERVAL_MS = 250;

  // Optional safety: keep handle attached even if something rebuilds DOM
  const WATCHDOG_MS = 1000;

  const STATE = {
    resizing: false,
    persistTimer: null,
    retryTimer: null,
    mo: null,
    watchdog: null,
    lastInitAt: 0,
    inRestore: false,
    wrapEl: null,
    handleEl: null,
  };

  function clampMin(n) { return Math.max(MIN_H, n); }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* ✅ Remove any max-height caps on the wrapper */
      ${WRAP_SEL}.__ncz_songlist_resizable__{
        max-height: none !important;
      }

      /* ✅ Sibling handle BELOW the wrapper (not inside the scrollbox) */
      #${HANDLE_ID}{
        display: block;
        width: 100%;
        height: ${HANDLE_H}px;
        cursor: ns-resize;
        user-select: none;
        touch-action: none;
        opacity: .9;
        background: linear-gradient(to bottom, rgba(255,255,255,0.06), rgba(0,0,0,0.0));
        border-top: 1px solid rgba(255,255,255,0.10);
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
      }
      #${HANDLE_ID}::after{
        content:"";
        display:block;
        margin: 4px auto 0 auto;
        width: 58px;
        height: 3px;
        border-radius: 999px;
        background: rgba(255,255,255,0.28);
        box-shadow: 0 1px 0 rgba(0,0,0,0.25);
      }

      body.__ncz_resizing_songlist__{
        user-select:none !important;
        cursor:ns-resize !important;
      }
    `;
    document.head.appendChild(st);
  }

  function pickWrapper() {
    const list = document.getElementById(LIST_ID);
    if (list) {
      const wrap = list.closest(WRAP_SEL);
      if (wrap) return wrap;
      if (list.parentElement) return list.parentElement;
    }
    return document.querySelector(WRAP_SEL);
  }

  function readSavedPx() {
    const v = parseInt(localStorage.getItem(STORE_KEY) || "", 10);
    if (!Number.isFinite(v) || v <= 0) return null;
    return clampMin(v);
  }

  function getCurrentPx(wrapEl) {
    const h = parseInt(getComputedStyle(wrapEl).height, 10);
    return Number.isFinite(h) ? h : null;
  }

  function applyHeightImportant(wrapEl, px) {
    if (!Number.isFinite(px) || px <= 0) return;
    wrapEl.style.maxHeight = "none";
    wrapEl.style.setProperty("height", `${Math.round(px)}px`, "important");
  }

  function persistHeightPx(wrapEl) {
    const h = Math.round(wrapEl.getBoundingClientRect().height);
    if (h > 0) localStorage.setItem(STORE_KEY, String(h));
  }

  function ensureWrapperScroll(wrapEl) {
    // ✅ Keep wrapper as scroll container (don’t touch #songList overflow)
    const cs = getComputedStyle(wrapEl);

    // Only force overflow if it's truly "visible" (non-scroll). Avoid needless writes.
    if (cs.overflowY === "visible") wrapEl.style.overflowY = "auto";
    if (cs.overflowX === "visible") wrapEl.style.overflowX = "hidden";
  }

  function placeHandleBelow(wrapEl, handleEl) {
    const parent = wrapEl.parentNode;
    if (!parent) return;

    // Ensure handle is a sibling immediately after wrapEl
    if (handleEl.parentNode !== parent) parent.insertBefore(handleEl, wrapEl.nextSibling);
    else if (wrapEl.nextSibling !== handleEl) parent.insertBefore(handleEl, wrapEl.nextSibling);
  }

  function strongRestore(wrapEl) {
    if (STATE.resizing || STATE.inRestore) return;
    const disp = getComputedStyle(wrapEl).display;
    if (disp === "none") return;

    const saved = readSavedPx();
    if (saved == null) return;

    const cur = getCurrentPx(wrapEl);
    if (cur == null || Math.abs(cur - saved) > 1) {
      STATE.inRestore = true;
      applyHeightImportant(wrapEl, saved);
      setTimeout(() => { STATE.inRestore = false; }, 0);
    }
  }

  function init() {
    const wrapEl = pickWrapper();
    if (!wrapEl) return false;

    addStyles();

    wrapEl.classList.add("__ncz_songlist_resizable__");
    wrapEl.style.maxHeight = "none";
    ensureWrapperScroll(wrapEl);

    // Create/find handle (sibling)
    let handle = document.getElementById(HANDLE_ID);
    if (!handle) {
      handle = document.createElement("div");
      handle.id = HANDLE_ID;
      handle.title = "Drag to resize Song List height";
    }
    placeHandleBelow(wrapEl, handle);

    STATE.wrapEl = wrapEl;
    STATE.handleEl = handle;

    // Strong restore now + after layout settles (beats late scripts)
    strongRestore(wrapEl);
    setTimeout(() => strongRestore(wrapEl), 0);
    setTimeout(() => strongRestore(wrapEl), 250);
    setTimeout(() => strongRestore(wrapEl), 900);

    // Bind once
    if (handle.dataset.nczBound !== "1") {
      handle.dataset.nczBound = "1";

      let startY = 0;
      let startH = 0;
      let lastPersistAt = 0;

      function startPersistLoop() {
        stopPersistLoop();
        STATE.persistTimer = setInterval(() => {
          if (!STATE.resizing) return;
          persistHeightPx(wrapEl);
        }, PERSIST_EVERY_MS);
      }

      function stopPersistLoop() {
        if (STATE.persistTimer) {
          clearInterval(STATE.persistTimer);
          STATE.persistTimer = null;
        }
      }

      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (getComputedStyle(wrapEl).display === "none") return;

        ensureWrapperScroll(wrapEl);

        STATE.resizing = true;
        startY = e.clientY;

        // Use current computed height if available, else bounding rect
        const h = getCurrentPx(wrapEl);
        startH = Number.isFinite(h) ? h : wrapEl.getBoundingClientRect().height;

        document.body.classList.add("__ncz_resizing_songlist__");
        handle.setPointerCapture?.(e.pointerId);

        lastPersistAt = Date.now();
        persistHeightPx(wrapEl);
        startPersistLoop();
      });

      handle.addEventListener("pointermove", (e) => {
        if (!STATE.resizing) return;
        const dy = e.clientY - startY;
        const next = clampMin(startH + dy); // ✅ NO viewport clamp
        applyHeightImportant(wrapEl, next);

        const now = Date.now();
        if (now - lastPersistAt >= PERSIST_EVERY_MS) {
          lastPersistAt = now;
          persistHeightPx(wrapEl);
        }
      });

      function endResize() {
        if (!STATE.resizing) return;
        STATE.resizing = false;
        document.body.classList.remove("__ncz_resizing_songlist__");

        stopPersistLoop();
        persistHeightPx(wrapEl);
      }

      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("pointercancel", endResize);

      // Double-click reset
      handle.addEventListener("dblclick", () => {
        localStorage.removeItem(STORE_KEY);
        wrapEl.style.removeProperty("height");
      });
    }

    // Observe wrapper attribute changes only (safe) and re-assert height/scroll without loops
    if (STATE.mo) {
      try { STATE.mo.disconnect(); } catch {}
    }
    STATE.mo = new MutationObserver(() => {
      ensureWrapperScroll(wrapEl);
      strongRestore(wrapEl);
    });
    STATE.mo.observe(wrapEl, { attributes: true, attributeFilter: ["style", "class", "hidden"] });

    // Optional watchdog: if something removes/moves the handle, put it back (no observers = no crash loops)
    if (!STATE.watchdog) {
      STATE.watchdog = setInterval(() => {
        const w = STATE.wrapEl && STATE.wrapEl.isConnected ? STATE.wrapEl : pickWrapper();
        if (!w) return;
        const h = document.getElementById(HANDLE_ID) || STATE.handleEl;
        if (!h) return;
        placeHandleBelow(w, h);
      }, WATCHDOG_MS);
    }

    console.log("[NCZ songlist resizer] attached (handle is sibling):", wrapEl);
    return true;
  }

  function bootWithRetry() {
    if (STATE.retryTimer) return;

    const start = Date.now();
    const tick = () => {
      try {
        if (init()) {
          clearTimeout(STATE.retryTimer);
          STATE.retryTimer = null;
          return;
        }
      } catch (e) {
        console.warn("[NCZ songlist resizer] init error:", e);
      }

      if (Date.now() - start > BOOT_TIMEOUT_MS) {
        console.warn("[NCZ songlist resizer] gave up waiting for mount. Check WRAP_SEL/LIST_ID.");
        clearTimeout(STATE.retryTimer);
        STATE.retryTimer = null;
        return;
      }
      STATE.retryTimer = setTimeout(tick, BOOT_INTERVAL_MS);
    };

    STATE.retryTimer = setTimeout(tick, 0);
  }

  function boot() {
    if (Date.now() - STATE.lastInitAt < 150) return;
    STATE.lastInitAt = Date.now();
    bootWithRetry();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else window.addEventListener("DOMContentLoaded", boot);

  window.addEventListener("load", boot, { once: true });
})();











// ✅ NCZ HARD PATCH: Disable Reverse while Random is ON (and force Normal order)
// - Tracks random state itself (no reliance on your other code)
// - Disables the Reverse button + blocks its clicks
// - Forces Reverse->Normal when enabling Random
(() => {
  "use strict";
  if (window.__ncz_hard_patch_reverse_lock__) return;
  window.__ncz_hard_patch_reverse_lock__ = true;

  const REVERSE_ID = "__ncz_songlist_reverse_btn__";

  // If you KNOW your random button id, put it here for perfect targeting:
  const RANDOM_ID = ""; // e.g. "__ncz_random_btn__"

  const STORE_KEY = "NCZ_PATCH_RANDOM_ON"; // our own truth source

  const norm = (s) => (s || "").trim().toLowerCase();

  function reverseBtn() {
    return document.getElementById(REVERSE_ID);
  }

  function findRandomBtn() {
    if (RANDOM_ID) return document.getElementById(RANDOM_ID);

    // try common ids
    const common = [
      "__ncz_random_btn__",
      "__ncz_random_toggle__",
      "__ncz_songlist_random_btn__",
      "__ncz_random__",
    ];
    for (const id of common) {
      const el = document.getElementById(id);
      if (el) return el;
    }

    // any button with id containing random
    const byId = document.querySelector('button[id*="random" i]');
    if (byId) return byId;

    // button with visible text "random"
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.find((b) => norm(b.textContent) === "random") || null;
  }

  function getRandomOn() {
    const v = localStorage.getItem(STORE_KEY);
    return v === "1";
  }
  function setRandomOn(on) {
    localStorage.setItem(STORE_KEY, on ? "1" : "0");
  }

  // Your UI behavior: when reverse mode is ON, the button text says "Normal"
  function isReverseModeOn(btn) {
    return btn && norm(btn.textContent) === "normal";
  }

  function lockReverse(on) {
    const rb = reverseBtn();
    if (!rb) return;

    // If turning Random ON: force reverse OFF first (click if currently in reverse mode)
    if (on && isReverseModeOn(rb)) {
      rb.click();
    }

    // VISUAL + REAL disable
    rb.disabled = !!on;
    rb.setAttribute("aria-disabled", on ? "true" : "false");
    rb.dataset.nczDisabled = on ? "1" : "0";
    rb.style.opacity = on ? "0.45" : "";
    rb.style.cursor = on ? "not-allowed" : "";
    rb.title = on ? "Reverse disabled while Random is ON" : "Reverse Song List order";
  }

  // Block reverse clicks while random is on (even if someone flips disabled back)
  function installReverseBlocker() {
    const rb = reverseBtn();
    if (!rb || rb.__ncz_reverse_blocker__) return;
    rb.__ncz_reverse_blocker__ = true;

    const blocker = (e) => {
      if (getRandomOn()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }
    };

    rb.addEventListener("click", blocker, true);
    rb.addEventListener("mousedown", blocker, true);
    rb.addEventListener("pointerdown", blocker, true);
    rb.addEventListener("keydown", (e) => {
      if (!getRandomOn()) return;
      if (e.key === "Enter" || e.key === " " || e.code === "Space") blocker(e);
    }, true);
  }

  // When Random button is clicked, update our state AFTER your toggle runs
  function installRandomHook() {
    const rbtn = findRandomBtn();
    if (!rbtn || rbtn.__ncz_random_hook__) return;
    rbtn.__ncz_random_hook__ = true;

    rbtn.addEventListener("click", () => {
      // wait a tick so your existing random-toggle code does its thing first
      setTimeout(() => {
        // If the random button exposes state, read it; otherwise just toggle our stored state.
        let on = null;

        const aria = rbtn.getAttribute("aria-pressed");
        if (aria === "true") on = true;
        if (aria === "false") on = false;

        if (on === null) {
          if (rbtn.classList.contains("active") || rbtn.classList.contains("on")) on = true;
        }

        if (on === null) {
          // fallback: toggle our state
          on = !getRandomOn();
        }

        setRandomOn(!!on);
        lockReverse(!!on);
      }, 0);
    }, true);
  }

  // Keep enforcing in case other code keeps fighting you
  function enforceLoop() {
    installReverseBlocker();
    installRandomHook();
    lockReverse(getRandomOn());
  }

  // Add a tiny CSS safety net
  function addStyle() {
    const id = "__ncz_patch_reverse_lock_style__";
    if (document.getElementById(id)) return;
    const st = document.createElement("style");
    st.id = id;
    st.textContent = `
      #${REVERSE_ID}[data-ncz-disabled="1"] { opacity: .45 !important; cursor: not-allowed !important; }
    `;
    document.head.appendChild(st);
  }

  addStyle();
  enforceLoop();

  // aggressive enforcement
  const mo = new MutationObserver(enforceLoop);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(enforceLoop, 250);
})();


// ✅ NCZ PATCH: disable Reverse button while Random is ON
// also auto-click Reverse -> Normal when enabling Random (to avoid the reverse-mode random bug)
(() => {
  "use strict";
  if (window.__ncz_patch_disable_reverse_when_random__) return;
  window.__ncz_patch_disable_reverse_when_random__ = true;

  const REVERSE_BTN_ID = "__ncz_songlist_reverse_btn__";

  // OPTIONAL: if your Random button has an ID, put it here for perfect targeting.
  // Otherwise we auto-detect it by text/id containing "random".
  const RANDOM_BTN_ID = ""; // e.g. "__ncz_random_btn__"

  const LS_KEYS = [
    "NCZ_UI_RANDOM_MODE",
    "NCZ_RANDOM_MODE",
    "ncz_random_mode",
    "randomMode",
    "__ncz_random_mode__",
  ];

  let fallbackRandomOn = null;

  const norm = (s) => (s || "").trim().toLowerCase();

  function getReverseBtn() {
    return document.getElementById(REVERSE_BTN_ID);
  }

  function findRandomBtn() {
    if (RANDOM_BTN_ID) return document.getElementById(RANDOM_BTN_ID);

    // common IDs people use
    const common = [
      "__ncz_random_btn__",
      "__ncz_random_toggle__",
      "__ncz_songlist_random_btn__",
      "__ncz_random__",
    ];
    for (const id of common) {
      const el = document.getElementById(id);
      if (el) return el;
    }

    // any button whose id contains "random"
    const byId = document.querySelector('button[id*="random" i]');
    if (byId) return byId;

    // fallback: button whose visible text is exactly "random"
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.find((b) => norm(b.textContent) === "random") || null;
  }

  function detectRandomOn(randomBtn) {
    // 1) global flags (if your code uses one)
    for (const k of ["NCZ_RANDOM_MODE", "__ncz_random_mode__", "nczRandomMode", "randomModeOn"]) {
      if (typeof window[k] === "boolean") return window[k];
    }

    // 2) localStorage flags
    for (const k of LS_KEYS) {
      const v = localStorage.getItem(k);
      if (v === "1" || v === "true" || v === "on") return true;
      if (v === "0" || v === "false" || v === "off") return false;
    }

    // 3) button UI state
    if (randomBtn) {
      if (randomBtn.getAttribute("aria-pressed") === "true") return true;
      if (randomBtn.classList.contains("active") || randomBtn.classList.contains("on")) return true;
      if (randomBtn.dataset && (randomBtn.dataset.on === "1" || randomBtn.dataset.state === "on")) return true;
    }

    // 4) fallback toggle state (only if we couldn't detect anything)
    if (fallbackRandomOn !== null) return fallbackRandomOn;

    return false;
  }

  // your UI behavior: when reverse is ON, the button text changes to "Normal"
  function isReverseModeOn(reverseBtn) {
    return reverseBtn && norm(reverseBtn.textContent) === "normal";
  }

  function setReverseDisabled(reverseBtn, disabled) {
    if (!reverseBtn) return;

    reverseBtn.disabled = !!disabled;
    reverseBtn.style.pointerEvents = disabled ? "none" : "";
    reverseBtn.style.opacity = disabled ? "0.45" : "";
    reverseBtn.title = disabled
      ? "Reverse disabled while Random is ON"
      : "Reverse Song List order";
  }

  function enforce() {
    const randomBtn = findRandomBtn();
    const reverseBtn = getReverseBtn();
    if (!reverseBtn) return;

    const randomOn = detectRandomOn(randomBtn);

    // If random is ON, ensure reverse-mode is OFF (fixes your reverse+random bug)
    if (randomOn && isReverseModeOn(reverseBtn)) {
      reverseBtn.click();
    }

    setReverseDisabled(reverseBtn, randomOn);
  }

  function install() {
    const reverseBtn = getReverseBtn();
    if (!reverseBtn) return;

    // Hard-block reverse clicks while random is ON (even if something re-enables it)
    if (!reverseBtn.__ncz_block_reverse_click__) {
      reverseBtn.__ncz_block_reverse_click__ = true;
      reverseBtn.addEventListener(
        "click",
        (e) => {
          const randomBtn = findRandomBtn();
          if (detectRandomOn(randomBtn)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return false;
          }
        },
        true
      );
    }

    const randomBtn = findRandomBtn();
    if (randomBtn && !randomBtn.__ncz_patch_random_listener__) {
      randomBtn.__ncz_patch_random_listener__ = true;

      // Capture phase so we run BEFORE your random toggle handler
      randomBtn.addEventListener(
        "click",
        () => {
          const rev = getReverseBtn();

          // If reverse mode is ON (button says "Normal"), click it FIRST to restore normal order
          if (rev && isReverseModeOn(rev)) rev.click();

          // After your random toggle runs, lock/unlock reverse
          setTimeout(() => {
            const rb = findRandomBtn();

            // If we still can't detect a real random state, toggle fallback
            const detectedViaStorage = LS_KEYS.some((k) => localStorage.getItem(k) !== null);
            const detectedViaAttrs =
              rb &&
              (rb.hasAttribute("aria-pressed") ||
                rb.classList.contains("active") ||
                rb.classList.contains("on") ||
                (rb.dataset && (rb.dataset.on || rb.dataset.state)));

            if (!detectedViaStorage && !detectedViaAttrs) {
              fallbackRandomOn = !(fallbackRandomOn ?? false);
            }

            enforce();
          }, 0);
        },
        true
      );
    }

    enforce();
  }

  // Run now and keep enforcing (your UI is dynamic)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }

  const mo = new MutationObserver(() => install());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();



// ✅ Dark scrollbars for the chat log div (#__ncz_chat_log__)
(() => {
  "use strict";

  const CHAT_ID = "__ncz_chat_log__";
  const STYLE_ID = "__ncz_chat_dark_scrollbars__";

  if (document.getElementById(STYLE_ID)) return;

  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
    /* Firefox */
    #${CHAT_ID}, #${CHAT_ID} * {
      scrollbar-width: thin;
      scrollbar-color: #2a3556 #0b0d12; /* thumb, track */
    }

    /* Chromium / Edge / Safari */
    #${CHAT_ID}::-webkit-scrollbar,
    #${CHAT_ID} *::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    #${CHAT_ID}::-webkit-scrollbar-track,
    #${CHAT_ID} *::-webkit-scrollbar-track {
      background: #0b0d12;
      border-radius: 10px;
    }

    #${CHAT_ID}::-webkit-scrollbar-thumb,
    #${CHAT_ID} *::-webkit-scrollbar-thumb {
      background: #2a3556;
      border-radius: 10px;
      border: 2px solid #0b0d12; /* creates "padding" look */
    }

    #${CHAT_ID}::-webkit-scrollbar-thumb:hover,
    #${CHAT_ID} *::-webkit-scrollbar-thumb:hover {
      background: #3a4a78;
    }

    #${CHAT_ID}::-webkit-scrollbar-corner,
    #${CHAT_ID} *::-webkit-scrollbar-corner {
      background: #0b0d12;
    }
  `;
  document.head.appendChild(st);
})();


















// ✅ NCZ "Make Lyrics" button enabler + Gemini Flash 2.5 generator (via your CHAT_PROXY_URL)
// - Enables button ONLY when #lyrics has >= 25 chars AND it is NOT exactly the last AI-generated text.
// - On click: sends textarea text to proxy as gemini:gemini-2.5-flash with your system prompt,
//   replaces textarea with reply, then DISABLES again until user edits it.
(() => {
  "use strict";

  const BTN_ID = "__ncz_make_lyrics_btn__";
  const TA_ID  = "lyrics";

  const MIN_CHARS = 25;

  const SYS_PROMPT =
    "Use this data to make a song, only return song lyrics and nothing else";

  // Use same convention as your meq-chat.js
  const CHAT_PROXY_URL = String(
    window.CHAT_PROXY_URL || "https://xtdevelopment.net/chat-proxy/chat-proxy.php"
  );

  // Allow override if you ever want it:
  // window.MEQ_LYRICS_MODEL = "gemini-2.5-flash";
  const PROVIDER = "gemini";
  const MODEL    = String(window.MEQ_LYRICS_MODEL || "gemini-2.5-flash");

  if (window.__NCZ_MAKE_LYRICS_PATCH_INSTALLED__) return;
  window.__NCZ_MAKE_LYRICS_PATCH_INSTALLED__ = true;

  let lastGeneratedText = null;
  let inflight = false;

  function qs(id) { return document.getElementById(id); }

  function setBtnVisual(btn, enabled) {
    // keep your styles, just adjust the "disabled look"
    btn.style.cursor = enabled ? "pointer" : "not-allowed";
    btn.style.opacity = enabled ? "1" : "0.5";
    btn.disabled = !enabled;
  }

  function shouldEnable(btn, ta) {
    const v = String(ta.value || "");
    if (inflight) return false;
    if (v.length < MIN_CHARS) return false;
    if (lastGeneratedText !== null && v === lastGeneratedText) return false;
    return true;
  }

  function syncState(btn, ta) {
    setBtnVisual(btn, shouldEnable(btn, ta));
  }

  async function callProxyMakeLyrics(text) {
    const payload = {
      action: "chat",
      provider: PROVIDER,
      model: MODEL,
      session_id: null,
      // "empty api key" (your proxy has auth built in)
      userapikey: "",
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user", content: text }
      ]
    };

    const res = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Proxy error ${res.status}: ${txt || "(no body)"}`);
    }

    const data = await res.json().catch(() => null);
    const reply = data && typeof data.reply === "string" ? data.reply : "";
    return reply.trim();
  }

  function install() {
    const btn = qs(BTN_ID);
    const ta  = qs(TA_ID);
    if (!btn || !ta) return false;

    // Ensure we start disabled/enabled correctly
    syncState(btn, ta);

    // Enable/disable live as user types
    const onInput = () => syncState(btn, ta);
    ta.addEventListener("input", onInput, { passive: true });
    ta.addEventListener("change", onInput, { passive: true });

    // Click handler (capture to avoid other handlers interfering)
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (inflight) return;

      const curText = String(ta.value || "");
      if (curText.length < MIN_CHARS) {
        syncState(btn, ta);
        return;
      }
      if (lastGeneratedText !== null && curText === lastGeneratedText) {
        syncState(btn, ta);
        return;
      }

      inflight = true;
      const oldLabel = btn.textContent;
      btn.textContent = "Making…";
      setBtnVisual(btn, false);

      try {
        const reply = await callProxyMakeLyrics(curText);
        if (!reply) throw new Error("Empty reply from proxy");

        ta.value = reply;
        lastGeneratedText = reply;

        // fire input event so any other UI reacts
        try { ta.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}

      } catch (err) {
        console.error("[MakeLyrics] failed:", err);
        // keep user text intact; just restore button label/state
      } finally {
        inflight = false;
        btn.textContent = oldLabel;
        syncState(btn, ta);
      }
    }, true);

    return true;
  }

  // Wait for DOM if needed
  if (!install()) {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (install() || Date.now() - t0 > 15000) clearInterval(timer);
    }, 200);
  }
})();









// NCZ: Chat .mp3 + .m4a linkify + ▶ play (any domain)
// - Turns any URL that ends with .mp3 OR .m4a (absolute OR /relative) into a clickable link
// - Adds a green ▶ button next to each audio link
// - Click ▶ => adds to Song List + plays in main player (same behavior as mp3 version)
//
// Drop-in replacement for the previous mp3-only script.
(() => {
  "use strict";

  if (window.__NCZ_CHAT_AUDIO_PLAY_INSTALLED__) return;
  window.__NCZ_CHAT_AUDIO_PLAY_INSTALLED__ = true;

  const CHAT_LOG_ID = "__ncz_chat_log__";

  const STYLE_ID   = "__ncz_chat_audio_play_styles__";
  const LINK_CLASS = "__ncz_chat_audio_link__";
  const BTN_CLASS  = "__ncz_chat_audio_play__";
  const SCAN_DEBOUNCE_MS = 80;

  // Cache: originalUrl(normalized) -> playableUrl (blob or direct)
  const playableCache = new Map(); // key -> { playUrl, isBlob }

  const $id = (id) => document.getElementById(id);

  // ✅ Allowed extensions (easy to extend later)
  const EXTENSIONS = ["mp3", "m4a"];

  function addStylesOnce(){
    if ($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${CHAT_LOG_ID} a.${LINK_CLASS}{
        color: rgba(106,166,255,1);
        text-decoration: underline;
        cursor: pointer;
        word-break: break-all;
        overflow-wrap: anywhere;
      }
      #${CHAT_LOG_ID} a.${LINK_CLASS}:hover{ opacity:.95; }

      #${CHAT_LOG_ID} .${BTN_CLASS}{
        margin-left: 8px;
        padding: 4px 8px;
        border-radius: 10px;
        border: 1px solid rgba(75,227,138,.55);
        background: rgba(75,227,138,.12);
        color: rgba(75,227,138,1);
        cursor: pointer;
        font-weight: 900;
        font-size: 12px;
        line-height: 1;
      }
      #${CHAT_LOG_ID} .${BTN_CLASS}:hover{
        background: rgba(75,227,138,.18);
        border-color: rgba(75,227,138,.85);
      }
      #${CHAT_LOG_ID} .${BTN_CLASS}[disabled]{
        opacity: .55;
        cursor: progress;
      }
    `;
    document.head.appendChild(st);
  }

  function debounce(fn, ms){
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function stripTrailingPunct(u){
    let s = String(u || "");
    while (s && /[)\].,!?;:'"]$/.test(s)) s = s.slice(0, -1);
    return s;
  }

  function extFromPathname(pathname){
    const p = String(pathname || "").toLowerCase();
    const dot = p.lastIndexOf(".");
    if (dot < 0) return "";
    return p.slice(dot + 1);
  }

  function isAllowedAudioUrlString(raw){
    const s = String(raw || "").trim();
    if (!s) return false;

    const cleaned = stripTrailingPunct(s);

    // absolute
    if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
      try {
        const u = new URL(cleaned);
        const ext = extFromPathname(u.pathname || "");
        return EXTENSIONS.includes(ext);
      } catch {
        return false;
      }
    }

    // /relative
    if (cleaned.startsWith("/")) {
      const path = cleaned.split(/[?#]/)[0];
      const ext = extFromPathname(path);
      return EXTENSIONS.includes(ext);
    }

    return false;
  }

  function toAbsoluteUrl(raw){
    const s = stripTrailingPunct(String(raw || "").trim());
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("/")) return (window.location.origin || "") + s;
    return "";
  }

  function normKey(url){
    try {
      const u = new URL(url);
      u.hash = ""; // drop hash for dedupe, keep query
      return u.toString();
    } catch {
      return String(url || "");
    }
  }

  function niceNameFromUrl(url){
    try{
      const u = new URL(url);
      const base = (u.pathname || "").split("/").filter(Boolean).pop() || "audio";
      let name = base;
      try { name = decodeURIComponent(base); } catch {}
      if (name.length > 90) name = name.slice(0, 86) + "…";
      return name;
    }catch{
      return "audio";
    }
  }

  async function getPlayableUrl(originalAbsUrl){
    const key = normKey(originalAbsUrl);
    const cached = playableCache.get(key);
    if (cached && cached.playUrl) return cached.playUrl;

    // Try fetch->blob when allowed; otherwise fallback to direct URL.
    try{
      const res = await fetch(originalAbsUrl, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      playableCache.set(key, { playUrl: blobUrl, isBlob: true });
      return blobUrl;
    }catch{
      playableCache.set(key, { playUrl: originalAbsUrl, isBlob: false });
      return originalAbsUrl;
    }
  }

  function pickMainPlayerEl(){
    return (
      document.getElementById("player") ||
      document.querySelector("#__ncz_audio__") ||
      document.querySelector("audio") ||
      document.querySelector("video") ||
      null
    );
  }

  function playViaMainSystem(index){
    const load = window.loadIntoMainPlayer;
    if (typeof load === "function") {
      try { window.__nczLastPlaylist = "new"; } catch {}
      try {
        load(index, true);
        return true;
      } catch (e) {
        console.warn("[NCZ chat-audio] loadIntoMainPlayer failed:", e);
      }
    }

    const player = pickMainPlayerEl();
    const s = (Array.isArray(window.songs) && window.songs[index]) ? window.songs[index] : null;
    const src = (s && (s.url || s.src)) ? (s.url || s.src) : "";
    if (!player || !src) return false;

    try{
      player.src = src;
      if (typeof player.load === "function") player.load();
      const p = player.play?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
      return true;
    }catch(e){
      console.warn("[NCZ chat-audio] fallback play failed:", e);
      return false;
    }
  }

  // --- window.songs dedupe without splicing ---
  function songKeyOf(s){
    return String(s?.__chat_audio_key || "");
  }

  function findSongIndicesByKey(key){
    const out = [];
    const arr = Array.isArray(window.songs) ? window.songs : [];
    for (let i = 0; i < arr.length; i++){
      if (songKeyOf(arr[i]) === key) out.push(i);
    }
    return out;
  }

  function findSongIndexByUrl(url){
    const arr = Array.isArray(window.songs) ? window.songs : [];
    for (let i = 0; i < arr.length; i++){
      const s = arr[i];
      const u = (s && (s.url || s.src)) ? (s.url || s.src) : "";
      if (u === url) return i;
    }
    return -1;
  }

  function softDisableSongEntry(i){
    try{
      const s = window.songs[i];
      if (!s) return;
      s.__deleted = true;
      s.url = "";
      s.src = "";
      s.__ncz_soft_disabled = true;
    }catch{}
  }

  function ensureSingleSongEntryAudio({ key, playUrl, originalUrl, title }){
    if (!Array.isArray(window.songs)) window.songs = [];

    let idxs = findSongIndicesByKey(key);
    if (!idxs.length){
      const byUrl = findSongIndexByUrl(playUrl);
      if (byUrl >= 0) idxs = [byUrl];
    }

    if (!idxs.length){
      const songObj = {
        title,
        name: title,
        filename: title,
        file: title,

        url: playUrl,
        src: playUrl,

        __chat_audio_key: key,
        __chat_audio_url: originalUrl,
        __chat_added: true,
        __source: "chat-audio",

        taskId: originalUrl,
        task_id: originalUrl,
        outputIndex: 0,
        output_index: 0,

        original_url: originalUrl,
        source_url: originalUrl,
      };

      window.songs.push(songObj);
      return window.songs.length - 1;
    }

    const keep = idxs[0];
    for (let k = 1; k < idxs.length; k++) softDisableSongEntry(idxs[k]);

    try{
      const s = window.songs[keep];
      s.__deleted = false;

      s.__chat_audio_key = key;
      s.__chat_audio_url = originalUrl;

      s.url = playUrl;
      s.src = playUrl;

      s.taskId = originalUrl;
      s.task_id = originalUrl;

      s.title = title;
      s.name = title;

      s.__source = "chat-audio";
    }catch{}

    return keep;
  }

  function registerWithRealPlaylist({ playUrl, originalUrl, title, key }){
    const list =
      document.querySelector("#songList, #__ncz_song_list__, #__ncz_songlist__, [id*='song'][id*='list']") || null;

    if (list && list.querySelector && list.querySelector(`[data-chat-audio-key="${CSS.escape(key)}"]`)) {
      return { ok: true };
    }

    if (typeof window.addSongToList === "function"){
      try{
        const ext = (() => {
          try { return extFromPathname(new URL(originalUrl).pathname || "") || "audio"; } catch { return "audio"; }
        })();

        const ret = window.addSongToList(playUrl, {
          label: ext.toUpperCase(),
          createdAt: new Date().toLocaleString(),
          taskId: originalUrl,
          outputIndex: 0,
          meta: { source: "chat-audio", url: originalUrl, title }
        });

        if (ret && ret.nodeType === 1) {
          ret.setAttribute("data-chat-audio-key", key);
          ret.setAttribute("data-chat-audio-url", originalUrl);
        } else if (list && list.lastElementChild) {
          list.lastElementChild.setAttribute("data-chat-audio-key", key);
          list.lastElementChild.setAttribute("data-chat-audio-url", originalUrl);
        }
        return { ok: true };
      }catch(e){
        console.warn("[NCZ chat-audio] addSongToList failed:", e);
      }
    }

    return { ok: false };
  }

  // --- Linkify allowed audio links inside a message ---
  function linkifyAudioInTxtSpan(txtSpan){
    if (!txtSpan) return;

    const walker = document.createTreeWalker(
      txtSpan,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node){
          const p = node.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.nodeType === 1) {
            const tag = p.tagName;
            if (tag === "A" || tag === "BUTTON") return NodeFilter.FILTER_REJECT;
            if (p.closest && p.closest("a,button")) return NodeFilter.FILTER_REJECT;
          }
          if (!node.nodeValue || node.nodeValue.trim().length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    // ✅ Match .mp3 or .m4a with optional query/hash, absolute OR /relative
    const extAlt = EXTENSIONS.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(
      `(?:https?:\\/\\/[^\\s<>"']+?\\.(?:${extAlt})(?:\\?[^\\s<>"']*)?(?:#[^\\s<>"']*)?)|(?:\\/[^\\s<>"']+?\\.(?:${extAlt})(?:\\?[^\\s<>"']*)?(?:#[^\\s<>"']*)?)`,
      "ig"
    );

    for (const n of nodes){
      const text = n.nodeValue;
      re.lastIndex = 0;

      let m, last = 0;
      const frag = document.createDocumentFragment();
      let changed = false;

      while ((m = re.exec(text)) !== null){
        const rawHit = m[0];
        const hit = stripTrailingPunct(rawHit);

        if (!isAllowedAudioUrlString(hit)) continue;

        const start = m.index;
        const end = start + rawHit.length;

        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

        const abs = toAbsoluteUrl(hit);
        if (!abs) {
          frag.appendChild(document.createTextNode(text.slice(start, end)));
          last = end;
          continue;
        }

        const a = document.createElement("a");
        a.className = LINK_CLASS;
        a.href = abs;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = abs;
        a.setAttribute("data-ncz-audio", "1");

        frag.appendChild(a);

        const trailing = rawHit.slice(hit.length);
        if (trailing) frag.appendChild(document.createTextNode(trailing));

        last = end;
        changed = true;
      }

      if (!changed) continue;

      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  function ensurePlayButtonNextToLink(a){
    if (!a || a.nodeType !== 1) return;
    if (a.dataset.__nczAudioBtnAttached === "1") return;

    const next = a.nextSibling;
    if (next && next.nodeType === 1 && next.classList && next.classList.contains(BTN_CLASS)) {
      a.dataset.__nczAudioBtnAttached = "1";
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.title = "Add to Song List + play in main player";
    btn.textContent = "▶";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const originalUrl = a.href;
      if (!originalUrl) return;

      // confirm extension still allowed
      try{
        const u = new URL(originalUrl);
        const ext = extFromPathname(u.pathname || "");
        if (!EXTENSIONS.includes(ext)) return;
      }catch{
        return;
      }

      const key = normKey(originalUrl);
      const title = niceNameFromUrl(originalUrl);

      try{
        btn.disabled = true;
        btn.textContent = "…";

        const playUrl = await getPlayableUrl(originalUrl);

        registerWithRealPlaylist({ playUrl, originalUrl, title, key });

        const idx = ensureSingleSongEntryAudio({ key, playUrl, originalUrl, title });

        playViaMainSystem(idx);

        btn.textContent = "▶";
      }catch(err){
        console.warn("[NCZ chat-audio] add/play failed:", err);
        btn.textContent = "!";
        setTimeout(() => (btn.textContent = "▶"), 900);
      }finally{
        btn.disabled = false;
      }
    });

    a.insertAdjacentElement("afterend", btn);
    a.dataset.__nczAudioBtnAttached = "1";
  }

  function scan(){
    const log = $id(CHAT_LOG_ID);
    if (!log) return;

    const rows = Array.from(log.querySelectorAll("div.__msg__"));
    for (const row of rows){
      const txtSpan = row.querySelector("span.__txt__");
      if (!txtSpan) continue;

      linkifyAudioInTxtSpan(txtSpan);

      const links = Array.from(txtSpan.querySelectorAll(`a.${LINK_CLASS}[href]`));
      for (const a of links){
        try{
          const u = new URL(a.href);
          const ext = extFromPathname(u.pathname || "");
          if (!EXTENSIONS.includes(ext)) continue;
        }catch{ continue; }

        ensurePlayButtonNextToLink(a);
      }
    }
  }

  function init(){
    addStylesOnce();

    const log = $id(CHAT_LOG_ID);
    if (!log){
      const mo = new MutationObserver(() => {
        const l = $id(CHAT_LOG_ID);
        if (l){
          mo.disconnect();
          init();
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }

    scan();

    const mo = new MutationObserver(debounce(scan, SCAN_DEBOUNCE_MS));
    mo.observe(log, { childList: true, subtree: true });

    console.log("[NCZ chat-audio] linkify + play enabled for:", EXTENSIONS.join(", "));
  }

  init();
})();

