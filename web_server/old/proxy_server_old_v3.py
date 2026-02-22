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
