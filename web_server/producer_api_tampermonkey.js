// ==UserScript==
// @name         NCZ Producer.ai Job Worker (Debug + Persistent)
// @namespace    ncz
// @version      1.2.4
// @description  Persist job URL, navigate, scrape, report. Pull jobs via WS or HTTP fallback.
// @match        https://www.producer.ai/*
// @match        https://producer.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(() => {
  "use strict";

  // ----------------------------
  // CONFIG
  // ----------------------------
  const DEBUG = true;

  const API = "http://127.0.0.1:80";
  const WS_URL = "ws://127.0.0.1:80/ws";     // might be blocked from https
  const JOB_HTTP = "/nextJob";               // GET -> {type:"job", url:"..."} or {type:"no_job"}
  const REPORT_HTTP = "/report";             // POST -> {url, pageTitle, uuids, songs, ts, meta}
  const HEALTH_HTTP = "/health";

  const POLL_MS = 2000;
  const SCRAPE_DELAY_MS = 3500;
  const TIMEOUT_MS = 15000;

  // Persistent keys
  const K_JOB_URL   = "ncz_job_url";
  const K_JOB_TRIES = "ncz_job_nav_tries";
  const K_LAST_HASH = "ncz_last_report_hash";
  const K_WORKER_ID = "ncz_worker_id";

  // UUID regex (matches "song/<uuid>" in raw HTML)
  const SONG_UUID_RE =
    /\bsong\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/ig;

  // href-based matcher for DOM links
  const UUID_STR =
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const SONG_HREF_RE = new RegExp(`/song/(${UUID_STR})(?:$|[/?#])`, "i");

  // Expose a tiny flag so you can see in DevTools if it ran
  window.__NCZ_PRODUCER_WORKER_LOADED__ = true;

  const log = (...a) => { if (DEBUG) console.log("[NCZ]", ...a); };
  const warn = (...a) => console.warn("[NCZ]", ...a);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const uniqLower = (arr) =>
    Array.from(new Set((arr || []).map(s => (s || "").toLowerCase()))).filter(Boolean);

  function stableHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function normalizeUrl(u) {
    try {
      const x = new URL(u);
      if (x.pathname.length > 1 && x.pathname.endsWith("/")) x.pathname = x.pathname.slice(0, -1);
      return x.toString();
    } catch {
      return (u || "").trim();
    }
  }

  function sameUrl(a, b) {
    return normalizeUrl(a) === normalizeUrl(b);
  }

  function gmGet(key, def = null) { try { return GM_getValue(key, def); } catch { return def; } }
  function gmSet(key, val) { try { GM_setValue(key, val); } catch {} }
  function gmDel(key) { try { GM_deleteValue(key); } catch {} }

  function ensureWorkerId() {
    let id = gmGet(K_WORKER_ID, "");
    if (!id) {
      id = "w_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
      gmSet(K_WORKER_ID, id);
    }
    return id;
  }

  function httpGet(path) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: API + path,
        timeout: TIMEOUT_MS,
        onload: resolve,
        onerror: reject,
        ontimeout: () => reject(new Error("GET timeout")),
      });
    });
  }

  function httpPost(path, json) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: API + path,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(json),
        timeout: TIMEOUT_MS,
        onload: resolve,
        onerror: reject,
        ontimeout: () => reject(new Error("POST timeout")),
      });
    });
  }

  // ----------------------------
  // Job state
  // ----------------------------
  function getJobUrl() { return gmGet(K_JOB_URL, ""); }
  function setJobUrl(url) { gmSet(K_JOB_URL, url); gmSet(K_JOB_TRIES, 0); }
  function clearJob() { gmDel(K_JOB_URL); gmDel(K_JOB_TRIES); }

  function bumpNavTry() {
    const n = Number(gmGet(K_JOB_TRIES, 0) || 0) + 1;
    gmSet(K_JOB_TRIES, n);
    return n;
  }

  // ----------------------------
  // Scrape: return ONLY {uuid,title,artist}
  // ----------------------------
  function cleanText(s) {
    return String(s || "")
      .replace(/\u00B7/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractUuidFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      href = (u.pathname || "") + (u.search || "") + (u.hash || "");
    } catch {}
    const m = String(href).match(SONG_HREF_RE);
    return m ? m[1] : null;
  }

  // SAME artist method you said was correct:
  function inferArtistFromAnchor(a) {
    const row =
      a?.closest?.('div[role="button"][aria-roledescription="sortable"]') ||
      a?.closest?.('div[role="button"]');

    if (!row) return null;

    const candidates = Array.from(row.querySelectorAll('a[href^="/"]'))
      .filter(x => {
        const href = (x.getAttribute("href") || "").trim();
        if (!href || !href.startsWith("/")) return false;
        if (href.startsWith("/song/")) return false;
        if (href.startsWith("/_next/")) return false;
        if (href.startsWith("/playlist/")) return false;

        const path = href.split(/[?#]/)[0];
        const segs = path.split("/").filter(Boolean);
        if (segs.length !== 1) return false; // ONLY "/username"

        const txt = cleanText(x.textContent || "");
        if (!txt) return false;

        const low = txt.toLowerCase();
        if (["home","explore","search","library","profile","settings","login","logout"].includes(low)) return false;

        return true;
      });

    if (!candidates.length) return null;
    return cleanText(candidates[0].textContent || "") || null;
  }

  function inferTitleFromAnchor(a) {
    // Producer song title is the anchor text itself in your example
    const t = cleanText(a?.textContent || "");
    if (t) return t;

    // fallback: aria label "Open details for X"
    const open = a?.closest?.('div[aria-label^="Open details for "]');
    const ariaOpen = cleanText(open?.getAttribute?.("aria-label") || "");
    if (ariaOpen) return ariaOpen.replace(/^Open details for\s*/i, "").trim() || null;

    // fallback: "Play X"
    const row =
      a?.closest?.('div[role="button"][aria-roledescription="sortable"]') ||
      a?.closest?.('div[role="button"]');
    const playBtn = row?.querySelector?.('button[aria-label^="Play "]');
    const ariaPlay = cleanText(playBtn?.getAttribute?.("aria-label") || "");
    if (ariaPlay) return ariaPlay.replace(/^Play\s*/i, "").trim() || null;

    // fallback: img alt
    const img = row?.querySelector?.("img[alt]");
    const alt = cleanText(img?.getAttribute?.("alt") || "");
    if (alt) return alt;

    return null;
  }

  function scrapeSongsSimple() {
    const map = new Map(); // uuidLower -> {uuid,title,artist}

    const anchors = document.querySelectorAll('a[href*="/song/"]');
    for (const a of anchors) {
      const href = a.getAttribute("href") || a.href || "";
      const uuid = extractUuidFromHref(href);
      if (!uuid) continue;

      const u = uuid.toLowerCase();
      if (map.has(u)) continue;

      const title = inferTitleFromAnchor(a);
      const artist = inferArtistFromAnchor(a);

      map.set(u, { uuid: u, title: title || null, artist: artist || null });
    }

    // Regex fallback if DOM gave nothing (no titles/artists)
    if (map.size === 0) {
      const html = document.documentElement ? document.documentElement.innerHTML : "";
      const matches = Array.from(html.matchAll(SONG_UUID_RE), m => (m[1] || "").toLowerCase()).filter(Boolean);
      for (const u of matches) {
        if (!map.has(u)) map.set(u, { uuid: u, title: null, artist: null });
      }
    }

    const songs = Array.from(map.values());

    if (songs.length) {
      log("Songs JSON (ONLY uuid/title/artist):");
      console.table(songs);
    } else {
      log("No songs found.");
    }

    return songs;
  }

  // keep old function name used elsewhere, but now it derives from songs
  function scrapeUUIDs() {
    const songs = scrapeSongsSimple();
    return uniqLower(songs.map(s => s.uuid));
  }

  async function handleJobIfAny() {
    const jobUrl = getJobUrl();
    if (!jobUrl) return false;

    const here = location.href;

    if (!sameUrl(here, jobUrl)) {
      const tries = bumpNavTry();
      log("Job present. Not on job page. Navigating.", { jobUrl, here, tries });

      if (tries > 10) {
        warn("Too many navigation tries. Clearing job.", jobUrl);
        clearJob();
        return false;
      }

      location.href = jobUrl; // reload
      return true;
    }

    // We are on the job page -> scrape and report
    log("On job page. Waiting for render then scraping.", jobUrl);
    await sleep(SCRAPE_DELAY_MS);

    const songs = scrapeSongsSimple();                 // <-- ONLY {uuid,title,artist}
    const uuids = uniqLower(songs.map(s => s.uuid));
    const pageTitle = document.title || null;

    // hash includes songs now
    const payloadCore = JSON.stringify({ url: jobUrl, pageTitle, songs });
    const hash = stableHash(payloadCore);
    const lastHash = gmGet(K_LAST_HASH, "");

    if (lastHash === hash) {
      log("Same content already reported; clearing job and returning to idle.");
      clearJob();
      return true;
    }

    const workerId = ensureWorkerId();
    log("Reporting scrape.", { count: uuids.length, workerId });

    try {
      await httpPost(REPORT_HTTP, {
        url: jobUrl,
        pageTitle,
        uuids,
        songs,                         // <-- ONLY fields you wanted
        ts: Date.now() / 1000,
        meta: { workerId, path: location.pathname, ua: navigator.userAgent }
      });
      gmSet(K_LAST_HASH, hash);
      clearJob();
      log("Report OK. Cleared job. Returning to idle.");
      return true;
    } catch (e) {
      warn("Report failed. Keeping job so we retry on next load.", e);
      return false;
    }
  }

  // ----------------------------
  // Job acquisition (WS first, HTTP fallback)
  // ----------------------------
  async function tryWebSocketOnce() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };

      try {
        const ws = new WebSocket(WS_URL);

        ws.addEventListener("open", () => {
          log("WS connected. Requesting job.");
          ws.send(JSON.stringify({ type: "get_job" }));
        });

        ws.addEventListener("message", (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }

          if (msg?.type === "job" && msg.url) {
            log("WS got job:", msg.url);
            setJobUrl(String(msg.url));
            ws.close();
            location.href = String(msg.url);
            finish(true);
          } else if (msg?.type === "no_job") {
            log("WS no_job");
            ws.close();
            finish(false);
          }
        });

        ws.addEventListener("error", (e) => {
          warn("WS error (likely blocked from https). Falling back to HTTP.", e);
          try { ws.close(); } catch {}
          finish(false);
        });

        ws.addEventListener("close", () => {
          if (!done) finish(false);
        });

        // Safety timeout
        setTimeout(() => {
          try { ws.close(); } catch {}
          finish(false);
        }, 2500);

      } catch (e) {
        warn("WS constructor failed. Falling back to HTTP.", e);
        finish(false);
      }
    });
  }

  async function httpPollLoop() {
    log("Starting HTTP poll loop:", API + JOB_HTTP);

    // quick health probe so you SEE something in console
    try {
      const h = await httpGet(HEALTH_HTTP);
      log("Health OK:", h.responseText?.slice(0, 200));
    } catch (e) {
      warn("Health probe failed (server down or blocked):", e);
    }

    while (true) {
      if (getJobUrl()) return; // job set elsewhere

      try {
        const resp = await httpGet(JOB_HTTP);
        const msg = JSON.parse(resp.responseText || "{}");

        if (msg?.type === "job" && msg.url) {
          log("HTTP got job:", msg.url);
          setJobUrl(String(msg.url));
          location.href = String(msg.url);
          return;
        } else {
          log("HTTP no_job");
        }
      } catch (e) {
        warn("HTTP poll error:", e);
      }

      await sleep(POLL_MS);
    }
  }

  // ----------------------------
  // BOOT (keeping your original structure)
  // ----------------------------
  (async () => {
    log("Loaded on:", location.href);

    // 1) If we already have a persistent job, navigate/report it first
    const acted = await handleJobIfAny();
    if (getJobUrl()) return; // still have job (report failed etc.)

    // 2) Try WS once (fast), then fall back to HTTP polling forever
    (async () => {
      log("Loaded on:", location.href);

      await handleJobIfAny();     // may navigate or report
      if (getJobUrl()) return;    // job still set (e.g., report failed)

      await httpPollLoop();       // ALWAYS keep polling forever when idle
    })();
  })();

})();
