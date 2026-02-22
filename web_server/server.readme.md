```md
# server.py — NCZ / MEQUAVIS FastAPI Hub (UI + Proxy + Songs + Browsers + Chat + Radio)

This `server.py` is the **one “front door”** your browser talks to.

It does **two** jobs at the same time:

1) **Front-end host:** serves your `index.html` + `/static/*` so the client loads from one origin.  
2) **Back-end gateway:** exposes NCZ-specific endpoints (songs, archive, Suno/Producer, external browse, chat, AI radio, eve) and **proxies everything else** to the upstream ACE-Step API server.

That “single origin” design is the reason your patches work cleanly: the UI can call **`/release_task`** (and everything else) without CORS drama, and your special endpoints live alongside the upstream API.

---

## Architecture (how it talks to both sides)

```

Browser (UI + patches)
|
|  GET /            -> server.py serves index.html
|  GET /static/*    -> server.py serves static assets
|
|  GET/POST /songs, /archive/*, /sunoPlaylist, /playlist, /chat/*, /aiRadio, ...
|       -> handled directly by server.py
|
|  ANYTHING ELSE (ex: /release_task, /health, /whatever ACE-Step exposes)
|       -> catch-all proxy forwards to ACE-Step upstream
|
server.py  <-------------------------------------->  ACE-Step API server (UPSTREAM)
(httpx streaming proxy, header filtering)

````

### Key idea
- The **client always talks to `server.py`**.
- If the route is a “NCZ endpoint”, `server.py` responds directly.
- If it’s not recognized, `server.py` **streams the request/response** to/from ACE-Step (`UPSTREAM`).

This is exactly how the “Advanced Source Audio” patch works:
- Your patch forces `/release_task` to multipart + `src_audio`.
- The browser POST hits **`server.py`**.
- `server.py` forwards it to **ACE-Step** unchanged (streaming).
- ACE-Step does the real work; response streams back.

---

## Run it

```bash
uvicorn server:app --host 0.0.0.0 --port 8080
````

Defaults:

* UI served from `WEB_DIR` (default `.`)
* ACE-Step upstream at `http://127.0.0.1:8001` unless overridden

---

## Configuration (env vars)

### Core

* `ACESTEP_UPSTREAM`
  Upstream ACE-Step base URL (default `http://127.0.0.1:8001`)
* `WEB_DIR`
  Folder containing `index.html` and optionally `static/` (default `.`)
* `ACESTEP_API_AUDIO_DIR`
  Local “generated songs” folder (default `./.cache/acestep/tmp/api_audio`)
* `ACESTEP_ARCHIVE_DIR`
  Local archive root (default `./archive` next to server.py)
* `SONG_REFRESH_SECONDS`
  `/songs` cache refresh interval (default `300`)

### Users online

* `USERS_ONLINE_LOG`
  JSON file path used by `/users_online` (default `users_online_ips.json` next to server.py)

### Chat

* `ACESTEP_CHAT_DIR`
  JSONL storage for chat rooms (default `./.cache/acestep/chat`)
* `CHAT_MAX_USERNAMES_PER_IP`
  Anti-spam username cap per IP (default `5`)

### External URL browser

* `EXTERNAL_CACHE_SECONDS` (default `86400`)
* `EXTERNAL_MAX_ITEMS` (default `5000`)
* `EXTERNAL_ALLOWED_EXTS` (default `.mp3,.m4a,.wav,.ogg,.flac,.aac`)
* `EXTERNAL_ALLOW_PRIVATE` (default `0`)
  SSRF guard: blocks localhost/private nets unless set to `1`

### AI Radio

* `AI_RADIO_QUEUE_LEN` (default `10`)
* `AI_RADIO_TICK_SECONDS` (default `5`)
* `AI_RADIO_ARCHIVE_REFRESH_SECONDS` (default `600`)
* `AI_RADIO_REMOTE_PROBE_BYTES` (default `131072`)

### eve bot

* `EVE_ENABLED` (default `1`)
* `EVE_POLL_SECONDS` (default `30`)
* `EVE_RECAP_5M_SECONDS` (default `300`)
* `EVE_RECAP_30M_SECONDS` (default `1800`)
* `NCZ_CHAT_PROXY_URL` (default `https://xtdevelopment.net/chat-proxy/chat-proxy.php`)
* `EVE_MODEL` (default `gemini-2.5-flash`)
* `EVE_AUTHOR` (default `eve`)
* `EVE_MAX_REPLIES_PER_TICK` (default `6`)
* `EVE_SYSTEM_PROMPT` (built-in default if unset)
* `EVE_STATE_PATH` (default `{CHAT_DIR}/eve_state.json`)

### Suno playlist fetch

* `SUNO_STUDIO_API` (default `https://studio-api.prod.suno.com`)
* `SUNO_MAX_PAGES` (default `200`)
* `SUNO_MAX_ITEMS` (default `8000`)
* `SUNO_PL_CACHE_SECONDS` (default `600`)

---

## What this server provides (feature map)

### 1) UI hosting

* `GET /` and `GET /index.html` serve `INDEX_PATH = {WEB_DIR}/index.html`
* `GET /static/*` serves static assets from:

  1. `{WEB_DIR}/static` if it exists
  2. `./static` beside `server.py` if it exists
  3. `./static` fallback if present

### 2) Generated songs (“new songs” list)

This is the local folder your ACE-Step outputs end up in (`AUDIO_DIR`).

* `GET /songs`
  Returns cached list of generated MP3s with metadata extracted from matching JSONs.
* `GET /api_audio/{filename}`
  Serves MP3 bytes directly from `AUDIO_DIR` (safe filename only).

**Why it matters to the client:**
Your SongList UI expects each song item to include keys like:

* `file` (playback URL)
* `label` / `prompt` (display)
* `task_id`, `output_index`, `created_at`
* plus `author`, `title`, `metas` for your metadata UI

This server builds that shape from:

* `{audio_id}.mp3`
* `{audio_id}.json` (and/or JSON that references the mp3 in `audio_path`)

### 3) Archive browser (local + remote alias)

Your archive UI uses this to browse *older* content.

* `GET /archive/browse` (or `/archive/browse/{subpath}`)

It supports **two “trees”**:

#### A) Local archive tree

Under `ARCHIVE_DIR` on disk:

* directories are returned as `{type:"dir"}`
* mp3s are returned as `{type:"mp3", file:"/archive/api_audio/<relpath>" }`
* JSON sidecars next to mp3s are read to populate `author/title/metas/caption`

#### B) Remote alias folder: `__xt_music__`

At archive root only, it injects a directory entry:

* `XT Music (xtdevelopment.net)` with `path="__xt_music__"`

Browsing inside `__xt_music__`:

* server scrapes directory listings at:
  `https://xtdevelopment.net/music/mp3s/`

* mp3 items come back with:

  * `file` = **absolute URL** to the real remote mp3
    (so playback streams from xtdevelopment.net directly, not via proxy)

* `GET /archive/api_audio/{rel_path}`
  Serves *local archive files only* (mp3/json) from `ARCHIVE_DIR` with safe path joining.
  Remote alias items never use this endpoint.

### 4) External URL Browser (scraped remote directory listings)

This powers your “External URL Browser” overlay.

* `POST /getExternal`
  Body:

  ```json
  { "url": "https://example.com/music/", "path": "Albums/2024/" }
  ```

Behavior:

* Normalizes base URL (forces http/https, strips query/fragment, ensures trailing slash)
* Enforces SSRF guard (blocks private/localhost unless `EXTERNAL_ALLOW_PRIVATE=1`)
* Scrapes directory listing HTML and returns:

  * directories (`type:"dir"`)
  * files (`type:"file"`) with `url` and `file` as absolute URLs
* Caches results (TTL `EXTERNAL_CACHE_SECONDS`)

This endpoint is intentionally shaped to match your overlay expectations: it returns `items[]` with `name`, `path`, `file/url`, `mtime`, `size`.

### 5) Users Online

* `GET /users_online`

Tracks “unique IPs seen in the last 90 minutes” and returns:

```json
{ "online": 12, "window_minutes": 90 }
```

Notes:

* Uses `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip` if present.
* Persists a compact IP->timestamp JSON file with an OS lock when possible.

### 6) Chat (rooms + JSONL persistence + anti-impersonation)

The chat system is **built into the same server** so your UI and patches don’t need a second service.

#### Read messages

* `GET /chat/messages?room=1&after_id=0&limit=80`

#### Send message

* `POST /chat/send`

  ```json
  { "room": 1, "author": "NanoCheeZe", "message": "hello" }
  ```

Storage:

* Each room is a JSONL file: `{CHAT_DIR}/room_{n}.jsonl`
* In-memory cache per room (deque max 500) for fast polling.

Anti-impersonation & username rules:

* Username identity is case-insensitive (canonicalized)
* First IP to use a username becomes the “owner”
* If another IP uses the same username:

  * server marks them as impostor and appends a stable 6-digit suffix to the displayed name
    (so “NanoCheeZe123456”)
* Per-IP username limit (default 5): blocks new names beyond the cap

Per-IP dropdown support (your “artist name dropdown” scripts):

* `GET /queryUsers` -> returns list of usernames owned by that IP
* `POST /deleteUser` -> removes an owned username mapping for that IP

### 7) AI Radio (server-side “station”)

This is the shared “random station” endpoint your front end can poll.

* Background task `_ai_radio_loop()` ticks every `AI_RADIO_TICK_SECONDS`
* Keeps a queue of `AI_RADIO_QUEUE_LEN` songs
* Advances based on server time + computed duration
* `GET /aiRadio` returns:

  * `now_playing` (with timing fields)
  * `queue_len`

Three sources are chosen **at the source level first**, then a random song within:

1. `generated` — from `/songs` cache (local `AUDIO_DIR`)
2. `archive` — from local `ARCHIVE_DIR` mp3 scan
3. `xt_remote` — from **already cached** remote browse results under `__xt_music__`

Duration computation:

* Local files: `mutagen` if installed, otherwise MP3 header parsing
* Remote files: range GET of first N bytes + header parsing (best-effort)

**Important rule (remote):**
Remote XT picks only from directories that have already been browsed and cached.
So the client typically “primes” remote availability by opening the XT folder in the archive browser UI.

### 8) eve bot (server-side chat poster)

If enabled, eve runs as a background loop in this server:

* Every ~30s:

  * scans new chat messages since last seen ID
  * replies to messages starting with `!eve`
* If no `!eve` replies happened for 5 minutes:

  * posts a recap + witty line to the most recently active room
* Every 30 minutes:

  * posts a recap regardless

It calls your Gemini proxy:

* `POST NCZ_CHAT_PROXY_URL` with `{ action:"chat", provider:"gemini", model:"gemini-2.5-flash", messages:[...] }`
* expects `{ reply: "..." }`

It posts back into chat by directly appending to room JSONL + in-memory cache (no IP / suffixing path), matching your “server writes messages as if someone chatted” requirement.

### 9) Suno playlists (public fetch + normalization + master list)

This is the endpoint your Suno playlist browser patch calls.

* `POST /sunoPlaylist`
* `POST /ace/sunoPlaylist` (same handler; supports your `/ace` prefixed client calls)

Input accepts:

* `url` or `playlist_url` or `playlist` (URL or raw UUID)
* optional `cookie` if you ever need private playlists

Behavior:

* Extracts playlist UUID
* Walks pages:
  `GET https://studio-api.prod.suno.com/api/playlist/<id>/?page=N`
* Flattens clip rows into `items[]` with:

  * `audio_url`, `video_url`, **`video_cover_url`**, `image_large_url`, `title`, `author/handle`
* Returns both:

  * `result.songs` (master-ish shape like your `/suno/all`)
  * `result.items` (browser-friendly list)
  * `result.uuids`
* Caches per playlist (TTL `SUNO_PL_CACHE_SECONDS`)
* Upserts into the “All Suno” master file:

  * `all Suno.json` (exact filename with space)

Master endpoint:

* `GET /suno/all`
* `GET /ace/suno/all` (alias)

### 10) Producer.ai playlists (worker queue + wait-for-result + master list)

This is your Producer “scrape it in a real browser” pipeline.

The server coordinates:

* a queue of playlist URLs
* a worker that fetches those URLs in the browser (Tampermonkey)
* a report endpoint where the worker posts extracted UUIDs (and optionally titles/artists)
* a blocking endpoint where *you* can request a playlist and wait for the scrape to finish

Worker poll:

* `GET /nextJob` -> `{type:"job", url:"..."}` or `{type:"no_job"}`
* (optional) `WS /ws` with `{type:"get_job"}` for the same idea

Worker report:

* `POST /report` with:

  ```json
  { "url": "...", "songs":[{"uuid":"...","title":"...","artist":"..."}], "uuids":["..."], "title":"...", "ts": 123 }
  ```

Client “wait for result”:

* `POST /playlist` with:

  ```json
  { "url":"https://www.producer.ai/playlist/<uuid>", "timeout_s":120, "force":true }
  ```

This queues a job and **blocks** until `/report` arrives (or timeout).

Cache viewer:

* `GET /playlist` (all)
* `GET /playlist?url=...` (one)
* `GET /playlist/latest`

Master list:

* `GET /producer/all` -> reads/serves `all Producer.json` (exact filename with space)

Correlation key logic:

* If the playlist URL contains a UUID, that UUID becomes the stable key (`uuid:<...>`)
* Otherwise it uses normalized URL (`url:<...>`)

---

## Catch-all proxy (ACE-Step passthrough)

This must be last:

* `/{full_path:path}` all methods -> forwarded to `UPSTREAM/{full_path}`

Proxy behavior:

* Streams upstream response (doesn’t buffer full payload)
* Filters hop-by-hop headers
* Strips `Accept-Encoding` to avoid gzip complexities with streaming

This is the “glue” that makes your entire client + patch stack behave:

* UI loads from this server
* Any upstream API calls hit this server
* Your custom endpoints also live here
* Everything is same-origin

---

## Endpoint reference (quick)

### UI / static

* `GET /`
* `GET /index.html`
* `GET /static/*`

### Songs (generated)

* `GET /songs`
* `GET /api_audio/{filename}`

### Archive

* `GET /archive/browse`
* `GET /archive/browse/{subpath}`
* `GET /archive/api_audio/{rel_path}`

### External browse

* `POST /getExternal`

### Online users

* `GET /users_online`

### Chat

* `GET /chat/messages`
* `POST /chat/send`
* `GET /queryUsers`
* `POST /deleteUser`

### AI Radio

* `GET /aiRadio`

### eve bot

* (no public endpoint; runs in background)

### Suno

* `POST /sunoPlaylist`
* `POST /ace/sunoPlaylist`
* `GET /suno/all`
* `GET /ace/suno/all`

### Producer.ai

* `GET /jobs`
* `POST /queueJob`
* `GET /nextJob`
* `POST /report`
* `POST /playlist` (wait)
* `GET /playlist` (cache)
* `GET /playlist/latest`
* `GET /producer/all`
* `WS /ws`

### Everything else

* proxied to `UPSTREAM`

---

## Data shapes (the ones the front-end expects)

### `/songs` response

```json
{
  "songs": [
    {
      "task_id": "job_or_audio_id",
      "output_index": 0,
      "created_at": "YYYY-MM-DD HH:MM:SS",
      "label": "caption/style text",
      "prompt": "caption/style text",
      "filename": "abc.mp3",
      "file": "/api_audio/abc.mp3",
      "author": "optional",
      "title": "optional",
      "metas": { "...": "..." }
    }
  ],
  "dir": "AUDIO_DIR",
  "refreshed_at": 1234567890
}
```

### `/archive/browse` response

```json
{
  "base": "...",
  "path": "",
  "exists": true,
  "remote": false,
  "items": [
    { "type":"dir", "name":"Folder", "path":"Folder", "mtime": 123 },
    { "type":"mp3", "name":"song.mp3", "path":"Folder/song.mp3", "file":"/archive/api_audio/Folder/song.mp3", "author":"", "title":"", "metas":{} }
  ]
}
```

Remote XT items are the same shape but with:

* `"remote": true`
* `"file": "https://xtdevelopment.net/music/mp3s/.../song.mp3"`

### `/aiRadio` response

```json
{
  "now_playing": {
    "source": "generated|archive|xt_remote",
    "file": "...",
    "duration": 187.2,
    "started_at": 1700000000.0,
    "server_time": 1700000123.0,
    "elapsed": 12.3,
    "remaining": 174.9
  },
  "queue_len": 10
}
```

### `/sunoPlaylist` response (normalized)

```json
{
  "ok": true,
  "cached": false,
  "result": {
    "title": "Playlist Name",
    "songs": [
      { "uuid":"...", "title":"...", "artist":"...", "audio_url":"...", "video_url":"...", "video_cover_url":"...", "image_large_url":"..." }
    ],
    "items": [
      { "id":"...", "title":"...", "author":"...", "audio_url":"...", "video_url":"...", "video_cover_url":"...", "image_large_url":"..." }
    ],
    "uuids": ["..."],
    "count": 123,
    "ts": 1700000000.0
  }
}
```

### Producer `/playlist` wait response

```json
{
  "ok": true,
  "cached": false,
  "result": {
    "key": "uuid:....",
    "reported_url": "...",
    "title": "...",
    "uuids": ["..."],
    "songs": [ { "uuid":"...", "title":null, "artist":null } ],
    "count": 50,
    "ts": 1700000000.0,
    "meta": {}
  }
}
```

---

## Notes / gotchas

* **Remote XT music selection for AI Radio requires priming:**
  If `_remote_archive_cache` is empty, `xt_remote` picks will be empty. Browsing the XT folder once fills the cache.

* **Reverse proxy IP headers:**
  If you run behind Nginx/Cloudflare/etc, set `x-forwarded-for` properly so `/users_online` and chat username ownership works as intended.

* **Windows locking:**
  File locks (`fcntl`) won’t work on Windows, but the server also uses an in-process asyncio lock for the chat user DB to stay consistent.

* **Catch-all proxy must stay last:**
  If you add endpoints, they must be declared above the proxy route or they’ll get forwarded to ACE-Step instead.

---

## Why this file is “the hub” for your patches

Everything your client patches do maps cleanly to one of these roles:

* **“Use the same functions / real UI handlers”**
  → the UI loads from this server; playlist + media actions call endpoints on this same origin.

* **Advanced Source Audio (/release_task multipart forcing)**
  → the client controls the request shape; this server just forwards it to ACE-Step.

* **Playlist browsers (Suno / Producer / External / Archive)**
  → this server provides the normalized JSON payloads those overlays rely on.

* **AI Radio + video priming logic**
  → this server provides `now_playing` + timing; client decides how to activate UI playback.

* **Chat + eve automation**
  → this server stores chat, serves it fast, and can inject eve messages without needing a second service.


----------------------------------------------------------------



````md
## Front-end Integration Cookbook (NCZ Patches → server.py Endpoints)

This section is **practical wiring**: exactly how your client / Tampermonkey patches should call this server, what they get back, and how to route playback correctly.

> Assumption: your UI is loaded from `server.py` (same origin), so all calls below are just `fetch("/...")` without CORS pain.

---

### 0) Base rule: call THIS server for everything
- UI loads from: `GET /` (serves `index.html`)
- Static assets: `/static/*`
- Anything not implemented here will be forwarded to ACE-Step automatically (catch-all proxy).

So in patch code:
```js
const API = ""; // same origin
// fetch(`${API}/songs`) == fetch("/songs")
````

---

## 1) Generated songs list (SongList / “new songs”)

### Load songs into the main playlist UI

**Request**

```js
const r = await fetch("/songs");
const data = await r.json();
const songs = data.songs || [];
```

**Response shape**
Each song item includes:

* `file` → `/api_audio/<mp3>`
* `filename`, `task_id`, `created_at`, `label/prompt`
* plus `author/title/metas` for your metadata UI

**Playback**
Your UI usually plays by clicking the real “Play” link in `#songList` rows (best method).
So the usual pattern is:

1. Add items to SongList arrays
2. Render
3. Click first visible `Play` link

---

## 2) Serve generated audio bytes (`player.src` target)

If you *do* need to point a player directly:

* `song.file` already points to the server-hosted mp3:

  * `/api_audio/<filename>`

Example:

```js
player.src = song.file; // "/api_audio/abc.mp3"
await player.play();
```

But your system is happiest when you trigger your **real app play handler** via the row Play link.

---

## 3) Archive Browser (local + remote XT alias)

### Browse archive folders

**Request**

```js
const r = await fetch("/archive/browse/MyFolder/SubFolder");
const data = await r.json();
const items = data.items || [];
```

**What you get**

* `type:"dir"` entries for folders
* `type:"mp3"` entries for songs

**Playback field rule**

* Local archive mp3 items:

  * `item.file` is `/archive/api_audio/<relpath>`
* Remote XT mp3 items (under `__xt_music__`):

  * `item.file` is a **full absolute URL** to xtdevelopment.net

So client playback logic should be:

```js
const url = item.file; // either "/archive/api_audio/..." OR "https://xtdevelopment.net/music/mp3s/..."
```

### Important: XT folder exists only at archive root

At `/archive/browse` root, you’ll see:

* `type:"dir"`, `path:"__xt_music__"`

Open it by calling:

```js
fetch("/archive/browse/__xt_music__")
```

---

## 4) External URL Browser overlay (`/getExternal`)

### Browse a remote directory listing you mounted

**Request**

```js
const r = await fetch("/getExternal", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    url: "https://example.com/music/", // base
    path: "Albums/2024/"               // relative folder under base
  })
});
const data = await r.json();
```

**Response**
`data.items[]` includes:

* dirs: `{type:"dir", path:"..." }`
* files: `{type:"file", url:"https://...", file:"https://..." }`

**Playback**
External browser file items are direct URLs:

```js
player.src = item.url || item.file;
```

---

## 5) AI Radio station (`/aiRadio`)

### Poll station state

**Request**

```js
const r = await fetch("/aiRadio");
const data = await r.json();
const np = data.now_playing;
```

**now_playing fields**

* `file` → playback URL (local or remote)
* `source` → `generated | archive | xt_remote`
* `duration`, plus timing sync:

  * `started_at`, `server_time`, `elapsed`, `remaining`

**Client usage pattern**

* Poll every few seconds (or on “radio mode on”)
* If `now_playing.file` changes, switch playback

Example:

```js
let lastFile = "";
async function tickRadio() {
  const r = await fetch("/aiRadio");
  const d = await r.json();
  const np = d.now_playing;
  if (!np?.file) return;

  if (np.file !== lastFile) {
    lastFile = np.file;

    // Preferred: use your real UI add/play path if you want it in SongList
    // or direct set:
    player.src = np.file;
    await player.play();
  }
}
setInterval(tickRadio, 3000);
```

**XT remote availability note**
`xt_remote` choices come only from previously cached XT browse results.
So if you want XT tracks to participate, make sure the user opens the XT folder once:

* `/archive/browse/__xt_music__` (or deeper)

---

## 6) Chat (poll + send)

### Poll messages

**Request**

```js
const room = 1;
const after = lastSeenId || 0;
const r = await fetch(`/chat/messages?room=${room}&after_id=${after}&limit=80`);
const data = await r.json();
const msgs = data.messages || [];
```

### Send message

**Request**

```js
await fetch("/chat/send", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    room: 1,
    author: "NanoCheeZe",
    message: "hello world"
  })
});
```

**What the server may change**

* It may append a stable 6-digit suffix to `author` if the same name is used from another IP.
* It may reject new usernames if the IP already hit the cap (`CHAT_MAX_USERNAMES_PER_IP`).

### Per-IP artist dropdown support

**Load “my names”**

```js
const r = await fetch("/queryUsers");
const names = await r.json(); // ["Name1","Name2",...]
```

**Delete one owned name**

```js
await fetch("/deleteUser", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({ username: "Name1" })
});
```

---

## 7) eve bot usage (client-side expectation)

There is **no** client endpoint to trigger eve directly.
eve watches chat in the background:

* Any user message that begins with `!eve` will get a reply from `eve` posted back into the same room.
* If chat is active but no `!eve` commands occur, eve may post periodic recaps (5m/30m rules).

Client just treats eve like any other author in `/chat/messages`.

---

## 8) Suno playlist browser (`/sunoPlaylist`)

### Fetch a Suno playlist by URL or UUID

**Request**

```js
const r = await fetch("/sunoPlaylist", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    url: "https://suno.com/playlist/<uuid>" // OR raw uuid
  })
});
const data = await r.json();
const result = data.result;
```

**Result payload**

* `result.items[]` for browser UI rows (has `audio_url`, `video_url`, `video_cover_url`)
* `result.songs[]` for master-ish records
* `result.uuids[]`

**Playback**
Suno items are direct CDNs:

```js
player.src = it.audio_url;
video.src  = it.video_url || "";
```

Your “Suno video driver” patch typically uses `audio_url` as lookup key to pick video/cover fields.

---

## 9) Suno master list (`/suno/all`)

Used by your “All Suno” master overlay row.

**Request**

```js
const r = await fetch("/suno/all");
const data = await r.json();
const result = data.result;
```

**Response**

* `result.songs[]` (includes `video_cover_url`)
* `result.items[]` (browser-friendly)
* `result.uuids[]`

---

## 10) Producer.ai playlists (worker pipeline)

### A) “Wait for scrape result” (your UI button)

**Request**

```js
const r = await fetch("/playlist", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    url: "https://www.producer.ai/playlist/<uuid>",
    timeout_s: 120,
    force: true
  })
});
const data = await r.json();
const result = data.result;
```

**Result**

* `result.songs[]` = `[{uuid,title,artist}, ...]`
* plus `uuids[]`

To build mp3 URLs (Producer public clips):

```js
const clipUrl = `https://storage.googleapis.com/producer-app-public/clips/${uuid}.mp3`;
```

### B) Worker polling (Tampermonkey side)

Worker repeatedly calls:

```js
const r = await fetch("/nextJob");
const job = await r.json();
// {type:"job", url:"..."} or {type:"no_job"}
```

### C) Worker reporting results back

Worker posts:

```js
await fetch("/report", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    url: location.href,
    title: document.title,
    songs: [{uuid, title, artist}],
    uuids: [uuid1, uuid2]
  })
});
```

---

## 11) Upstream ACE-Step calls (proxy passthrough)

Anything not matched by the explicit endpoints above is forwarded to:

* `UPSTREAM = ACESTEP_UPSTREAM`

So your client can do:

```js
await fetch("/release_task", { method:"POST", body: formData });
```

…and it lands at:

* `http://127.0.0.1:8001/release_task` (by default)

**Why this matters**

* Your “Advanced Source Audio” patch modifies request shape, but you do not need to change the URL.
* Same origin, no CORS, no special routing in the client.

---

## 12) Recommended “play the right way” patterns

### Pattern A: “Exact-play via your real UI”

Best for avoiding race conditions with your video system:

1. Add item(s) into the real playlist arrays
2. Render `#songList`
3. Click the `Play` link in the correct row

This triggers the app’s own logic:

* player src set
* highlight/selection
* video driver activation order

### Pattern B: “Direct-src playback”

Works for simple cases (radio, external URLs), but may bypass UI state:

```js
player.src = url;
await player.play();
```

If video activation depends on UI handlers, prefer Pattern A.

---

## 13) Endpoint checklist (what each overlay should call)

* **Main SongList panel**: `/songs` + `/api_audio/*`
* **Archive overlay**: `/archive/browse/*` + `/archive/api_audio/*`
* **XT remote archive**: `/archive/browse/__xt_music__/*` (play uses absolute URLs)
* **External URL overlay**: `/getExternal` (play uses absolute URLs)
* **Suno overlay**: `/sunoPlaylist` + `/suno/all`
* **Producer overlay**: `/playlist` (wait) + `/producer/all` (master)
* **Chat panel**: `/chat/messages` + `/chat/send` + `/queryUsers` + `/deleteUser`
* **AI Radio mode**: `/aiRadio`



-----------------


````md
## Public Reverse Proxy Layer (GoDaddy shared hosting → PHP 5.2 → your FastAPI server)

You serve the whole MEQUAVIS / NCZ web app through **two proxy layers**:

1) **Public-facing proxy (PHP 5.2 on GoDaddy shared hosting)**  
   - Public URL: `https://xtdevelopment.net/ace/...`
   - Runs `index.php` + `.htaccess` rewrite rules
   - Forwards every request to your real server (the FastAPI `server.py`)

2) **Your real server (FastAPI `server.py`)**  
   - Runs on your machine / VPS / home network (whatever the `UPSTREAM` points to)
   - Serves `index.html`, `/songs`, `/archive/*`, `/aiRadio`, chat, playlist endpoints, etc.
   - Proxies any unknown routes to ACE-Step upstream (`ACESTEP_UPSTREAM`)

This setup lets you:
- **Hide** your real server behind `xtdevelopment.net/ace/`
- Still allow direct access when appropriate:
  - `http://<your_public_ip>/...` (if someone knows it and firewall allows)
  - `http://127.0.0.1/...` on your LAN/intranet
  - Local intranet hostname if you use one

### The 3 ways your app can be reached
- **Public (hidden origin):** `https://xtdevelopment.net/ace/` → PHP proxy → FastAPI `server.py`
- **Direct public IP:** `http://<ip>/` → FastAPI `server.py` (only if you expose it)
- **Local network:** `http://127.0.0.1/` or `http://LAN-IP/` → FastAPI `server.py`

All three “work” as long as routing/firewall/network policies allow them.

---

# PHP 5.2 reverse proxy (`index.php`)

This file is a **streaming reverse proxy** using cURL that forwards:

- Method (GET/POST/PUT/etc.)
- Query params (except the internal routing param `u`)
- Body (for POST/PUT/PATCH)
- Most headers (with hop-by-hop headers stripped)

### Why you need it (and why PHP 5.2)
GoDaddy shared hosting is limited: you can’t run FastAPI directly there.  
But you *can* run PHP, and PHP can forward requests to your actual server.

So `xtdevelopment.net/ace/...` becomes a clean public front door.

---

## How routing works

### 1) `.htaccess` rewrites everything to `index.php?u=...`

When a browser requests:
- `https://xtdevelopment.net/ace/songs`

Apache rewrites it to:
- `/ace/index.php?u=/songs`

### 2) `index.php` rebuilds the upstream target URL

It starts with:
```php
$UPSTREAM = 'http://*.*.*.*'; // your real server
$u = $_GET['u'];             // the rewritten path
````

Then it builds:

```php
$target = rtrim($UPSTREAM, '/') . $u . '?' . remaining_query_params
```

So the example becomes:

* `http://*.*.*.*/songs`

And it streams the upstream response back to the client.

---

## Path safety + encoding detail

This line is important:

```php
$u = preg_replace_callback('~[^/]+~', function($m){
    return rawurlencode(rawurldecode($m[0]));
}, $u);
```

It:

* decodes each segment
* re-encodes it safely

That prevents path segments from being double-encoded or broken by weird characters (spaces, `%`, unicode, etc.). It keeps your proxy path behavior stable for things like:

* `/archive/api_audio/...`
* filenames with spaces
* nested folder paths

---

## Header handling (why it strips certain headers)

### Incoming headers → outgoing cURL headers

It strips:

* hop-by-hop headers (`Connection`, `Transfer-Encoding`, `Host`, `Content-Length`, etc.)
* `Accept-Encoding`

Dropping `Accept-Encoding` is a common trick: it avoids gzip/chunked edge cases on shared hosting where Apache/PHP buffering can corrupt streaming responses.

### Response headers → browser

Your callback `proxyHeaderCb()`:

* forwards the upstream HTTP status code
* forwards most headers
* strips `Transfer-Encoding`, `Content-Length`, etc.
* de-dupes headers (but still allows multiple `Set-Cookie`)

This keeps streaming sane and prevents “double-chunking” problems.

---

## Streaming response body

`proxyWriteCb()` echoes raw bytes as they arrive, and calls `flush()` when available.

That means:

* mp3 bytes can stream
* large responses don’t need to buffer entirely in PHP memory

---

# `.htaccess` (Apache rewrite + CORS)

This is what makes `/ace/...` behave like a clean site root.

## Rewrite rules

```apache
RewriteEngine On
RewriteBase /ace/
```

### 1) Serve real files directly (optional but nice)

```apache
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
```

If you ever put a real file under `/ace/` (like a static fallback), Apache serves it normally.

### 2) Rewrite everything else to the PHP proxy

```apache
RewriteRule ^$ index.php?u=/ [QSA,L]
RewriteRule ^(.+)$ index.php?u=/$1 [B,QSA,L]
```

So:

* `/ace/` → `index.php?u=/`
* `/ace/anything/here` → `index.php?u=/anything/here`

`QSA` preserves the original query string.
`B` ensures proper escaping of special characters in the rewrite substitution.

---

## CORS headers

```apache
Header always set Access-Control-Allow-Origin "*"
Header always set Access-Control-Allow-Methods "GET, POST, OPTIONS"
Header always set Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With"
Header always set Access-Control-Max-Age "86400"
```

This makes it easier for:

* Tampermonkey scripts
* browser fetch() calls
* tools hitting your endpoints

**Note:** if you later introduce cookies/sessions that need credentialed requests, you’d tighten this (because `*` + credentials is not allowed). For now it matches your “public proxy” style.

---

# Tampermonkey Worker (`producer_api_tampermonkey.js`)

This script is the “headless worker” that makes Producer.ai scraping possible even though Producer’s playlist data isn’t trivially accessible from your server.

## What it does

1. **Polls your server for jobs**

   * WS first (fast) → `ws://127.0.0.1:80/ws`
   * If WS blocked (common from https sites), it falls back to HTTP polling:

     * `GET http://127.0.0.1:80/nextJob`

2. **Navigates the browser to the job URL**

   * The job is a Producer.ai playlist URL
   * It stores it in Tampermonkey persistent storage so the job survives reloads

3. **Waits for the page to render**

   * `SCRAPE_DELAY_MS` (default 3500ms)

4. **Scrapes songs from the DOM**

   * Extracts UUIDs from `/song/<uuid>` links
   * Infers `title` and `artist` from the row structure you validated

5. **Reports results back to your server**

   * `POST http://127.0.0.1:80/report`
   * Sends:

     * `url`
     * `uuids`
     * `songs: [{uuid,title,artist}]`
     * `meta` diagnostics (workerId, UA, path)
   * This wakes any waiting `/playlist` call on the server side

---

## Why it must run locally (not through xtdevelopment.net/ace/)

Producer.ai pages are `https://...` and browser restrictions make cross-origin + local network access tricky.

This worker uses:

* `GM_xmlhttpRequest` (Tampermonkey’s privileged XHR)
* `@connect 127.0.0.1` / `localhost`

So it can talk to your local FastAPI server even when the webpage is Producer.ai.

That’s why your config points to:

```js
const API = "http://127.0.0.1:80";
```

Meaning:

* the Producer.ai worker talks to **your local server.py**
* your public users talk to **xtdevelopment.net/ace/** (PHP proxy)
* both paths ultimately feed the same job queue system if you choose to expose it

---

## Persistent job logic (why it survives reloads)

The script stores:

* `ncz_job_url` (current job)
* `ncz_job_nav_tries` (anti-infinite-loop)
* `ncz_last_report_hash` (dedupe reports)
* `ncz_worker_id` (debug identity)

So if Producer.ai reloads or you refresh, it continues the same job and reports once.

---

## WS-first, HTTP-forever fallback

* It tries WS once (fast path):

  * `ws://127.0.0.1:80/ws`
* If blocked, it falls back to:

  * poll `/nextJob` every `POLL_MS` (default 2000ms)

This matches reality: many sites block `ws://` from `https://` contexts or your browser blocks mixed content.

---

## Output contract (what your server expects)

The key design is: the worker reports only:

```js
songs: [{ uuid, title, artist }]
```

and `uuids` is derived from that list.

That matches your server’s `/report` normalization logic, and the server writes/updates:

* `all Producer.json` master list (uuid/title/artist only)

---

# How this all fits the “two proxy” architecture

### Public user path (hidden server)

Browser → `https://xtdevelopment.net/ace/...`
Apache rewrite → `index.php?u=/...`
PHP proxy → `http://<your_real_server>/...`
FastAPI (`server.py`) serves JSON/mp3/html or proxies to ACE-Step.

### Producer.ai scrape path (worker)

Producer.ai tab → Tampermonkey → `http://127.0.0.1:80/nextJob`
Worker navigates/scrapes → `http://127.0.0.1:80/report`
FastAPI wakes `/playlist` waiters and updates master files.

---

# Quick “drop-in” README additions (you can paste above into your main README)

### Files involved

* `/ace/.htaccess` — rewrites clean URLs to the proxy script + adds CORS
* `/ace/index.php` — PHP 5.2 reverse proxy that forwards all requests to your real FastAPI server
* `producer_api_tampermonkey.js` — browser worker that scrapes Producer.ai and reports song UUID/title/artist back to your server

