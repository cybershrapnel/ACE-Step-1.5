import os
import asyncio
import time
import json
from datetime import datetime
from typing import Iterable, Tuple, List, Dict, Optional
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles





UPSTREAM = os.getenv("ACESTEP_UPSTREAM", "http://127.0.0.1:8001").rstrip("/")
WEB_DIR = os.getenv("WEB_DIR", ".")
INDEX_PATH = os.path.join(WEB_DIR, "index.html")

# Local audio directory to scan/serve (your "new songs" list)
AUDIO_DIR = os.getenv(
    "ACESTEP_API_AUDIO_DIR",
    os.path.abspath(os.path.join(os.getcwd(), ".cache", "acestep", "tmp", "api_audio")),
)

# ✅ Archive folder (same directory as this server script)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.getenv("ACESTEP_ARCHIVE_DIR", os.path.join(SCRIPT_DIR, "archive"))

# Refresh song list every 5 minutes
SONG_REFRESH_SECONDS = int(os.getenv("SONG_REFRESH_SECONDS", "300"))

TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=300.0, pool=10.0)
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
static_path = os.path.join(WEB_DIR, "static")
if os.path.isdir(static_path):
    app.mount("/static", StaticFiles(directory=static_path), name="static")

client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)

# ---------------------------
# Song list cache (in-memory)
# ---------------------------
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
      - item.label OR item.prompt  -> used for display label (else shows "Song")
      - item.task_id               -> shown as "task XXXXX"
      - item.output_index          -> shown as "output N"
      - item.created_at            -> shown as the date line (string)

    Adds:
      - item.author, item.title    -> from JSON (preferred) so it persists across reloads
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

                # ✅ AUTHOR + TITLE (persist across reloads via /songs JSON)
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

            # job_id as visible id => put it where UI uses it: task_id
            visible_id = job_id or audio_id

            created_at_str = _fmt_created_at(created_at_epoch) if created_at_epoch is not None else ""
            sort_epoch = created_at_epoch if created_at_epoch is not None else fs_mtime

            # UI shows label/prompt; keep it as caption/style (your existing behavior)
            style_text = caption or ""

            out.append(
                {
                    # UI fields
                    "task_id": visible_id,
                    "output_index": audio_index,
                    "created_at": created_at_str,
                    "label": style_text,
                    "prompt": style_text,

                    # file fields
                    "filename": fn,
                    "file": f"/api_audio/{quote(fn)}",
                    "mtime": int(sort_epoch),

                    # ✅ new persisted metadata
                    "author": author,
                    "title": title,
                    "metas": metas,   # full metas for your popup

                    # extras
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


@app.on_event("startup")
async def _startup():
    global _song_refresh_task
    await _refresh_song_cache(force=True)
    _song_refresh_task = asyncio.create_task(_song_refresh_loop())


@app.on_event("shutdown")
async def _shutdown():
    global _song_refresh_task
    if _song_refresh_task:
        _song_refresh_task.cancel()
        _song_refresh_task = None
    await client.aclose()


# ---------------------------
# Proxy helpers
# ---------------------------
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


# ---------------------------
# Web + Song list endpoints
# ---------------------------
@app.get("/")
async def root():
    return FileResponse(INDEX_PATH)


@app.get("/index.html")
async def index_html():
    return FileResponse(INDEX_PATH)


@app.get("/favicon.ico")
async def favicon():
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


# ---------------------------
# ✅ Archive endpoints (DO NOT PROXY THESE)
# ---------------------------
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


def _archive_browse(rel_path: str) -> Dict:
    base_abs = os.path.abspath(ARCHIVE_DIR)
    if not os.path.isdir(base_abs):
        return {"base": base_abs, "path": rel_path or "", "exists": False, "items": []}

    full_dir = _safe_join_under(base_abs, rel_path or "")
    if not full_dir or not os.path.isdir(full_dir):
        raise HTTPException(status_code=404, detail="Archive path not found")

    items = []
    try:
        with os.scandir(full_dir) as it:
            for entry in it:
                name = entry.name
                # skip dotfiles
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
                    items.append(
                        {
                            "type": "dir",
                            "name": name,
                            "path": rel_item,
                            "mtime": mtime,
                        }
                    )
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
                        # ignore other file types by default
                        continue
    except OSError:
        raise HTTPException(status_code=500, detail="Archive browse failed")

    # dirs first, then newest files
    items.sort(key=lambda x: (0 if x["type"] == "dir" else 1, -(x.get("mtime") or 0), x.get("name", "")))

    return {"base": base_abs, "path": (rel_path or ""), "exists": True, "items": items}


@app.get("/archive/browse")
async def archive_browse(path: str = ""):
    return JSONResponse(_archive_browse(path))


@app.get("/archive/browse/{subpath:path}")
async def archive_browse_sub(subpath: str):
    return JSONResponse(_archive_browse(subpath))


@app.get("/archive/api_audio/{rel_path:path}")
async def archive_api_audio(rel_path: str):
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




# ---- ARCHIVE BASE (same directory as this server file) ----
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.abspath(os.path.join(SERVER_DIR, "archive"))

def _safe_join_under_archive(rel_path: str) -> Optional[str]:
    rel = (rel_path or "").lstrip("/").replace("\\", "/")
    full = os.path.abspath(os.path.join(ARCHIVE_DIR, rel))
    # allow exactly ARCHIVE_DIR or anything under it
    if full != ARCHIVE_DIR and not full.startswith(ARCHIVE_DIR + os.sep):
        return None
    return full


@app.get("/archive/api_audio/{rel_path:path}")
async def archive_api_audio(rel_path: str):
    full = _safe_join_under_archive(rel_path)
    if not full:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not full.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Not an mp3")
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="Not found")

    # Serve it
    return FileResponse(full, media_type="audio/mpeg", filename=os.path.basename(full))


@app.get("/archive/meta/{rel_path:path}")
async def archive_meta(rel_path: str):
    full = _safe_join_under_archive(rel_path)
    if not full:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not full.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Not a json")
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="Not found")

    meta = _load_json(full) or {}
    return JSONResponse(meta)


import os
import json
import time
from fastapi import Request
from fastapi.responses import JSONResponse

# Optional file lock (Linux): prevents race conditions on concurrent requests
try:
    import fcntl  # type: ignore
except Exception:
    fcntl = None

# ---- config ----
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_ONLINE_LOG = os.getenv(
    "USERS_ONLINE_LOG",
    os.path.join(SCRIPT_DIR, "users_online_ips.json")
)
USERS_ONLINE_LOCK = USERS_ONLINE_LOG + ".lock"

WINDOW_MINUTES = 90
WINDOW_SECONDS = WINDOW_MINUTES * 60


def _get_client_ip(request: Request) -> str:
    """
    Best-effort real IP:
    - X-Forwarded-For (first IP)
    - X-Real-IP
    - CF-Connecting-IP
    - request.client.host
    """
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
    # Atomic-ish write: write to temp then replace
    d = os.path.dirname(path) or "."
    if not os.path.isdir(d):
        os.makedirs(d)

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, separators=(",", ":"))
    try:
        os.replace(tmp, path)
    except Exception:
        # last resort
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, separators=(",", ":"))
        try:
            os.remove(tmp)
        except Exception:
            pass


def _with_lock(lock_path: str):
    """
    Cross-request lock using a lockfile.
    Works best on Linux with fcntl.
    """
    lf = open(lock_path, "a+", encoding="utf-8")
    if fcntl:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
    return lf


# ---- add this route to your FastAPI app ----
@app.get("/users_online")
async def users_online(request: Request):
    now = time.time()
    ip = _get_client_ip(request)
    cutoff = now - WINDOW_SECONDS

    # lock during read-modify-write so concurrent hits don't clobber each other
    lockf = _with_lock(USERS_ONLINE_LOCK)
    try:
        state = _read_state(USERS_ONLINE_LOG)

        # update existing or add new
        state[ip] = now

        # keep only "recent" users
        state = {k: v for (k, v) in state.items() if v >= cutoff}

        _write_state_atomic(USERS_ONLINE_LOG, state)

        count = len(state)
    finally:
        try:
            lockf.close()
        except Exception:
            pass

    # Return JSON; JS below accepts either {"online":N} or just N
    return JSONResponse({"online": count, "window_minutes": WINDOW_MINUTES})



# ---------------------------
# Catch-all proxy to upstream
# ---------------------------
@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(full_path: str, request: Request):
    if full_path in ("", "index.html"):
        return FileResponse(INDEX_PATH)

    upstream_url = f"{UPSTREAM}/{full_path}"
    params = dict(request.query_params)

    body = await request.body()
    headers = _filtered_headers(request.headers.items())

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



