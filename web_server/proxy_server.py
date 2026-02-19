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

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
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
    global _http_client, _song_refresh_task
    _http_client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)
    await _refresh_song_cache(force=True)
    _song_refresh_task = asyncio.create_task(_song_refresh_loop())


@app.on_event("shutdown")
async def _shutdown():
    global _http_client, _song_refresh_task
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


@app.post("/chat/send")
async def chat_send(req: Request, payload: ChatSendIn):
    room = _clamp_room(payload.room)

    author = (payload.author or "").strip()[:40]
    message = (payload.message or "").strip()
    if not author:
        raise HTTPException(status_code=400, detail="author required")
    if not message:
        raise HTTPException(status_code=400, detail="message required")

    ip = getattr(req.client, "host", "") or ""
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
            "ip": ip,
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
