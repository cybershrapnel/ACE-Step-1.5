Modified the api_server.py file of ace to work with this, fixed some bugs in it too and added author and title and some stuff.
Will document more later

Server is up and running at https://music.mequavis.com

All of these files belong in the top ACE-Step folder fyi. I just put them in here to keep it sorted for everyone. But move these files to the top directoy or you will need to make some edits.

<img src="https://github.com/cybershrapnel/ACE-Step-1.5/blob/main/web_server/old/preview.png?raw=true">



````md
# MEQUAVIS ACE-Step AI Music Generator (Web UI)

A single-page web frontend for submitting **Ace-Step 1.5** music generation jobs, tracking queue progress, and managing playback + downloads for generated songs and archived songs.

This page is designed to work both:
- **Locally** (e.g., `http://localhost:8001`)
- **Behind a subpath proxy** (notably `https://xtdevelopment.net/ace`), where API + static routes may be prefixed with `/ace`

---

## Contents

- [What this UI does](#what-this-ui-does)
- [Quick start](#quick-start)
- [API expectations](#api-expectations)
- [UI walkthrough](#ui-walkthrough)
- [Request payload mapping](#request-payload-mapping)
- [Core runtime architecture](#core-runtime-architecture)
- [Script modules (in-page)](#script-modules-in-page)
- [Global hooks for other patches](#global-hooks-for-other-patches)
- [LocalStorage keys](#localstorage-keys)
- [Static assets & external scripts](#static-assets--external-scripts)
- [Customization notes](#customization-notes)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## What this UI does

### Core workflow
1. **Health check** the API server (`/health`)
2. **Load available models** (`/v1/models`)
3. **Submit a generation task** (`/release_task`)
4. **Poll job status** (`/v1/stats` + `/query_result`)
5. When the job succeeds, **append outputs** to the **Song List** (new songs list)
6. Play, navigate (Prev/Next), view lyrics/meta, download, remove, clear list

### Two “libraries” of songs
- **New Songs (in-session list)**  
  Items appended when generation completes (and optionally fetched via `/songs`).  
  Managed by an in-memory `songs[]` array + DOM list in `#songList`.

- **Archive Browser (left sidebar)**  
  Browses server-side directories via `/archive/browse` and plays archived `.mp3` directly.
  Archive play integrates with the same player + same right-panel lyrics/meta viewer where possible.

### Quality-of-life UI systems
- Sticky **footer audio player bar** (auto-shows only when a real song is loaded)
- **Playlist-aware navigation** (Next/Prev follows the last playlist you interacted with: `new` vs `archive`)
- **Reverse visual order** toggle for the Song List (CSS-only reorder)
- **Metadata modal** per song row (pulls `/songs` and matches rows to server objects)
- Right info panel: **Full lyrics viewer** + **random background video** that changes on song change
- “Chain-It” banner + modal (Litecoin address helper UI)
- “Users online” pill that polls `/users_online`
- “Autogen” button: repeatedly clicks **Generate** on a timer (when enabled)
- Upload UI helpers: “Source Audio” picker + an MP3 preview player (UI-only unless server upload implemented)

---

## Quick start

### 1) Serve this HTML + static files
This is meant to be served by your web server (often the same host as the Ace-Step proxy).

Required static paths used by this page:
- `static/favicon.ico`
- `static/chat.js`
- `static/multipart.js`
- Optional: `static/banners/chainit-*.png` for the Chain-It banner rotation

### 2) Point it at your API
Open the page, then set:
- **API Base URL**: e.g.
  - Local: `http://localhost:8001`
  - XT proxy: `https://xtdevelopment.net/ace`

> The UI auto-defaults the base URL:
> - If hostname is `xtdevelopment.net`, it sets Base URL to `origin + "/ace"`
> - Otherwise it uses `origin`

### 3) Click **Reload models**, then **Generate**
- Fill in **Style Prompt** and/or **Lyrics**
- Click **Generate**
- Watch queue stats update
- When complete, outputs append to the Song List

---

## API expectations

This UI is “API-shape tolerant” in a few places, but these are the expected endpoints:

### Required endpoints

#### `GET /health`
Returns server health.
- Accepts either:
  - plain JSON object, or
  - wrapped `{ code, data, error, ... }` where `code === 200`

Example (wrapped):
```json
{ "code": 200, "data": { "status": "ok", "service": "NCZ API", "version": "1.1" }, "error": null }
````

#### `GET /v1/models`

Returns available generation models:

```json
{
  "models": [{ "name": "ace-step-1.5", "is_default": true }],
  "default_model": "ace-step-1.5"
}
```

#### `GET /v1/stats`

Queue + job counters used for estimating progress:

```json
{
  "queue_size": 12,
  "jobs": { "queued": 10, "running": 2, "succeeded": 120, "failed": 3 }
}
```

#### `POST /release_task`

Submits a generation request. Returns at least:

```json
{ "task_id": "abc123", "queue_position": 5 }
```

#### `POST /query_result`

Checks the state of one or more tasks:
Request:

```json
{ "task_id_list": ["abc123"] }
```

Response: array of task objects, each containing:

* `task_id`
* `status` (0=running, 1=succeeded, 2=failed)
* `result` (stringified JSON array on success)

On success, `result` is parsed as JSON and expected to contain items with at least:

* `file` (path or URL to output audio)
* optional: `metas`, `generation_info`, `dit_model`, `lm_model`

### Optional endpoints

#### `GET /songs`

Used by “Show new songs” and the Metadata modal for richer server-side history:

* Can return:

  * an array of song items, or
  * `{ songs: [...] }`, or even nested `{ data: { songs: [...] } }`

Song items can contain:

* `file` or `url`
* `title`, `author`
* `meta`/`metas`/`metadata` (prompt/lyrics/signature)
* `task_id`, `output_index`, `created_at`

#### `GET /archive/browse?path=<folder>`

Archive explorer endpoint.
This UI accepts many shapes (strings or objects) and tries to normalize them into:

* `folders[]`
* `songs[]` (mp3 only)

Typical supported shapes:

* `{ path, folders: ["subdir"], items: ["song.mp3", "song.json"] }`
* `{ path, items: [{type:"dir", name:"subdir"}, {name:"song.mp3", meta:{...}}] }`

#### `GET /users_online`

Returns the number of users online in the last 90 minutes:

* Either a plain number: `12`
* Or: `{ "online": 12 }`

---

## UI walkthrough

### Top header pills

* **Users online pill** (👤)
  Polls `/users_online` every 5 minutes; click to refresh immediately.
* **Health pill**
  Displays result of `/health`.

### “Create a generation task” (left main card)

Fields:

* **API Base URL**: base address for all API calls
* **Auth Mode**:

  * `none` (no key)
  * `header` → adds `Authorization: Bearer <key>`
  * `body` → adds `ai_token` into request JSON
* **API Key**: optional key used by the above modes
* **Style Prompt** (`prompt`) and **Lyrics** (`lyrics`)
* **Advanced options** (model, output format, thinking, use_format, duration, bpm, key/scale, time signature, inference steps, batch size)
* Buttons:

  * **Check server** → `/health`
  * **Reload models** → `/v1/models`
  * **Generate** → `/release_task` then starts polling
  * **Stop polling** → stops local polling (does not cancel server job)

Metadata additions (injected UI elements):

* **Song Title** input (optional)
* **Author** input (persisted in localStorage)
* **Signature** is fetched from:

  1. `window.__nczGetSignature()` if available
  2. `window.__NCZ_SIGNATURE_DATA__` if present
  3. (optional) `#metaSignature` input if you add it later

### “Queue & Song List” (right main card)

Shows:

* Task ID
* initial queue position
* estimated queue position (best-effort)
* queue size / running counts
* elapsed time / last check timestamp
* progress bar (derived from `qInit` and changes in succeeded+failed jobs)

Playback + list:

* Always-visible `audio#player` (moved into a fixed footer bar once loaded)
* Download link for the current track
* “Show new songs” → fetches `/songs` and merges into the Song List
* Song List items include:

  * caption/title
  * Play / Download / Remove (✖)
  * timestamp/task/output info
  * filename ID line (injected)

---

## Request payload mapping

When you click **Generate**, the UI builds a JSON body and posts it to:

`POST /release_task`

### Required-ish fields

* `prompt` *(string)* — style prompt / caption
* `lyrics` *(string)* — optional; blank implies instrumental

The UI requires **at least one** of `prompt` or `lyrics`.

### Optional generation flags

* `thinking` *(boolean)* — “Quality mode”
* `use_format` *(boolean)* — input enhancement/formatting
* `audio_format` *(string)* — `"mp3" | "wav" | "flac"`

### Optional model selection

* `model` *(string)* — chosen from `/v1/models`

### Optional musical parameters

* `audio_duration` *(number)* — seconds
* `bpm` *(int)*
* `key_scale` *(string)* — e.g., `"E Minor"`
* `time_signature` *(string)* — e.g., `"4"` for 4/4
* `inference_steps` *(int)*
* `batch_size` *(int)* — UI suggests max 8

### Optional metadata passed through to server

* `title` *(string)* — from the injected Song Title input
* `author` *(string)* — from the injected Author input
* `signature` *(string)* — from the signature getter chain described above

### Auth in request body (only if configured)

* `ai_token` *(string)* — only when Auth Mode = `body`

---

## Core runtime architecture

### Helper utilities

Key helpers in the main script block:

* `$(id)`
  Short ID lookup (`document.getElementById`).

* `normBaseUrl(u)`
  Trims and removes trailing slashes; default fallback is `http://localhost:8001`.

* `apiFetch(path, opts)`
  Unified fetch wrapper that:

  * prepends `baseUrl`
  * applies auth header/body config
  * parses JSON
  * supports “wrapped” `{code,data}` APIs

* `absSongUrl(fileOrUrl)`
  Converts server-returned paths into absolute URLs with correct subpath behavior:

  * If Base URL is `https://xtdevelopment.net/ace`, and server returns `/api_audio/x.mp3`,
    the UI rewrites to `https://xtdevelopment.net/ace/api_audio/x.mp3` as needed.

* `extractSongMeta(item)`
  Normalizes metadata across multiple possible object shapes:

  * `item.meta`, `item.metas`, `item.metadata`, etc.

* `pickSongDisplayTitle(meta, fallback)` / `pickSongDisplayTitle2(...)`
  Chooses a display title and prevents duplicate “Title - Title - …” formatting.

### State variables

Main generation state:

* `taskId`
* `pollTimer`, `pollInFlight`
* `startedAtMs`
* queue estimation:

  * `qInit` (initial position)
  * `baselineCompleted` (succeeded+failed at submission time)
  * `lastStats` (latest `/v1/stats`)

Song list state (“New Songs” list):

* `songs[]`: array of `{ url, label, createdAt, taskId, outputIndex, meta, serverItem, downloadName, __deleted }`
* `songUrlToIndex`: URL → stable index in `songs[]`
* `songUrlToMeta`: URL → merged meta
* `currentSongIndex`

Archive state:

* `window.__nczArchiveState = { path, songs, index }`
* `window.__nczArchiveRendered = { path, songs }`

Playlist router state:

* `window.__nczLastPlaylist = "new" | "archive"`

### Polling logic

* `submitTask()`:

  * captures baseline stats
  * calls `/release_task`
  * starts interval polling every `POLL_MS` (3000ms)

* `pollOnce()`:

  1. `GET /v1/stats` (update queue counters and estimated progress)
  2. `POST /query_result` for the current `taskId`
  3. If status:

     * `0`: queued/running → keep polling
     * `1`: succeeded → parse `item.result` as JSON → read `file` fields → append to Song List
     * `2`: failed → stop polling and show error

Stop behavior:

* “Stop polling” stops **local polling only**; it does not cancel server computation.

---

## Script modules (in-page)

This HTML contains multiple distinct “modules” as IIFEs (Immediately Invoked Function Expressions). Here’s what each one does.

### 1) Main generator + Song List manager (primary IIFE)

Responsible for:

* API calls: health/models/stats/release_task/query_result/songs
* Queue UI + progress estimation
* “New Songs” list data structures and DOM rendering
* Playback loading via `loadIntoMainPlayer()`
* Remove song button (✖) + tombstone deletes
* Auto-next behavior on track end (prefers playlist-aware router)

Key functions:

* `healthCheck()`
* `loadModels()`
* `getStats()`
* `submitTask()`
* `pollOnce()`
* `showAllSongs()`
* `addSongToList()`
* `removeSongFromNewList()`
* `loadIntoMainPlayer()`
* `showSongMeta()`

Exports (globals):

* `window.songs`
* `window.addSongToList`
* `window.loadIntoMainPlayer`
* `window.showSongMeta`
* `window.songUrlToMeta`
* `window.removeSongFromNewList`
* `window.currentSongIndex` (kept updated)

### 2) Footer player bar

Moves only `<audio id="player">` into a fixed bottom footer:

* Footer is hidden until the player has a real `src/currentSrc`
* Adds body padding only while visible

### 3) Playlist-aware navigation router

Defines:

* `window.__nczPlayNext()`
* `window.__nczPlayPrev()`

Behavior:

* Uses `window.__nczLastPlaylist` to decide whether to step through:

  * archive (`window.__nczArchiveStep`) or
  * new songs (`songs[]` via `loadIntoMainPlayer`)
* Provides fallback logic if one list can’t step further

### 4) Prev/Next buttons around the player + keyboard shortcuts

Injects two buttons around the `<audio>` element:

* Prev: Shift+Left
* Next: Shift+Right

If playlist-aware router exists, it delegates to it.
Otherwise it falls back to stepping through DOM order.

### 5) Player invert colors

Applies `filter: invert(1) hue-rotate(180deg)` to the audio element
(toggle-safe via `data-inverted`).

### 6) Auto-click “Check server”

Clicks the “Check server” button ~3 seconds after load.

### 7) Filename line injection per Song List item

Adds an extra line showing the basename (without `.mp3`) under the caption for each Song List row.

### 8) Connection fields collapse toggle

Adds a button that collapses/expands the Base URL + Auth + API Key row.
Persists state in localStorage.

### 9) Left sidebar (“View Music”) + archive browser

Creates a fixed left bar that can collapse, and has a **music mode** that replaces the menu items with a scrollable archive browser.

Archive browser features:

* folder navigation + “..” up item
* plays only `.mp3` entries
* optional JSON hydration: if `song.json` exists, fetch it to get title/author
* **+All** button: add all visible archive songs into the New Songs list

Defines archive stepping:

* `window.__nczArchiveStep(delta, {autoplay})`

### 10) Left panel reflow fix

Keeps page content aligned when left sidebar collapses/expands.

### 11) Right info panel (collapsible)

Creates a fixed right panel and starts it collapsed by default.
Moves the toggle button beneath the icon when collapsed.

### 12) Right panel push (stable overlap)

Adjusts `padding-right` only when the right panel would overlap the content.
Uses hysteresis + RAF scheduling to prevent “ping-pong”.

### 13) Right panel resize handle

Adds draggable left-edge handle to resize the panel.
Persists width in localStorage.

### 14) Autogen button

Adds “Autogen” next to the main buttons:

* When ON: clears lyrics and clicks Generate every 10s if Generate is enabled
* Persists ON/OFF

### 15) Make Lyrics button placement (placeholder)

Moves or creates a “Make Lyrics” button next to the Lyrics label.
Then another module disables it (“Coming soon”).

### 16) Song Title input injection

Adds `__ncz_songtitle_input__` above the Style Prompt.

### 17) Author input + disabled Signature button injection

Adds `__ncz_author_input__` next to the Style Prompt label.
A later module persists Author in localStorage.

### 18) Metadata modal (“Metadata” link per Song List row)

Injects a “Metadata” link next to each Download link.
On click:

* fetches `/songs` (cached 30s)
* tries to match row by song index or filename
* shows a modal with:

  * server fetch status + endpoint used
  * ui-extracted values (url/index/title/author)
  * matched server song object

### 19) “Source Audio” upload UI + preview player

Adds:

* “Source Audio” button next to Song Title
* stores selected file in `window.__ncz_sourceAudioFile`
* separate module installs an `audio#uploadFilePlayer` preview by scanning the DOM (and open shadow roots)

> Note: These are UI-only unless your server upload flow is implemented (likely in `static/multipart.js`).

### 20) Right panel lyrics viewer + random video background

Creates/uses a “Song Lyrics” card that:

* displays title/author/signature/prompt + full lyrics
* shows **video** when audio is playing, and **image** when paused
* selects random video URLs from:

  * `https://xtdevelopment.net/ace/videos.txt` (one URL per line)
  * fallback list if fetch fails
  * can be overridden by persisted custom list in localStorage

Exports a control API:

* `window.__nczLyricsVideoList.get()`
* `window.__nczLyricsVideoList.set(urls, {persist})`
* `window.__nczLyricsVideoList.useDefault({clearStored})`
* `window.__nczLyricsVideoList.playNow()`

### 21) Chain-It rotating banner + modal

Inserts a rotating banner below the “Please download your songs!” hint block.
On click opens a modal with:

* LTC “pricing” estimator
* LTC address finder (pulls from page text; fallback hardcoded)
* copy-to-clipboard helper

### 22) Song List reverse toggle (CSS only)

Adds a small “Reverse/Normal” button next to “Song List”.
Uses `flex-direction: column-reverse` without touching DOM nodes.
Also adds symmetry overrides so navigation still makes sense in reversed mode.

### 23) Global `$` helper

Defines a simple `window.$` for compatibility (ID lookup or querySelector).

### 24) Clear Song List button

Adds a “Clear Song List” button under the New Songs list.
Uses the same delete path as the ✖ buttons (`removeSongFromNewList`) so indices/maps remain consistent.

### 25) External scripts

Loads:

* `static/chat.js`
* `static/multipart.js`

…and then adds the Users Online pill module.

---

## Global hooks for other patches

This page is designed to be “patchable”. These globals are intentionally exported:

### Core list/player exports

* `window.songs` — New Songs array
* `window.addSongToList(url, opts)` — add/merge song rows
* `window.loadIntoMainPlayer(index, autoplay)` — load a song into `audio#player`
* `window.showSongMeta(index)` — writes a meta summary into `#resultMeta`
* `window.songUrlToMeta` — `Map(url → meta)` (merged meta store)
* `window.removeSongFromNewList(index, {autoplayNext})`
* `window.currentSongIndex`

### Navigation/router exports

* `window.__nczPlayNext()`
* `window.__nczPlayPrev()`
* `window.__nczLastPlaylist = "new" | "archive"`

### Archive exports

* `window.__nczArchiveStep(delta, {autoplay})`
* `window.__nczArchiveState`
* `window.__nczArchiveRendered`

### Signature integration point

If you have a signature system elsewhere, implement:

* `window.__nczGetSignature = () => "..."`

or set:

* `window.__NCZ_SIGNATURE_DATA__ = "..."`

---

## LocalStorage keys

This UI persists a lot of layout and UX state:

* `NCZ_UI_CONN_COLLAPSED` — connection block collapsed
* `NCZ_UI_LEFTBAR_COLLAPSED` — left sidebar collapsed
* `NCZ_UI_LEFTBAR_MUSICMODE` — left sidebar in music mode
* `NCZ_UI_RIGHTINFO_COLLAPSED` — right panel collapsed
* `NCZ_UI_RIGHTINFO_WIDTH_PX` — right panel width
* `NCZ_AUTOGEN_ENABLED` — autogen enabled
* `NCZ_META_AUTHOR` — persisted author field
* `NCZ_SONGLIST_REVERSED` — Song List reverse toggle
* `NCZ_UI_CUSTOM_VIDEO_URLS` — custom lyric-video URL list (overrides videos.txt)

---

## Static assets & external scripts

### Static assets referenced

* `static/favicon.ico`
* `static/banners/chainit-1.png` etc. (optional but expected by the Chain-It banner)

### External libraries

* PayPal hosted buttons SDK is loaded in `<head>`:

  ```html
  <script src="https://www.paypal.com/sdk/js?...&components=hosted-buttons&enable-funding=venmo&currency=USD"></script>
  ```

  This page snippet doesn’t instantiate hosted buttons directly, but the SDK is available for your other UI modules to use.

### Additional scripts loaded at end

* `static/chat.js`
  Chat panel features (not documented here because it’s external to this HTML).
* `static/multipart.js`
  Upload / multipart behaviors (also external).

---

## Customization notes

### Subpath hosting (`/ace`) is first-class

Several helpers explicitly preserve subpaths:

* `absSongUrl()`
* banner `staticUrl()` logic
* metadata modal tries to infer `/songs` prefix by examining `/api_audio/` links

If you change the deployed subpath, update:

* Base URL defaulting logic in `init()`
* Banner `basePrefix()` helper
* Any hardcoded list URLs (e.g., videos.txt)

### Adding new server metadata fields

If `/songs` or `/query_result` returns extra metadata you want displayed:

* Extend `extractSongMeta()` (main list)
* Extend `buildArchiveMeta()` / `pickTitleAuthorFromAnyMeta()` (archive side)
* Extend the right panel lyrics viewer formatter (it currently prints title/author/signature/prompt/lyrics)

### Upload flow

The page currently has:

* Source file chooser UI (stores file in `window.__ncz_sourceAudioFile`)
* Preview player module
  …but the actual upload-to-server mechanics likely live in `static/multipart.js`.

---

## Troubleshooting

### “Models failed to load”

* Confirm Base URL points at the server that implements `/v1/models`
* Try **Check server** first
* Confirm CORS is allowed if UI is hosted on a different origin

### “Polling error” / stuck in queued

* Verify `/query_result` returns an array and includes your `task_id`
* Ensure your proxy isn’t stripping request bodies
* Ensure the job runner is active and can write output files

### Download filename looks wrong

This UI tries hard to set the correct download filename:

* `applyDownloadFilenameFromHref()` reads `?path=` if present, otherwise uses URL pathname
* For server list items, `downloadName` may be passed in to help derive a better basename

If your proxy uses a different query key than `path/file/name/filename`, update:

* `extractDownloadFilename()` and `applyDownloadFilenameFromHref()`

### Archive list shows duplicates or wrong titles

Archive normalization supports many server shapes, but the cleanest behavior is when `/archive/browse` returns:

* folders separately, and
* mp3 items with either inline meta OR `song.json` meta paired by basename

If your browse endpoint includes `.json` entries without `.mp3`, they will be ignored as songs (by design).

### Random lyrics video doesn’t play

Autoplay rules require the video to be muted (it is).
If it still fails:

* Check browser autoplay policies
* Verify URLs in `videos.txt` are accessible with correct CORS
* Use `window.__nczLyricsVideoList.set([...])` to test a known-good URL list

---

## Credits / Links

* Ace-Step: [https://github.com/ace-step/ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5)
* AceMusic: [https://acemusic.ai](https://acemusic.ai)
* Hosted by: [https://mequavis.com](https://mequavis.com)
* Web server reference: [https://github.com/cybershrapnel/ACE-Step-1.5/blob/main/web_server/](https://github.com/cybershrapnel/ACE-Step-1.5/blob/main/web_server/)

```

If you want, paste your **server-side endpoint docs** (the FastAPI routes for `/release_task`, `/query_result`, `/archive/browse`, `/songs`, `/users_online`) and I’ll extend the README with exact request/response schemas and examples that match your real implementation.
```
