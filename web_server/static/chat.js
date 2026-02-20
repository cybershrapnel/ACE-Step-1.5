




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
        Usernames limited to 5 per IP! Occupied names get random numbers.
<br>Does not effect song generation artist name.
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
        statEl.textContent = msgs.length ? `Updated (${msgs.length} new)` : "🟢";
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
//end reverse











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

  const MAX_INIT = 1000;                 // <-- your cap
  return clampMin(Math.min(v, MAX_INIT)); // cap only what we restore
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








// ✅ NCZ PATCH: Make the LEFT sidebar (#__ncz_leftbar__) resizable (drag its right edge)
// - Resizes the *expanded* width (collapsed width stays your COLLAPSED_W)
// - Persists width in localStorage
// - Safe/idempotent (won’t bind twice)

(() => {
  "use strict";

  const SID_ID    = "__ncz_leftbar__";
  const STYLE_ID  = "__ncz_leftbar_resize_style__";
  const HANDLE_ID = "__ncz_leftbar_resize_handle__";
  const STORE_KEY = "NCZ_UI_LEFTBAR_WIDTH"; // px

  // tune to taste
  const MIN_W = 190;
  const MAX_W = 560;

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function setExpandedWidth(px){
    const w = clamp(Math.round(px), MIN_W, MAX_W);
    // your leftbar CSS uses: --ncz-leftbar-expanded, --ncz-leftbar-w, etc.
    // Override the expanded width var at the root so the existing CSS keeps working.
    document.documentElement.style.setProperty("--ncz-leftbar-expanded", w + "px");
    try { localStorage.setItem(STORE_KEY, String(w)); } catch {}
    return w;
  }

  function getSavedWidth(){
    try{
      const v = Number(localStorage.getItem(STORE_KEY));
      return Number.isFinite(v) ? v : null;
    }catch{ return null; }
  }

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* drag handle on the RIGHT edge of the leftbar */
      #${SID_ID}{ position:fixed; } /* keep as fixed; safe even if already set */
      #${SID_ID} #${HANDLE_ID}{
        position:absolute;
        top:0; right:0; bottom:0;
        width:10px;
        cursor: col-resize;
        z-index: 999999; /* above sidebar content */
        background: transparent;
      }
      /* a subtle visible grab area */
      #${SID_ID} #${HANDLE_ID}::after{
        content:"";
        position:absolute;
        top:0; bottom:0;
        right:3px;
        width:2px;
        border-radius: 2px;
        background: rgba(255,255,255,.10);
        opacity: .6;
      }
      #${SID_ID}:hover #${HANDLE_ID}::after{ opacity: .95; }
      #${SID_ID}.__collapsed__ #${HANDLE_ID}{ display:none; } /* avoid weirdness while collapsed */

      /* while dragging */
      body.__ncz_lb_resizing__{
        user-select:none !important;
        cursor: col-resize !important;
      }
      body.__ncz_lb_resizing__ *{
        cursor: col-resize !important;
      }
    `;
    document.head.appendChild(st);
  }

  function attach(side){
    ensureStyle();

    // apply saved width once
    const saved = getSavedWidth();
    if (saved != null) setExpandedWidth(saved);

    // ensure handle exists
    let handle = document.getElementById(HANDLE_ID);
    if (!handle){
      handle = document.createElement("div");
      handle.id = HANDLE_ID;
      handle.setAttribute("aria-hidden", "true");
      side.appendChild(handle);
    }else if(handle.parentElement !== side){
      side.appendChild(handle);
    }

    // bind once
    if (handle.dataset.__nczBound__ === "1") return;
    handle.dataset.__nczBound__ = "1";

    let dragging = false;
    let raf = 0;
    let lastX = 0;

    function onMove(e){
      if (!dragging) return;
      lastX = e.clientX;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // sidebar is anchored left=0, so width ~= mouseX
        setExpandedWidth(lastX);
      });
    }

    function stop(){
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("__ncz_lb_resizing__");
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", stop, true);
      window.removeEventListener("blur", stop, true);
    }

    handle.addEventListener("mousedown", (e) => {
      // only left click
      if (e.button !== 0) return;
      // don’t start drag if collapsed
      if (side.classList.contains("__collapsed__")) return;

      e.preventDefault();
      e.stopPropagation();

      dragging = true;
      lastX = e.clientX;

      document.body.classList.add("__ncz_lb_resizing__");
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", stop, true);
      window.addEventListener("blur", stop, true);
    }, true);

    // if collapse/expand happens, keep handle state correct (we hide it via CSS, but this keeps it robust)
    const mo = new MutationObserver(() => {
      // nothing required; CSS handles visibility. kept for future-proofing.
    });
    mo.observe(side, { attributes:true, attributeFilter:["class"] });
  }

  function init(){
    const side = document.getElementById(SID_ID);
    if (side){ attach(side); return true; }
    return false;
  }

  if (init()) return;

  // wait for the leftbar script to inject it
  const obs = new MutationObserver(() => {
    if (init()) obs.disconnect();
  });
  obs.observe(document.documentElement, { childList:true, subtree:true });
})();
























// ✅ NCZ Chat Ban List + ⛔ block buttons (SAFE / low-overhead)
(() => {
  "use strict";

  if (window.__NCZ_CHAT_BANLIST_PATCH__) return;
  window.__NCZ_CHAT_BANLIST_PATCH__ = true;

  const CHAT_LOG_ID = "__ncz_chat_log__";
  const ROOM_SEL_ID = "__ncz_chat_room__";

  const BAN_SEL_ID  = "__ncz_chat_banlist__";
  const STYLE_ID    = "__ncz_chat_banlist_style__";

  const LS_KEY = "NCZ_CHAT_BANLIST_USERS_V1"; // stores [{k, name}]

  // key = normalized (lower/trim), value = display name (original)
  const bannedMap = new Map();

  const normKey = (s) => String(s || "").trim().toLowerCase();

  function loadBanlist() {
    bannedMap.clear();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const it of parsed) {
          if (it && typeof it === "object") {
            const k = normKey(it.k || it.name);
            const name = String(it.name || "").trim();
            if (k && name) bannedMap.set(k, name);
          } else if (typeof it === "string") {
            const name = it.trim();
            const k = normKey(name);
            if (k && name) bannedMap.set(k, name);
          }
        }
      }
    } catch {}
  }

  function saveBanlist() {
    try {
      const arr = Array.from(bannedMap.entries()).map(([k, name]) => ({ k, name }));
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch {}
  }

  function addStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* Hide banned rows */
      #${CHAT_LOG_ID} .__ncz_banned__{ display:none !important; }

      /* Ban list select */
      #${BAN_SEL_ID}{
        min-width: 120px;
        max-width: 180px;
      }

      /* ⛔ block button */
      #${CHAT_LOG_ID} .__ncz_block_btn__{
        margin-right: 6px;
        padding: 0 6px;
        height: 22px;
        line-height: 20px;
        border-radius: 10px;
        border: 1px solid rgba(255,92,122,.55);
        background: rgba(255,92,122,.10);
        cursor: pointer;
        font-weight: 900;
        font-size: 12px;
      }
      #${CHAT_LOG_ID} .__ncz_block_btn__:hover{
        background: rgba(255,92,122,.18);
        border-color: rgba(255,92,122,.85);
      }
    `;
    document.head.appendChild(st);
  }

  function ensureBanSelect() {
    const roomSel = document.getElementById(ROOM_SEL_ID);
    if (!roomSel) return null;

    // label that contains "Room" + the room select
    const roomLabel = roomSel.closest("label");
    if (!roomLabel || !roomLabel.parentElement) return null;

    // Right-side header flex container
    const hdrRight = roomLabel.parentElement;

    let banSel = document.getElementById(BAN_SEL_ID);
    if (!banSel) {
      banSel = document.createElement("select");
      banSel.id = BAN_SEL_ID;
      banSel.title = "Blocked users (select one to unblock)";
      banSel.setAttribute("aria-label", "Ban List");

      // insert to the LEFT of the Room label
      hdrRight.insertBefore(banSel, roomLabel);

      banSel.addEventListener("change", () => {
        const k = String(banSel.value || "");
        if (!k) return;

        // Unblock selected
        bannedMap.delete(k);
        saveBanlist();
        refreshBanSelect(banSel);
        applyBanVisibilityToAll();

        // reset back to placeholder
        try { banSel.value = ""; } catch {}
      });
    }

    refreshBanSelect(banSel);
    return banSel;
  }

  function refreshBanSelect(sel) {
    if (!sel) return;

    // Rebuild options (small list, safe)
    sel.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Ban List";
    opt0.disabled = true;
    opt0.selected = true;
    sel.appendChild(opt0);

    const entries = Array.from(bannedMap.entries())
      .map(([k, name]) => ({ k, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const it of entries) {
      const o = document.createElement("option");
      o.value = it.k;
      o.textContent = it.name;
      sel.appendChild(o);
    }
  }

  function isBannedAuthor(authorName) {
    const k = normKey(authorName);
    return k ? bannedMap.has(k) : false;
  }

  function banAuthor(authorName) {
    const name = String(authorName || "").trim();
    const k = normKey(name);
    if (!k || !name) return;

    if (!bannedMap.has(k)) {
      bannedMap.set(k, name);
      saveBanlist();
      refreshBanSelect(document.getElementById(BAN_SEL_ID));
    }

    applyBanVisibilityToAll();
  }

  function ensureBlockButton(rowEl, authorName) {
    if (!rowEl || rowEl.nodeType !== 1) return;

    // already done?
    if (rowEl.querySelector("button.__ncz_block_btn__")) return;

    const whoEl = rowEl.querySelector("span.__who__");
    if (!whoEl) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "__ncz_block_btn__";
    btn.textContent = "⛔";
    btn.title = `Block ${authorName}`;
    btn.setAttribute("data-author-key", normKey(authorName));

    // insert LEFT of the username
    whoEl.insertAdjacentElement("beforebegin", btn);
  }

  function applyBanVisibilityToRow(rowEl) {
    if (!rowEl || rowEl.nodeType !== 1) return;

    const author = String(rowEl.getAttribute("data-author") || "").trim();
    if (!author) return;

    ensureBlockButton(rowEl, author);

    const banned = isBannedAuthor(author);
    const has = rowEl.classList.contains("__ncz_banned__");
    if (banned && !has) rowEl.classList.add("__ncz_banned__");
    else if (!banned && has) rowEl.classList.remove("__ncz_banned__");
  }

  function applyBanVisibilityToAll() {
    const log = document.getElementById(CHAT_LOG_ID);
    if (!log) return;

    const rows = log.querySelectorAll("div.__msg__");
    for (const row of rows) applyBanVisibilityToRow(row);
  }

  function attachDelegatedClick(logEl) {
    if (!logEl || logEl.__nczBanDelegated__) return;
    logEl.__nczBanDelegated__ = true;

    logEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const btn = t.closest("button.__ncz_block_btn__");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      // resolve author from row
      const row = btn.closest("div.__msg__");
      if (!row) return;

      const author = String(row.getAttribute("data-author") || "").trim();
      if (!author) return;

      banAuthor(author);
    }, true);
  }

  function watchNewMessages(logEl) {
    if (!logEl || logEl.__nczBanMO__) return;

    const mo = new MutationObserver((mutations) => {
      // Only process added nodes (cheap)
      for (const m of mutations) {
        for (const n of m.addedNodes || []) {
          if (!(n instanceof Element)) continue;

          if (n.matches && n.matches("div.__msg__")) {
            applyBanVisibilityToRow(n);
          } else {
            // if a chunk was appended, find msg rows inside it
            const rows = n.querySelectorAll ? n.querySelectorAll("div.__msg__") : [];
            for (const r of rows) applyBanVisibilityToRow(r);
          }
        }
      }
    });

    mo.observe(logEl, { childList: true, subtree: true });
    logEl.__nczBanMO__ = mo;
  }

  function bootOnceReady() {
    addStylesOnce();
    loadBanlist();

    const log = document.getElementById(CHAT_LOG_ID);
    const roomSel = document.getElementById(ROOM_SEL_ID);

    if (!log || !roomSel) return false;

    ensureBanSelect();
    attachDelegatedClick(log);
    watchNewMessages(log);

    // initial apply (existing rows)
    applyBanVisibilityToAll();

    return true;
  }

  // Retry until chat mounts (no global MutationObserver, no tight loops)
  (function retryBoot() {
    const t0 = Date.now();
    const MAX = 15000;
    const STEP = 250;

    const tick = () => {
      try {
        if (bootOnceReady()) return;
      } catch (e) {
        console.warn("[NCZ banlist] boot error:", e);
      }
      if (Date.now() - t0 > MAX) {
        console.warn("[NCZ banlist] gave up waiting for chat mount.");
        return;
      }
      setTimeout(tick, STEP);
    };

    tick();
  })();

})();























// NCZ: force chat panel selects to min-width: 0px (override earlier CSS)
(() => {
  "use strict";
  const STYLE_ID = "__ncz_chat_select_minwidth0__";
  if (document.getElementById(STYLE_ID)) return;

  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
    #__ncz_chat_panel__ select {
      min-width: 55px !important;
    }
  `;
  document.head.appendChild(st);
})();






// NCZ: remove only "flex-wrap: wrap;" from the parent of #__ncz_chat_banlist__
(() => {
  "use strict";

  const FLAG = "__ncz_flexwrap_removed__";

  function stripFlexWrap() {
    const ban = document.getElementById("__ncz_chat_banlist__");
    if (!ban || !ban.parentElement) return false;

    const p = ban.parentElement;
    if (p.dataset[FLAG] === "1") return true;
    p.dataset[FLAG] = "1";

    // Remove only flex-wrap from inline style (handles both flex-wrap:wrap and flex-wrap: wrap)
    p.style.removeProperty("flex-wrap");

    // If it was written in the raw style attribute, clean it too (belt + suspenders)
    const raw = p.getAttribute("style") || "";
    const cleaned = raw
      .replace(/(^|;)\s*flex-wrap\s*:\s*wrap\s*;?/gi, ";")
      .replace(/;{2,}/g, ";")
      .replace(/^\s*;\s*|\s*;\s*$/g, "");
    if (cleaned !== raw) {
      if (cleaned) p.setAttribute("style", cleaned);
      else p.removeAttribute("style");
    }

    return true;
  }

  // Try now
  if (stripFlexWrap()) return;

  // Or later if injected dynamically
  const mo = new MutationObserver(() => {
    if (stripFlexWrap()) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
























// NCZ: Riffusion/Producer chat link patch (canonicalize to producer.ai) + green ▶ like Suno
// - Detects classic.riffusion.com/song/<uuid> OR producer.ai/song/<uuid> in chat messages
// - Rewrites href to: https://www.producer.ai/song/<uuid>
// - IMPORTANT FIXES:
//    1) Only touches riffusion/producer domains (won't rewrite Suno /song/<uuid>)
//    2) If original is riffusion, keep display text the same; only change href
// ✅ ADDED (ONLY REAL CHANGE): clicking ▶ now also adds to your REAL playlist via window.addSongToList
(() => {
  "use strict";

  if (window.__NCZ_CHAT_PRODUCER_PLAY_INSTALLED__) return;
  window.__NCZ_CHAT_PRODUCER_PLAY_INSTALLED__ = true;

  const CHAT_LOG_ID = "__ncz_chat_log__";

  const STYLE_ID  = "__ncz_chat_producer_play_styles__";
  const BTN_CLASS = "__ncz_chat_producer_play__";
  const LINK_CLASS = "__ncz_chat_producer_link__";

  const UUID_RE_SRC = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

  // Canonical producer page
  const PRODUCER_PAGE_BASE = "https://www.producer.ai/song/";

  // ✅ Audio URL (first UUID is STATIC; only the second (song uuid) changes)
  const RIFFS_STATIC_UUID = "ec30a5e2-fc28-441e-bef0-17ecf0928017";
  const AUDIO_BASE =
    `https://storage.googleapis.com/corpusant-app-public/riffs/${RIFFS_STATIC_UUID}/audio/`;

  // Match page links inside raw text (only riffusion/producer)
  const PAGE_RE = new RegExp(
    String.raw`https?:\/\/(?:classic\.riffusion\.com|riffusion\.com|(?:www\.)?producer\.ai)\/song\/(${UUID_RE_SRC})(?:[?#][^\s<>"']*)?`,
    "ig"
  );

  // Strict host allowlist so we NEVER rewrite Suno/etc.
  const ALLOWED_HOST_RE =
    /^(classic\.riffusion\.com|riffusion\.com|www\.riffusion\.com|producer\.ai|www\.producer\.ai)$/i;

  const SCAN_DEBOUNCE_MS = 80;

  // uuid -> blobUrl (or direct fallback)
  const blobCache = new Map();

  window.__nczLastProducerChat = window.__nczLastProducerChat || null;

  const $id = (id) => document.getElementById(id);

  function addStylesOnce() {
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

      /* ✅ ADDED: clickable taskId link inside playlist row */
      a.__ncz_producer_songlink__{
        color: rgba(106,166,255,1);
        text-decoration: underline;
        cursor: pointer;
        word-break: break-all;
        overflow-wrap: anywhere;
      }
      a.__ncz_producer_songlink__:hover{ opacity:.95; }
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

  function stripTrailingPunct(u) {
    let s = String(u || "");
    while (s && /[)\].,!?;:'"]$/.test(s)) s = s.slice(0, -1);
    return s;
  }

  function canonicalProducerPage(uuid) {
    return PRODUCER_PAGE_BASE + uuid;
  }

  function buildAudioUrl(uuid) {
    return `${AUDIO_BASE}${uuid}.m4a`;
  }

  // ✅ STRICT parser: only riffusion/producer hosts and /song/<uuid>
  function parseProducerOrRiffusionUrl(rawUrl) {
    const s = stripTrailingPunct(String(rawUrl || "").trim());
    let u;
    try {
      u = new URL(s, window.location.href);
    } catch {
      return null;
    }
    if (!ALLOWED_HOST_RE.test(u.hostname)) return null;

    const m = u.pathname.match(new RegExp(String.raw`\/song\/(${UUID_RE_SRC})(?:\/|$)`, "i"));
    if (!m) return null;

    const uuid = m[1];
    const isProducer = /producer\.ai$/i.test(u.hostname);
    const isRiffusion = /riffusion\.com$/i.test(u.hostname) && !isProducer;

    return { uuid, isProducer, isRiffusion, urlObj: u, raw: s };
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
        console.warn("[NCZ producer-play] loadIntoMainPlayer failed:", e);
      }
    }

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
      console.warn("[NCZ producer-play] fallback play failed:", e);
      return false;
    }
  }

  async function getPlayableUrlForUuid(uuid) {
    const cached = blobCache.get(uuid);
    if (cached) return cached;

    const audioUrl = buildAudioUrl(uuid);

    try {
      const res = await fetch(audioUrl, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobCache.set(uuid, blobUrl);
      return blobUrl;
    } catch (e) {
      blobCache.set(uuid, audioUrl);
      return audioUrl;
    }
  }

  // ---- window.songs dedupe without splicing ----
  function producerUuidOf(s) {
    if (!s) return "";
    return String(s.__chat_producer_uuid || s.producer_uuid || s.uuid || s.id || "");
  }

  function findSongIndicesByUuid(uuid) {
    const out = [];
    const arr = Array.isArray(window.songs) ? window.songs : [];
    for (let i = 0; i < arr.length; i++) {
      if (producerUuidOf(arr[i]) === uuid) out.push(i);
    }
    return out;
  }

  function findSongIndexByUrl(url) {
    const arr = Array.isArray(window.songs) ? window.songs : [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      const u = (s && (s.url || s.src)) ? (s.url || s.src) : "";
      if (u === url) return i;
    }
    return -1;
  }

  function softDisableSongEntry(i) {
    try {
      const s = window.songs[i];
      if (!s) return;
      s.__deleted = true;
      s.url = "";
      s.src = "";
      s.__ncz_soft_disabled = true;
    } catch {}
  }

  function ensureSingleSongEntryProducer(uuid, playUrl) {
    if (!Array.isArray(window.songs)) window.songs = [];

    const pageUrl  = canonicalProducerPage(uuid);
    const audioUrl = buildAudioUrl(uuid);

    let idxs = findSongIndicesByUuid(uuid);
    if (!idxs.length) {
      const byUrl = findSongIndexByUrl(playUrl);
      if (byUrl >= 0) idxs = [byUrl];
    }

    const title = `Producer: ${uuid}.m4a`;

    if (!idxs.length) {
      window.songs.push({
        title,
        name: title,
        filename: `${uuid}.m4a`,
        file: `${uuid}.m4a`,

        url: playUrl,
        src: playUrl,

        id: uuid,
        uuid,
        producer_uuid: uuid,
        __chat_producer_uuid: uuid,
        __chat_producer_play: playUrl,
        __chat_added: true,
        __source: "producer-chat",

        taskId: pageUrl,
        task_id: pageUrl,
        outputIndex: 0,
        output_index: 0,

        output_url: audioUrl,
        output: audioUrl,
        out: audioUrl,
        result_url: audioUrl,

        song_page: pageUrl,
        source_url: pageUrl,
      });
      return window.songs.length - 1;
    }

    const keep = idxs[0];
    for (let k = 1; k < idxs.length; k++) softDisableSongEntry(idxs[k]);

    try {
      const s = window.songs[keep];
      s.__deleted = false;

      s.__chat_producer_uuid = uuid;
      s.producer_uuid = uuid;
      s.uuid = uuid;
      s.id = uuid;

      s.url = playUrl;
      s.src = playUrl;

      s.taskId = pageUrl;
      s.task_id = pageUrl;

      s.output_url = audioUrl;
      s.output = audioUrl;
      s.song_page = pageUrl;

      s.title = title;
      s.name = title;

      s.__source = "producer-chat";
    } catch {}

    return keep;
  }

  // --- Linkify riffusion/producer page links INSIDE the message text ---
  function linkifyProducerLinksInTxtSpan(txtSpan) {
    if (!txtSpan) return;

    const walker = document.createTreeWalker(
      txtSpan,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
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

    for (const n of nodes) {
      const text = n.nodeValue;
      PAGE_RE.lastIndex = 0;

      let m, last = 0;
      const frag = document.createDocumentFragment();
      let changed = false;

      while ((m = PAGE_RE.exec(text)) !== null) {
        const raw = m[0];
        const uuid = m[1];
        if (!uuid) continue;

        const start = m.index;
        const endFull = start + raw.length;

        // Trim punctuation off the matched URL but keep punctuation as plain text
        const hit = stripTrailingPunct(raw);
        const trailing = raw.slice(hit.length);

        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

        const isProducerHit = /producer\.ai/i.test(hit);
        // ✅ If riffusion link: keep displayed text (hit), but point to producer.ai
        // ✅ If producer link: display canonical producer URL
        const displayText = isProducerHit ? canonicalProducerPage(uuid) : hit;

        const a = document.createElement("a");
        a.className = LINK_CLASS;
        a.href = canonicalProducerPage(uuid);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = displayText;
        a.setAttribute("data-ncz-producer", "1");

        a.addEventListener("click", (e) => e.stopPropagation());

        frag.appendChild(a);

        if (trailing) frag.appendChild(document.createTextNode(trailing));

        last = endFull;
        changed = true;
      }

      if (!changed) continue;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }

    // ✅ Normalize ONLY riffusion/producer anchors (never touch Suno/etc)
    const links = Array.from(txtSpan.querySelectorAll("a[href]"));
    for (const a of links) {
      const hrefAttr = a.getAttribute("href") || "";
      const info = parseProducerOrRiffusionUrl(hrefAttr);
      if (!info) continue;

      const canon = canonicalProducerPage(info.uuid);

      // Always point to producer
      if (a.href !== canon) a.href = canon;

      // ✅ If it was riffusion: KEEP DISPLAY TEXT as-is
      // ✅ If it was producer: show canonical
      if (info.isProducer) {
        a.textContent = canon;
      }

      a.classList.add(LINK_CLASS);
      a.setAttribute("data-ncz-producer", "1");
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.addEventListener("click", (e) => e.stopPropagation());
    }
  }

  // ✅ ADDED: playlist tagging + "taskId" linkify (same approach as your Suno script)
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
    const href = canonicalProducerPage(uuid);

    const leafs = Array.from(el.querySelectorAll("*")).filter(n => n.childElementCount === 0);
    for (const n of leafs) {
      const t = (n.textContent || "").trim();
      if (!t) continue;

      const looksLikeTask =
        t === href ||
        t === (`producer:${uuid}`) ||
        (t.includes(uuid) && (t.includes("task") || t.includes("Task") || t.includes("id")));

      if (!looksLikeTask) continue;

      n.textContent = "";
      const a = document.createElement("a");
      a.className = "__ncz_producer_songlink__";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = href;
      a.addEventListener("click", (e) => e.stopPropagation());
      n.appendChild(a);
      break;
    }
  }

  function tagPlaylistEl(el, uuid, taskIdUrl, outputIndex, blobUrl, audioUrl) {
    if (!el || el.nodeType !== 1) return;

    el.setAttribute("data-producer-uuid", uuid);
    el.setAttribute("data-task-id", taskIdUrl);
    el.setAttribute("data-taskid", taskIdUrl);
    el.setAttribute("data-task", taskIdUrl);

    el.setAttribute("data-output-index", String(outputIndex));
    el.setAttribute("data-outputindex", String(outputIndex));

    el.setAttribute("data-blob-url", blobUrl);
    el.setAttribute("data-audio-url", audioUrl);

    linkifyTaskIdWithin(el, uuid);
  }

  function tagMostLikelyNewPlaylistChild(uuid, taskIdUrl, outputIndex, blobUrl, audioUrl) {
    const list = pickSongListEl();
    if (!list) return;

    const kids = Array.from(list.children || []);
    if (!kids.length) return;

    let best = null;
    for (let i = kids.length - 1; i >= 0; i--) {
      const el = kids[i];
      const t = (el && el.textContent) ? el.textContent : "";
      if (!t) continue;
      if (t.includes(uuid) || t.includes(blobUrl) || t.includes(audioUrl) || t.includes(taskIdUrl)) {
        best = el;
        break;
      }
    }
    if (!best) return;

    tagPlaylistEl(best, uuid, taskIdUrl, outputIndex, blobUrl, audioUrl);
  }

  function registerWithRealPlaylistProducer(uuid, blobUrl) {
    const audioUrl  = buildAudioUrl(uuid);
    const taskIdUrl = canonicalProducerPage(uuid);
    const outputIndex = 0;

    const already =
      (Array.isArray(window.songs) && findSongIndicesByUuid(uuid).length > 0) ||
      (pickSongListEl() && pickSongListEl().querySelector && pickSongListEl().querySelector(`[data-producer-uuid="${uuid}"]`));

    if (already) return { ok: true, taskIdUrl, audioUrl, outputIndex, el: null };

    if (typeof window.addSongToList === "function") {
      try {
        const ret = window.addSongToList(blobUrl, {
          label: `Producer: ${uuid}.m4a`,
          createdAt: new Date().toLocaleString(),
          taskId: taskIdUrl,
          outputIndex: outputIndex,
          meta: {
            source: "producer-chat",
            uuid,
            audioUrl,
            songPage: taskIdUrl,
          }
        });

        if (ret && ret.nodeType === 1) {
          tagPlaylistEl(ret, uuid, taskIdUrl, outputIndex, blobUrl, audioUrl);
          return { ok: true, taskIdUrl, audioUrl, outputIndex, el: ret };
        } else {
          setTimeout(() => tagMostLikelyNewPlaylistChild(uuid, taskIdUrl, outputIndex, blobUrl, audioUrl), 0);
          return { ok: true, taskIdUrl, audioUrl, outputIndex, el: null };
        }
      } catch (e) {
        console.warn("[NCZ producer-play] addSongToList failed:", e);
      }
    }

    return { ok: false, taskIdUrl, audioUrl, outputIndex, el: null };
  }

  function ensurePlayButton(rowEl, uuid) {
    if (!rowEl || !uuid) return;

    if (rowEl.querySelector(`button.${BTN_CLASS}`)) return;
    if (rowEl.getAttribute("data-ncz-producer-play") === "1") return;

    const replyBtn = rowEl.querySelector("button.__reply__");
    if (!replyBtn) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.title = "Add Producer/Riffusion song to Song List + play in main player";
    btn.textContent = "▶";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        btn.disabled = true;
        btn.textContent = "…";

        const playUrl = await getPlayableUrlForUuid(uuid);
        const pageUrl = canonicalProducerPage(uuid);
        const audioUrl = buildAudioUrl(uuid);

        window.__nczLastProducerChat = { uuid, pageUrl, audioUrl, playUrl };

        // ✅ THIS is the missing piece: add to REAL playlist (like Suno)
        registerWithRealPlaylistProducer(uuid, playUrl);

        const idx = ensureSingleSongEntryProducer(uuid, playUrl);
        playViaMainSystem(idx);

        btn.textContent = "▶";
      } catch (err) {
        console.warn("[NCZ producer-play] add/play failed:", err);
        btn.textContent = "!";
        setTimeout(() => (btn.textContent = "▶"), 900);
      } finally {
        btn.disabled = false;
      }
    });

    replyBtn.insertAdjacentElement("afterend", btn);

    rowEl.setAttribute("data-ncz-producer-play", "1");
    rowEl.setAttribute("data-ncz-producer-uuid", uuid);
  }

  function findFirstUuidInRow(row) {
    const txtSpan = row.querySelector("span.__txt__");
    const a = txtSpan ? txtSpan.querySelector(`a.${LINK_CLASS}[href], a[data-ncz-producer="1"][href]`) : null;
    if (a) {
      const info = parseProducerOrRiffusionUrl(a.getAttribute("href") || "");
      if (info && info.uuid) return info.uuid;
    }

    const t = (row.textContent || "");
    const m = t.match(new RegExp(String.raw`(?:classic\.riffusion\.com|riffusion\.com|(?:www\.)?producer\.ai)\/song\/(${UUID_RE_SRC})`, "i"));
    return m ? m[1] : null;
  }

  function scan() {
    const log = $id(CHAT_LOG_ID);
    if (!log) return;

    const rows = Array.from(log.querySelectorAll("div.__msg__"));
    for (const row of rows) {
      const txtSpan = row.querySelector("span.__txt__");

      // ✅ This is what makes "https://www.producer.ai/song/<uuid>" become a LINK
      if (txtSpan) linkifyProducerLinksInTxtSpan(txtSpan);

      const uuid = findFirstUuidInRow(row);
      if (uuid) ensurePlayButton(row, uuid);
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

    console.log("[NCZ producer-play] riffusion/producer links => producer.ai + ▶ enabled + playlist add");
  }

  init();
})();


























// ✅ NCZ PATCH (linkify-safe) v5:
// - __msg__ flex ROW (meta bar left + original message right)
// - meta bar contains: toggle + timestamp (.__ts__) + block btns (.__ncz_block_btn__)
// - DEFAULT: timestamp hidden AND block buttons hidden
// - Toggle: shows/hides BOTH timestamp + block buttons together
// - Accounts for block buttons being injected later
// - NEVER touches anything inside span.__txt__ (linkify-safe)
(() => {
  "use strict";

  if (window.__NCZ_CHAT_TS_SPLIT_V5_INSTALLED__) return;
  window.__NCZ_CHAT_TS_SPLIT_V5_INSTALLED__ = true;

  const CHAT_LOG_ID  = "__ncz_chat_log__";
  const STYLE_ID     = "__ncz_chat_ts_split_style_v5__";
  const META_CLASS   = "__ncz_meta_bar__";
  const TOGGLE_CLASS = "__ncz_meta_toggle__";
  const OPEN_CLASS   = "__ncz_meta_open__"; // controls both ts + block

  const TRI_CLOSED = "▾"; // meta hidden
  const TRI_OPEN   = "▸"; // meta shown

  const $id = (id) => document.getElementById(id);

  function addStylesOnce() {
    if ($id(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* Row is flex row */
      #${CHAT_LOG_ID} div.__msg__{
        display:flex;
        flex-direction:row;
        align-items:stretch;
        gap: 6px;
      }

      /* Meta bar shown LEFT, but appended LAST in DOM */
      #${CHAT_LOG_ID} .${META_CLASS}{
        order:-1;
        display:flex;
        align-items:center;
        gap:6px;
        flex: 0 0 auto;
      }

      /* __who__ sizes to its text */
      #${CHAT_LOG_ID} div.__msg__ span.__who__{
        display:inline-block;
        white-space:nowrap;
        width:max-content;
        min-width:max-content;
        flex: 0 0 auto;
      }

      /* Message text wraps in flex row */
      #${CHAT_LOG_ID} div.__msg__ span.__txt__{
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap:anywhere;
      }

      /* Toggle button */
      #${CHAT_LOG_ID} .${META_CLASS} button.${TOGGLE_CLASS}{
        display:inline-flex !important;
        align-items:center;
        justify-content:center;
        width:18px;
        height:18px;
        border-radius:8px;
        border:1px solid rgba(255,255,255,.12);
        background: rgba(255,255,255,.06);
        color: rgba(169,179,207,.98);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        user-select:none;
        padding: 0;
        appearance:none;
        -webkit-appearance:none;
        flex: 0 0 auto;
      }
      #${CHAT_LOG_ID} .${META_CLASS} button.${TOGGLE_CLASS}:hover{
        background: rgba(255,255,255,.10);
      }

      /* ✅ Default: hide timestamp + block buttons */
      #${CHAT_LOG_ID} div.__msg__ .__ts__{ display:none; }
      #${CHAT_LOG_ID} div.__msg__ button.__ncz_block_btn__{ display:none; }

      /* ✅ When open: show both */
      #${CHAT_LOG_ID} div.__msg__.${OPEN_CLASS} .__ts__{ display:inline; }
      #${CHAT_LOG_ID} div.__msg__.${OPEN_CLASS} button.__ncz_block_btn__{ display:inline-flex; }
    `;
    document.head.appendChild(st);
  }

  function isInsideTxt(el) {
    return !!(el && el.closest && el.closest("span.__txt__"));
  }

  function ensureMetaBar(row) {
    let bar = row.querySelector(`:scope > .${META_CLASS}`);
    if (bar) return bar;

    bar = document.createElement("div");
    bar.className = META_CLASS;
    bar.setAttribute("data-ncz-ui", "1");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = TOGGLE_CLASS;
    btn.title = "Toggle timestamp + block";
    btn.textContent = TRI_CLOSED;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = row.classList.toggle(OPEN_CLASS);
      btn.textContent = open ? TRI_OPEN : TRI_CLOSED;
      row.dataset.__nczMetaOpen = open ? "1" : "0";
    }, true);

    bar.appendChild(btn);

    // DOM safety: append at end (don’t disturb existing node order)
    row.appendChild(bar);
    return bar;
  }

  function syncToggleGlyph(row) {
    const bar = row.querySelector(`:scope > .${META_CLASS}`);
    if (!bar) return;
    const t = bar.querySelector(`button.${TOGGLE_CLASS}`);
    if (!t) return;

    const open = row.classList.contains(OPEN_CLASS) || row.dataset.__nczMetaOpen === "1";
    t.textContent = open ? TRI_OPEN : TRI_CLOSED;
  }

  function moveIntoMeta(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.dataset.__nczMetaMoved === "1") return;
    if (isInsideTxt(el)) return; // never touch linkified text area

    const row = el.closest("div.__msg__");
    if (!row) return;

    addStylesOnce();
    const bar = ensureMetaBar(row);

    if (el.parentElement !== bar) bar.appendChild(el);

    // mark to avoid re-processing loops when observer sees our move
    el.dataset.__nczMetaMoved = "1";
  }

  function patchRow(row) {
    if (!row || row.nodeType !== 1) return;

    addStylesOnce();

    const hasTs = !!row.querySelector(".__ts__");
    const hasBlock = !!row.querySelector("button.__ncz_block_btn__");
    if (!hasTs && !hasBlock) return;

    ensureMetaBar(row);

    // Default collapsed once per row
    if (row.dataset.__nczMetaInit !== "1") {
      row.dataset.__nczMetaInit = "1";
      row.dataset.__nczMetaOpen = "0";
      row.classList.remove(OPEN_CLASS);
    } else {
      const open = row.dataset.__nczMetaOpen === "1";
      row.classList.toggle(OPEN_CLASS, open);
    }
    syncToggleGlyph(row);

    // Move existing timestamp + block buttons into meta bar
    const ts = row.querySelector(".__ts__");
    if (ts) moveIntoMeta(ts);

    const blocks = row.querySelectorAll("button.__ncz_block_btn__");
    for (const b of blocks) moveIntoMeta(b);
  }

  function processAddedNode(n) {
    if (!n || n.nodeType !== 1) return;

    if (n.matches && n.matches("div.__msg__")) {
      patchRow(n);
      return;
    }

    if (n.matches && (n.matches("button.__ncz_block_btn__") || n.matches(".__ts__"))) {
      moveIntoMeta(n);

      // ensure the parent row has a bar + correct open/closed state
      const row = n.closest("div.__msg__");
      if (row) {
        ensureMetaBar(row);
        // default collapsed if new
        if (row.dataset.__nczMetaInit !== "1") {
          row.dataset.__nczMetaInit = "1";
          row.dataset.__nczMetaOpen = "0";
          row.classList.remove(OPEN_CLASS);
        } else {
          row.classList.toggle(OPEN_CLASS, row.dataset.__nczMetaOpen === "1");
        }
        syncToggleGlyph(row);
      }
      return;
    }

    // Otherwise, scan inside this added chunk for targets (cheap + safe)
    if (n.querySelectorAll) {
      const targets = n.querySelectorAll("div.__msg__, button.__ncz_block_btn__, .__ts__");
      for (const t of targets) {
        if (t.matches("div.__msg__")) patchRow(t);
        else processAddedNode(t);
      }
    }
  }

  function init() {
    const log = $id(CHAT_LOG_ID);
    if (!log) {
      const mo = new MutationObserver(() => {
        const l = $id(CHAT_LOG_ID);
        if (l) { mo.disconnect(); init(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }

    // Initial pass
    log.querySelectorAll("div.__msg__").forEach(patchRow);

    // Observe subtree so we catch later-injected block buttons,
    // but we never touch anything inside span.__txt__
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes || []) processAddedNode(n);
      }
    });

    mo.observe(log, { childList: true, subtree: true });

    console.log("[NCZ chat] ts split v5 ready (toggle shows/hides timestamp + block buttons)");
  }

  init();
})();




(() => {
  "use strict";

  const SID_ID = "__ncz_leftbar__";
  const BODY_SEL = ".__ncz_lb_body__";
  const BTN_ID = "__ncz_lb_mequavis_link__";
  const URL = "https://mequavis.com/";

  function buildItem(){
    const item = document.createElement("div");
    item.id = BTN_ID;
    item.className = "__ncz_lb_item__";
    item.setAttribute("data-action", "mequavisLink");
    item.title = "Open mequavis.com";

    item.innerHTML = `
      <div class="__ncz_lb_icon__">🌐</div>
      <div class="__ncz_lb_labelwrap__" style="min-width:0">
        <div class="__ncz_lb_label__">MEQUAVIS</div>
        <div class="__ncz_lb_hint__">mequavis.com</div>
      </div>
    `;

    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(URL, "_blank", "noopener,noreferrer");
    };

    item.addEventListener("click", open);
    item.addEventListener("auxclick", (e) => { if (e.button === 1) open(e); });

    return item;
  }

  function insertBottom(){
    const side = document.getElementById(SID_ID);
    if(!side) return false;

    const body = side.querySelector(BODY_SEL);
    if(!body) return false;

    if(document.getElementById(BTN_ID)) return true;

    const item = buildItem();

    // put it at the very bottom of the leftbar body
    body.appendChild(item);

    return true;
  }

  if (insertBottom()) return;

  const mo = new MutationObserver(() => {
    if (insertBottom()) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => mo.disconnect(), 15000);
})();

















// ✅ NCZ PATCH: YouTube links in chat — add green ▶ button + iframe modal player
// Fixes:
// 1) Button styling applies immediately (CSS injected at boot, not first click)
// 2) Autoplay + SOUND attempt after user click using YouTube JS postMessage commands
// 3) Reuses the same iframe/player (no about:blank wipe; uses pauseVideo; loadVideoById)
// 4) NEW: pauses other media players before starting YouTube

(() => {
  "use strict";

  if (window.__NCZ_YT_IFRAME_PATCH__) return;
  window.__NCZ_YT_IFRAME_PATCH__ = true;

  const CHAT_LOG_ID = "__ncz_chat_log__";

  const STYLE_ID = "__ncz_youtube_iframe_style__";
  const MODAL_ID = "__ncz_youtube_modal__";
  const IFRAME_ID = "__ncz_youtube_iframe__";
  const TITLE_ID = "__ncz_youtube_title__";
  const OPEN_ID = "__ncz_youtube_open__";
  const SOUND_ID = "__ncz_youtube_sound__";
  const CLOSE_ID = "__ncz_youtube_close__";

  const BTN_CLASS = "__ncz_chat_yt_play__";

  const SOUND_STORE = "NCZ_YT_SOUND_ON"; // "1" or "0"
  const titleCache = new Map(); // id -> title

  function $id(id) { return document.getElementById(id); }

  // ---------- NEW: Pause other media players ----------
  function pauseOtherMediaPlayers() {
    // 1) pause all DOM media elements
    try {
      const media = Array.from(document.querySelectorAll("audio, video"));
      for (const el of media) {
        try {
          if (!el.paused) el.pause();
        } catch {}
      }
    } catch {}

    // 2) try some likely global refs (safe if not present)
    const maybe = [
      window.NCZ_AUDIO,
      window.NCZ_VIDEO,
      window.__NCZ_AUDIO__,
      window.__NCZ_VIDEO__,
      window.__NCZ_HOOK_AUDIO__,
      window.__NCZ_HOOK_VIDEO__,
      window.__ncz_audio__,
      window.__ncz_video__,
      window.nczAudio,
      window.nczVideo
    ];
    for (const x of maybe) {
      try {
        if (x && typeof x.pause === "function") x.pause();
      } catch {}
    }

    // 3) broadcast so any other scripts can pause hidden/off-DOM players
    try {
      window.dispatchEvent(new CustomEvent("ncz:pauseAllMedia", { detail: { source: "youtube" } }));
    } catch {}
  }

  // ---------- Styles ----------
  function addStylesOnce() {
    if ($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${MODAL_ID}{
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.55);
        z-index: 2147483646;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      #${MODAL_ID}.__open__{ display:flex; }
      #${MODAL_ID} .__box__{
        width: min(1100px, 96vw);
        height: min(720px, 88vh);
        background: rgba(12,16,28,.98);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        box-shadow: 0 18px 60px rgba(0,0,0,.55);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      #${MODAL_ID} .__hdr__{
        flex: 0 0 auto;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.04);
        font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      }
      #${MODAL_ID} .__hdr__ .__title__{
        font-weight: 900;
        font-size: 12px;
        opacity: .95;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${MODAL_ID} .__hdr__ .__btns__{
        display:flex;
        gap: 8px;
        align-items:center;
      }
      #${MODAL_ID} button.__x__{
        padding: 6px 10px;
        border-radius: 10px;
        font-weight: 900;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(255,255,255,.06);
        cursor: pointer;
        color: rgba(233,238,252,.98);
      }
      #${MODAL_ID} button.__x__:hover{
        background: rgba(255,255,255,.10);
      }
      #${MODAL_ID} .__body__{
        flex: 1 1 auto;
        min-height: 0;
        background: rgba(0,0,0,.40);
      }
      #${IFRAME_ID}{
        width: 100%;
        height: 100%;
        border: 0;
        display:block;
        background: rgba(0,0,0,.20);
      }

      /* The injected ▶ button */
      button.${BTN_CLASS}{
        margin-left: 6px;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 900;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(75,227,138,.16);
        color: rgba(233,238,252,.98);
        cursor: pointer;
        line-height: 18px;
      }
      button.${BTN_CLASS}:hover{
        background: rgba(75,227,138,.26);
      }
      button.${BTN_CLASS}[disabled]{
        opacity: .55;
        cursor: default;
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------- YouTube postMessage control ----------
  function ytCmd(iframe, func, args = []) {
    try {
      if (!iframe || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*"
      );
    } catch {}
  }

  function kickPlayback(iframe, wantSound) {
    const bursts = [0, 60, 160, 320, 650, 1000];
    for (const ms of bursts) {
      setTimeout(() => {
        ytCmd(iframe, "playVideo");
        if (wantSound) {
          ytCmd(iframe, "unMute");
          ytCmd(iframe, "setVolume", [100]);
        } else {
          ytCmd(iframe, "mute");
        }
      }, ms);
    }
  }

  function loadVideoViaJs(iframe, id, startSeconds) {
    ytCmd(iframe, "loadVideoById", [{
      videoId: id,
      startSeconds: Math.max(0, startSeconds || 0)
    }]);
  }

  function getSoundPref() {
    const v = localStorage.getItem(SOUND_STORE);
    return v !== "0"; // default ON
  }
  function setSoundPref(on) {
    localStorage.setItem(SOUND_STORE, on ? "1" : "0");
    const btn = $id(SOUND_ID);
    if (btn) btn.textContent = on ? "🔊" : "🔇";
  }

  // ---------- Modal ----------
  function ensureModal() {
    addStylesOnce();

    let modal = $id(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="__box__" role="dialog" aria-modal="true">
        <div class="__hdr__">
          <div class="__title__" id="${TITLE_ID}">YouTube</div>
          <div class="__btns__">
            <button type="button" class="__x__" id="${SOUND_ID}" title="Toggle sound">🔊</button>
            <button type="button" class="__x__" id="${OPEN_ID}" title="Open in new tab">↗</button>
            <button type="button" class="__x__" id="${CLOSE_ID}" title="Close">✕</button>
          </div>
        </div>
        <div class="__body__">
          <iframe
            id="${IFRAME_ID}"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    setSoundPref(getSoundPref());

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("__open__")) closeModal();
    });

    modal.querySelector(`#${CLOSE_ID}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });

    modal.querySelector(`#${OPEN_ID}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      const url = modal.getAttribute("data-open-url") || "";
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });

    modal.querySelector(`#${SOUND_ID}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      const iframe = $id(IFRAME_ID);
      const on = !getSoundPref();
      setSoundPref(on);
      if (iframe) kickPlayback(iframe, on);
    });

    return modal;
  }

  function openModalAndPlay(id, startSeconds, watchUrl, titleText) {
    // NEW: pause other players first
    pauseOtherMediaPlayers();

    const modal = ensureModal();
    const iframe = $id(IFRAME_ID);
    const titleEl = $id(TITLE_ID);

    if (titleEl) titleEl.textContent = titleText || "YouTube";
    modal.setAttribute("data-open-url", watchUrl || "");
    modal.classList.add("__open__");

    const wantSound = getSoundPref();
    const alreadyLoaded = iframe && iframe.getAttribute("data-ncz-yt-loaded") === "1";

    if (iframe && alreadyLoaded) {
      loadVideoViaJs(iframe, id, startSeconds);
      kickPlayback(iframe, wantSound);
      return;
    }

    if (iframe) {
      iframe.setAttribute("data-ncz-yt-loaded", "1");
      iframe.src = buildEmbedUrl(id, startSeconds);
      kickPlayback(iframe, wantSound);
    }
  }

  function closeModal() {
    const modal = $id(MODAL_ID);
    if (!modal) return;
    modal.classList.remove("__open__");

    const iframe = $id(IFRAME_ID);
    if (iframe) ytCmd(iframe, "pauseVideo");
  }

  // ---------- URL parsing ----------
  function isYouTubeHost(host) {
    const h = (host || "").toLowerCase();
    return (
      h === "youtu.be" ||
      h === "www.youtu.be" ||
      h === "youtube.com" ||
      h === "www.youtube.com" ||
      h === "m.youtube.com" ||
      h === "music.youtube.com" ||
      h === "youtube-nocookie.com" ||
      h === "www.youtube-nocookie.com"
    );
  }

  function parseTimeToSeconds(t) {
    if (!t) return 0;
    const s = String(t).trim().toLowerCase();
    if (/^\d+$/.test(s)) return parseInt(s, 10) || 0;

    let total = 0;
    const re = /(\d+)\s*([hms])/g;
    let m;
    while ((m = re.exec(s))) {
      const val = parseInt(m[1], 10) || 0;
      const unit = m[2];
      if (unit === "h") total += val * 3600;
      if (unit === "m") total += val * 60;
      if (unit === "s") total += val;
    }
    return total || 0;
  }

  function extractYouTubeIdAndStart(href) {
    try {
      const u = new URL(href);
      if (!isYouTubeHost(u.hostname)) return null;

      const host = (u.hostname || "").toLowerCase();
      const path = u.pathname || "";
      const qp = u.searchParams;

      let id = "";

      if (host.includes("youtu.be")) {
        id = (path.split("/").filter(Boolean)[0] || "").trim();
      } else if (path.startsWith("/watch")) {
        id = (qp.get("v") || "").trim();
      } else if (path.startsWith("/shorts/")) {
        id = (path.split("/shorts/")[1] || "").split("/")[0].trim();
      } else if (path.startsWith("/live/")) {
        id = (path.split("/live/")[1] || "").split("/")[0].trim();
      } else if (path.startsWith("/embed/")) {
        id = (path.split("/embed/")[1] || "").split("/")[0].trim();
      } else if (path.startsWith("/v/")) {
        id = (path.split("/v/")[1] || "").split("/")[0].trim();
      } else {
        id = (qp.get("v") || "").trim();
      }

      if (!id) return null;
      id = id.replace(/[^0-9A-Za-z_-]/g, "");
      if (!id) return null;

      const t = qp.get("t") || qp.get("start") || "";
      const start = parseTimeToSeconds(t);

      return { id, start };
    } catch {
      const s = String(href || "");
      if (!s.toLowerCase().includes("youtu")) return null;
      const m = s.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/|\/live\/)([0-9A-Za-z_-]{6,})/i);
      if (!m) return null;
      return { id: m[1], start: 0 };
    }
  }

  function buildWatchUrl(id) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }

  function buildEmbedUrl(id, startSeconds) {
    const base = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
    const params = new URLSearchParams();

    params.set("autoplay", "1");
    params.set("playsinline", "1");
    params.set("rel", "0");
    params.set("modestbranding", "1");

    params.set("enablejsapi", "1");
    const origin = (window.location && window.location.origin && window.location.origin !== "null")
      ? window.location.origin
      : "";
    if (origin) params.set("origin", origin);

    if (startSeconds && startSeconds > 0) params.set("start", String(startSeconds));

    return `${base}?${params.toString()}`;
  }

  function withAutoplayParams(url) {
    try {
      const u = new URL(url);
      if (!isYouTubeHost(u.hostname)) return url;
      u.searchParams.set("autoplay", "1");
      return u.toString();
    } catch {
      return url;
    }
  }

  // ---------- OG title ----------
  function getOgProxyBase() {
    return String(
      window.NCZ_YT_OG_PROXY ||
      window.NCZ_HOOK_OG_PROXY ||
      "https://xtdevelopment.net/og-proxy/?ttl=86400&url="
    );
  }

  async function fetchTitleViaOgProxy(watchUrl, id) {
    if (titleCache.has(id)) return titleCache.get(id);

    const proxyBase = getOgProxyBase();
    const proxyUrl = proxyBase + encodeURIComponent(watchUrl);

    try {
      const r = await fetch(proxyUrl, { credentials: "omit" });
      if (!r.ok) throw new Error("bad proxy status " + r.status);
      const j = await r.json();

      const og = (j && j.og) ? j.og : {};
      const tw = (j && j.twitter) ? j.twitter : {};
      const title =
        og["og:title"] ||
        tw["twitter:title"] ||
        (j && j.meta && (j.meta["title"] || j.meta["Title"])) ||
        "";

      if (title) {
        titleCache.set(id, title);
        return title;
      }
    } catch {}

    return "";
  }

  // ---------- Chat decoration ----------
  function injectPlayButtonNextToLink(a, id) {
    addStylesOnce();

    if (a.getAttribute("data-ncz-yt-btn") === "1") return;
    a.setAttribute("data-ncz-yt-btn", "1");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.textContent = "▶";
    btn.title = "Play YouTube video (iframe)";
    btn.setAttribute("data-yt-id", id);

    if (a.nextSibling) a.parentNode.insertBefore(btn, a.nextSibling);
    else a.parentNode.appendChild(btn);
  }

  function decorateChat() {
    const log = $id(CHAT_LOG_ID);
    if (!log) return;

    const rows = Array.from(log.querySelectorAll("div.__msg__"));
    for (const row of rows) {
      const links = Array.from(row.querySelectorAll("a[href]"));
      for (const a of links) {
        const info = extractYouTubeIdAndStart(a.href || a.getAttribute("href") || "");
        if (!info) continue;
        injectPlayButtonNextToLink(a, info.id);
      }
    }
  }

  // Click handler for injected ▶ (capture phase so nothing else steals it)
  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const btn = t.closest(`button.${BTN_CLASS}`);
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const id = btn.getAttribute("data-yt-id") || "";
    if (!id) return;

    const row = btn.closest("div.__msg__");
    let start = 0;
    let watchUrl = buildWatchUrl(id);

    if (row) {
      const links = Array.from(row.querySelectorAll("a[href]"));
      for (const a of links) {
        const info = extractYouTubeIdAndStart(a.href || a.getAttribute("href") || "");
        if (info && info.id === id) {
          start = info.start || 0;
          watchUrl = a.href || watchUrl;
          break;
        }
      }
    }

    watchUrl = withAutoplayParams(watchUrl);

    const oldText = btn.textContent;
    try {
      btn.disabled = true;
      btn.textContent = "…";

      openModalAndPlay(id, start, watchUrl, `YouTube: ${id}`);

      const canonicalWatch = buildWatchUrl(id);
      const title = await fetchTitleViaOgProxy(canonicalWatch, id);
      if (title) {
        const titleEl = $id(TITLE_ID);
        if (titleEl) titleEl.textContent = title;
      }

      btn.textContent = oldText || "▶";
    } catch (err) {
      console.warn("[NCZ yt] failed:", err);
      btn.textContent = "!";
      setTimeout(() => { btn.textContent = oldText || "▶"; }, 900);
    } finally {
      btn.disabled = false;
    }
  }, true);

  function boot() {
    addStylesOnce();
    decorateChat();

    const log = $id(CHAT_LOG_ID);
    if (!log) {
      const mo = new MutationObserver(() => {
        const l = $id(CHAT_LOG_ID);
        if (l) { mo.disconnect(); boot(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }

    const mo = new MutationObserver(() => decorateChat());
    mo.observe(log, { childList: true, subtree: true });
  }

  boot();
  console.log("[NCZ yt] iframe patch active (JS commands + reuse + pause other media)");
})();



















// ✅ NCZ PATCH: Suno /hook/ links (video)
// - Intercepts clicks on the existing chat Suno ▶ button (.__ncz_chat_suno_play__)
// - If the message contains a Suno hook link (/hook/<uuid> or /@user/hook/<uuid>),
//   we resolve an embed/video URL using your OG proxy.
// - ✅ Plays the MP4 in your EXISTING video player:
//     <video id="__ncz_right_lyrics_video__" ... muted></video>
//   - Pauses (does NOT mute) the main audio player: <audio id="player" ...>
//   - Shows video controls while hook video is active
//   - Unmutes the video while hook video is active
//   - When any other media starts playing again (including #player), re-mutes the video + hides controls
//
// ✅ CHANGE REQUESTED:
//   Pause #player immediately, THEN wait 300ms before loading/playing the hook video.
//   (This avoids race conditions with other scripts that pause media right after #player changes.)
//
// Drop this *after* your existing "NCZ suno-play" script.
(() => {
  "use strict";

  if (window.__NCZ_SUNO_HOOK_VIDEOPLAYER_PATCH__) return;
  window.__NCZ_SUNO_HOOK_VIDEOPLAYER_PATCH__ = true;

  const CHAT_LOG_ID = "__ncz_chat_log__";
  const SUNO_BTN_CLASS = "__ncz_chat_suno_play__";

  const AUDIO_ID = "player";
  const VIDEO_ID = "__ncz_right_lyrics_video__";

  const LOAD_DELAY_MS = 300;

  const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

  // ✅ Default to YOUR OG proxy (JSON)
  // You can override by setting:
  //   window.NCZ_HOOK_OG_PROXY = "https://xtdevelopment.net/og-proxy/?ttl=86400&url=";
  const DEFAULT_OG_PROXY_BASE = "https://xtdevelopment.net/og-proxy/?ttl=86400&url=";

  // Optional modal iframe fallback (only used if we can't get a direct mp4/webm/m3u8 URL)
  const STYLE_ID = "__ncz_suno_hook_modal_style__";
  const MODAL_ID = "__ncz_suno_hook_modal__";
  const IFRAME_ID = "__ncz_suno_hook_iframe__";

  const embedCache = new Map();     // uuid -> embedUrl
  const ogDataCache = new Map();    // hookUrl -> og JSON
  const ogHtmlCache = new Map();    // hookUrl -> html (only for last-resort fallback)

  let hookPlayToken = 0;            // increments per hook play, used to ignore stale async results
  let pendingLoadTimer = null;      // single timer for delayed load

  function $id(id) { return document.getElementById(id); }

  function getAudio() {
    const a = $id(AUDIO_ID);
    return (a && a.tagName === "AUDIO") ? a : null;
  }

  function getVideo() {
    const v = $id(VIDEO_ID);
    return (v && v.tagName === "VIDEO") ? v : null;
  }

  function pauseMainAudioOnly() {
    const a = getAudio();
    if (!a) return;
    try { a.pause(); } catch {}
  }

  function setVideoControlsVisible(v, on) {
    if (!v) return;
    try { v.controls = !!on; } catch {}
    if (on) v.setAttribute("controls", "");
    else v.removeAttribute("controls");
  }

  function unmuteVideo(v) {
    if (!v) return;
    try { v.muted = false; } catch {}
    try { v.defaultMuted = false; } catch {}
    try { v.volume = 1; } catch {}
    try { v.removeAttribute("muted"); } catch {}
  }

  function remuteVideoToBaseline(v) {
    if (!v) return;
    try { v.muted = true; } catch {}
    try { v.defaultMuted = true; } catch {}
    v.setAttribute("muted", ""); // restore your baseline muted attribute
  }

  function isProbablyDirectVideoUrl(u) {
    const s = String(u || "").trim();
    if (!s) return false;
    const lc = s.toLowerCase();
    if (lc.includes("cdn1.suno.ai/hook_") && lc.includes(".mp4")) return true;
    if (lc.endsWith(".mp4") || lc.includes(".mp4?")) return true;
    if (lc.endsWith(".webm") || lc.includes(".webm?")) return true;
    if (lc.endsWith(".m3u8") || lc.includes(".m3u8?")) return true;
    return false;
  }

  function guessHookCdnMp4(uuid) {
    // https://cdn1.suno.ai/hook_<uuid>.mp4
    return `https://cdn1.suno.ai/hook_${uuid}.mp4`;
  }

  function setHookActive(on, uuid, token) {
    const v = getVideo();
    if (!v) return;
    if (on) {
      v.setAttribute("data-ncz-hook-active", "1");
      if (uuid) v.setAttribute("data-ncz-last-hook", uuid);
      if (token != null) v.setAttribute("data-ncz-hook-token", String(token));
    } else {
      v.removeAttribute("data-ncz-hook-active");
      v.removeAttribute("data-ncz-hook-token");
      v.removeAttribute("data-ncz-hook-resolved");
      v.removeAttribute("data-ncz-hook-guess");
    }
  }

  // ✅ When hook video is active, any other media starting => hide controls + re-mute video
  function installMediaPlayWatcher() {
    if (window.__NCZ_HOOK_MEDIA_WATCHER__) return;
    window.__NCZ_HOOK_MEDIA_WATCHER__ = true;

    const handler = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLMediaElement)) return;

      const v = getVideo();
      if (!v) return;

      if (v.getAttribute("data-ncz-hook-active") !== "1") return;
      if (t === v) return; // allow hook video to play without canceling itself

      // Another media element started (including #player)
      setVideoControlsVisible(v, false);
      remuteVideoToBaseline(v);
      setHookActive(false);
    };

    document.addEventListener("play", handler, true);
    document.addEventListener("playing", handler, true);
  }

  // ✅ One-time "anti-pause" retry, to defeat any script that pauses immediately after play
  function armAntiPauseRetry(v, token) {
    if (!v) return;
    let retried = false;
    const startedAt = performance.now();

    const onPause = () => {
      if (retried) return;
      if (v.getAttribute("data-ncz-hook-active") !== "1") return;
      if (v.getAttribute("data-ncz-hook-token") !== String(token)) return;

      const dt = performance.now() - startedAt;
      if (dt < 1400) {
        retried = true;
        setTimeout(() => {
          if (v.getAttribute("data-ncz-hook-active") !== "1") return;
          if (v.getAttribute("data-ncz-hook-token") !== String(token)) return;
          try {
            const p = v.play();
            if (p && typeof p.catch === "function") p.catch(() => {});
          } catch {}
        }, 0);
      }
    };

    v.addEventListener("pause", onPause, true);
    setTimeout(() => v.removeEventListener("pause", onPause, true), 2200);
  }

  // ---- Link parsing ----
  function canonicalHookUrlFromAnySunoUrl(href) {
    try {
      const u = new URL(href);
      const host = (u.hostname || "").toLowerCase();
      if (host !== "suno.com" && !host.endsWith(".suno.com")) return null;

      const m = u.pathname.match(UUID_RE);
      if (!m) return null;
      const uuid = m[0];

      if (!u.pathname.toLowerCase().includes("/hook/")) return null;

      return { uuid, hookUrl: `https://suno.com/hook/${uuid}` };
    } catch {
      const s = String(href || "");
      if (!s.toLowerCase().includes("suno.com")) return null;
      if (!s.toLowerCase().includes("/hook/")) return null;
      const m = s.match(UUID_RE);
      if (!m) return null;
      const uuid = m[0];
      return { uuid, hookUrl: `https://suno.com/hook/${uuid}` };
    }
  }

  function findHookInfoInRow(rowEl) {
    if (!rowEl) return null;
    const links = Array.from(rowEl.querySelectorAll("a[href]"));
    for (const a of links) {
      const info = canonicalHookUrlFromAnySunoUrl(a.href || a.getAttribute("href") || "");
      if (info) return info;
    }
    return null;
  }

  function absUrlFromMaybeRelative(u, baseUrl) {
    const s = String(u || "").trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("//")) {
      try { return (new URL(baseUrl)).protocol + s; } catch { return "https:" + s; }
    }
    if (s.startsWith("/")) {
      try { return (new URL(baseUrl)).origin + s; } catch { return s; }
    }
    try { return new URL(s, baseUrl).toString(); } catch { return s; }
  }

  function firstVal(v) {
    if (!v) return "";
    if (Array.isArray(v)) return String(v[0] || "").trim();
    return String(v).trim();
  }

  function pickBestCandidate(cands, hookUrl) {
    const cleaned = cands.map(s => absUrlFromMaybeRelative(String(s || "").trim(), hookUrl)).filter(Boolean);
    const direct = cleaned.filter(isProbablyDirectVideoUrl);
    if (direct.length) return direct[0];
    return cleaned[0] || "";
  }

  function pickEmbedFromOgJson(data, hookUrl, uuid) {
    if (!data || data.ok === false) return "";

    if (typeof window.NCZ_HOOK_EMBED_PICKER_JSON === "function") {
      try {
        const vv = window.NCZ_HOOK_EMBED_PICKER_JSON(data, hookUrl, uuid);
        if (vv) return absUrlFromMaybeRelative(vv, hookUrl);
      } catch {}
    }

    const og = data.og || {};
    const tw = data.twitter || {};
    const meta = data.meta || {};

    const candidates = [
      firstVal(og["og:video"]),
      firstVal(og["og:video:url"]),
      firstVal(og["og:video:secure_url"]),
      firstVal(tw["twitter:player:stream"]),
      firstVal(tw["twitter:player"]),
      firstVal(tw["twitter:player:url"]),
      firstVal(meta["twitter:player"]),
    ].filter(Boolean);

    const picked = pickBestCandidate(candidates, hookUrl);
    if (picked) return picked;

    const buckets = [og, tw, meta];
    const more = [];
    for (const b of buckets) {
      for (const k in b) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
        const v = b[k];
        const vv = Array.isArray(v) ? v : [v];
        for (const item of vv) {
          const s = String(item || "").trim();
          if (!s) continue;
          const lc = s.toLowerCase();
          if (lc.startsWith("http://") || lc.startsWith("https://") || lc.startsWith("//") || lc.startsWith("/")) {
            more.push(s);
          }
        }
      }
    }
    return pickBestCandidate(more, hookUrl);
  }

  function pickEmbedFromDoc(doc, hookUrl, uuid) {
    if (typeof window.NCZ_HOOK_EMBED_PICKER === "function") {
      try {
        const v = window.NCZ_HOOK_EMBED_PICKER(doc, hookUrl, uuid);
        if (v) return v;
      } catch {}
    }

    const sel = (q) => doc.querySelector(q)?.getAttribute("content") || "";

    const candidates = [
      sel('meta[property="og:video"]'),
      sel('meta[property="og:video:url"]'),
      sel('meta[property="og:video:secure_url"]'),
      sel('meta[name="twitter:player:stream"]'),
      sel('meta[name="twitter:player"]'),
      sel('meta[property="twitter:player"]'),
    ].map(s => String(s || "").trim()).filter(Boolean);

    const picked = pickBestCandidate(candidates, hookUrl);
    if (picked) return picked;

    const metas = Array.from(doc.querySelectorAll("meta[content]"));
    const more = [];
    for (const m of metas) {
      const c = (m.getAttribute("content") || "").trim();
      if (!c) continue;
      const lc = c.toLowerCase();
      if (lc.startsWith("http://") || lc.startsWith("https://") || lc.startsWith("//") || lc.startsWith("/")) {
        more.push(c);
      }
    }
    return pickBestCandidate(more, hookUrl);
  }

  async function fetchOgJson(url) {
    if (ogDataCache.has(url)) return ogDataCache.get(url);

    const base = (typeof window.NCZ_HOOK_OG_PROXY === "string" && window.NCZ_HOOK_OG_PROXY.trim())
      ? window.NCZ_HOOK_OG_PROXY.trim()
      : DEFAULT_OG_PROXY_BASE;

    try {
      const r = await fetch(base + encodeURIComponent(url), { credentials: "omit" });
      const j = await r.json().catch(() => null);
      if (j && typeof j === "object") {
        ogDataCache.set(url, j);
        return j;
      }
    } catch {}

    const fn = window.NCZ_HOOK_OG_PROXY;
    if (typeof fn === "function") {
      try {
        const v = await fn(url);
        if (v && typeof v === "object") { ogDataCache.set(url, v); return v; }
        if (typeof v === "string") {
          const j = JSON.parse(v);
          if (j && typeof j === "object") { ogDataCache.set(url, j); return j; }
        }
      } catch {}
    }

    return null;
  }

  async function fetchHtmlWithFallbacks(url) {
    if (ogHtmlCache.has(url)) return ogHtmlCache.get(url);

    try {
      const ao = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
      const r = await fetch(ao, { credentials: "omit" });
      if (r && r.ok) {
        const t = await r.text();
        ogHtmlCache.set(url, t);
        return t;
      }
    } catch {}

    try {
      const ju = "https://r.jina.ai/" + url;
      const r = await fetch(ju, { credentials: "omit" });
      if (r && r.ok) {
        const t = await r.text();
        ogHtmlCache.set(url, t);
        return t;
      }
    } catch {}

    return "";
  }

  function defaultEmbedGuesses(uuid) {
    return [
      `https://suno.com/embed/hook/${uuid}`,
      `https://suno.com/hook/${uuid}/embed`,
      `https://suno.com/embed/${uuid}`,
      `https://suno.com/embed/hook/${uuid}?autoplay=1`,
    ];
  }

  async function resolveEmbedUrlForHook(uuid, hookUrl) {
    if (embedCache.has(uuid)) return embedCache.get(uuid);

    const ogj = await fetchOgJson(hookUrl);
    if (ogj) {
      const embed = pickEmbedFromOgJson(ogj, hookUrl, uuid);
      if (embed) {
        embedCache.set(uuid, embed);
        return embed;
      }
    }

    const html = await fetchHtmlWithFallbacks(hookUrl);
    if (html) {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const embed = pickEmbedFromDoc(doc, hookUrl, uuid);
        if (embed) {
          embedCache.set(uuid, embed);
          return embed;
        }
      } catch {}
    }

    const guesses =
      (typeof window.NCZ_HOOK_EMBED_GUESSES === "function")
        ? (window.NCZ_HOOK_EMBED_GUESSES(uuid) || [])
        : defaultEmbedGuesses(uuid);

    if (Array.isArray(guesses) && guesses.length) {
      embedCache.set(uuid, guesses[0]);
      return guesses[0];
    }

    return "";
  }

  // ✅ NEW: Pause audio immediately, then WAIT 300ms before setting src+playing
  function playHookDelayed(uuid, token) {
    const v = getVideo();
    if (!v) throw new Error("Video element not found: #" + VIDEO_ID);

    // pause main audio NOW
    pauseMainAudioOnly();

    // mark active NOW (so controls/mute state flips immediately)
    setHookActive(true, uuid, token);
    setVideoControlsVisible(v, true);
    unmuteVideo(v);

    try { v.style.display = "block"; } catch {}

    // clear prior pending timer
    if (pendingLoadTimer) {
      clearTimeout(pendingLoadTimer);
      pendingLoadTimer = null;
    }

    const guessed = guessHookCdnMp4(uuid);
    v.setAttribute("data-ncz-hook-guess", guessed);

    // IMPORTANT: do NOT touch src yet; wait a bit so other scripts settle
    pendingLoadTimer = setTimeout(() => {
      pendingLoadTimer = null;

      // still same hook session?
      if (v.getAttribute("data-ncz-hook-active") !== "1") return;
      if (v.getAttribute("data-ncz-hook-token") !== String(token)) return;

      const resolved = v.getAttribute("data-ncz-hook-resolved") || "";
      const srcToUse = (resolved && isProbablyDirectVideoUrl(resolved)) ? resolved : guessed;

      v.src = srcToUse;
      try { v.load(); } catch {}

      armAntiPauseRetry(v, token);

      try {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    }, LOAD_DELAY_MS);
  }

  // If guess fails, fall back to resolved URL (direct video if possible, else iframe)
  function armGuessErrorFallback(uuid, hookUrl, token, resolvedPromise) {
    const v = getVideo();
    if (!v) return;

    const onError = async () => {
      if (v.getAttribute("data-ncz-hook-active") !== "1") return;
      if (v.getAttribute("data-ncz-hook-token") !== String(token)) return;
      v.removeEventListener("error", onError, true);

      let resolved = "";
      try { resolved = await resolvedPromise; } catch {}

      if (!resolved) return;

      if (isProbablyDirectVideoUrl(resolved)) {
        v.src = resolved;
        try { v.load(); } catch {}
        armAntiPauseRetry(v, token);
        try {
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {}
        return;
      }

      openModal(resolved, hookUrl, uuid);
    };

    v.addEventListener("error", onError, true);
    setTimeout(() => v.removeEventListener("error", onError, true), 8000);
  }

  // ---- Optional modal iframe fallback ----
  function addStylesOnce() {
    if ($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${MODAL_ID}{
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.55);
        z-index: 2147483646;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      #${MODAL_ID} .__box__{
        width: min(1100px, 96vw);
        height: min(720px, 88vh);
        background: rgba(12,16,28,.98);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        box-shadow: 0 18px 60px rgba(0,0,0,.55);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      #${MODAL_ID} .__hdr__{
        flex: 0 0 auto;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.04);
        font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      }
      #${MODAL_ID} .__hdr__ .__title__{
        font-weight: 900;
        font-size: 12px;
        opacity: .95;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${MODAL_ID} .__hdr__ .__btns__{
        display:flex;
        gap: 8px;
        align-items:center;
      }
      #${MODAL_ID} button.__x__{
        padding: 6px 10px;
        border-radius: 10px;
        font-weight: 900;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(255,255,255,.06);
        cursor: pointer;
      }
      #${MODAL_ID} button.__x__:hover{
        background: rgba(255,255,255,.10);
      }
      #${MODAL_ID} .__body__{
        flex: 1 1 auto;
        min-height: 0;
        background: rgba(0,0,0,.40);
      }
      #${IFRAME_ID}{
        width: 100%;
        height: 100%;
        border: 0;
        display:block;
        background: rgba(0,0,0,.20);
      }
      #${MODAL_ID}.__open__{ display:flex; }
    `;
    document.head.appendChild(st);
  }

  function ensureModal() {
    addStylesOnce();

    let modal = $id(MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = MODAL_ID;
      modal.innerHTML = `
        <div class="__box__" role="dialog" aria-modal="true">
          <div class="__hdr__">
            <div class="__title__" id="__ncz_suno_hook_title__">Suno Hook</div>
            <div class="__btns__">
              <button type="button" class="__x__" id="__ncz_suno_hook_open__" title="Open in new tab">↗</button>
              <button type="button" class="__x__" id="__ncz_suno_hook_close__" title="Close">✕</button>
            </div>
          </div>
          <div class="__body__">
            <iframe id="${IFRAME_ID}" allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("__open__")) closeModal();
      });

      modal.querySelector("#__ncz_suno_hook_close__")?.addEventListener("click", (e) => {
        e.preventDefault();
        closeModal();
      });

      modal.querySelector("#__ncz_suno_hook_open__")?.addEventListener("click", (e) => {
        e.preventDefault();
        const url = modal.getAttribute("data-open-url") || "";
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      });
    }
    return modal;
  }

  function openModal(embedUrl, hookUrl, uuid) {
    pauseMainAudioOnly();

    const modal = ensureModal();
    const iframe = $id(IFRAME_ID);
    const titleEl = modal.querySelector("#__ncz_suno_hook_title__");

    if (titleEl) titleEl.textContent = `Suno Hook: ${uuid}`;

    modal.setAttribute("data-open-url", embedUrl || "");
    modal.setAttribute("data-hook-url", hookUrl || "");
    modal.setAttribute("data-uuid", uuid || "");

    if (iframe) iframe.src = embedUrl;
    modal.classList.add("__open__");
  }

  function closeModal() {
    const modal = $id(MODAL_ID);
    if (!modal) return;
    modal.classList.remove("__open__");
    const iframe = $id(IFRAME_ID);
    if (iframe) iframe.src = "about:blank";
  }

  // ---- UI niceness ----
  function markHookButtonsNice() {
    const log = $id(CHAT_LOG_ID);
    if (!log) return;

    const rows = Array.from(log.querySelectorAll("div.__msg__"));
    for (const row of rows) {
      const info = findHookInfoInRow(row);
      if (!info) continue;

      const btn = row.querySelector(`button.${SUNO_BTN_CLASS}`);
      if (!btn) continue;

      if (btn.getAttribute("data-ncz-hook-title") !== "1") {
        btn.setAttribute("data-ncz-hook-title", "1");
        btn.title = "Play Suno hook video";
      }
    }
  }

  // Intercept the existing ▶ for hook links (capture phase, so mp3 handler never runs)
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const btn = t.closest(`button.${SUNO_BTN_CLASS}`);
    if (!btn) return;

    const row = btn.closest("div.__msg__");
    if (!row) return;

    const info = findHookInfoInRow(row);
    if (!info) return; // not a hook link => let normal suno mp3 behavior run

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const { uuid, hookUrl } = info;

    const oldText = btn.textContent;
    const token = ++hookPlayToken;

    try {
      btn.disabled = true;
      btn.textContent = "…";

      // ✅ Start state changes NOW, but delay src/load/play
      playHookDelayed(uuid, token);

      // Resolve in background
      const resolvedPromise = resolveEmbedUrlForHook(uuid, hookUrl);

      // If we get a direct video URL, stash it so the delayed loader prefers it over the guess
      resolvedPromise.then((resolved) => {
        const v = getVideo();
        if (!v) return;
        if (v.getAttribute("data-ncz-hook-active") !== "1") return;
        if (v.getAttribute("data-ncz-hook-token") !== String(token)) return;
        if (!resolved) return;

        v.setAttribute("data-ncz-hook-resolved", resolved);

        // If we already started and it’s NOT playing, and we’re past the delay, attempt a gentle swap
        // (but don't disrupt a good playback)
        if (!v.paused && v.readyState >= 2) return;
      }).catch(() => {});

      // If guessed mp4 errors, use resolved
      armGuessErrorFallback(uuid, hookUrl, token, resolvedPromise);

      btn.textContent = oldText || "▶";
    } catch (err) {
      console.warn("[NCZ suno-hook] failed:", err);
      btn.textContent = "!";
      setTimeout(() => { btn.textContent = oldText || "▶"; }, 900);
    } finally {
      btn.disabled = false;
    }
  }, true);

  function boot() {
    installMediaPlayWatcher();
    markHookButtonsNice();

    const log = $id(CHAT_LOG_ID);
    if (!log) {
      const mo = new MutationObserver(() => {
        const l = $id(CHAT_LOG_ID);
        if (l) { mo.disconnect(); boot(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }

    const mo = new MutationObserver(() => markHookButtonsNice());
    mo.observe(log, { childList: true, subtree: true });
  }

  boot();

  console.log("[NCZ suno-hook] video-player patch active (pause audio + 300ms delayed video load)");
})();
























// ✅ NCZ PATCH: Create a page button (insert AFTER last card - 3) that opens a Suno /hook/ link
// as an embedded player in a modal iframe by pulling OG/Twitter player URLs (same logic as your hook script).
//
// Target hook:
//   https://suno.com/hook/2aad90ed-20c6-4ee1-ad45-43c28ac25c41
//
// Placement:
//   Insert AFTER the 4th-from-last <div class="__card__"> (aka "last card - 3").
//   Fallback: if < 4 cards, insert after the last card.
//
// Optional override (same as your hook script):
//   window.NCZ_HOOK_OG_PROXY = "https://xtdevelopment.net/og-proxy/raw?url="; // must return raw HTML
//   (or) window.NCZ_HOOK_OG_PROXY = async (url)=> "<html>...</html>";
(() => {
  "use strict";

  if (window.__NCZ_PAGE_HOOK_EMBED_BTN_PATCH__) return;
  window.__NCZ_PAGE_HOOK_EMBED_BTN_PATCH__ = true;

  const CARD_SEL = "div.__card__";

  const HOOK_URL = "https://suno.com/hook/2aad90ed-20c6-4ee1-ad45-43c28ac25c41";
  const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

  const STYLE_ID = "__ncz_page_hook_embed_style__";
  const WRAP_ID  = "__ncz_page_hook_embed_wrap__";
  const BTN_ID   = "__ncz_page_hook_embed_btn__";

  const MODAL_ID  = "__ncz_page_hook_embed_modal__";
  const IFRAME_ID = "__ncz_page_hook_embed_iframe__";
  const CLOSE_ID  = "__ncz_page_hook_embed_close__";
  const OPEN_ID   = "__ncz_page_hook_embed_open__";
  const TITLE_ID  = "__ncz_page_hook_embed_title__";

  const embedCache = new Map();   // uuid -> embedUrl
  const ogHtmlCache = new Map();  // hookUrl -> html

  const $id = (id) => document.getElementById(id);

  function addStylesOnce() {
    if ($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${WRAP_ID}{
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #${BTN_ID}{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 14px;
        font-weight: 900;
        letter-spacing: .2px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(106,166,255,.16); /* accent-ish */
        color: rgba(233,238,252,.98);
        cursor: pointer;
        user-select: none;
      }
      #${BTN_ID}:hover{ background: rgba(106,166,255,.26); }
      #${BTN_ID} .__dot__{
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: rgba(106,166,255,.95);
        box-shadow: 0 0 0 3px rgba(106,166,255,.18);
        flex: 0 0 auto;
      }
      #${BTN_ID}[disabled]{ opacity: .6; cursor: default; }

      #${MODAL_ID}{
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.55);
        z-index: 2147483646;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      #${MODAL_ID}.__open__{ display:flex; }

      #${MODAL_ID} .__box__{
        width: min(1100px, 96vw);
        height: min(720px, 88vh);
        background: rgba(12,16,28,.98);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 16px;
        box-shadow: 0 18px 60px rgba(0,0,0,.55);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      #${MODAL_ID} .__hdr__{
        flex: 0 0 auto;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.04);
        font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      }
      #${MODAL_ID} .__hdr__ .__title__{
        font-weight: 900;
        font-size: 12px;
        opacity: .95;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${MODAL_ID} .__hdr__ .__btns__{
        display:flex;
        gap: 8px;
        align-items:center;
      }
      #${MODAL_ID} button.__x__{
        padding: 6px 10px;
        border-radius: 10px;
        font-weight: 900;
        border: 1px solid rgba(255,255,255,.12);
        background: rgba(255,255,255,.06);
        cursor: pointer;
        color: rgba(233,238,252,.98);
      }
      #${MODAL_ID} button.__x__:hover{ background: rgba(255,255,255,.10); }

      #${MODAL_ID} .__body__{
        flex: 1 1 auto;
        min-height: 0;
        background: rgba(0,0,0,.40);
      }
      #${IFRAME_ID}{
        width: 100%;
        height: 100%;
        border: 0;
        display:block;
        background: rgba(0,0,0,.20);
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function canonicalHookUrl(href) {
    try {
      const u = new URL(href);
      const host = (u.hostname || "").toLowerCase();
      if (host !== "suno.com" && !host.endsWith(".suno.com")) return null;
      if (!u.pathname.toLowerCase().includes("/hook/")) return null;

      const m = u.pathname.match(UUID_RE);
      if (!m) return null;
      const uuid = m[0];
      return { uuid, hookUrl: `https://suno.com/hook/${uuid}` };
    } catch {
      const s = String(href || "");
      if (!s.toLowerCase().includes("suno.com")) return null;
      if (!s.toLowerCase().includes("/hook/")) return null;
      const m = s.match(UUID_RE);
      if (!m) return null;
      const uuid = m[0];
      return { uuid, hookUrl: `https://suno.com/hook/${uuid}` };
    }
  }

  function absUrlFromMaybeRelative(u, baseUrl) {
    const s = String(u || "").trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("//")) {
      try { return (new URL(baseUrl)).protocol + s; } catch { return "https:" + s; }
    }
    if (s.startsWith("/")) {
      try { return (new URL(baseUrl)).origin + s; } catch { return s; }
    }
    try { return new URL(s, baseUrl).toString(); } catch { return s; }
  }

  function pickEmbedFromDoc(doc, hookUrl, uuid) {
    // Optional full override
    if (typeof window.NCZ_HOOK_EMBED_PICKER === "function") {
      try {
        const v = window.NCZ_HOOK_EMBED_PICKER(doc, hookUrl, uuid);
        if (v) return v;
      } catch {}
    }

    const sel = (q) => doc.querySelector(q)?.getAttribute("content") || "";

    const candidates = [
      sel('meta[property="og:video"]'),
      sel('meta[property="og:video:url"]'),
      sel('meta[property="og:video:secure_url"]'),
      sel('meta[name="twitter:player"]'),
      sel('meta[name="twitter:player:stream"]'),
      sel('meta[property="twitter:player"]'),
    ].map(s => s.trim()).filter(Boolean);

    if (candidates.length) return absUrlFromMaybeRelative(candidates[0], hookUrl);

    // last-ditch: look for anything meta-ish containing "player" / "embed"
    const metas = Array.from(doc.querySelectorAll("meta[content]"));
    for (const m of metas) {
      const c = (m.getAttribute("content") || "").trim();
      if (!c) continue;
      const lc = c.toLowerCase();
      if (lc.includes("player") || lc.includes("embed")) {
        if (lc.startsWith("http://") || lc.startsWith("https://") || lc.startsWith("//") || lc.startsWith("/")) {
          return absUrlFromMaybeRelative(c, hookUrl);
        }
      }
    }

    return "";
  }

  async function fetchHtmlWithFallbacks(url) {
    if (ogHtmlCache.has(url)) return ogHtmlCache.get(url);

    // 1) direct (usually CORS blocked)
    try {
      const r = await fetch(url, { mode: "cors", credentials: "omit" });
      if (r && r.ok) {
        const t = await r.text();
        ogHtmlCache.set(url, t);
        return t;
      }
    } catch {}

    // 2) user proxy (raw HTML)
    const proxy = window.NCZ_HOOK_OG_PROXY;
    if (proxy) {
      try {
        if (typeof proxy === "function") {
          const t = await proxy(url);
          if (t) { ogHtmlCache.set(url, t); return t; }
        } else {
          const pu = String(proxy) + encodeURIComponent(url);
          const r = await fetch(pu, { credentials: "omit" });
          if (r && r.ok) {
            const t = await r.text();
            ogHtmlCache.set(url, t);
            return t;
          }
        }
      } catch {}
    }

    // 3) AllOrigins raw
    try {
      const ao = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
      const r = await fetch(ao, { credentials: "omit" });
      if (r && r.ok) {
        const t = await r.text();
        ogHtmlCache.set(url, t);
        return t;
      }
    } catch {}

    // 4) Jina proxy (sometimes works)
    try {
      const ju = "https://r.jina.ai/" + url;
      const r = await fetch(ju, { credentials: "omit" });
      if (r && r.ok) {
        const t = await r.text();
        ogHtmlCache.set(url, t);
        return t;
      }
    } catch {}

    return "";
  }

  function defaultEmbedGuesses(uuid) {
    return [
      `https://suno.com/embed/hook/${uuid}`,
      `https://suno.com/hook/${uuid}/embed`,
      `https://suno.com/embed/${uuid}`,
      `https://suno.com/embed/hook/${uuid}?autoplay=1`,
    ];
  }

  async function resolveEmbedUrlForHook(uuid, hookUrl) {
    if (embedCache.has(uuid)) return embedCache.get(uuid);

    const html = await fetchHtmlWithFallbacks(hookUrl);
    if (html) {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const embed = pickEmbedFromDoc(doc, hookUrl, uuid);
        if (embed) {
          embedCache.set(uuid, embed);
          return embed;
        }
      } catch {}
    }

    const guesses =
      (typeof window.NCZ_HOOK_EMBED_GUESSES === "function")
        ? (window.NCZ_HOOK_EMBED_GUESSES(uuid) || [])
        : defaultEmbedGuesses(uuid);

    if (Array.isArray(guesses) && guesses.length) {
      embedCache.set(uuid, guesses[0]);
      return guesses[0];
    }

    return "";
  }

  function ensureModal() {
    addStylesOnce();

    let modal = $id(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="__box__" role="dialog" aria-modal="true">
        <div class="__hdr__">
          <div class="__title__" id="${TITLE_ID}">Suno Hook</div>
          <div class="__btns__">
            <button type="button" class="__x__" id="${OPEN_ID}" title="Open in new tab">↗</button>
            <button type="button" class="__x__" id="${CLOSE_ID}" title="Close">✕</button>
          </div>
        </div>
        <div class="__body__">
          <iframe id="${IFRAME_ID}" allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="no-referrer-when-downgrade"></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("__open__")) closeModal();
    });

    modal.querySelector(`#${CLOSE_ID}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });

    modal.querySelector(`#${OPEN_ID}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      const url = modal.getAttribute("data-open-url") || "";
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });

    return modal;
  }

  function openModal(embedUrl, hookUrl, uuid) {
    const modal = ensureModal();
    const iframe = $id(IFRAME_ID);
    const titleEl = $id(TITLE_ID);

    if (titleEl) titleEl.textContent = `Suno Hook: ${uuid}`;
    modal.setAttribute("data-open-url", embedUrl || "");
    modal.setAttribute("data-hook-url", hookUrl || "");
    modal.setAttribute("data-uuid", uuid || "");

    if (iframe) iframe.src = embedUrl || "about:blank";
    modal.classList.add("__open__");
  }

  function closeModal() {
    const modal = $id(MODAL_ID);
    if (!modal) return;
    modal.classList.remove("__open__");
    const iframe = $id(IFRAME_ID);
    if (iframe) iframe.src = "about:blank";
  }

  function ensureWrapAndButton() {
    addStylesOnce();

    let wrap = $id(WRAP_ID);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = WRAP_ID;
    }

    let btn = $id(BTN_ID);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = BTN_ID;
      btn.innerHTML = `<span class="__dot__"></span><span>Open Suno Hook Player</span>`;
      btn.title = `Embed player for ${HOOK_URL}`;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const info = canonicalHookUrl(HOOK_URL);
        if (!info) return;

        const old = btn.textContent;
        try {
          btn.disabled = true;
          btn.textContent = "Loading…";

          const embedUrl = await resolveEmbedUrlForHook(info.uuid, info.hookUrl);
          if (!embedUrl) throw new Error("No embed/player URL found in OG meta");

          openModal(embedUrl, info.hookUrl, info.uuid);
        } catch (err) {
          console.warn("[NCZ page-hook] failed:", err);
          btn.textContent = "Failed";
          setTimeout(() => { btn.textContent = old || "Open Suno Hook Player"; }, 1200);
        } finally {
          btn.disabled = false;
        }
      }, true);
    }

    if (!wrap.contains(btn)) wrap.appendChild(btn);
    return wrap;
  }

  function insertAfterLastMinus3Card(wrap) {
    const cards = document.querySelectorAll(CARD_SEL);
    if (!cards || cards.length === 0) return false;

    const idx = (cards.length >= 4) ? (cards.length - 4) : (cards.length - 1);
    const target = cards[idx];
    if (!target || !target.parentNode) return false;

    if (target.nextElementSibling === wrap) return true;
    target.insertAdjacentElement("afterend", wrap);
    return true;
  }

  function tick() {
    const wrap = ensureWrapAndButton();
    return insertAfterLastMinus3Card(wrap);
  }

  function boot() {
    tick();
    const mo = new MutationObserver(() => tick());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
  console.log("[NCZ] Page Hook Embed button patch active (OG embed iframe)");
})();
















// ✅ NCZ PATCH: Make the iframe modal window DRAGGABLE (grab the top bar) + RESIZABLE (pin handle top-left)
//
// Works with your NCZ modals that use:
//   <div id="..._modal__"><div class="__box__"><div class="__hdr__"> ... </div> ... <iframe>...</iframe></div></div>
//
// - Drag: click+drag on the top header area (.__hdr__)
// - Resize: drag the little "📌" pin in the top-left corner
// - Clamps to viewport, min size enforced
(() => {
  "use strict";

  if (window.__NCZ_MODAL_DRAG_RESIZE_PATCH__) return;
  window.__NCZ_MODAL_DRAG_RESIZE_PATCH__ = true;

  const STYLE_ID = "__ncz_modal_drag_resize_style__";
  const HANDLE_CLASS = "__ncz_resize_handle__";

  const MIN_W = 420;
  const MIN_H = 280;
  const PAD   = 8; // keep a little margin from edges

  const $id = (id) => document.getElementById(id);

  function addStylesOnce() {
    if ($id(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      /* Make header feel draggable */
      .__ncz_draggable_hdr__{
        cursor: move;
        user-select: none;
        -webkit-user-select: none;
      }

      /* Top-left resize pin */
      .${HANDLE_CLASS}{
        position: absolute;
        top: 8px;
        left: 8px;
        width: 20px;
        height: 20px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 900;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: rgba(233,238,252,.98);
        cursor: nwse-resize;
        z-index: 10;
      }
      .${HANDLE_CLASS}:hover{
        background: rgba(255,255,255,.10);
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function clampBox(box) {
    const r = box.getBoundingClientRect();
    let left = parseFloat(box.style.left || r.left) || r.left;
    let top  = parseFloat(box.style.top  || r.top)  || r.top;
    let w    = parseFloat(box.style.width  || r.width)  || r.width;
    let h    = parseFloat(box.style.height || r.height) || r.height;

    w = Math.max(MIN_W, w);
    h = Math.max(MIN_H, h);

    const maxW = Math.max(MIN_W, window.innerWidth  - PAD * 2);
    const maxH = Math.max(MIN_H, window.innerHeight - PAD * 2);
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);

    left = Math.min(Math.max(PAD, left), window.innerWidth  - w - PAD);
    top  = Math.min(Math.max(PAD, top),  window.innerHeight - h - PAD);

    box.style.left = `${left}px`;
    box.style.top  = `${top}px`;
    box.style.width  = `${w}px`;
    box.style.height = `${h}px`;
  }

  function centerInit(box) {
    const r = box.getBoundingClientRect();
    const w = Math.max(MIN_W, Math.min(r.width,  window.innerWidth  - PAD * 2));
    const h = Math.max(MIN_H, Math.min(r.height, window.innerHeight - PAD * 2));
    const left = Math.max(PAD, (window.innerWidth  - w) / 2);
    const top  = Math.max(PAD, (window.innerHeight - h) / 2);

    box.style.position = "fixed";
    box.style.margin = "0";
    box.style.left = `${left}px`;
    box.style.top  = `${top}px`;
    box.style.width  = `${w}px`;
    box.style.height = `${h}px`;
  }

  function ensureHandle(box, hdr) {
    if (box.querySelector(`.${HANDLE_CLASS}`)) return;

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = HANDLE_CLASS;
    handle.title = "Resize (drag)";
    handle.textContent = "📌";

    // Make sure header has room so the pin doesn't cover text too badly
    if (hdr && !hdr.dataset.__nczPadLeft) {
      hdr.dataset.__nczPadLeft = hdr.style.paddingLeft || "";
      // bump padding-left a bit to avoid overlap
      hdr.style.paddingLeft = "34px";
    }

    box.appendChild(handle);
  }

  function makeDraggableAndResizable(modal) {
    if (!modal || modal.dataset.__nczDragResize === "1") return;

    const box = modal.querySelector("div.__box__");
    const hdr = modal.querySelector("div.__hdr__");
    if (!box || !hdr) return;

    modal.dataset.__nczDragResize = "1";
    addStylesOnce();

    // mark header as draggable
    hdr.classList.add("__ncz_draggable_hdr__");

    // initialize box to fixed + explicit px sizes once
    if (box.dataset.__nczInit !== "1") {
      box.dataset.__nczInit = "1";
      // if modal is currently open, center it now; otherwise it'll be centered on first open tick
      centerInit(box);
      clampBox(box);
    }

    // add resize pin
    ensureHandle(box, hdr);

    // -------- Drag logic (header) --------
    let drag = null;

    hdr.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      // Don't start drag when clicking buttons/links/inputs OR the resize pin
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (target.closest("button, a, input, select, textarea, ." + HANDLE_CLASS)) return;

      e.preventDefault();

      // if box hasn't been converted cleanly yet, do it now
      if (!box.style.position || box.style.position !== "fixed") centerInit(box);

      const r = box.getBoundingClientRect();
      drag = {
        pointerId: e.pointerId,
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
        w: r.width,
        h: r.height,
      };

      try { hdr.setPointerCapture(e.pointerId); } catch {}
    });

    hdr.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();

      let left = e.clientX - drag.offX;
      let top  = e.clientY - drag.offY;

      left = Math.min(Math.max(PAD, left), window.innerWidth  - drag.w - PAD);
      top  = Math.min(Math.max(PAD, top),  window.innerHeight - drag.h - PAD);

      box.style.position = "fixed";
      box.style.left = `${left}px`;
      box.style.top  = `${top}px`;

      // keep explicit sizing stable while dragging
      box.style.width  = `${drag.w}px`;
      box.style.height = `${drag.h}px`;
    });

    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      drag = null;
      try { hdr.releasePointerCapture(e.pointerId); } catch {}
      clampBox(box);
    };

    hdr.addEventListener("pointerup", endDrag);
    hdr.addEventListener("pointercancel", endDrag);

    // -------- Resize logic (top-left pin) --------
    const handle = box.querySelector(`.${HANDLE_CLASS}`);
    let rz = null;

    handle.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      // ensure fixed/px sizing
      if (!box.style.position || box.style.position !== "fixed") centerInit(box);

      const r = box.getBoundingClientRect();
      rz = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: r.left,
        startTop: r.top,
        startW: r.width,
        startH: r.height,
      };

      try { handle.setPointerCapture(e.pointerId); } catch {}
    });

    handle.addEventListener("pointermove", (e) => {
      if (!rz || e.pointerId !== rz.pointerId) return;
      e.preventDefault();

      const dx = e.clientX - rz.startX;
      const dy = e.clientY - rz.startY;

      // Top-left resize: moving right/down shrinks; moving left/up grows
      let newLeft = rz.startLeft + dx;
      let newTop  = rz.startTop + dy;
      let newW    = rz.startW - dx;
      let newH    = rz.startH - dy;

      // enforce mins by pushing left/top back if needed
      if (newW < MIN_W) {
        const diff = MIN_W - newW;
        newW = MIN_W;
        newLeft -= diff;
      }
      if (newH < MIN_H) {
        const diff = MIN_H - newH;
        newH = MIN_H;
        newTop -= diff;
      }

      // clamp to viewport
      newLeft = Math.min(Math.max(PAD, newLeft), window.innerWidth  - newW - PAD);
      newTop  = Math.min(Math.max(PAD, newTop),  window.innerHeight - newH - PAD);

      // also clamp max size
      newW = Math.min(newW, window.innerWidth  - newLeft - PAD);
      newH = Math.min(newH, window.innerHeight - newTop  - PAD);

      box.style.position = "fixed";
      box.style.left = `${newLeft}px`;
      box.style.top  = `${newTop}px`;
      box.style.width  = `${newW}px`;
      box.style.height = `${newH}px`;
    });

    const endResize = (e) => {
      if (!rz || e.pointerId !== rz.pointerId) return;
      e.preventDefault();
      rz = null;
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      clampBox(box);
    };

    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);

    // Keep inside viewport when window resizes
    if (!window.__NCZ_MODAL_DRAG_RESIZE_ONRESIZE__) {
      window.__NCZ_MODAL_DRAG_RESIZE_ONRESIZE__ = true;
      window.addEventListener("resize", () => {
        for (const m of document.querySelectorAll('div[id*="_modal__"].__open__')) {
          const b = m.querySelector("div.__box__");
          if (b) clampBox(b);
        }
      });
    }
  }

  function tick() {
    // any NCZ modal that matches the pattern and is in DOM
    const modals = Array.from(document.querySelectorAll('div[id*="_modal__"]'));
    for (const m of modals) {
      // only set up ones that look like our modal structure
      if (m.querySelector("div.__box__ > div.__hdr__")) {
        makeDraggableAndResizable(m);

        // if it's open and box hasn't been placed yet (rare), center it once
        const box = m.querySelector("div.__box__");
        if (m.classList.contains("__open__") && box && box.dataset.__nczPlaced !== "1") {
          box.dataset.__nczPlaced = "1";
          centerInit(box);
          clampBox(box);
        }
      }
    }
  }

  function boot() {
    addStylesOnce();
    tick();

    const mo = new MutationObserver(() => tick());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
  console.log("[NCZ] modal drag+resize patch active");
})();



















// NCZ PATCH: Keep hook iframe open unless the Close button is clicked.
// Targets: <iframe id="__ncz_page_hook_embed_iframe__" ...>
(() => {
  "use strict";

  const IFRAME_ID = "__ncz_page_hook_embed_iframe__";
  const MARK = "__ncz_iframe_guarded__";

  // Guess the "modal / panel / wrapper" that gets hidden/removed.
  function pickContainer(iframe) {
    return (
      iframe.closest('[role="dialog"]') ||
      iframe.closest(".modal") ||
      iframe.closest(".dialog") ||
      iframe.closest(".overlay") ||
      iframe.closest('[class*="modal"]') ||
      iframe.closest('[class*="dialog"]') ||
      iframe.closest('[class*="overlay"]') ||
      iframe.parentElement
    );
  }

  function looksLikeCloseBtn(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (!(tag === "button" || tag === "a" || el.getAttribute?.("role") === "button")) return false;

    const t = (el.textContent || "").trim().toLowerCase();
    const aria = (el.getAttribute?.("aria-label") || "").trim().toLowerCase();
    const title = (el.getAttribute?.("title") || "").trim().toLowerCase();

    // Common close patterns
    if (t === "×" || t === "✕" || t === "x") return true;
    if (t.includes("close")) return true;
    if (aria.includes("close")) return true;
    if (title.includes("close")) return true;

    return false;
  }

  function armGuardForIframe(iframe) {
    if (!iframe || iframe.nodeType !== 1) return;
    if (iframe.dataset && iframe.dataset[MARK] === "1") return;

    const container = pickContainer(iframe);
    if (!container) return;

    // Mark guarded
    if (iframe.dataset) iframe.dataset[MARK] = "1";
    if (container.dataset) container.dataset[MARK] = "1";

    // State + originals
    let enabled = true;
    let disconnectAll = () => {};

    const homeParent = container.parentNode;
    const homeNext = container.nextSibling;

    // Utility: put it back + force visible
    const restore = () => {
      if (!enabled) return;

      // Reinsert container if removed
      if (!container.isConnected && homeParent) {
        try {
          homeParent.insertBefore(container, homeNext || null);
        } catch {}
      }

      // Force container visible if someone hid it
      try {
        if (container.hidden) container.hidden = false;

        const cs = window.getComputedStyle(container);
        if (cs.display === "none") container.style.display = "";
        if (cs.visibility === "hidden") container.style.visibility = "visible";
        if (cs.opacity === "0") container.style.opacity = "";
      } catch {}
    };

    // DISARM when the real close button is clicked (then let normal close happen)
    function bindCloseButtons() {
      const btns = container.querySelectorAll("button, a, [role='button']");
      for (const b of btns) {
        if (!looksLikeCloseBtn(b)) continue;

        // Capture so we disarm BEFORE any other close logic runs
        b.addEventListener(
          "click",
          () => {
            enabled = false;        // disarm guard permanently for this instance
            disconnectAll?.();      // stop restoring
          },
          true
        );
      }
    }
    bindCloseButtons();

    // If the app *later* renders the close button, keep scanning briefly
    let closeScanTries = 0;
    const closeScan = setInterval(() => {
      if (!enabled) return clearInterval(closeScan);
      closeScanTries++;
      bindCloseButtons();
      if (closeScanTries > 40) clearInterval(closeScan); // ~4s
    }, 100);

    // Block attempts to remove container/iframe via remove()/removeChild()
    const origContainerRemove = container.remove?.bind(container);
    container.remove = function () {
      if (!enabled) return origContainerRemove ? origContainerRemove() : undefined;
      restore();
      return undefined;
    };

    const origIframeRemove = iframe.remove?.bind(iframe);
    iframe.remove = function () {
      if (!enabled) return origIframeRemove ? origIframeRemove() : undefined;
      restore();
      return undefined;
    };

    // Patch parent removeChild ONLY for this container/iframe (localized)
    const parent = container.parentNode;
    let origRemoveChild = null;
    if (parent && typeof parent.removeChild === "function") {
      origRemoveChild = parent.removeChild.bind(parent);
      parent.removeChild = function (child) {
        if (!enabled) return origRemoveChild(child);
        if (child === container || child === iframe) {
          restore();
          return child; // pretend
        }
        return origRemoveChild(child);
      };
    }

    // Observe attribute changes (display:none, hidden, class toggles, etc.) + DOM removals
    const mo = new MutationObserver(() => {
      if (!enabled) return;
      restore();
    });

    try {
      mo.observe(container, {
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-hidden"],
        subtree: false,
      });

      // Watch for removal from DOM: if container disappears, restore it
      if (document.body) {
        mo.observe(document.body, { childList: true, subtree: true });
      }
    } catch {}

    // Keep it open on a heartbeat too (handles weird cases)
    const tick = setInterval(() => {
      if (!enabled) return clearInterval(tick);
      restore();
    }, 500);

    disconnectAll = () => {
      try { mo.disconnect(); } catch {}
      try { clearInterval(tick); } catch {}
      try { clearInterval(closeScan); } catch {}

      // Best-effort restore patched parent.removeChild
      try {
        if (parent && origRemoveChild) parent.removeChild = origRemoveChild;
      } catch {}
    };

    // Initial restore in case it’s already hidden
    restore();
  }

  // Watch for iframe appearing (your UI may mount it later)
  function watch() {
    const existing = document.getElementById(IFRAME_ID);
    if (existing) armGuardForIframe(existing);

    const mo = new MutationObserver(() => {
      const iframe = document.getElementById(IFRAME_ID);
      if (iframe) armGuardForIframe(iframe);
    });

    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  }

  watch();
})();
