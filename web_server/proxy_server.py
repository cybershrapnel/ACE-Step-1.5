"""
server.py — NCZ / MEQUAVIS FastAPI proxy + local songs + archive browser + remote archive alias + users_online + chat

✅ FIXES INCLUDED
- Removes duplicate ARCHIVE_DIR + duplicate /archive/api_audio routes (there is only ONE now).
- Single /static mount (prefers WEB_DIR/static if it exists; else falls back to ./static).
- Archive browse supports:
    1) Local filesystem archive under ARCHIVE_DIR
    2) A virtual remote folder "__xt_music__" that mirrors:
       https://xtdevelopment.net/music/mp3s/
       by scraping the HTML directory listing and returning mp3s/dirs as if local.
  Remote mp3 items return file=<REAL ABS URL> so playback uses real server URL (not proxy).
- Keeps your /songs cache behavior, /api_audio mp3 serve, and upstream catch-all proxy.
- Includes /users_online and chat endpoints in the same app (no duplicate app creation).

Run:
  uvicorn server:app --host 0.0.0.0 --port 8080
"""

import os
import re
import json
import time
import asyncio
from datetime import datetime
from collections import deque
from typing import Iterable, Tuple, List, Dict, Optional, Deque, Any
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit, unquote
import secrets
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field











# imports (ok if duplicates / wrong spot)
import asyncio, time, re
from collections import deque
from typing import Any, Dict, List, Optional
from fastapi import WebSocket, WebSocketDisconnect, HTTPException, Query
from pydantic import BaseModel, Field





































# ============================================================
# Config
# ============================================================
UPSTREAM = os.getenv("ACESTEP_UPSTREAM", "http://127.0.0.1:8001").rstrip("/")
WEB_DIR = os.getenv("WEB_DIR", ".")
INDEX_PATH = os.path.join(WEB_DIR, "index.html")

# Local audio directory to scan/serve (your "new songs" list)
AUDIO_DIR = os.getenv(
    "ACESTEP_API_AUDIO_DIR",
    os.path.abspath(os.path.join(os.getcwd(), ".cache", "acestep", "tmp", "api_audio")),
)

# Archive folder (same directory as this server script, unless overridden)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.getenv("ACESTEP_ARCHIVE_DIR", os.path.join(SCRIPT_DIR, "archive"))

# Refresh song list every 5 minutes
SONG_REFRESH_SECONDS = int(os.getenv("SONG_REFRESH_SECONDS", "300"))

TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=300.0, pool=10.0)


# ============================================================
# App + Static
# ============================================================
app = FastAPI()

# Mount /static exactly once. Prefer WEB_DIR/static if present; else ./static if present.
static_candidates = [
    os.path.join(WEB_DIR, "static"),
    os.path.join(SCRIPT_DIR, "static"),
    "static",
]
static_dir = None
for cand in static_candidates:
    if cand and os.path.isdir(cand):
        static_dir = cand
        break

if static_dir:
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


# ============================================================
# HTTP client lifecycle
# ============================================================
_http_client: Optional[httpx.AsyncClient] = None

def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        # Should not happen after startup, but keep safe.
        _http_client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)
    return _http_client


@app.on_event("startup")
async def _startup():
    global _http_client, _song_refresh_task, _ai_radio_task, _eve_task
    _http_client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)
    await _refresh_song_cache(force=True)
    _song_refresh_task = asyncio.create_task(_song_refresh_loop())

    # ✅ start AI radio loop
    _ai_radio_task = asyncio.create_task(_ai_radio_loop())

    # ✅ start eve loop
    if EVE_ENABLED:
        _eve_task = asyncio.create_task(_eve_loop())


@app.on_event("shutdown")
async def _shutdown():
    global _http_client, _song_refresh_task, _ai_radio_task, _eve_task

    if _eve_task:
        _eve_task.cancel()
        _eve_task = None

    if _ai_radio_task:
        _ai_radio_task.cancel()
        _ai_radio_task = None

    if _song_refresh_task:
        _song_refresh_task.cancel()
        _song_refresh_task = None

    if _http_client:
        try:
            await _http_client.aclose()
        except Exception:
            pass
        _http_client = None


























# ============================================================
# Song cache (in-memory)
# ============================================================
_song_cache: List[Dict] = []
_song_cache_ts: float = 0.0
_song_lock = asyncio.Lock()
_song_refresh_task: Optional[asyncio.Task] = None


def _is_safe_filename(name: str) -> bool:
    # Prevent path traversal: only allow base filename (no slashes)
    return name == os.path.basename(name) and ("/" not in name) and ("\\" not in name)


def _safe_join_under_audio_dir(filename: str) -> Optional[str]:
    if not _is_safe_filename(filename):
        return None
    audio_dir_abs = os.path.abspath(AUDIO_DIR)
    full_path = os.path.abspath(os.path.join(audio_dir_abs, filename))
    if not full_path.startswith(audio_dir_abs + os.sep) and full_path != os.path.join(audio_dir_abs, filename):
        return None
    return full_path


# ✅ Safe join that ALLOWS nested paths under a base directory (for archive browsing)
def _safe_join_under(base_dir: str, rel_path: str) -> Optional[str]:
    if rel_path is None:
        rel_path = ""
    rel_path = rel_path.strip().replace("\\", "/")

    # allow root browse
    if rel_path in ("", "."):
        return os.path.abspath(base_dir)

    # forbid absolute
    if rel_path.startswith("/"):
        return None
    drive, _ = os.path.splitdrive(rel_path)
    if drive:
        return None

    norm = os.path.normpath(rel_path).replace("\\", os.sep)

    # forbid traversal
    if norm == ".." or norm.startswith(".." + os.sep):
        return None

    base_abs = os.path.abspath(base_dir)
    full = os.path.abspath(os.path.join(base_abs, norm))

    if not full.startswith(base_abs + os.sep) and full != base_abs:
        return None

    return full


def _load_json(path: str) -> Optional[Dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _json_created_at(meta: Dict) -> float:
    try:
        v = meta.get("created_at", 0.0)
        return float(v) if v is not None else 0.0
    except Exception:
        return 0.0


def _fmt_created_at(epoch: Optional[float]) -> str:
    """
    Your UI expects created_at as a string (it prints it directly).
    """
    if epoch is None:
        return ""
    try:
        return datetime.fromtimestamp(float(epoch)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""


def _index_song_json_by_mp3() -> Dict[str, Dict]:
    """
    Map mp3 filename -> json metadata.
    Best match: json["audio_path"] basename == mp3 filename.
    If multiple JSONs map to same mp3, keep newest created_at.
    Fallback: json filename base -> {base}.mp3
    """
    out: Dict[str, Dict] = {}
    if not os.path.isdir(AUDIO_DIR):
        return out

    try:
        for fn in os.listdir(AUDIO_DIR):
            if not fn.lower().endswith(".json"):
                continue

            full = _safe_join_under_audio_dir(fn)
            if not full or not os.path.isfile(full):
                continue

            meta = _load_json(full)
            if not isinstance(meta, dict):
                continue

            mp3_name: Optional[str] = None

            audio_path = meta.get("audio_path")
            if isinstance(audio_path, str) and audio_path:
                bn = os.path.basename(audio_path)
                if bn.lower().endswith(".mp3") and _is_safe_filename(bn):
                    mp3_name = bn

            if mp3_name is None:
                base = fn[:-5]  # strip .json
                guess = f"{base}.mp3"
                if _is_safe_filename(guess):
                    mp3_name = guess

            if mp3_name is None:
                continue

            if mp3_name in out:
                if _json_created_at(meta) > _json_created_at(out[mp3_name]):
                    out[mp3_name] = meta
            else:
                out[mp3_name] = meta

    except OSError:
        return {}

    return out


def _scan_audio_dir() -> List[Dict]:
    """
    Build a list of songs from AUDIO_DIR.
    Files are named {audio_id}.mp3.

    What your index.html expects for /songs:
      - item.label OR item.prompt  -> display label (else shows "Song")
      - item.task_id               -> shown as "task XXXXX"
      - item.output_index          -> shown as "output N"
      - item.created_at            -> shown as date line (string)

    Adds:
      - item.author, item.title    -> from JSON so it persists across reloads
      - item.metas                 -> full metas dict for metadata popup
    """
    out: List[Dict] = []

    if not os.path.isdir(AUDIO_DIR):
        return out

    meta_by_mp3 = _index_song_json_by_mp3()

    def _as_str(v) -> str:
        return v.strip() if isinstance(v, str) else ""

    def _pick_str(*vals) -> str:
        for v in vals:
            s = _as_str(v)
            if s:
                return s
        return ""

    try:
        mp3_entries: List[Tuple[float, str]] = []
        for fn in os.listdir(AUDIO_DIR):
            if not fn.lower().endswith(".mp3"):
                continue
            full = _safe_join_under_audio_dir(fn)
            if not full or not os.path.isfile(full):
                continue
            try:
                fs_mtime = os.path.getmtime(full)
            except OSError:
                fs_mtime = 0.0
            mp3_entries.append((fs_mtime, fn))

        mp3_entries.sort(key=lambda x: x[0], reverse=True)

        for fs_mtime, fn in mp3_entries:
            audio_id = fn[:-4]  # strip .mp3
            meta = meta_by_mp3.get(fn)

            # fallback: same-basename json (audio_id.json)
            if meta is None:
                json_guess = f"{audio_id}.json"
                json_path = _safe_join_under_audio_dir(json_guess)
                if json_path and os.path.isfile(json_path):
                    meta = _load_json(json_path)

            job_id = None
            created_at_epoch: Optional[float] = None
            audio_index = 0
            caption = ""
            metas: Dict = {}
            author = ""
            title = ""

            if isinstance(meta, dict):
                job_id = meta.get("job_id") or None

                try:
                    if meta.get("created_at") is not None:
                        created_at_epoch = float(meta.get("created_at"))
                except Exception:
                    created_at_epoch = None

                try:
                    if meta.get("audio_index") is not None:
                        audio_index = int(meta.get("audio_index"))
                except Exception:
                    audio_index = 0

                metas = meta.get("metas") if isinstance(meta.get("metas"), dict) else {}
                cap = metas.get("caption")
                caption = cap if isinstance(cap, str) else ""

                title = _pick_str(
                    metas.get("title"),
                    metas.get("song_title"),
                    meta.get("title"),
                    meta.get("song_title"),
                )
                author = _pick_str(
                    metas.get("author"),
                    metas.get("artist"),
                    meta.get("author"),
                    meta.get("artist"),
                )

            visible_id = job_id or audio_id

            created_at_str = _fmt_created_at(created_at_epoch) if created_at_epoch is not None else ""
            sort_epoch = created_at_epoch if created_at_epoch is not None else fs_mtime

            style_text = caption or ""

            out.append(
                {
                    "task_id": visible_id,
                    "output_index": audio_index,
                    "created_at": created_at_str,
                    "label": style_text,
                    "prompt": style_text,

                    "filename": fn,
                    "file": f"/api_audio/{quote(fn)}",
                    "mtime": int(sort_epoch),

                    "author": author,
                    "title": title,
                    "metas": metas,

                    "job_id": job_id,
                    "audio_id": audio_id,
                    "caption": caption,
                    "_created_at_epoch": created_at_epoch,
                }
            )

        out.sort(key=lambda s: float(s.get("_created_at_epoch") or s.get("mtime") or 0), reverse=True)
        for s in out:
            s.pop("_created_at_epoch", None)

    except OSError:
        return []

    return out


async def _refresh_song_cache(force: bool = False) -> None:
    global _song_cache, _song_cache_ts
    now = time.time()
    if (not force) and (now - _song_cache_ts) < SONG_REFRESH_SECONDS:
        return

    async with _song_lock:
        now2 = time.time()
        if (not force) and (now2 - _song_cache_ts) < SONG_REFRESH_SECONDS:
            return
        _song_cache = _scan_audio_dir()
        _song_cache_ts = now2


async def _song_refresh_loop():
    while True:
        try:
            await _refresh_song_cache(force=True)
        except Exception:
            pass
        await asyncio.sleep(SONG_REFRESH_SECONDS)


# ============================================================
# Proxy helpers
# ============================================================
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def _filtered_headers(headers: Iterable[Tuple[str, str]]) -> dict:
    out = {}
    for k, v in headers:
        lk = k.lower()
        if lk in HOP_BY_HOP:
            continue
        # avoid gzip so streaming stays simple/stable
        if lk == "accept-encoding":
            continue
        out[k] = v
    return out


# ============================================================
# Web + Song list endpoints
# ============================================================
@app.get("/")
async def root():
    return FileResponse(INDEX_PATH)


@app.get("/index.html")
async def index_html():
    return FileResponse(INDEX_PATH)


@app.get("/favicon.ico")
async def favicon():
    # If you actually have a favicon file, replace this with FileResponse(...)
    return Response(status_code=204)


@app.get("/songs")
async def songs():
    await _refresh_song_cache(force=False)
    return JSONResponse({"songs": _song_cache, "dir": AUDIO_DIR, "refreshed_at": int(_song_cache_ts)})


@app.get("/api_audio/{filename}")
async def api_audio(filename: str):
    if not _is_safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    full_path = os.path.abspath(os.path.join(AUDIO_DIR, filename))
    audio_dir_abs = os.path.abspath(AUDIO_DIR)

    if not full_path.startswith(audio_dir_abs + os.sep) and full_path != os.path.join(audio_dir_abs, filename):
        raise HTTPException(status_code=400, detail="Invalid path")

    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Not found")

    return FileResponse(full_path, media_type="audio/mpeg", filename=filename)


# ============================================================
# ✅ Archive endpoints (LOCAL + REMOTE ALIAS)
# ============================================================

def _archive_extract_meta_for_mp3(mp3_full_path: str) -> Dict:
    """
    If archive has {same_base}.json next to mp3, pull author/title/metas/caption/etc.
    """
    base_no_ext, _ = os.path.splitext(mp3_full_path)
    json_path = base_no_ext + ".json"
    meta = _load_json(json_path) if os.path.isfile(json_path) else None

    def _as_str(v) -> str:
        return v.strip() if isinstance(v, str) else ""

    def _pick_str(*vals) -> str:
        for v in vals:
            s = _as_str(v)
            if s:
                return s
        return ""

    job_id = None
    created_at_epoch: Optional[float] = None
    audio_index = 0
    caption = ""
    metas: Dict = {}
    author = ""
    title = ""

    if isinstance(meta, dict):
        job_id = meta.get("job_id") or None
        try:
            if meta.get("created_at") is not None:
                created_at_epoch = float(meta.get("created_at"))
        except Exception:
            created_at_epoch = None

        try:
            if meta.get("audio_index") is not None:
                audio_index = int(meta.get("audio_index"))
        except Exception:
            audio_index = 0

        metas = meta.get("metas") if isinstance(meta.get("metas"), dict) else {}
        cap = metas.get("caption")
        caption = cap if isinstance(cap, str) else ""

        title = _pick_str(metas.get("title"), metas.get("song_title"), meta.get("title"), meta.get("song_title"))
        author = _pick_str(metas.get("author"), metas.get("artist"), meta.get("author"), meta.get("artist"))

    return {
        "job_id": job_id,
        "created_at": _fmt_created_at(created_at_epoch) if created_at_epoch is not None else "",
        "output_index": audio_index,
        "caption": caption,
        "metas": metas,
        "author": author,
        "title": title,
    }


# ---------------------------
# Remote alias: xtdevelopment.net/music/mp3s/
# ---------------------------
REMOTE_ARCHIVE_KEY = "__xt_music__"
REMOTE_ARCHIVE_NAME = "XT Music (xtdevelopment.net)"
REMOTE_ARCHIVE_BASE_URL = "https://xtdevelopment.net/music/mp3s/"  # must end with /

REMOTE_CACHE_SECONDS = 86400
_remote_archive_cache: Dict[str, Tuple[float, Dict]] = {}
_remote_archive_lock = asyncio.Lock()

_remote_base_path = urlsplit(REMOTE_ARCHIVE_BASE_URL).path.rstrip("/") + "/"  # "/music/mp3s/"


def _is_remote_archive_path(rel_path: str) -> bool:
    p = (rel_path or "").strip().replace("\\", "/").strip("/")
    return p == REMOTE_ARCHIVE_KEY or p.startswith(REMOTE_ARCHIVE_KEY + "/")


def _remote_subpath_from_archive_path(rel_path: str) -> str:
    p = (rel_path or "").strip().replace("\\", "/").strip("/")
    if p == REMOTE_ARCHIVE_KEY:
        return ""
    if p.startswith(REMOTE_ARCHIVE_KEY + "/"):
        return p[len(REMOTE_ARCHIVE_KEY) + 1 :].strip("/")
    return ""


def _safe_remote_rel(rel: str) -> str:
    rel = (rel or "").strip().replace("\\", "/").strip("/")
    if rel in ("", "."):
        return ""
    if rel.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid remote path")
    if ":" in rel.split("/")[0]:
        raise HTTPException(status_code=400, detail="Invalid remote path")
    norm = os.path.normpath(rel).replace("\\", "/").strip("/")
    if norm == ".." or norm.startswith("../"):
        raise HTTPException(status_code=400, detail="Invalid remote path")
    return norm


def _encode_url_path(rel: str) -> str:
    rel = (rel or "").strip().replace("\\", "/").strip("/")
    if not rel:
        return ""
    return "/".join(quote(seg) for seg in rel.split("/") if seg)


class _LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: List[Tuple[str, str]] = []
        self._in_a = False
        self._href = None
        self._txt: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            d = dict(attrs)
            href = d.get("href")
            if href:
                self._in_a = True
                self._href = href
                self._txt = []

    def handle_data(self, data):
        if self._in_a and data:
            self._txt.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._in_a:
            text = "".join(self._txt).strip()
            href = (self._href or "").strip()
            self.links.append((href, text))
            self._in_a = False
            self._href = None
            self._txt = []


_DATE_PATTERNS = [
    ("%Y-%m-%d %H:%M", re.compile(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})")),
    ("%d-%b-%Y %H:%M", re.compile(r"(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})")),
]


def _parse_size_to_bytes(s: str) -> int:
    s = (s or "").strip()
    if not s or s in ("-", "DIR", "dir"):
        return 0
    m = re.match(r"^(\d+(?:\.\d+)?)([KMGTP]?)(?:B)?$", s, re.IGNORECASE)
    if not m:
        return 0
    n = float(m.group(1))
    u = (m.group(2) or "").upper()
    mult = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}.get(u, 1)
    return int(n * mult)


def _guess_mtime_size_from_html(html: str, href: str) -> Tuple[int, int]:
    if not html or not href:
        return (0, 0)

    candidates = [href, href.replace("&", "&amp;")]
    idx = -1
    for c in candidates:
        idx = html.find(c)
        if idx != -1:
            break
    if idx == -1:
        return (0, 0)

    snippet = html[idx : idx + 600]

    epoch = 0
    for fmt, rx in _DATE_PATTERNS:
        mm = rx.search(snippet)
        if mm:
            try:
                dt = datetime.strptime(mm.group(1), fmt)
                epoch = int(dt.timestamp())
            except Exception:
                epoch = 0
            break

    size = 0
    # heuristic: find something like " 12M " near the row
    msize = re.search(r"\s(\d+(?:\.\d+)?[KMGTP]?)\s", snippet)
    if msize:
        size = _parse_size_to_bytes(msize.group(1))

    return (epoch, size)


async def _remote_archive_browse(rel_path: str) -> Dict:
    sub = _safe_remote_rel(_remote_subpath_from_archive_path(rel_path))
    cache_key = sub
    now = time.time()

    async with _remote_archive_lock:
        hit = _remote_archive_cache.get(cache_key)
        if hit and (now - float(hit[0])) < REMOTE_CACHE_SECONDS:
            return hit[1]

    # Build remote directory URL (ensure trailing slash)
    remote_dir_url = REMOTE_ARCHIVE_BASE_URL
    enc = _encode_url_path(sub)
    if enc:
        remote_dir_url = urljoin(REMOTE_ARCHIVE_BASE_URL, enc + "/")

    client = _get_client()
    try:
        r = await client.get(
            remote_dir_url,
            headers={
                "Accept": "text/html,*/*",
                "User-Agent": "ncz-archive-mirror/1.0",
            },
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Remote listing HTTP {r.status_code}")
        html = r.text or ""
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Remote listing fetch failed: {e}")

    parser = _LinkParser()
    try:
        parser.feed(html)
    except Exception:
        parser.links = []

    items: List[Dict] = []
    seen = set()

    for href, text in parser.links:
        if not href:
            continue
        if href.startswith("#") or href.startswith("?"):
            continue

        t = (text or "").strip().lower()
        if t in ("parent directory", ".."):
            continue
        if href.startswith("../"):
            continue

        # Make absolute URL
        abs_url = urljoin(remote_dir_url, href)
        up = urlsplit(abs_url).path

        # Only allow URLs under the remote base path
        if not up.startswith(_remote_base_path):
            continue

        # Identify directories
        is_dir = up.endswith("/")
        up_clean = up.rstrip("/")

        rel_inside = up_clean[len(_remote_base_path):].lstrip("/")
        rel_inside = unquote(rel_inside)

        try:
            rel_inside = _safe_remote_rel(rel_inside)
        except HTTPException:
            continue

        name = os.path.basename(rel_inside) if rel_inside else ""
        if not name:
            continue

        key = ("dir:" if is_dir else "file:") + rel_inside
        if key in seen:
            continue
        seen.add(key)

        if is_dir:
            items.append(
                {
                    "type": "dir",
                    "name": name,
                    "path": (REMOTE_ARCHIVE_KEY + "/" + rel_inside).strip("/"),
                    "mtime": 0,
                }
            )
            continue

        if not name.lower().endswith(".mp3"):
            continue

        mtime_epoch, size_bytes = _guess_mtime_size_from_html(html, href)

        items.append(
            {
                "type": "mp3",
                "name": name,
                "path": (REMOTE_ARCHIVE_KEY + "/" + rel_inside).strip("/"),
                "size": int(size_bytes or 0),
                "mtime": int(mtime_epoch or 0),

                # ✅ IMPORTANT: direct URL to real server
                "file": abs_url,

                # minimal UI fields
                "task_id": os.path.splitext(name)[0],
                "output_index": 0,
                "created_at": "",
                "label": "",
                "prompt": "",
                "author": "",
                "title": "",
                "metas": {},
            }
        )

    # dirs first, then newest files if mtimes parse
    items.sort(key=lambda x: (0 if x["type"] == "dir" else 1, -(x.get("mtime") or 0), x.get("name", "")))

    payload = {
        "base": REMOTE_ARCHIVE_BASE_URL,
        "path": (rel_path or ""),
        "exists": True,
        "remote": True,
        "items": items,
    }

    async with _remote_archive_lock:
        _remote_archive_cache[cache_key] = (time.time(), payload)

    return payload


# ---------------------------
# Local archive browse
# ---------------------------
def _local_archive_browse(rel_path: str) -> Dict:
    base_abs = os.path.abspath(ARCHIVE_DIR)
    if not os.path.isdir(base_abs):
        return {"base": base_abs, "path": rel_path or "", "exists": False, "items": []}

    full_dir = _safe_join_under(base_abs, rel_path or "")
    if not full_dir or not os.path.isdir(full_dir):
        raise HTTPException(status_code=404, detail="Archive path not found")

    items: List[Dict] = []
    try:
        with os.scandir(full_dir) as it:
            for entry in it:
                name = entry.name
                if name.startswith("."):
                    continue

                rel_item = os.path.relpath(entry.path, base_abs).replace("\\", "/")
                try:
                    st = entry.stat()
                    mtime = int(st.st_mtime)
                    size = int(st.st_size)
                except Exception:
                    mtime = 0
                    size = 0

                if entry.is_dir(follow_symlinks=False):
                    items.append({"type": "dir", "name": name, "path": rel_item, "mtime": mtime})
                elif entry.is_file(follow_symlinks=False):
                    lower = name.lower()
                    if lower.endswith(".mp3"):
                        meta_bits = _archive_extract_meta_for_mp3(entry.path)
                        items.append(
                            {
                                "type": "mp3",
                                "name": name,
                                "path": rel_item,
                                "size": size,
                                "mtime": mtime,
                                "file": f"/archive/api_audio/{quote(rel_item)}",
                                "task_id": meta_bits.get("job_id") or os.path.splitext(name)[0],
                                "output_index": meta_bits.get("output_index", 0),
                                "created_at": meta_bits.get("created_at", ""),
                                "label": meta_bits.get("caption", ""),
                                "prompt": meta_bits.get("caption", ""),
                                "author": meta_bits.get("author", ""),
                                "title": meta_bits.get("title", ""),
                                "metas": meta_bits.get("metas", {}) or {},
                            }
                        )
                    elif lower.endswith(".json"):
                        items.append(
                            {
                                "type": "json",
                                "name": name,
                                "path": rel_item,
                                "size": size,
                                "mtime": mtime,
                                "file": f"/archive/api_audio/{quote(rel_item)}",
                            }
                        )
                    else:
                        continue
    except OSError:
        raise HTTPException(status_code=500, detail="Archive browse failed")

    # ✅ add remote alias folder at ROOT only
    if (rel_path or "").strip().replace("\\", "/").strip("/") == "":
        items.append(
            {
                "type": "dir",
                "name": REMOTE_ARCHIVE_NAME,
                "path": REMOTE_ARCHIVE_KEY,
                "mtime": int(time.time()),
            }
        )

    items.sort(key=lambda x: (0 if x["type"] == "dir" else 1, -(x.get("mtime") or 0), x.get("name", "")))
    return {"base": base_abs, "path": (rel_path or ""), "exists": True, "items": items}


async def _archive_browse(rel_path: str) -> Dict:
    if _is_remote_archive_path(rel_path):
        return await _remote_archive_browse(rel_path)
    return _local_archive_browse(rel_path)


@app.get("/archive/browse")
async def archive_browse(path: str = ""):
    return JSONResponse(await _archive_browse(path))


@app.get("/archive/browse/{subpath:path}")
async def archive_browse_sub(subpath: str):
    return JSONResponse(await _archive_browse(subpath))


@app.get("/archive/api_audio/{rel_path:path}")
async def archive_api_audio(rel_path: str):
    """
    Serves local archive files only (mp3/json) from ARCHIVE_DIR.
    Remote alias items return absolute URLs and should NOT hit this endpoint.
    """
    base_abs = os.path.abspath(ARCHIVE_DIR)
    if not os.path.isdir(base_abs):
        raise HTTPException(status_code=404, detail="Archive dir not found")

    full_path = _safe_join_under(base_abs, rel_path)
    if not full_path or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Not found")

    lower = full_path.lower()
    if not (lower.endswith(".mp3") or lower.endswith(".json")):
        raise HTTPException(status_code=400, detail="Unsupported file type")

    media_type = "audio/mpeg" if lower.endswith(".mp3") else "application/json"
    return FileResponse(full_path, media_type=media_type, filename=os.path.basename(full_path))


# ============================================================
# Users online endpoint
# ============================================================
try:
    import fcntl  # type: ignore
except Exception:
    fcntl = None

USERS_ONLINE_LOG = os.getenv("USERS_ONLINE_LOG", os.path.join(SCRIPT_DIR, "users_online_ips.json"))
USERS_ONLINE_LOCK = USERS_ONLINE_LOG + ".lock"
WINDOW_MINUTES = 90
WINDOW_SECONDS = WINDOW_MINUTES * 60


def _get_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[0]

    xrip = request.headers.get("x-real-ip")
    if xrip:
        return xrip.strip()

    cfip = request.headers.get("cf-connecting-ip")
    if cfip:
        return cfip.strip()

    if request.client and request.client.host:
        return str(request.client.host)

    return "unknown"


def _read_state(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            out = {}
            for k, v in data.items():
                try:
                    out[str(k)] = float(v)
                except Exception:
                    pass
            return out
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return {}


def _write_state_atomic(path: str, state: dict) -> None:
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, separators=(",", ":"))
    try:
        os.replace(tmp, path)
    except Exception:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, separators=(",", ":"))
        try:
            os.remove(tmp)
        except Exception:
            pass


def _with_lock(lock_path: str):
    d = os.path.dirname(lock_path) or "."
    os.makedirs(d, exist_ok=True)

    lf = open(lock_path, "a+", encoding="utf-8")
    if fcntl:
        try:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        except Exception:
            pass
    return lf


@app.get("/users_online")
async def users_online(request: Request):
    now = time.time()
    ip = _get_client_ip(request)
    cutoff = now - WINDOW_SECONDS

    lockf = _with_lock(USERS_ONLINE_LOCK)
    try:
        state = _read_state(USERS_ONLINE_LOG)
        state[ip] = now
        state = {k: v for (k, v) in state.items() if v >= cutoff}
        _write_state_atomic(USERS_ONLINE_LOG, state)
        count = len(state)
    finally:
        try:
            lockf.close()
        except Exception:
            pass

    return JSONResponse({"online": count, "window_minutes": WINDOW_MINUTES})




# ============================================================
# Chat endpoints (JSONL + in-memory cache)
# ============================================================
CHAT_ROOMS = 13
CHAT_CACHE_MAX = 500

CHAT_DIR = os.getenv("ACESTEP_CHAT_DIR", os.path.abspath(os.path.join(os.getcwd(), ".cache", "acestep", "chat")))
os.makedirs(CHAT_DIR, exist_ok=True)


def _room_file(room: int) -> str:
    return os.path.join(CHAT_DIR, f"room_{room}.jsonl")


_ROOM_CACHE: Dict[int, Deque[Dict[str, Any]]] = {r: deque(maxlen=CHAT_CACHE_MAX) for r in range(1, CHAT_ROOMS + 1)}
_ROOM_LOCKS: Dict[int, asyncio.Lock] = {r: asyncio.Lock() for r in range(1, CHAT_ROOMS + 1)}
_ROOM_LAST_ID: Dict[int, int] = {r: 0 for r in range(1, CHAT_ROOMS + 1)}


def _clamp_room(room: int) -> int:
    try:
        room = int(room)
    except Exception:
        return 1
    if room < 1:
        room = 1
    if room > CHAT_ROOMS:
        room = CHAT_ROOMS
    return room


def _load_room_into_cache(room: int) -> None:
    fp = _room_file(room)
    if not os.path.exists(fp):
        return
    try:
        with open(fp, "rb") as f:
            data = f.read().splitlines()[-CHAT_CACHE_MAX:]
        for line in data:
            try:
                obj = json.loads(line.decode("utf-8", errors="ignore"))
                if isinstance(obj, dict) and "id" in obj:
                    _ROOM_CACHE[room].append(obj)
            except Exception:
                continue
        if _ROOM_CACHE[room]:
            _ROOM_LAST_ID[room] = max(int(m.get("id", 0)) for m in _ROOM_CACHE[room])
    except Exception:
        pass


for r in range(1, CHAT_ROOMS + 1):
    _load_room_into_cache(r)


class ChatSendIn(BaseModel):
    room: int = Field(1, ge=1, le=CHAT_ROOMS)
    author: str = Field(..., min_length=1, max_length=40)
    message: str = Field(..., min_length=1, max_length=2000)


@app.get("/chat/messages")
async def chat_messages(room: int = 1, after_id: int = 0, limit: int = 80):
    room = _clamp_room(room)
    try:
        limit = int(limit)
    except Exception:
        limit = 80
    limit = max(1, min(limit, 200))

    async with _ROOM_LOCKS[room]:
        msgs = list(_ROOM_CACHE[room])

    if after_id and after_id > 0:
        out = [m for m in msgs if int(m.get("id", 0)) > after_id]
        if len(out) > limit:
            out = out[-limit:]
    else:
        out = msgs[-limit:] if len(msgs) > limit else msgs

    return {"room": room, "messages": out, "now": int(time.time() * 1000)}




# ============================================================
# Chat username/IP log + anti-impersonation suffixing
# ============================================================

CHAT_USER_LOG = os.getenv(
    "ACESTEP_CHAT_USER_LOG",
    os.path.join(CHAT_DIR, "chat_user_log.json")
)
CHAT_USER_LOCK = CHAT_USER_LOG + ".lock"

def _now_iso_ms(ms: int) -> str:
    try:
        return datetime.fromtimestamp(ms / 1000.0).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""

def _read_json_dict(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}

def _write_json_atomic(path: str, data: Dict[str, Any]) -> None:
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    try:
        os.replace(tmp, path)
    except Exception:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        try:
            os.remove(tmp)
        except Exception:
            pass

def _rand6() -> str:
    # 100000..999999
    return f"{secrets.randbelow(900000) + 100000:06d}"



def _canon_username(name: str) -> str:
    # Case-insensitive key (unicode-safe)
    return (name or "").strip().casefold()

def _cap_display(name: str) -> str:
    return (name or "").strip()[:40]

def _as_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default

def _merge_iprec(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(a, dict):
        a = {}
    if not isinstance(b, dict):
        b = {}

    a_fs = _as_int(a.get("first_seen_ms"), 0)
    b_fs = _as_int(b.get("first_seen_ms"), 0)
    a_ls = _as_int(a.get("last_seen_ms"), 0)
    b_ls = _as_int(b.get("last_seen_ms"), 0)

    fs = min([x for x in (a_fs, b_fs) if x > 0], default=0)
    ls = max(a_ls, b_ls)

    out = dict(a)
    out["first_seen_ms"] = fs or (a_fs or b_fs or 0)
    out["last_seen_ms"] = ls or (a_ls or b_ls or 0)
    out["first_seen"] = out.get("first_seen") or a.get("first_seen") or b.get("first_seen") or _now_iso_ms(out["first_seen_ms"])
    out["last_seen"] = _now_iso_ms(out["last_seen_ms"]) if out.get("last_seen_ms") else (out.get("last_seen") or a.get("last_seen") or b.get("last_seen") or "")

    out["count"] = _as_int(a.get("count"), 0) + _as_int(b.get("count"), 0)

    # keep a valid suffix if either has it
    s1 = str(a.get("suffix") or "").strip()
    s2 = str(b.get("suffix") or "").strip()
    if re.fullmatch(r"\d{6}", s1 or ""):
        out["suffix"] = s1
    elif re.fullmatch(r"\d{6}", s2 or ""):
        out["suffix"] = s2
    else:
        out.pop("suffix", None)

    return out

def _merge_userrec(dst: Dict[str, Any], src: Dict[str, Any], fallback_display: str = "") -> Dict[str, Any]:
    if not isinstance(dst, dict):
        dst = {}
    if not isinstance(src, dict):
        src = {}

    out = dict(dst)

    # display: keep existing; else take src; else fallback
    disp = out.get("display")
    if not isinstance(disp, str) or not disp.strip():
        disp2 = src.get("display")
        if isinstance(disp2, str) and disp2.strip():
            out["display"] = _cap_display(disp2)
        else:
            out["display"] = _cap_display(fallback_display) or out.get("display") or ""

    def _merge_ipmap(key: str):
        m1 = out.get(key)
        m2 = src.get(key)
        if not isinstance(m1, dict):
            m1 = {}
        if isinstance(m2, dict):
            for ip, iprec2 in m2.items():
                if not isinstance(ip, str):
                    ip = str(ip)
                iprec1 = m1.get(ip)
                if isinstance(iprec1, dict):
                    m1[ip] = _merge_iprec(iprec1, iprec2 if isinstance(iprec2, dict) else {})
                else:
                    m1[ip] = iprec2 if isinstance(iprec2, dict) else {}
        out[key] = m1

    # merge owners + impostors
    _merge_ipmap("ips")
    _merge_ipmap("impostors")

    # merge seen/counts
    out_fs = _as_int(out.get("first_seen_ms"), 0)
    src_fs = _as_int(src.get("first_seen_ms"), 0)
    out_ls = _as_int(out.get("last_seen_ms"), 0)
    src_ls = _as_int(src.get("last_seen_ms"), 0)

    fs = min([x for x in (out_fs, src_fs) if x > 0], default=0)
    ls = max(out_ls, src_ls)

    out["first_seen_ms"] = fs or (out_fs or src_fs or 0)
    out["last_seen_ms"] = ls or (out_ls or src_ls or 0)

    out["first_seen"] = out.get("first_seen") or src.get("first_seen") or (_now_iso_ms(out["first_seen_ms"]) if out["first_seen_ms"] else "")
    out["last_seen"] = _now_iso_ms(out["last_seen_ms"]) if out["last_seen_ms"] else (out.get("last_seen") or src.get("last_seen") or "")

    out["count_total"] = _as_int(out.get("count_total"), 0) + _as_int(src.get("count_total"), 0)

    # recompute first_ip from *owners only* (ips)
    def _ip_fs(iprec: Any) -> int:
        try:
            return int((iprec or {}).get("first_seen_ms") or 0)
        except Exception:
            return 0

    ips1 = out.get("ips")
    if isinstance(ips1, dict) and ips1:
        first_ip = sorted(ips1.items(), key=lambda kv: (_ip_fs(kv[1]) or 0, kv[0]))[0][0]
        out["first_ip"] = first_ip
        try:
            if isinstance(ips1.get(first_ip), dict):
                ips1[first_ip].pop("suffix", None)
        except Exception:
            pass

    return out

def _read_chat_user_db_locked() -> tuple[Dict[str, Any], bool]:
    """
    Reads CHAT_USER_LOG and returns (db, changed).
    Ensures keys are canonical (case-insensitive) and merges duplicates.
    Call this ONLY while holding CHAT_USER_LOCK file lock and/or _CHAT_USER_ASYNC_LOCK.
    """
    raw = _read_json_dict(CHAT_USER_LOG)
    if not isinstance(raw, dict):
        return {}, False

    out: Dict[str, Any] = {}
    changed = False

    for raw_name, raw_rec in raw.items():
        canon = _canon_username(str(raw_name))
        if not canon:
            changed = True
            continue

        rec = raw_rec if isinstance(raw_rec, dict) else {}
        # ensure display exists somewhere
        if isinstance(rec, dict):
            disp = rec.get("display")
            if not isinstance(disp, str) or not disp.strip():
                rec["display"] = _cap_display(str(raw_name)) or canon

        if canon not in out:
            out[canon] = rec
            if canon != str(raw_name):
                changed = True
        else:
            out[canon] = _merge_userrec(out[canon], rec, fallback_display=_cap_display(str(raw_name)) or canon)
            changed = True

    # if we canonicalized or merged anything, we’ll want to write it back
    return out, changed






MAX_USERNAMES_PER_IP = int(os.getenv("CHAT_MAX_USERNAMES_PER_IP", "5"))

# Windows-safe in-process lock (your fcntl lock is effectively a no-op on Windows)
_CHAT_USER_ASYNC_LOCK = asyncio.Lock()

def _usernames_for_ip_from_db(db: Dict[str, Any], ip: str) -> set[str]:
    """
    Returns canonical username keys (case-insensitive identities) for this IP.
    """
    out: set[str] = set()
    if not ip:
        return out
    for ukey, rec in (db or {}).items():
        if not isinstance(rec, dict):
            continue
        ips = rec.get("ips")
        if isinstance(ips, dict) and ip in ips:
            out.add(str(ukey))
    return out

def _display_names_for_ip_from_db(db: Dict[str, Any], ip: str) -> List[str]:
    """
    Returns display names for this IP (deduped by canonical key).
    """
    out: List[str] = []
    if not ip:
        return out
    for ukey, rec in (db or {}).items():
        if not isinstance(rec, dict):
            continue
        ips = rec.get("ips")
        if not (isinstance(ips, dict) and ip in ips):
            continue
        disp = rec.get("display")
        if not isinstance(disp, str) or not disp.strip():
            disp = str(ukey)
        out.append(_cap_display(disp))
    # dedupe while preserving order
    seen = set()
    uniq = []
    for n in out:
        k = _canon_username(n)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(n)
    return uniq

def _peek_ip_usernames(ip: str) -> set[str]:
    """Read-only: returns canonical username keys already associated with this IP."""
    lockf = _with_lock(CHAT_USER_LOCK)
    try:
        db, changed = _read_chat_user_db_locked()
        if changed:
            _write_json_atomic(CHAT_USER_LOG, db)
        return _usernames_for_ip_from_db(db, ip)
    finally:
        try:
            lockf.close()
        except Exception:
            pass

def _touch_user_identity(username: str, ip: str, now_ms: int) -> tuple[str, str]:
    """
    Case-insensitive username identity:
      - owners live in rec["ips"]
      - impostor usage lives in rec["impostors"] (NOT owned)
      - suffix is stable per ip in whichever bucket it lands in

    Returns (first_ip_for_username, suffix_for_this_ip_or_empty).
    """
    username_in = _cap_display(username)
    ukey = _canon_username(username_in)
    ip = (ip or "").strip() or "unknown"
    ip_l = ip.lower()

    if not ukey:
        ukey = "unknown"

    lockf = _with_lock(CHAT_USER_LOCK)
    try:
        db, changed = _read_chat_user_db_locked()

        rec = db.get(ukey)
        if not isinstance(rec, dict):
            rec = {}

        # keep initial display stable (don’t let casing “rename”)
        disp = rec.get("display")
        if not isinstance(disp, str) or not disp.strip():
            rec["display"] = username_in or ukey

        first_ip = str(rec.get("first_ip") or "").strip()
        first_seen_ms = int(rec.get("first_seen_ms") or 0) or now_ms

        # owners map
        ips = rec.get("ips")
        if not isinstance(ips, dict):
            ips = {}

        # If first_ip missing/unknown, let a real IP claim ownership as first owner
        if (not first_ip) or first_ip.lower() in ("unknown", "0.0.0.0"):
            if ip_l not in ("unknown", "0.0.0.0") and ip:
                first_ip = ip
            else:
                first_ip = first_ip or ip or "unknown"

        # -----------------------------
        # ✅ IMPERSONATION CASE:
        # username already has a first owner (first_ip),
        # and this ip is different -> DO NOT add to rec["ips"].
        # Track under rec["impostors"] instead.
        # -----------------------------
        is_real_ip = ip_l not in ("unknown", "0.0.0.0") and bool(ip)
        has_real_first = (first_ip or "").lower() not in ("", "unknown", "0.0.0.0")

        if has_real_first and is_real_ip and ip != first_ip and ukey in db:
            impostors = rec.get("impostors")
            if not isinstance(impostors, dict):
                impostors = {}

            iprec = impostors.get(ip)
            if not isinstance(iprec, dict):
                iprec = {
                    "first_seen_ms": now_ms,
                    "first_seen": _now_iso_ms(now_ms),
                    "last_seen_ms": now_ms,
                    "last_seen": _now_iso_ms(now_ms),
                    "count": 0,
                }

            iprec["last_seen_ms"] = now_ms
            iprec["last_seen"] = _now_iso_ms(now_ms)
            try:
                iprec["count"] = int(iprec.get("count") or 0) + 1
            except Exception:
                iprec["count"] = 1

            # stable suffix for impostor
            s = str(iprec.get("suffix") or "").strip()
            if not re.fullmatch(r"\d{6}", s or ""):
                s = _rand6()
                iprec["suffix"] = s

            impostors[ip] = iprec
            rec["impostors"] = impostors

            # update summary fields
            rec["first_ip"] = first_ip
            rec["first_seen_ms"] = first_seen_ms
            rec["first_seen"] = rec.get("first_seen") or _now_iso_ms(first_seen_ms)
            rec["last_seen_ms"] = now_ms
            rec["last_seen"] = _now_iso_ms(now_ms)
            rec["ips"] = ips  # unchanged (no ownership granted)

            try:
                rec["count_total"] = int(rec.get("count_total") or 0) + 1
            except Exception:
                rec["count_total"] = 1

            db[ukey] = rec
            _write_json_atomic(CHAT_USER_LOG, db)
            return first_ip, s

        # -----------------------------
        # OWNER CASE (new name OR same first_ip)
        # -----------------------------
        iprec = ips.get(ip)
        if not isinstance(iprec, dict):
            iprec = {
                "first_seen_ms": now_ms,
                "first_seen": _now_iso_ms(now_ms),
                "last_seen_ms": now_ms,
                "last_seen": _now_iso_ms(now_ms),
                "count": 0,
            }

        iprec["last_seen_ms"] = now_ms
        iprec["last_seen"] = _now_iso_ms(now_ms)
        try:
            iprec["count"] = int(iprec.get("count") or 0) + 1
        except Exception:
            iprec["count"] = 1

        suffix = ""
        if ip != first_ip:
            s = str(iprec.get("suffix") or "").strip()
            if not re.fullmatch(r"\d{6}", s or ""):
                s = _rand6()
                iprec["suffix"] = s
            suffix = s
        else:
            iprec.pop("suffix", None)

        ips[ip] = iprec

        rec["first_ip"] = first_ip
        rec["first_seen_ms"] = first_seen_ms
        rec["first_seen"] = rec.get("first_seen") or _now_iso_ms(first_seen_ms)
        rec["last_seen_ms"] = now_ms
        rec["last_seen"] = _now_iso_ms(now_ms)
        rec["ips"] = ips

        try:
            rec["count_total"] = int(rec.get("count_total") or 0) + 1
        except Exception:
            rec["count_total"] = 1

        db[ukey] = rec
        _write_json_atomic(CHAT_USER_LOG, db)

        return first_ip, suffix

    finally:
        try:
            lockf.close()
        except Exception:
            pass



@app.post("/chat/send")
async def chat_send(req: Request, payload: ChatSendIn):
    room = _clamp_room(payload.room)

    author_in = _cap_display(payload.author)
    message_in = (payload.message or "").strip()
    if not author_in:
        raise HTTPException(status_code=400, detail="author required")
    if not message_in:
        raise HTTPException(status_code=400, detail="message required")

    author_key = _canon_username(author_in)
    ip = _get_client_ip(req)
    now_ms = int(time.time() * 1000)

    async with _CHAT_USER_ASYNC_LOCK:
        # If IP already has >= MAX usernames, block NEW username attempts (case-insensitive).
        if ip and ip.lower() not in ("unknown", "0.0.0.0"):
            lockf = _with_lock(CHAT_USER_LOCK)
            try:
                db, changed = _read_chat_user_db_locked()
                if changed:
                    _write_json_atomic(CHAT_USER_LOG, db)

                existing_keys = _usernames_for_ip_from_db(db, ip)
                existing_displays = _display_names_for_ip_from_db(db, ip)

                if (author_key not in existing_keys) and (len(existing_keys) >= MAX_USERNAMES_PER_IP):
                    allowed_list = ", ".join(sorted(existing_displays, key=lambda s: s.casefold())) if existing_displays else "(none)"
                    err_text = (
                        f"Username limit reached for your IP ({len(existing_keys)}/{MAX_USERNAMES_PER_IP}). "
                        f"Please use one of your existing usernames: {allowed_list}"
                    )

                    msg = {
                        "id": now_ms,
                        "ts": now_ms,
                        "room": room,
                        "author": "system",
                        "message": err_text,
                        "local_only": True,
                        "error": "username_limit",
                        "ip": ip,
                        "attempted_author": author_in,
                    }
                    return {"ok": False, "message": msg}
            finally:
                try:
                    lockf.close()
                except Exception:
                    pass

        # Allowed: update user/ip log and compute stable suffix ("" for oldest IP)
        first_ip, suffix = _touch_user_identity(author_in, ip, now_ms)

        author_out = author_in
        if suffix:
            keep = max(1, 40 - len(suffix))
            author_out = author_in[:keep] + suffix

        async with _ROOM_LOCKS[room]:
            last = int(_ROOM_LAST_ID.get(room, 0))
            msg_id = now_ms if now_ms > last else (last + 1)
            _ROOM_LAST_ID[room] = msg_id

            msg = {
                "id": msg_id,
                "ts": now_ms,
                "room": room,
                "author": author_out,
                "message": message_in,

                # internal/debug
                "author_base": author_in,
                "author_key": author_key,
                "ip": ip,
                "first_ip_for_name": first_ip,
                "suffix": suffix,
            }

            _ROOM_CACHE[room].append(msg)

            fp = _room_file(room)
            try:
                with open(fp, "a", encoding="utf-8") as f:
                    f.write(json.dumps(msg, ensure_ascii=False) + "\n")
            except Exception:
                pass

    return {"ok": True, "message": msg}







# ============================================================
# ✅ Per-IP Artist Name endpoints (for dropdown script)
#   GET  /queryUsers   -> returns ["name1","name2",...]
#   POST /deleteUser   -> body: { "username": "name" }
# ============================================================

class DeleteUserIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=40)


@app.get("/queryUsers")
async def query_users(request: Request):
    ip = _get_client_ip(request)
    if (not ip) or ip.lower() in ("unknown", "0.0.0.0"):
        return []

    async with _CHAT_USER_ASYNC_LOCK:
        lockf = _with_lock(CHAT_USER_LOCK)
        try:
            db, changed = _read_chat_user_db_locked()
            if changed:
                _write_json_atomic(CHAT_USER_LOG, db)

            out: List[Tuple[int, str]] = []
            for ukey, rec in (db or {}).items():
                if not isinstance(rec, dict):
                    continue
                ips = rec.get("ips")
                if not isinstance(ips, dict):
                    continue
                iprec = ips.get(ip)
                if not isinstance(iprec, dict):
                    continue

                last_seen_ms = _as_int(iprec.get("last_seen_ms"), 0)
                disp = rec.get("display")
                name = _cap_display(disp) if isinstance(disp, str) and disp.strip() else str(ukey)
                out.append((last_seen_ms, name))

            out.sort(key=lambda x: (x[0], x[1].casefold()), reverse=True)
            # dedupe by canonical
            seen = set()
            res = []
            for _, name in out:
                k = _canon_username(name)
                if k in seen:
                    continue
                seen.add(k)
                res.append(name)
            return res
        finally:
            try:
                lockf.close()
            except Exception:
                pass


@app.post("/deleteUser")
async def delete_user(request: Request, payload: DeleteUserIn):
    ip = _get_client_ip(request)
    if (not ip) or ip.lower() in ("unknown", "0.0.0.0"):
        raise HTTPException(status_code=403, detail="No valid client IP")

    username_in = _cap_display(payload.username)
    if not username_in:
        raise HTTPException(status_code=400, detail="username required")

    ukey = _canon_username(username_in)

    async with _CHAT_USER_ASYNC_LOCK:
        lockf = _with_lock(CHAT_USER_LOCK)
        try:
            db, changed = _read_chat_user_db_locked()
            if changed:
                _write_json_atomic(CHAT_USER_LOG, db)

            rec = db.get(ukey)
            if not isinstance(rec, dict):
                # treat as success (UI already removed it)
                return {"ok": True, "deleted": False, "username": username_in}

            ips = rec.get("ips")
            if not isinstance(ips, dict) or (ip not in ips):
                raise HTTPException(status_code=403, detail="Username not owned by your IP")

            ips.pop(ip, None)

            if not ips:
                db.pop(ukey, None)
            else:
                def _first_seen_ms(v: Any) -> int:
                    try:
                        return int((v or {}).get("first_seen_ms") or 0)
                    except Exception:
                        return 0

                new_first_ip = sorted(ips.items(), key=lambda kv: (_first_seen_ms(kv[1]) or 0, kv[0]))[0][0]
                rec["first_ip"] = new_first_ip

                try:
                    if isinstance(ips.get(new_first_ip), dict):
                        ips[new_first_ip].pop("suffix", None)
                except Exception:
                    pass

                rec["ips"] = ips
                now_ms = int(time.time() * 1000)
                rec["last_seen_ms"] = now_ms
                rec["last_seen"] = _now_iso_ms(now_ms)
                db[ukey] = rec

            _write_json_atomic(CHAT_USER_LOG, db)
            return {"ok": True, "deleted": True, "username": username_in}

        finally:
            try:
                lockf.close()
            except Exception:
                pass






# ============================================================
# ✅ External URL browser endpoint (/getExternal)
#   - Scrapes "index.php / apache style" HTML directory listings
#   - Returns dirs/files under a user-provided base URL
#   - Designed for your new "External URL Browser…" popup
# ============================================================

EXTERNAL_CACHE_SECONDS = int(os.getenv("EXTERNAL_CACHE_SECONDS", "86400"))  # 24h default
EXTERNAL_MAX_ITEMS = int(os.getenv("EXTERNAL_MAX_ITEMS", "5000"))

# Allowed file extensions (comma-separated)
EXTERNAL_ALLOWED_EXTS = set(
    e.strip().lower()
    for e in os.getenv("EXTERNAL_ALLOWED_EXTS", ".mp3,.m4a,.wav,.ogg,.flac,.aac").split(",")
    if e.strip()
)

# SSRF guard (block localhost/private nets unless explicitly allowed)
EXTERNAL_ALLOW_PRIVATE = os.getenv("EXTERNAL_ALLOW_PRIVATE", "0").strip() == "1"

_external_cache: Dict[str, Tuple[float, Dict]] = {}
_external_cache_lock = asyncio.Lock()


class ExternalBrowseIn(BaseModel):
    url: str = Field(..., min_length=3, max_length=2000)
    path: str = Field("", max_length=2000)


def _looks_private_host(host: str) -> bool:
    h = (host or "").strip().lower()
    if not h:
        return True
    if h in ("localhost", "127.0.0.1", "::1"):
        return True
    # common private ranges (IPv4 textual)
    if re.match(r"^(10\.|192\.168\.|169\.254\.|0\.)", h):
        return True
    if re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.", h):
        return True
    # block typical internal-ish hostnames
    if h.endswith(".local") or h.endswith(".internal"):
        return True
    return False


def _normalize_external_base_url(raw: str) -> Tuple[str, str, str]:
    """
    Returns (base_url_with_trailing_slash, base_netloc, base_path_root_with_slash)

    - Forces http/https
    - Drops query/fragment
    - Ensures base path ends with "/"
    - If user pasted a file URL, converts to its directory
    """
    u = (raw or "").strip()
    if not u:
        raise HTTPException(status_code=400, detail="url required")

    # allow user paste without scheme
    if not re.match(r"^https?://", u, re.IGNORECASE):
        u = "https://" + u

    parts = urlsplit(u)
    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http/https URLs are allowed")

    netloc = parts.netloc
    if not netloc:
        raise HTTPException(status_code=400, detail="Invalid URL (missing host)")

    host_only = netloc.split("@")[-1].split(":")[0]  # strip creds/port for checks
    if (not EXTERNAL_ALLOW_PRIVATE) and _looks_private_host(host_only):
        raise HTTPException(status_code=400, detail="Private/localhost targets are blocked (set EXTERNAL_ALLOW_PRIVATE=1 to allow)")

    path = parts.path or "/"

    # If it looks like a file, treat base as its parent dir
    last_seg = path.rstrip("/").split("/")[-1]
    if "." in last_seg:
        path = "/".join(path.rstrip("/").split("/")[:-1]) + "/"

    if not path.endswith("/"):
        path += "/"

    # Rebuild without query/fragment (stabilizes caching + safer)
    base_url = f"{scheme}://{netloc}{path}"
    base_root_path = path  # already ends with "/"
    return base_url, netloc, base_root_path


def _safe_external_rel(rel: str) -> str:
    """
    Safe relative path under the external base. Returns normalized path WITHOUT leading slash.
    Preserves trailing slash if caller provides it (for dirs).
    """
    rel = (rel or "").strip().replace("\\", "/")
    if rel in ("", "."):
        return ""

    # preserve trailing slash intent (dir)
    want_slash = rel.endswith("/")

    rel = rel.lstrip("/")
    drive, _ = os.path.splitdrive(rel)
    if drive:
        raise HTTPException(status_code=400, detail="Invalid path")

    norm = os.path.normpath(rel).replace("\\", "/").lstrip("/")
    if norm == ".." or norm.startswith("../"):
        raise HTTPException(status_code=400, detail="Invalid path")

    if norm == ".":
        norm = ""

    if want_slash and norm and not norm.endswith("/"):
        norm += "/"

    return norm


def _encode_rel_path(rel: str) -> str:
    rel = (rel or "").strip().replace("\\", "/").strip("/")
    if not rel:
        return ""
    return "/".join(quote(seg) for seg in rel.split("/") if seg)


async def _external_browse(base_url: str, rel_path: str) -> Dict:
    """
    base_url: normalized base dir URL ending in "/"
    rel_path: safe rel dir path (may be "" or "Albums/2024/")
    """
    rel_path = _safe_external_rel(rel_path or "")

    cache_key = f"{base_url}||{rel_path}"
    now = time.time()

    async with _external_cache_lock:
        hit = _external_cache.get(cache_key)
        if hit and (now - float(hit[0])) < EXTERNAL_CACHE_SECONDS:
            return hit[1]

    # Build directory listing URL
    listing_url = base_url
    enc = _encode_rel_path(rel_path)
    if enc:
        # ensure directory listing ends with "/"
        listing_url = urljoin(base_url, enc)
        if not listing_url.endswith("/"):
            listing_url += "/"

    base_parts = urlsplit(base_url)
    base_netloc = base_parts.netloc
    base_root_path = (base_parts.path or "/")
    if not base_root_path.endswith("/"):
        base_root_path += "/"

    client = _get_client()
    try:
        r = await client.get(
            listing_url,
            headers={
                "Accept": "text/html,*/*",
                "User-Agent": "ncz-external-browser/1.0",
            },
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"External listing HTTP {r.status_code}")
        html = r.text or ""
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"External listing fetch failed: {e}")

    parser = _LinkParser()
    try:
        parser.feed(html)
    except Exception:
        parser.links = []

    items: List[Dict] = []
    seen = set()

    for href, text in parser.links:
        if not href:
            continue
        if href.startswith("#") or href.startswith("?"):
            continue

        t = (text or "").strip().lower()
        if t in ("parent directory", ".."):
            continue
        if href.startswith("../"):
            continue

        abs_url = urljoin(listing_url, href)
        parts = urlsplit(abs_url)

        # Force same host as base (do not allow jumping)
        if parts.netloc != base_netloc:
            continue

        abs_path = parts.path or ""
        # Must stay under the base root path
        if not abs_path.startswith(base_root_path):
            continue

        is_dir = abs_path.endswith("/")
        abs_path_clean = abs_path.rstrip("/")
        rel_inside = abs_path_clean[len(base_root_path):].lstrip("/")
        rel_inside = unquote(rel_inside)

        # Safe normalize
        try:
            rel_inside_norm = _safe_external_rel(rel_inside + ("/" if is_dir else ""))
        except HTTPException:
            continue

        name = os.path.basename(rel_inside_norm.rstrip("/"))
        if not name:
            continue

        key = ("dir:" if is_dir else "file:") + rel_inside_norm
        if key in seen:
            continue
        seen.add(key)

        if is_dir:
            items.append(
                {
                    "type": "dir",
                    "kind": "dir",
                    "name": name,
                    "path": rel_inside_norm,  # e.g. "Albums/2024/"
                    "mtime": 0,
                }
            )
            continue

        lower = name.lower()
        if not any(lower.endswith(ext) for ext in EXTERNAL_ALLOWED_EXTS):
            continue

        mtime_epoch, size_bytes = _guess_mtime_size_from_html(html, href)

        items.append(
            {
                "type": "file",
                "kind": "file",
                "name": name,
                "path": rel_inside_norm,  # e.g. "Albums/2024/track01.mp3"
                "mtime": int(mtime_epoch or 0),
                "size": int(size_bytes or 0),

                # both keys provided (your popup uses url; your archive UI often uses file)
                "url": abs_url,
                "file": abs_url,
            }
        )

        if len(items) >= EXTERNAL_MAX_ITEMS:
            break

    # dirs first, then newest files (if mtimes parse)
    items.sort(key=lambda x: (0 if x.get("type") == "dir" else 1, -(x.get("mtime") or 0), x.get("name", "")))

    payload = {
        "base": base_url,
        "path": rel_path,
        "exists": True,
        "remote": True,
        "items": items,
    }

    async with _external_cache_lock:
        _external_cache[cache_key] = (time.time(), payload)

    return payload


@app.post("/getExternal")
async def get_external(payload: ExternalBrowseIn):
    base_url, _, _ = _normalize_external_base_url(payload.url)
    rel_path = payload.path or ""
    return JSONResponse(await _external_browse(base_url, rel_path))


























# ============================================================
# ✅ AI Radio (shared random station) /aiRadio
# - Keeps 10-song queue
# - Advances based on real time + mp3 duration
# - Ticks every 5 seconds in background
# ============================================================

AI_RADIO_QUEUE_LEN = int(os.getenv("AI_RADIO_QUEUE_LEN", "10"))
AI_RADIO_TICK_SECONDS = int(os.getenv("AI_RADIO_TICK_SECONDS", "5"))
AI_RADIO_ARCHIVE_REFRESH_SECONDS = int(os.getenv("AI_RADIO_ARCHIVE_REFRESH_SECONDS", "600"))  # 10m
AI_RADIO_REMOTE_PROBE_BYTES = int(os.getenv("AI_RADIO_REMOTE_PROBE_BYTES", "131072"))        # 128KB

_ai_radio_lock = asyncio.Lock()
_ai_radio_queue: Deque[Dict[str, Any]] = deque()
_ai_radio_started_at: float = 0.0  # start time (epoch seconds) of queue[0]
_ai_radio_task: Optional[asyncio.Task] = None

_archive_mp3_cache: List[str] = []     # list of rel paths under ARCHIVE_DIR (posix style)
_archive_mp3_cache_ts: float = 0.0

# Optional fast duration via mutagen if installed
try:
    from mutagen.mp3 import MP3 as _MutagenMP3  # type: ignore
except Exception:
    _MutagenMP3 = None


def _synchsafe_int(b: bytes) -> int:
    # ID3v2 synchsafe 4-byte int
    if len(b) != 4:
        return 0
    return ((b[0] & 0x7F) << 21) | ((b[1] & 0x7F) << 14) | ((b[2] & 0x7F) << 7) | (b[3] & 0x7F)


def _mp3_parse_duration_from_prefix(prefix: bytes, file_size: int) -> float:
    """
    Best-effort MP3 duration from a prefix (first ~128KB) plus total file_size.
    Handles ID3v2, finds first MPEG frame, reads Xing/Info or VBRI if present.
    Falls back to CBR estimate.
    """
    if not prefix or file_size <= 0:
        return 0.0

    data = prefix
    n = len(data)
    i = 0

    # Skip ID3v2 tag if present
    if n >= 10 and data[0:3] == b"ID3":
        tag_size = _synchsafe_int(data[6:10])
        i = 10 + tag_size
        if i > n:
            # prefix too small; can't parse further
            return 0.0

    # Find first frame sync
    def _is_sync_at(pos: int) -> bool:
        if pos + 4 > n:
            return False
        if data[pos] != 0xFF:
            return False
        b1 = data[pos + 1]
        return (b1 & 0xE0) == 0xE0  # 111xxxxx

    # Scan a bit to avoid false positives (within first 256KB max)
    scan_limit = min(n - 4, i + 256000)
    pos = -1
    p = i
    while p < scan_limit:
        if _is_sync_at(p):
            # quick validate header bits aren't "reserved"
            b1 = data[p + 1]
            ver_id = (b1 >> 3) & 0x03
            layer_id = (b1 >> 1) & 0x03
            if ver_id != 0x01 and layer_id != 0x00:
                pos = p
                break
        p += 1

    if pos < 0:
        return 0.0

    h0, h1, h2, h3 = data[pos], data[pos + 1], data[pos + 2], data[pos + 3]
    ver_id = (h1 >> 3) & 0x03
    layer_id = (h1 >> 1) & 0x03
    prot_bit = h1 & 0x01  # 0 => CRC present
    bitrate_idx = (h2 >> 4) & 0x0F
    sr_idx = (h2 >> 2) & 0x03
    pad = (h2 >> 1) & 0x01
    chan_mode = (h3 >> 6) & 0x03  # 3 => mono

    # Version mapping
    # ver_id: 00=2.5, 01=reserved, 10=2, 11=1
    if ver_id == 0x03:
        mpeg_ver = 1
    elif ver_id == 0x02:
        mpeg_ver = 2
    elif ver_id == 0x00:
        mpeg_ver = 25
    else:
        return 0.0

    # Layer mapping
    # layer_id: 01=III, 10=II, 11=I
    if layer_id == 0x01:
        layer = 3
    elif layer_id == 0x02:
        layer = 2
    elif layer_id == 0x03:
        layer = 1
    else:
        return 0.0

    # Sample rate table
    sr_table = {
        1:  [44100, 48000, 32000, 0],
        2:  [22050, 24000, 16000, 0],
        25: [11025, 12000, 8000, 0],
    }
    sr = sr_table.get(mpeg_ver, [0, 0, 0, 0])[sr_idx]
    if sr <= 0:
        return 0.0

    # Bitrate tables (kbps)
    br_table = None
    if layer == 1:
        br_table = {
            1:  [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448,0],
            2:  [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0],
            25: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0],
        }.get(mpeg_ver)
    elif layer == 2:
        br_table = {
            1:  [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,0],
            2:  [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
            25: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
        }.get(mpeg_ver)
    else:  # layer 3
        br_table = {
            1:  [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0],
            2:  [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
            25: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
        }.get(mpeg_ver)

    if not br_table:
        return 0.0

    br_kbps = br_table[bitrate_idx]
    if br_kbps <= 0:
        return 0.0

    br_bps = br_kbps * 1000

    # Samples per frame
    if layer == 1:
        samples_per_frame = 384
    elif layer == 2:
        samples_per_frame = 1152
    else:  # layer 3
        samples_per_frame = 1152 if mpeg_ver == 1 else 576

    # Frame length
    if layer == 1:
        frame_len = int((12 * br_bps / sr + pad) * 4)
    else:
        if layer == 3 and mpeg_ver != 1:
            frame_len = int(72 * br_bps / sr + pad)
        else:
            frame_len = int(144 * br_bps / sr + pad)

    if frame_len <= 0:
        return 0.0

    # Check Xing/Info (VBR) header for Layer III
    crc_len = 2 if prot_bit == 0 else 0
    is_mono = (chan_mode == 0x03)

    dur_from_frames = 0.0

    if layer == 3:
        # side info length
        if mpeg_ver == 1:
            side_info_len = 17 if is_mono else 32
        else:
            side_info_len = 9 if is_mono else 17

        xing_pos = pos + 4 + crc_len + side_info_len
        if xing_pos + 16 <= n:
            tag = data[xing_pos:xing_pos + 4]
            if tag in (b"Xing", b"Info"):
                flags = int.from_bytes(data[xing_pos + 4:xing_pos + 8], "big", signed=False)
                off = xing_pos + 8
                frames = 0
                if (flags & 0x1) and off + 4 <= n:
                    frames = int.from_bytes(data[off:off + 4], "big", signed=False)
                if frames > 0:
                    dur_from_frames = (frames * samples_per_frame) / float(sr)

        # VBRI (also VBR) - typical offset: header+crc+32
        vbri_pos = pos + 4 + crc_len + 32
        if dur_from_frames <= 0.0 and vbri_pos + 26 <= n and data[vbri_pos:vbri_pos + 4] == b"VBRI":
            # frames at offset 14 from VBRI start
            frames = int.from_bytes(data[vbri_pos + 14:vbri_pos + 18], "big", signed=False)
            if frames > 0:
                dur_from_frames = (frames * samples_per_frame) / float(sr)

    if dur_from_frames > 0.0:
        return float(dur_from_frames)

    # CBR fallback:
    # Prefer bitrate estimate (handles tags / minor variations reasonably)
    audio_bytes = max(0, file_size - pos)
    dur = (audio_bytes * 8.0) / float(br_bps) if br_bps > 0 else 0.0
    return float(dur)


def _clamp_duration(d: float) -> float:
    try:
        d = float(d)
    except Exception:
        return 0.0
    if d != d or d <= 0:
        return 0.0
    # clamp to something sane
    if d < 5:
        return 5.0
    if d > 60 * 60 * 6:
        return 60 * 60 * 6.0
    return d


def _mp3_duration_local(path: str) -> float:
    """
    Local mp3 duration, accurate via mutagen if present; else header parsing.
    """
    try:
        if _MutagenMP3 is not None:
            a = _MutagenMP3(path)
            d = float(getattr(a.info, "length", 0.0) or 0.0)
            return _clamp_duration(d)
    except Exception:
        pass

    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            prefix = f.read(262144)  # 256KB
        d = _mp3_parse_duration_from_prefix(prefix, size)
        return _clamp_duration(d)
    except Exception:
        return 0.0


async def _mp3_duration_remote(url: str) -> float:
    """
    Remote mp3 duration: reads first ~128KB (range) + total size from headers if possible.
    """
    url = (url or "").strip()
    if not url:
        return 0.0

    client = _get_client()
    size_total = 0

    # Try a HEAD first (some servers block HEAD; ignore errors)
    try:
        rh = await client.head(url, headers={"User-Agent": "ncz-ai-radio/1.0"})
        if rh.status_code < 400:
            cl = rh.headers.get("content-length")
            if cl:
                try:
                    size_total = int(cl)
                except Exception:
                    size_total = 0
    except Exception:
        pass

    # Range GET (stream) for prefix
    prefix = b""
    try:
        headers = {
            "User-Agent": "ncz-ai-radio/1.0",
            "Range": f"bytes=0-{AI_RADIO_REMOTE_PROBE_BYTES - 1}",
        }
        async with client.stream("GET", url, headers=headers) as r:
            # content-range can contain total size: "bytes 0-123/999999"
            cr = r.headers.get("content-range") or ""
            if "/" in cr:
                try:
                    size_total = max(size_total, int(cr.split("/")[-1].strip()))
                except Exception:
                    pass
            if size_total <= 0:
                cl = r.headers.get("content-length")
                if cl:
                    try:
                        size_total = max(size_total, int(cl))
                    except Exception:
                        pass

            async for chunk in r.aiter_bytes():
                if not chunk:
                    break
                prefix += chunk
                if len(prefix) >= AI_RADIO_REMOTE_PROBE_BYTES:
                    break
    except Exception:
        return 0.0

    d = _mp3_parse_duration_from_prefix(prefix, size_total if size_total > 0 else len(prefix))
    return _clamp_duration(d)


async def _refresh_archive_mp3_cache(force: bool = False) -> None:
    global _archive_mp3_cache, _archive_mp3_cache_ts
    now = time.time()
    if (not force) and (now - _archive_mp3_cache_ts) < AI_RADIO_ARCHIVE_REFRESH_SECONDS:
        return

    base_abs = os.path.abspath(ARCHIVE_DIR)
    if not os.path.isdir(base_abs):
        _archive_mp3_cache = []
        _archive_mp3_cache_ts = now
        return

    mp3s: List[str] = []
    try:
        for root, dirs, files in os.walk(base_abs):
            # skip hidden dirs
            dirs[:] = [d for d in dirs if d and not d.startswith(".")]
            for fn in files:
                if not fn.lower().endswith(".mp3"):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, base_abs).replace("\\", "/")
                # safety: no traversal from relpath anyway, but keep consistent
                if rel.startswith(".."):
                    continue
                mp3s.append(rel)
    except Exception:
        mp3s = []

    _archive_mp3_cache = mp3s
    _archive_mp3_cache_ts = now


async def _pick_generated_song() -> Optional[Dict[str, Any]]:
    await _refresh_song_cache(force=False)
    if not _song_cache:
        return None
    base = secrets.choice(_song_cache)
    fn = base.get("filename") or ""
    if not isinstance(fn, str) or not fn.lower().endswith(".mp3"):
        return None

    full_path = _safe_join_under_audio_dir(fn)
    if not full_path or not os.path.isfile(full_path):
        return None

    dur = _mp3_duration_local(full_path)
    if dur <= 0:
        dur = 180.0

    item = dict(base)
    item["source"] = "generated"
    item["duration"] = float(dur)
    # normalize a nice display name
    item["name"] = (item.get("title") or item.get("filename") or item.get("task_id") or "song")
    return item


async def _pick_archive_song() -> Optional[Dict[str, Any]]:
    await _refresh_archive_mp3_cache(force=False)
    if not _archive_mp3_cache:
        return None

    rel = secrets.choice(_archive_mp3_cache)
    base_abs = os.path.abspath(ARCHIVE_DIR)
    full = _safe_join_under(base_abs, rel)
    if not full or not os.path.isfile(full):
        return None

    dur = _mp3_duration_local(full)
    if dur <= 0:
        dur = 180.0

    name = os.path.basename(rel)
    meta_bits = _archive_extract_meta_for_mp3(full)
    item = {
        "type": "mp3",
        "name": name,
        "path": rel,
        "file": f"/archive/api_audio/{quote(rel)}",
        "size": 0,
        "mtime": 0,

        # UI-ish fields
        "task_id": meta_bits.get("job_id") or os.path.splitext(name)[0],
        "output_index": meta_bits.get("output_index", 0),
        "created_at": meta_bits.get("created_at", ""),
        "label": meta_bits.get("caption", "") or "",
        "prompt": meta_bits.get("caption", "") or "",
        "author": meta_bits.get("author", "") or "",
        "title": meta_bits.get("title", "") or "",
        "metas": meta_bits.get("metas", {}) or {},
    }
    item["source"] = "archive"
    item["duration"] = float(dur)
    return item


def _remote_cache_pick_any_mp3_item() -> Optional[Dict[str, Any]]:
    """
    Pick a random mp3 item from any already-cached remote directory payload.
    This follows your rule: ONLY choose from cached dirs (no forced browse here).
    """
    if not _remote_archive_cache:
        return None

    # collect cache entries that actually have mp3 items
    candidates: List[Dict[str, Any]] = []
    for _, (_, payload) in _remote_archive_cache.items():
        try:
            items = (payload or {}).get("items") or []
            if not isinstance(items, list):
                continue
            mp3s = [it for it in items if isinstance(it, dict) and it.get("type") == "mp3" and it.get("file")]
            if mp3s:
                candidates.append(payload)
        except Exception:
            continue

    if not candidates:
        return None

    payload = secrets.choice(candidates)
    items = payload.get("items") or []
    mp3s = [it for it in items if isinstance(it, dict) and it.get("type") == "mp3" and it.get("file")]
    if not mp3s:
        return None

    return secrets.choice(mp3s)


async def _pick_remote_xt_song() -> Optional[Dict[str, Any]]:
    base = _remote_cache_pick_any_mp3_item()
    if not base:
        return None

    url = str(base.get("file") or "").strip()
    if not url:
        return None

    dur = await _mp3_duration_remote(url)
    if dur <= 0:
        # if duration can't be computed remotely, fall back to 180s
        dur = 180.0

    item = dict(base)
    item["source"] = "xt_remote"
    item["duration"] = float(dur)
    item["name"] = (item.get("title") or item.get("name") or item.get("task_id") or "song")
    return item


async def _pick_random_song_3ways() -> Optional[Dict[str, Any]]:
    """
    Your rule: choose randomly between the 3 sources first, then pick a random song within.
    If the chosen source is empty, retry.
    """
    for _ in range(12):
        mode = secrets.randbelow(3)
        if mode == 0:
            s = await _pick_generated_song()
        elif mode == 1:
            s = await _pick_archive_song()
        else:
            s = await _pick_remote_xt_song()
        if s:
            return s

    # hard fallback order
    s = await _pick_generated_song()
    if s:
        return s
    s = await _pick_archive_song()
    if s:
        return s
    s = await _pick_remote_xt_song()
    return s


def _song_key(item: Dict[str, Any]) -> str:
    # de-dupe key in queue
    src = str(item.get("source") or "")
    f = str(item.get("file") or item.get("url") or "")
    p = str(item.get("path") or "")
    n = str(item.get("name") or "")
    return f"{src}||{f}||{p}||{n}"


async def _ai_radio_fill_queue_locked(target_len: int) -> None:
    """
    Fill queue up to target_len. Caller must hold _ai_radio_lock.
    """
    seen = set(_song_key(x) for x in _ai_radio_queue if isinstance(x, dict))
    attempts = 0
    while len(_ai_radio_queue) < target_len and attempts < target_len * 6:
        attempts += 1
        s = await _pick_random_song_3ways()
        if not s:
            break
        k = _song_key(s)
        if k in seen:
            continue
        seen.add(k)
        s["queued_at"] = float(time.time())
        _ai_radio_queue.append(s)


async def _ai_radio_advance_locked(now: float) -> None:
    """
    Advance now_playing based on started_at + duration.
    Caller must hold _ai_radio_lock.
    """
    global _ai_radio_started_at

    if not _ai_radio_queue:
        _ai_radio_started_at = 0.0
        return

    if _ai_radio_started_at <= 0.0:
        _ai_radio_started_at = float(now)

    # advance as many as needed (no drift: move start to previous_end)
    guard = 0
    while _ai_radio_queue and guard < 100:
        guard += 1
        cur = _ai_radio_queue[0]
        dur = 0.0
        try:
            dur = float(cur.get("duration") or 0.0)
        except Exception:
            dur = 0.0
        dur = _clamp_duration(dur) if dur > 0 else 180.0

        end_at = _ai_radio_started_at + dur
        if now < end_at:
            break

        # song ended: pop and set next start to exact end time
        _ai_radio_queue.popleft()
        _ai_radio_started_at = float(end_at)

    # if we ran out, reset start time to now
    if not _ai_radio_queue:
        _ai_radio_started_at = 0.0


async def _ai_radio_tick(ensure_full: bool = True) -> None:
    """
    Single tick: ensure queue exists, advance if needed, and keep queue topped up.
    """
    now = float(time.time())
    async with _ai_radio_lock:
        # ensure at least one item exists
        if not _ai_radio_queue:
            await _ai_radio_fill_queue_locked(max(1, AI_RADIO_QUEUE_LEN))
            if _ai_radio_queue and _ai_radio_started_at <= 0.0:
                _ai_radio_started_at = now

        # advance if needed
        await _ai_radio_advance_locked(now)

        # top up
        if ensure_full and len(_ai_radio_queue) < AI_RADIO_QUEUE_LEN:
            await _ai_radio_fill_queue_locked(AI_RADIO_QUEUE_LEN)


async def _ai_radio_loop():
    while True:
        try:
            await _ai_radio_tick(ensure_full=True)
        except Exception:
            pass
        await asyncio.sleep(AI_RADIO_TICK_SECONDS)


@app.get("/aiRadio")
async def ai_radio():
    # Quick tick so callers always get a correct, advanced now_playing
    await _ai_radio_tick(ensure_full=False)

    async with _ai_radio_lock:
        if not _ai_radio_queue:
            return JSONResponse({"ok": False, "detail": "No songs available for aiRadio"})

        cur = dict(_ai_radio_queue[0])
        started_at = float(_ai_radio_started_at or 0.0)
        now = float(time.time())

        dur = 0.0
        try:
            dur = float(cur.get("duration") or 0.0)
        except Exception:
            dur = 0.0
        dur = _clamp_duration(dur) if dur > 0 else 180.0

        elapsed = max(0.0, now - started_at) if started_at > 0 else 0.0
        remaining = max(0.0, dur - elapsed)

        # attach timing for client sync
        cur["started_at"] = started_at
        cur["server_time"] = now
        cur["elapsed"] = elapsed
        cur["remaining"] = remaining

        return JSONResponse(
            {
                "now_playing": cur,
                "queue_len": len(_ai_radio_queue),
            }
        )





















# ============================================================
# ✅ EVE Chat Bot (background)
# - Every ~30s: respond to messages that start with "!eve"
# - If no !eve replies for 5m: recap last 5m of chat (latest-active room)
# - Every 30m: recap last 30m of chat (latest-active room), even if !eve happened
#
# Uses your existing xtdevelopment Gemini proxy format:
#   POST https://xtdevelopment.net/chat-proxy/chat-proxy.php
#   { action:"chat", provider:"gemini", model:"gemini-2.5-flash", messages:[...] }
#   expects JSON { reply: "..." }
# ============================================================

EVE_ENABLED = os.getenv("EVE_ENABLED", "1").strip() == "1"
EVE_POLL_SECONDS = int(os.getenv("EVE_POLL_SECONDS", "30"))

EVE_RECAP_5M_SECONDS = int(os.getenv("EVE_RECAP_5M_SECONDS", "300"))
EVE_RECAP_30M_SECONDS = int(os.getenv("EVE_RECAP_30M_SECONDS", "1800"))

EVE_CHAT_PROXY_URL = os.getenv(
    "NCZ_CHAT_PROXY_URL",
    "https://xtdevelopment.net/chat-proxy/chat-proxy.php"
).strip()

EVE_PROVIDER = "gemini"
EVE_MODEL = os.getenv("EVE_MODEL", "gemini-2.5-flash").strip()

EVE_AUTHOR = os.getenv("EVE_AUTHOR", "eve").strip() or "eve"
EVE_MAX_REPLIES_PER_TICK = int(os.getenv("EVE_MAX_REPLIES_PER_TICK", "6"))

# Keep prompts configurable
EVE_SYSTEM_PROMPT = os.getenv(
    "EVE_SYSTEM_PROMPT",
    (
        "You are eve, the MEQUAVIS AI avatar in a public chat.\n"
        "Voice: sharp, playful, clever, helpful. No corporate tone.\n"
        "Keep replies concise (aim < 900 chars) unless asked for detail.\n"
        "Stay in-universe with MEQUAVIS/NCZ lore when it fits, but don't derail.\n"
        "If someone asks for code, be precise and practical.\n"
        "Don't repeat the user's entire message back.\n"
    )
)

EVE_STATE_PATH = os.getenv("EVE_STATE_PATH", os.path.join(CHAT_DIR, "eve_state.json"))

_eve_task: Optional[asyncio.Task] = None
_eve_state_lock = asyncio.Lock()
_eve_state: Dict[str, Any] = {
    "last_seen_id": {str(r): 0 for r in range(1, CHAT_ROOMS + 1)},
    "last_eve_cmd_reply_ts": 0,   # epoch seconds
    "last_5m_recap_ts": 0,        # epoch seconds
    "last_30m_recap_ts": 0,       # epoch seconds
}


def _load_eve_state() -> None:
    global _eve_state
    try:
        d = _read_json_dict(EVE_STATE_PATH)
        if isinstance(d, dict):
            # merge with defaults
            merged = dict(_eve_state)
            merged.update(d)

            # normalize last_seen_id map
            lsi = merged.get("last_seen_id")
            if not isinstance(lsi, dict):
                lsi = {}
            for r in range(1, CHAT_ROOMS + 1):
                k = str(r)
                try:
                    lsi[k] = int(lsi.get(k, 0) or 0)
                except Exception:
                    lsi[k] = 0
            merged["last_seen_id"] = lsi

            for k in ("last_eve_cmd_reply_ts", "last_5m_recap_ts", "last_30m_recap_ts"):
                try:
                    merged[k] = int(float(merged.get(k, 0) or 0))
                except Exception:
                    merged[k] = 0

            _eve_state = merged
    except Exception:
        pass


def _save_eve_state() -> None:
    try:
        _write_json_atomic(EVE_STATE_PATH, _eve_state)
    except Exception:
        pass


def _now_s() -> int:
    return int(time.time())


def _fmt_ts_ms(ts_ms: Any) -> str:
    try:
        return datetime.fromtimestamp(int(ts_ms) / 1000.0).strftime("%H:%M:%S")
    except Exception:
        return ""


async def _append_chat_message_internal(room: int, author: str, message: str) -> Dict[str, Any]:
    """
    Append directly to room cache + jsonl file (no request/ip/suffixing).
    This is your "server just sends it out as if someone chatted" path.
    """
    room = _clamp_room(room)
    author = _cap_display(author) or "anon"
    message = (message or "").strip()
    if not message:
        return {}

    now_ms = int(time.time() * 1000)

    async with _ROOM_LOCKS[room]:
        last = int(_ROOM_LAST_ID.get(room, 0))
        msg_id = now_ms if now_ms > last else (last + 1)
        _ROOM_LAST_ID[room] = msg_id

        msg = {
            "id": msg_id,
            "ts": now_ms,
            "room": room,
            "author": author,
            "message": message,

            # internal marker (optional)
            "bot": True,
            "bot_name": author,
        }

        _ROOM_CACHE[room].append(msg)

        fp = _room_file(room)
        try:
            with open(fp, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        except Exception:
            pass

    return msg


async def _eve_call_gemini(user_text: str) -> str:
    """
    Calls your xtdevelopment chat proxy with Gemini Flash 2.5.
    Expects { reply: "..." } back.
    """
    user_text = (user_text or "").strip()
    if not user_text:
        return ""

    payload = {
        "action": "chat",
        "provider": EVE_PROVIDER,
        "model": EVE_MODEL,
        "session_id": None,
        "userapikey": "",
        "messages": [
            {"role": "system", "content": EVE_SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
    }

    client = _get_client()
    r = await client.post(
        EVE_CHAT_PROXY_URL,
        json=payload,
        headers={"Content-Type": "application/json"},
    )
    if r.status_code >= 400:
        raise RuntimeError(f"eve proxy HTTP {r.status_code}: {r.text[:300]}")

    data = r.json()
    reply = ""
    if isinstance(data, dict):
        reply = data.get("reply") if isinstance(data.get("reply"), str) else ""
        # tolerate other shapes, just in case
        if not reply and isinstance(data.get("data"), dict):
            v = data["data"].get("reply")
            reply = v if isinstance(v, str) else ""
    return (reply or "").strip()


def _is_eve_command(msg_text: str) -> bool:
    s = (msg_text or "").lstrip()
    return s.lower().startswith("!eve")


def _eve_command_query(msg_text: str) -> str:
    s = (msg_text or "").lstrip()
    # remove leading "!eve"
    rest = s[4:].lstrip()
    return rest if rest else "Talk to me. What do you see in the MEQUAVIS right now?"


async def _eve_tick_handle_commands() -> int:
    """
    Scan new messages (since last_seen_id) across all rooms.
    Reply to any message starting with !eve.
    Returns number of !eve replies produced.
    """
    replies_made = 0
    new_last_seen: Dict[str, int] = {}
    work_items: List[Tuple[int, Dict[str, Any]]] = []

    # Snapshot new messages per room
    async with _eve_state_lock:
        last_seen_map = dict((_eve_state.get("last_seen_id") or {}))

    for room in range(1, CHAT_ROOMS + 1):
        after_id = int(last_seen_map.get(str(room), 0) or 0)

        async with _ROOM_LOCKS[room]:
            msgs = list(_ROOM_CACHE[room])

        # gather new msgs
        new_msgs = [m for m in msgs if int(m.get("id", 0) or 0) > after_id]
        if new_msgs:
            max_id = max(int(m.get("id", 0) or 0) for m in new_msgs)
            new_last_seen[str(room)] = max_id
            for m in new_msgs:
                work_items.append((room, m))
        else:
            new_last_seen[str(room)] = after_id

    # Persist updated last_seen_id (so we don't double-react)
    async with _eve_state_lock:
        _eve_state["last_seen_id"] = new_last_seen
        _save_eve_state()

    # Process commands (bounded per tick)
    for room, m in work_items:
        if replies_made >= EVE_MAX_REPLIES_PER_TICK:
            break

        author = str(m.get("author") or "").strip()
        if not author:
            continue

        # don't respond to self/system bots
        if author.casefold() in (EVE_AUTHOR.casefold(), "system"):
            continue

        text = str(m.get("message") or "").strip()
        if not _is_eve_command(text):
            continue

        query = _eve_command_query(text)

        try:
            reply = await _eve_call_gemini(query)
        except Exception as e:
            reply = f"(proxy hiccup: {e})"

        if reply:
            # Light mention
            out = f"@{author} {reply}"
            await _append_chat_message_internal(room, EVE_AUTHOR, out)

            replies_made += 1
            async with _eve_state_lock:
                _eve_state["last_eve_cmd_reply_ts"] = _now_s()
                _save_eve_state()

    return replies_made


def _build_transcript_for_window(room: int, window_seconds: int, max_chars: int = 12000) -> str:
    """
    Build a compact transcript from in-memory cache for one room.
    """
    room = _clamp_room(room)
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - int(window_seconds * 1000)

    msgs = list(_ROOM_CACHE[room])
    # only last window, exclude eve lines
    lines: List[str] = []
    for m in msgs:
        ts = int(m.get("ts", 0) or 0)
        if ts < cutoff_ms:
            continue
        author = str(m.get("author") or "").strip()
        if not author:
            continue
        if author.casefold() == EVE_AUTHOR.casefold():
            continue

        text = str(m.get("message") or "").strip()
        if not text:
            continue

        lines.append(f"[{_fmt_ts_ms(ts)}] {author}: {text}")

    if not lines:
        return ""

    # trim from the front if too long
    out = "\n".join(lines)
    if len(out) <= max_chars:
        return out

    # keep last lines until fits
    tail: List[str] = []
    total = 0
    for line in reversed(lines):
        add = len(line) + 1
        if total + add > max_chars:
            break
        tail.append(line)
        total += add
    tail.reverse()
    return "\n".join(tail)


def _pick_latest_active_room(window_seconds: int) -> Optional[int]:
    """
    Choose the room with the most recent message in the window (excluding eve).
    """
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - int(window_seconds * 1000)

    best_room = None
    best_ts = -1

    for room in range(1, CHAT_ROOMS + 1):
        msgs = list(_ROOM_CACHE[room])
        for m in reversed(msgs):
            ts = int(m.get("ts", 0) or 0)
            if ts < cutoff_ms:
                break
            author = str(m.get("author") or "").strip()
            if author.casefold() == EVE_AUTHOR.casefold():
                continue
            if ts > best_ts:
                best_ts = ts
                best_room = room
                break

    return best_room


async def _eve_send_recap(window_seconds: int, label: str) -> bool:
    """
    Make ONE recap post in the most recently active room.
    """
    room = _pick_latest_active_room(window_seconds)
    if not room:
        return False

    transcript = _build_transcript_for_window(room, window_seconds)
    if not transcript.strip():
        return False

    user_prompt = (
        f"This is the last {label} of chat from room {room}.\n"
        "Summarize what happened, then drop ONE clever/witty eve response to the room.\n"
        "Be concise. Don't list every line. Don't mention 'as an AI'.\n\n"
        "CHAT TRANSCRIPT:\n"
        f"{transcript}"
    )

    try:
        reply = await _eve_call_gemini(user_prompt)
    except Exception as e:
        reply = f"(recap proxy hiccup: {e})"

    reply = (reply or "").strip()
    if not reply:
        return False

    await _append_chat_message_internal(room, EVE_AUTHOR, reply)
    return True


async def _eve_loop():
    """
    Background loop:
      - every tick: handle !eve commands
      - every 5m (if no !eve replies): recap last 5m
      - every 30m (always): recap last 30m
    """
    if not EVE_ENABLED:
        return

    # load persisted state once
    async with _eve_state_lock:
        _load_eve_state()

    # small startup delay so caches mount
    await asyncio.sleep(1.0)

    while True:
        try:
            now = _now_s()

            # 1) react to !eve
            eve_replies = await _eve_tick_handle_commands()

            # 2) every 30 minutes: recap regardless
            do_30m = False
            async with _eve_state_lock:
                last30 = int(_eve_state.get("last_30m_recap_ts") or 0)
                if now - last30 >= EVE_RECAP_30M_SECONDS:
                    do_30m = True

            if do_30m:
                ok = await _eve_send_recap(EVE_RECAP_30M_SECONDS, "30 minutes")
                async with _eve_state_lock:
                    _eve_state["last_30m_recap_ts"] = now
                    # also bump 5m recap timer so it doesn't immediately fire after 30m recap
                    if ok:
                        _eve_state["last_5m_recap_ts"] = now
                    _save_eve_state()

            # 3) every 5 minutes if eve hasn't answered !eve in that span
            do_5m = False
            async with _eve_state_lock:
                last_cmd = int(_eve_state.get("last_eve_cmd_reply_ts") or 0)
                last5 = int(_eve_state.get("last_5m_recap_ts") or 0)

                # only recap if:
                # - no !eve replies for 5m
                # - we haven't already done a 5m recap recently
                if (now - last_cmd >= EVE_RECAP_5M_SECONDS) and (now - last5 >= EVE_RECAP_5M_SECONDS):
                    do_5m = True

            if do_5m:
                ok = await _eve_send_recap(EVE_RECAP_5M_SECONDS, "5 minutes")
                async with _eve_state_lock:
                    _eve_state["last_5m_recap_ts"] = now if ok else (int(_eve_state.get("last_5m_recap_ts") or 0))
                    _save_eve_state()

        except asyncio.CancelledError:
            return
        except Exception:
            # never crash the server for eve
            pass

        await asyncio.sleep(max(5, EVE_POLL_SECONDS))


# ============================================================
# ✅ Hook it into startup/shutdown
# Add these small edits in your existing startup/shutdown handlers.
# ============================================================

# In _startup(), after other tasks:
#   global _eve_task
#   if EVE_ENABLED:
#       _eve_task = asyncio.create_task(_eve_loop())

# In _shutdown(), cancel it:
#   global _eve_task
#   if _eve_task:
#       _eve_task.cancel()
#       _eve_task = None






















# ============================================================
# ✅ Suno Playlist endpoint (/sunoPlaylist and /ace/sunoPlaylist)
# - Accepts: { url } OR { playlist_url } OR { playlist } (URL or raw playlist UUID)
# - Walks pages: GET https://studio-api.prod.suno.com/api/playlist/<id>/?page=N
# - Stops when playlist_clips is empty
# - Returns:
#     { ok, playlist_id, pages, count, items:[...], playlist_clips:[...], playlist_meta:{...} }
#
# Paste this ABOVE your catch-all proxy route.
# ============================================================

SUNO_STUDIO_API = os.getenv("SUNO_STUDIO_API", "https://studio-api.prod.suno.com").rstrip("/")
SUNO_MAX_PAGES_DEFAULT = int(os.getenv("SUNO_MAX_PAGES", "200"))
SUNO_MAX_ITEMS_DEFAULT = int(os.getenv("SUNO_MAX_ITEMS", "8000"))

_PLAYLIST_ID_RX = re.compile(r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")

class SunoPlaylistIn(BaseModel):
    # your client sends multiple keys; accept them all
    url: Optional[str] = Field(None, max_length=2000)
    playlist_url: Optional[str] = Field(None, max_length=2000)
    playlist: Optional[str] = Field(None, max_length=2000)

    # optional: if you ever need private playlists, you can pass Suno cookie here
    cookie: Optional[str] = Field(None, max_length=8000)

    # safety bounds
    max_pages: Optional[int] = Field(None, ge=1, le=500)
    max_items: Optional[int] = Field(None, ge=1, le=20000)

def _extract_suno_playlist_id(s: str) -> str:
    s = (s or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="Missing playlist URL/ID")

    # raw UUID
    if _PLAYLIST_ID_RX.fullmatch(s):
        return s

    # try pull UUID from URL text
    m = _PLAYLIST_ID_RX.search(s)
    if m:
        return m.group(1)

    raise HTTPException(status_code=400, detail="Could not find playlist UUID in input")

async def _fetch_suno_playlist_page(playlist_id: str, page: int, cookie: Optional[str]) -> Dict[str, Any]:
    client = _get_client()
    url = f"{SUNO_STUDIO_API}/api/playlist/{playlist_id}/"

    headers = {
        "Accept": "application/json",
        "User-Agent": "ncz-suno-playlist/1.0",
        "Referer": "https://suno.com/",
        "Origin": "https://suno.com",
    }
    if cookie:
        # DO NOT store this; only used for this request
        headers["Cookie"] = cookie

    r = await client.get(url, params={"page": page}, headers=headers)
    if r.status_code == 403:
        raise HTTPException(status_code=403, detail="Forbidden by Suno (playlist may be private)")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Suno studio API HTTP {r.status_code}")

    try:
        data = r.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Suno studio API returned non-JSON")

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Suno studio API returned unexpected payload")

    return data










def _flatten_playlist_clips(raw_playlist_clips: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def _pick_str(*vals) -> str:
        for v in vals:
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""

    def _pick_dict(*vals) -> Dict[str, Any]:
        for v in vals:
            if isinstance(v, dict):
                return v
        return {}

    items: List[Dict[str, Any]] = []
    for row in raw_playlist_clips:
        if not isinstance(row, dict):
            continue

        clip = row.get("clip") if isinstance(row.get("clip"), dict) else row
        user = _pick_dict(clip.get("user"), clip.get("creator"), row.get("user"), row.get("creator"))

        cid = _pick_str(clip.get("id"), clip.get("uuid"), clip.get("clip_id"), clip.get("song_id"))
        title = _pick_str(clip.get("title"), clip.get("name"), clip.get("caption"))

        handle = _pick_str(
            clip.get("handle"),
            clip.get("user_handle"),
            user.get("handle"),
            user.get("username"),
            user.get("name"),
            clip.get("display_name"),        # ✅ add this
            user.get("display_name"),        # ✅ and this
        )
        author = handle

        audio_url = _pick_str(
            clip.get("audio_url"), clip.get("audioUrl"), clip.get("audio"),
            clip.get("file"), clip.get("url")
        )

        video_url = _pick_str(
            clip.get("video_url"), clip.get("videoUrl"), clip.get("video")
        )

        image_large_url = _pick_str(
            clip.get("image_large_url"), clip.get("imageLargeUrl"),
            clip.get("image_url"), clip.get("imageUrl"),
            user.get("image_large_url"), user.get("imageLargeUrl"),
            user.get("image_url"), user.get("imageUrl"),
        )

        items.append({
            "id": cid,
            "title": title,
            "author": author,
            "handle": handle,
            "audio_url": audio_url,
            "video_url": video_url,
            "image_large_url": image_large_url,
            # keep these if you still want raw stuff around:
            "clip": clip,
            "playlist_row": row,
        })

    return items

async def _walk_suno_playlist(playlist_id: str, cookie: Optional[str], max_pages: int, max_items: int) -> Dict[str, Any]:
    all_rows: List[Dict[str, Any]] = []
    playlist_meta: Dict[str, Any] = {}

    for page in range(1, max_pages + 1):
        data = await _fetch_suno_playlist_page(playlist_id, page, cookie)
        if page == 1:
            pm = data.get("playlist")
            if isinstance(pm, dict):
                playlist_meta = pm

        rows = data.get("playlist_clips") or []
        if not isinstance(rows, list) or len(rows) == 0:
            return {
                "playlist_id": playlist_id,
                "pages": page - 1,
                "playlist_meta": playlist_meta,
                "playlist_clips": all_rows,
                "items": _flatten_playlist_clips(all_rows),
                "count": len(all_rows),
            }

        for r0 in rows:
            if isinstance(r0, dict):
                all_rows.append(r0)
                if len(all_rows) >= max_items:
                    return {
                        "playlist_id": playlist_id,
                        "pages": page,
                        "playlist_meta": playlist_meta,
                        "playlist_clips": all_rows,
                        "items": _flatten_playlist_clips(all_rows),
                        "count": len(all_rows),
                        "truncated": True,
                        "truncated_reason": f"Reached max_items={max_items}",
                    }

        # tiny yield to be polite (and keep event loop responsive)
        await asyncio.sleep(0.05)

    return {
        "playlist_id": playlist_id,
        "pages": max_pages,
        "playlist_meta": playlist_meta,
        "playlist_clips": all_rows,
        "items": _flatten_playlist_clips(all_rows),
        "count": len(all_rows),
        "truncated": True,
        "truncated_reason": f"Reached max_pages={max_pages}",
    }


# --- Suno playlist cache (TTL) ---
SUNO_PL_CACHE_SECONDS = int(os.getenv("SUNO_PL_CACHE_SECONDS", "600"))  # 10 minutes
_suno_pl_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_suno_pl_cache_lock = asyncio.Lock()

def _suno_pl_cache_key(playlist_id: str, cookie: Optional[str]) -> str:
    # Do NOT include raw cookie; just a boolean so private/public caches don't mix.
    return f"{playlist_id}||cookie={'1' if cookie else '0'}"

async def _suno_pl_cache_get(key: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    async with _suno_pl_cache_lock:
        hit = _suno_pl_cache.get(key)
        if not hit:
            return None
        ts, val = hit
        if (now - float(ts)) > SUNO_PL_CACHE_SECONDS:
            _suno_pl_cache.pop(key, None)
            return None
        return val

async def _suno_pl_cache_set(key: str, val: Dict[str, Any]) -> None:
    async with _suno_pl_cache_lock:
        _suno_pl_cache[key] = (time.time(), val)




def _suno_items_to_master_songs(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    songs = []
    for it in (items or []):
        if not isinstance(it, dict):
            continue
        u = (it.get("id") or it.get("uuid") or "").strip()
        if not u:
            continue
        handle = (it.get("handle") or it.get("author") or "").strip() or None
        songs.append({
            "uuid": u.lower(),
            "title": (it.get("title") or "").strip() or None,
            "artist": handle,              # matches your master convention
            "handle": handle,
            "audio_url": (it.get("audio_url") or "").strip() or None,
            "video_url": (it.get("video_url") or "").strip() or None,
            "image_large_url": (it.get("image_large_url") or "").strip() or None,
        })
    return songs




async def _suno_playlist_handler(payload: SunoPlaylistIn):
    raw = (payload.url or payload.playlist_url or payload.playlist or "").strip()
    playlist_id = _extract_suno_playlist_id(raw)

    max_pages = int(payload.max_pages or SUNO_MAX_PAGES_DEFAULT)
    max_items = int(payload.max_items or SUNO_MAX_ITEMS_DEFAULT)
    cookie = (payload.cookie or "").strip() or None

    cache_key = _suno_pl_cache_key(playlist_id, cookie)

    def _wrap_result(data: Dict[str, Any], cached_flag: bool) -> JSONResponse:
        playlist_meta = data.get("playlist_meta") if isinstance(data, dict) else {}
        if not isinstance(playlist_meta, dict):
            playlist_meta = {}

        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            # fallback if older cached shape
            rows = (data.get("playlist_clips") or []) if isinstance(data, dict) else []
            items = _flatten_playlist_clips(rows if isinstance(rows, list) else [])

        # ✅ build same output shape as /suno/all
        songs = _suno_items_to_master_songs(items)
        uuids = [s["uuid"] for s in songs if isinstance(s, dict) and s.get("uuid")]

        title = (
            (playlist_meta.get("title") or "").strip()
            or (playlist_meta.get("name") or "").strip()
            or f"Suno Playlist {playlist_id}"
        )

        return JSONResponse({
            "ok": True,
            "cached": cached_flag,
            "result": {
                "title": title,
                "songs": songs,     # ✅ master-ish shape
                "items": [          # ✅ browser-friendly shape
                    {
                        "id": it.get("id") or "",
                        "title": it.get("title") or "",
                        "author": it.get("handle") or it.get("author") or "",
                        "handle": it.get("handle") or it.get("author") or "",
                        "audio_url": it.get("audio_url") or "",
                        "video_url": it.get("video_url") or "",
                        "image_large_url": it.get("image_large_url") or "",
                    }
                    for it in (items or [])
                    if isinstance(it, dict)
                ],
                "uuids": uuids,
                "count": len(uuids),
                "ts": time.time(),
            },

            # OPTIONAL: keep these if you still want them for debugging
            "playlist_id": playlist_id,
            "pages": int(data.get("pages") or 0) if isinstance(data, dict) else 0,
        })

    cached = await _suno_pl_cache_get(cache_key)
    if cached:
        try:
            await _suno_all_upsert_many((cached.get("items") or []) if isinstance(cached, dict) else [])
        except Exception:
            pass
        return _wrap_result(cached, True)

    data = await _walk_suno_playlist(playlist_id, cookie, max_pages=max_pages, max_items=max_items)

    try:
        await _suno_all_upsert_many((data.get("items") or []) if isinstance(data, dict) else [])
    except Exception:
        pass

    await _suno_pl_cache_set(cache_key, data)
    return _wrap_result(data, False)



@app.post("/sunoPlaylist")
async def suno_playlist(payload: SunoPlaylistIn):
    return await _suno_playlist_handler(payload)

# ✅ also support the /ace prefix path your front-end sometimes uses
@app.post("/ace/sunoPlaylist")
async def suno_playlist_ace(payload: SunoPlaylistIn):
    return await _suno_playlist_handler(payload)




































# ============================================================
# ✅ NCZ PATCH: Producer.ai worker job queue + WAIT-for-result endpoint
# - Tampermonkey worker polls:    GET  /nextJob
# - Tampermonkey worker reports:  POST /report   { url, uuids, title?, ts?, meta? }
# - YOU call and WAIT:            POST /playlist { url, timeout_s?, force? }
#   -> server queues job + blocks until /report arrives, then returns result in SAME response
# - Optional helpers:
#     POST /queueJob  (non-blocking queue)
#     GET  /playlist  (cache viewer)   /playlist/latest
#     WS   /ws        (optional job pull: {"type":"get_job"})
#
# PASTE THIS WHOLE BLOCK ABOVE YOUR CATCH-ALL PROXY ROUTE.
# ============================================================

from pathlib import Path
import json, os

# -------------------------
# master "all Producer.json"
# -------------------------
_PRODUCER_ALL_FILE = Path("all Producer.json")  # exact name, space included
_producer_all_lock = asyncio.Lock()
_producer_all_loaded = False
_producer_all: Dict[str, Dict[str, Any]] = {}  # uuid -> {uuid,title,artist}

def _clean_str(v: Any) -> Optional[str]:
    s = (str(v).strip() if v is not None else "")
    return s if s else None

def _read_json_file(path: Path) -> Dict[str, Any]:
    try:
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}

def _atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(str(tmp), str(path))

async def _producer_all_load_if_needed() -> None:
    global _producer_all_loaded

    if _producer_all_loaded:
        return

    # load outside lock (avoid holding lock during disk IO)
    data = await asyncio.to_thread(_read_json_file, _PRODUCER_ALL_FILE)

    async with _producer_all_lock:
        if _producer_all_loaded:
            return

        songs = data.get("songs") if isinstance(data, dict) else None
        if isinstance(songs, list):
            for s in songs:
                if not isinstance(s, dict):
                    continue
                u = _clean_str(s.get("uuid"))
                if not u:
                    continue
                u = u.lower()
                # keep ONLY the 3 fields
                _producer_all[u] = {
                    "uuid": u,
                    "title": _clean_str(s.get("title")),
                    "artist": _clean_str(s.get("artist")),
                }

        _producer_all_loaded = True

async def _producer_all_upsert_many(songs_out: List[Dict[str, Any]]) -> int:
    """
    Merge songs into master list (unique by uuid).
    - Never adds extra fields.
    - Only overwrites title/artist if incoming value is non-empty.
    - Writes the master file only if something changed.
    """
    await _producer_all_load_if_needed()

    changed = False
    snapshot = None

    async with _producer_all_lock:
        for s in (songs_out or []):
            if not isinstance(s, dict):
                continue

            u = _clean_str(s.get("uuid"))
            if not u:
                continue
            u = u.lower()

            title = _clean_str(s.get("title"))
            artist = _clean_str(s.get("artist"))

            cur = _producer_all.get(u)
            if not cur:
                _producer_all[u] = {"uuid": u, "title": title, "artist": artist}
                changed = True
                continue

            # update only if we got something non-empty
            if title and title != cur.get("title"):
                cur["title"] = title
                changed = True
            if artist and artist != cur.get("artist"):
                cur["artist"] = artist
                changed = True

        if changed:
            snapshot = {"songs": list(_producer_all.values())}

    if snapshot is not None:
        await asyncio.to_thread(_atomic_write_json, _PRODUCER_ALL_FILE, snapshot)

    async with _producer_all_lock:
        return len(_producer_all)











# -------------------------
# master "all Suno.json"
# -------------------------
_SUNO_ALL_FILE = Path("all Suno.json")  # exact name, space included
_suno_all_lock = asyncio.Lock()
_suno_all_loaded = False
_suno_all: Dict[str, Dict[str, Any]] = {}  # uuid -> {uuid,title,artist}

async def _suno_all_load_if_needed() -> None:
    global _suno_all_loaded
    if _suno_all_loaded:
        return

    data = await asyncio.to_thread(_read_json_file, _SUNO_ALL_FILE)

    async with _suno_all_lock:
        if _suno_all_loaded:
            return

        songs = data.get("songs") if isinstance(data, dict) else None
        if isinstance(songs, list):
            for s in songs:
                if not isinstance(s, dict):
                    continue
                u = _clean_str(s.get("uuid"))
                if not u:
                    continue
                u = u.lower()

                _suno_all[u] = {
                    "uuid": u,
                    "title": _clean_str(s.get("title")),
                    "artist": _clean_str(s.get("artist") or s.get("handle")),
                    "handle": _clean_str(s.get("handle") or s.get("artist")),
                    "audio_url": _clean_str(s.get("audio_url")),
                    "video_url": _clean_str(s.get("video_url")),
                    "image_large_url": _clean_str(s.get("image_large_url")),
                }

        _suno_all_loaded = True


async def _suno_all_upsert_many(items: List[Dict[str, Any]]) -> int:
    """
    items: from _flatten_playlist_clips()
      { id, title, author, handle, audio_url, video_url, image_large_url, ... }

    Master stores ONLY:
      { uuid, title, artist/handle, audio_url, video_url, image_large_url }
    """
    await _suno_all_load_if_needed()

    changed = False
    snapshot = None

    async with _suno_all_lock:
        for it in (items or []):
            if not isinstance(it, dict):
                continue

            u = _clean_str(it.get("id") or it.get("uuid") or it.get("clip_id") or it.get("song_id"))
            if not u:
                continue
            u = u.lower()

            title = _clean_str(it.get("title") or it.get("name"))
            handle = _clean_str(it.get("handle"))
            artist = _clean_str(handle or it.get("author") or it.get("artist") or it.get("user") or it.get("username"))

            audio_url = _clean_str(it.get("audio_url") or it.get("audioUrl") or it.get("audio") or it.get("file") or it.get("url"))
            video_url = _clean_str(it.get("video_url") or it.get("videoUrl") or it.get("video"))
            image_large_url = _clean_str(it.get("image_large_url") or it.get("imageLargeUrl") or it.get("image_url") or it.get("imageUrl"))

            cur = _suno_all.get(u)
            if not cur:
                _suno_all[u] = {
                    "uuid": u,
                    "title": title,
                    "artist": artist,
                    "handle": handle or artist,
                    "audio_url": audio_url,
                    "video_url": video_url,
                    "image_large_url": image_large_url,
                }
                changed = True
                continue

            # overwrite only when incoming is non-empty
            if title and title != cur.get("title"):
                cur["title"] = title; changed = True
            if artist and artist != cur.get("artist"):
                cur["artist"] = artist; changed = True
            if handle and handle != cur.get("handle"):
                cur["handle"] = handle; changed = True
            if audio_url and audio_url != cur.get("audio_url"):
                cur["audio_url"] = audio_url; changed = True
            if video_url and video_url != cur.get("video_url"):
                cur["video_url"] = video_url; changed = True
            if image_large_url and image_large_url != cur.get("image_large_url"):
                cur["image_large_url"] = image_large_url; changed = True

        if changed:
            snapshot = {"songs": list(_suno_all.values())}

    if snapshot is not None:
        await asyncio.to_thread(_atomic_write_json, _SUNO_ALL_FILE, snapshot)

    async with _suno_all_lock:
        return len(_suno_all)









# -------------------------
# in-memory state
# -------------------------
_PRODUCER_UUID_RX = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b"
)

_producer_jobs = deque()                 # deque[str] of urls
_producer_jobs_lock = asyncio.Lock()

# keyed by stable key (uuid if present, else normalized url)
_producer_results: Dict[str, Dict[str, Any]] = {}
_producer_results_lock = asyncio.Lock()
_producer_latest: Dict[str, Any] = {"ts": 0.0, "key": None}

# waiters: key -> list of futures
_producer_waits: Dict[str, List[asyncio.Future]] = {}
_producer_waits_lock = asyncio.Lock()


def _producer_key(url: str) -> str:
    """
    Stable correlation key:
      - if URL contains a UUID -> use that (survives query/hash/route differences)
      - else -> normalized URL (trim whitespace + trailing slash)
    """
    u = (url or "").strip()
    m = _PRODUCER_UUID_RX.search(u)
    if m:
        return f"uuid:{m.group(0).lower()}"
    # fallback: normalize a bit
    if u.endswith("/") and len(u) > len("https://x/"):
        u = u.rstrip("/")
    return f"url:{u}"


async def _producer_push_job(url: str) -> int:
    async with _producer_jobs_lock:
        _producer_jobs.append((url or "").strip())
        return len(_producer_jobs)


async def _producer_pop_job() -> Optional[str]:
    async with _producer_jobs_lock:
        return _producer_jobs.popleft() if _producer_jobs else None


async def _producer_wake_waiters(key: str, payload: Dict[str, Any]) -> None:
    async with _producer_waits_lock:
        waiters = _producer_waits.pop(key, [])
    for fut in waiters:
        if not fut.done():
            fut.set_result(payload)


# -------------------------
# models
# -------------------------
class ProducerJobIn(BaseModel):
    url: str = Field(..., description="Producer.ai playlist URL to open")


class ProducerReportIn(BaseModel):
    url: str
    uuids: List[str] = Field(default_factory=list)
    title: Optional[str] = None
    ts: Optional[float] = None
    meta: Optional[Dict[str, Any]] = None


class ProducerPlaylistWaitIn(BaseModel):
    url: str
    timeout_s: float = 90.0
    force: bool = True  # True: always queue a fresh job; False: return cached if available

class ProducerSong(BaseModel):
    uuid: str
    title: Optional[str] = None
    artist: Optional[str] = None


class ProducerReportIn(BaseModel):
    url: str
    uuids: List[str] = Field(default_factory=list)

    # ✅ NEW: full song objects from the worker
    songs: List[ProducerSong] = Field(default_factory=list)

    title: Optional[str] = None
    ts: Optional[float] = None
    meta: Optional[Dict[str, Any]] = None


# -------------------------
# endpoints
# -------------------------



@app.get("/jobs")
async def producer_jobs():
    async with _producer_jobs_lock:
        return {"queue_len": len(_producer_jobs), "queue": list(_producer_jobs)}


@app.post("/queueJob")
async def producer_queue_job(job: ProducerJobIn):
    url = (job.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    qlen = await _producer_push_job(url)
    return {"ok": True, "queued": url, "queue_len": qlen}


@app.get("/nextJob")
async def producer_next_job():
    """
    Tampermonkey worker polls this.
    Returns:
      {"type":"job","url":"..."}  OR  {"type":"no_job"}
    """
    url = await _producer_pop_job()
    if not url:
        return {"type": "no_job"}
    return {"type": "job", "url": url}


@app.post("/report")
async def producer_report(report: ProducerReportIn):
    """
    Tampermonkey posts scraped song data here.
    Wakes any POST /playlist waiters waiting on this key.
    """
    raw_url = (report.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="url required")

    key = _producer_key(raw_url)
    ts = float(report.ts or time.time())

    def _clean(s: Any) -> Optional[str]:
        s = (str(s).strip() if s is not None else "")
        return s if s else None

    # --------
    # ✅ normalize songs [{uuid,title,artist}] in-order, de-duped by uuid
    # --------
    songs_out: List[Dict[str, Any]] = []
    seen_song = set()

    for s in (report.songs or []):
        u = _clean(getattr(s, "uuid", None))
        if not u:
            continue
        u = u.lower()

        # ensure it looks like a uuid
        if not _PRODUCER_UUID_RX.fullmatch(u):
            continue

        if u in seen_song:
            continue
        seen_song.add(u)

        songs_out.append({
            "uuid": u,
            "title": _clean(getattr(s, "title", None)),
            "artist": _clean(getattr(s, "artist", None)),
        })

    # --------
    # normalize uuids too (append any extras worker sent that weren't in songs)
    # keep ORDER: songs first, then any extra uuids
    # --------
    uuids_in = []
    for u in (report.uuids or []):
        if isinstance(u, str):
            u2 = u.strip().lower()
            if u2 and _PRODUCER_UUID_RX.fullmatch(u2):
                uuids_in.append(u2)

    uuids_out: List[str] = []
    seen_uuid = set()

    for u in [x["uuid"] for x in songs_out] + uuids_in:
        if u and u not in seen_uuid:
            seen_uuid.add(u)
            uuids_out.append(u)

    # If worker didn't send songs, synthesize songs from uuids (title/artist null)
    if not songs_out and uuids_out:
        songs_out = [{"uuid": u, "title": None, "artist": None} for u in uuids_out]

    # ✅ NEW: update master file
    await _producer_all_upsert_many(songs_out)

    payload = {
        "key": key,
        "reported_url": raw_url,     # location.href from browser
        "title": report.title,       # page title (optional)
        "uuids": uuids_out,
        "songs": songs_out,          # ✅ THIS is what your UI will use
        "count": len(uuids_out),
        "ts": ts,
        "meta": report.meta or {},
    }

    async with _producer_results_lock:
        _producer_results[key] = payload
        if ts >= float(_producer_latest.get("ts", 0.0)):
            _producer_latest["ts"] = ts
            _producer_latest["key"] = key

    await _producer_wake_waiters(key, payload)
    return {"ok": True, "stored_for": key, "count": payload["count"]}


@app.post("/playlist")
async def producer_playlist_wait(req: ProducerPlaylistWaitIn):
    """
    YOU call this:
      POST /playlist { url, timeout_s?, force? }
    Server queues job and waits until worker reports it, then returns the payload.
    """
    in_url = (req.url or "").strip()
    if not in_url:
        raise HTTPException(status_code=400, detail="url required")

    key = _producer_key(in_url)

    # If force==False and cached exists, return immediately
    if not req.force:
        async with _producer_results_lock:
            if key in _producer_results:
                return {"ok": True, "cached": True, "result": _producer_results[key]}

    # register a waiter
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()

    async with _producer_waits_lock:
        _producer_waits.setdefault(key, []).append(fut)

    # queue job for the worker
    await _producer_push_job(in_url)

    try:
        result = await asyncio.wait_for(fut, timeout=float(req.timeout_s))
        return {"ok": True, "cached": False, "result": result}
    except asyncio.TimeoutError:
        # cleanup waiter so we don't leak futures
        async with _producer_waits_lock:
            lst = _producer_waits.get(key, [])
            if fut in lst:
                lst.remove(fut)
            if not lst:
                _producer_waits.pop(key, None)
        raise HTTPException(status_code=504, detail=f"Timed out waiting for worker report ({req.timeout_s}s)")


@app.get("/playlist")
async def producer_playlist_cache(url: Optional[str] = Query(default=None)):
    """
    Optional cache viewer:
      GET /playlist            -> all cached results
      GET /playlist?url=...    -> cached result for that playlist url (by uuid/url key)
    """
    async with _producer_results_lock:
        if url:
            key = _producer_key(url)
            if key not in _producer_results:
                raise HTTPException(status_code=404, detail="No results for that url yet.")
            return _producer_results[key]
        return {"count": len(_producer_results), "latest": _producer_latest, "results": list(_producer_results.values())}


@app.get("/playlist/latest")
async def producer_playlist_latest():
    async with _producer_results_lock:
        key = _producer_latest.get("key")
        if not key or key not in _producer_results:
            raise HTTPException(status_code=404, detail="No results yet.")
        return _producer_results[key]


@app.get("/producer/all")
async def producer_all_master():
    await _producer_all_load_if_needed()
    async with _producer_all_lock:
        songs = list(_producer_all.values())
        uuids = [s["uuid"] for s in songs]

    return {
        "ok": True,
        "cached": True,
        "result": {
            "title": "All Producer",
            "songs": songs,     # ✅ each is ONLY {uuid,title,artist}
            "uuids": uuids,
            "count": len(uuids),
            "ts": time.time(),
        }
    }


@app.get("/suno/all")
async def suno_all_master():
    await _suno_all_load_if_needed()
    async with _suno_all_lock:
        songs = list(_suno_all.values())
        uuids = [s["uuid"] for s in songs]

        # ✅ items[] shape matches your browser expectations
        items = []
        for s in songs:
            items.append({
                "id": s.get("uuid"),
                "title": s.get("title") or "",
                "author": s.get("handle") or s.get("artist") or "",
                "handle": s.get("handle") or s.get("artist") or "",
                "audio_url": s.get("audio_url") or "",
                "video_url": s.get("video_url") or "",
                "image_large_url": s.get("image_large_url") or "",
            })

    return {
        "ok": True,
        "cached": True,
        "result": {
            "title": "All Suno",
            "songs": songs,   # ✅ master record (uuid/title/artist/handle/audio_url/video_url/image_large_url)
            "items": items,   # ✅ browser-friendly list
            "uuids": uuids,
            "count": len(uuids),
            "ts": time.time(),
        }
    }


@app.get("/ace/suno/all")
async def suno_all_master_ace():
    return await suno_all_master()



# -------------------------
# optional WebSocket job pull
# -------------------------
@app.websocket("/ws")
async def producer_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_json()
            mtype = (msg or {}).get("type")

            if mtype in ("get_job", "next", "job"):
                url = await _producer_pop_job()
                if not url:
                    await ws.send_json({"type": "no_job"})
                else:
                    await ws.send_json({"type": "job", "url": url})

            elif mtype == "ping":
                await ws.send_json({"type": "pong", "t": time.time()})

            else:
                await ws.send_json({"type": "error", "error": "unknown_message_type", "got": msg})

    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass

































# ============================================================
# Catch-all proxy to upstream (MUST BE LAST)
# ============================================================
@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(full_path: str, request: Request):
    if full_path in ("", "index.html"):
        return FileResponse(INDEX_PATH)

    upstream_url = f"{UPSTREAM}/{full_path}"
    params = dict(request.query_params)

    body = await request.body()
    headers = _filtered_headers(request.headers.items())

    client = _get_client()

    try:
        req = client.build_request(
            request.method,
            upstream_url,
            params=params,
            content=body if body else None,
            headers=headers,
        )

        resp = await client.send(req, stream=True)
        resp_headers = _filtered_headers(resp.headers.items())
        media_type = resp.headers.get("content-type")

        if request.method == "HEAD":
            await resp.aclose()
            return Response(status_code=resp.status_code, headers=resp_headers)

        async def streamer():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            except (httpx.StreamClosed, RuntimeError):
                return
            finally:
                try:
                    await resp.aclose()
                except Exception:
                    pass

        return StreamingResponse(
            streamer(),
            status_code=resp.status_code,
            headers=resp_headers,
            media_type=media_type,
        )

    except httpx.RequestError as e:
        return Response(content=f"Upstream request error: {e}", status_code=502)
