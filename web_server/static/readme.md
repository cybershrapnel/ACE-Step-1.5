-------
chat.js
-------
(multipart.js is covered after)
-------------------------------

# NCZ Supplemental JS Patch Pack (README Addendum)

This document is a **paste-ready README.md section** that describes the “supplemental / additional JS patch files” shown in the giant patch bundle you posted.

It’s written as a **module-by-module, function-by-function** overview:
- Purpose + how it works
- DOM IDs/classes touched
- Storage keys + global state
- Dependencies on your app functions
- Internal helper functions (what they do)
- Observers/event hooks + load-order notes

> Naming note: Each `(() => { ... })();` block below is treated as one **Patch Module**.

---

## Table of Contents
- [Common Conventions](#common-conventions)
- [Patch Index](#patch-index)
- [01 — Chat Panel + Leftbar Toggle](#01--chat-panel--leftbar-toggle)
- [02 — Chat Height Resizer](#02--chat-height-resizer)
- [03 — Song List Random Mode Button](#03--song-list-random-mode-button)
- [04 — Chat Suno ▶ Add+Play + Deduper + TaskId Linkify](#04--chat-suno--addplay--deduper--taskid-linkify)
- [05 — Default Song on Page Load](#05--default-song-on-page-load)
- [06 — Suno Download Fix v2 Scoped](#06--suno-download-fix-v2-scoped)
- [07 — Song List Resizer (Sibling Handle)](#07--song-list-resizer-sibling-handle)
- [08 — Disable Reverse While Random Is ON](#08--disable-reverse-while-random-is-on)
- [09 — Dark Scrollbars for Chat Log](#09--dark-scrollbars-for-chat-log)
- [10 — Make Lyrics Button Enabler + Gemini Flash via Proxy](#10--make-lyrics-button-enabler--gemini-flash-via-proxy)
- [11 — Chat .mp3/.m4a Linkify + ▶ Add+Play (Any Domain)](#11--chat-mp3m4a-linkify--addplay-any-domain)
- [12 — Left Sidebar Resizer (Drag Right Edge)](#12--left-sidebar-resizer-drag-right-edge)
- [13 — Chat Ban List + ⛔ Block Buttons](#13--chat-ban-list--block-buttons)
- [14 — Chat Select Min-Width Override](#14--chat-select-min-width-override)
- [15 — Remove flex-wrap Only (Banlist Header Parent)](#15--remove-flex-wrap-only-banlist-header-parent)
- [16 — Producer/Riffusion Chat Link Patch + ▶ Add+Play](#16--producerriffusion-chat-link-patch--addplay)
- [17 — Chat Meta Split v5 (Toggle Timestamp + Block UI)](#17--chat-meta-split-v5-toggle-timestamp--block-ui)
- [18 — Leftbar MEQUAVIS Link Item](#18--leftbar-mequavis-link-item)
- [19 — YouTube Chat ▶ + Reusable Iframe Modal Player](#19--youtube-chat--reusable-iframe-modal-player)
- [20 — Suno /hook/ Video in Existing Video Player](#20--suno-hook-video-in-existing-video-player)
- [21 — Page Hook Embed Button (Card Insertion)](#21--page-hook-embed-button-card-insertion)
- [22 — Modal Drag + Resize (Generic NCZ Modals)](#22--modal-drag--resize-generic-ncz-modals)
- [23 — Iframe Guard (Prevent Auto-Close Unless Close Clicked)](#23--iframe-guard-prevent-auto-close-unless-close-clicked)
- [Recommended Load Order](#recommended-load-order)
- [Core App Hooks Expected](#core-app-hooks-expected)

---

## Common Conventions

### 1) Idempotency flags
Most modules start with something like:
- `if (window.__SOME_PATCH_FLAG__) return;`
- `window.__SOME_PATCH_FLAG__ = true;`

This prevents accidental double install if the patch file is injected twice.

### 2) DOM binding markers
Event listeners are typically guarded with:
- `el.dataset.__nczBound__ = "1"`
This prevents duplicate listener installs when a module re-inits after SPA remounts.

### 3) Safe playlist dedupe pattern (no splicing)
Several “chat add” patches must avoid breaking your “parallel arrays / metadata symmetry” across the UI.  
Instead of `splice()`, duplicates are “soft disabled”:
- `s.__deleted = true; s.url=""; s.src="";`
So the slot remains but becomes non-playable.

---

## Patch Index

| # | Module | Primary UI/Feature | Key Globals / Storage |
|---|--------|--------------------|------------------------|
| 01 | Chat Panel + Leftbar Toggle | Adds Chat panel + 💬 leftbar item | `NCZ_UI_CHAT_OPEN`, `NCZ_UI_CHAT_ROOM` |
| 02 | Chat Height Resizer | Drag handle resizes chat panel height | `NCZ_CHAT_HEIGHT_PX` |
| 03 | Random Mode Button | Random Next/Prev/Ended for Song List | `window.__nczRandomModeState` |
| 04 | Suno Chat ▶ | Add+Play Suno from chat + dedupe + linkify taskId | `window.__nczLastSunoChat` |
| 05 | Default Song | Adds default archive track on boot | none |
| 06 | Suno Download Fix | `#downloadLink` downloads Suno CDN when Suno playing | internal blob cache |
| 07 | Song List Resizer | Drag handle resizes `.songListWrap` | `NCZ_SONGLIST_HEIGHT_PX` |
| 08 | Disable Reverse | Locks Reverse while Random is ON | localStorage heuristics |
| 09 | Dark Scrollbars | Nice scrollbars for chat log | none |
| 10 | Make Lyrics | Enables button + sends lyrics to Gemini proxy | `window.MEQ_LYRICS_MODEL` |
| 11 | Chat Audio ▶ | Linkify `.mp3/.m4a` + add/play | internal play cache |
| 12 | Leftbar Resizer | Drag leftbar edge to resize | `NCZ_UI_LEFTBAR_WIDTH` |
| 13 | Ban List | ⛔ block users + dropdown to unblock | `NCZ_CHAT_BANLIST_USERS_V1` |
| 14 | Select MinWidth | Overrides chat select min-width | none |
| 15 | Remove flex-wrap | Header layout fix for banlist parent | none |
| 16 | Producer ▶ | Canonicalize riffusion/producer links + add/play | `window.__nczLastProducerChat` |
| 17 | Meta Split v5 | Toggle showing timestamp + block buttons | row `dataset` state |
| 18 | MEQUAVIS Link | Adds 🌐 leftbar item to open mequavis.com | none |
| 19 | YouTube ▶ Modal | Chat YouTube modal player + sound toggle | `NCZ_YT_SOUND_ON` |
| 20 | Suno Hook Video | Plays `/hook/` video in your existing `<video>` | `window.NCZ_HOOK_OG_PROXY` |
| 21 | Page Hook Button | Button inserted after “last card - 3” | embed cache |
| 22 | Modal Drag/Resize | Draggable/resizable NCZ modals | none |
| 23 | Iframe Guard | Prevent modal/iframe from disappearing | patches `remove()` |

---

## 01 — Chat Panel + Leftbar Toggle

### Purpose
Creates the Chat UI panel, wires it to your server endpoints, and adds a 💬 entry in the left sidebar to show/hide chat.

### Install / Flag
No explicit flag in snippet header, but uses idempotent DOM IDs:
- `#__ncz_chat_panel__`
- leftbar item `[data-action="chat"]`

### Key Constants
- `SID_ID = "__ncz_leftbar__"`
- `CHAT_ACTION = "chat"`
- `POLL_MS = 25000`

### Storage Keys
- `NCZ_UI_CHAT_OPEN` → `"1"` if open
- `NCZ_UI_CHAT_ROOM` → `"1".."13"` room selection

### DOM Created / Used
Created:
- `#__ncz_chat_panel__`
- `#__ncz_chat_log__`
- `#__ncz_chat_input__`
- `#__ncz_chat_send__`
- `#__ncz_chat_room__`
- `#__ncz_chat_name__`
- `#__ncz_chat_stat__`
Style injected:
- `#__ncz_chat_styles__`

Used (existing):
- `#baseUrl`, `#authMode`, `#apiKey` (if present)
- author field search:
  - `#__ncz_author_input__` OR `input[name="author"]`

### Dependencies (Server API)
Calls:
- `GET /chat/messages?room=<n>&after_id=<id>&limit=80`
- `POST /chat/send` body `{room, author, message}`

### Internal Functions (what they do)
- `escapeHtml(s)`
  - HTML-escapes message content to prevent injection.
- `normBaseUrl(u)`
  - Normalizes base URL, strips trailing slashes; defaults to `window.location.origin`.
- `getAuthorName()`
  - Reads author name from a known input; fallback `"anon"`.
- `fmtTime(ts)`
  - Accepts numeric ms timestamp or ISO string; returns `toLocaleString()`.
- `linkifyAllowed(text)`
  - Safe linkify after escaping.
  - Only allows youtube/suno/soundcloud domains.
- `apiFetch(path, {method, body})`
  - Builds URL from baseUrl + path
  - Adds Authorization header if `authMode === "header"`
  - Normalizes `{code,data}` responses.
- `ensureStyles()`
  - Injects CSS for chat panel + message rows.
- `ensureLeftbarItem()`
  - Inserts the Chat nav item right after the Music item.
- `findInsertAnchor(container)`
  - Inserts chat panel above song title area if possible.
- `ensurePanel()`
  - Creates DOM if missing, binds default state.
- `clampRoom(n)`
  - Ensures 1..13.
- `loadRoom() / saveRoom(n)`
  - localStorage wrapper.
- `loadOpen() / saveOpen(v)`
  - localStorage wrapper.
- `isNearBottom(el)`
  - Determines autoscroll behavior.
- `appendMessageRow(logEl, msg)`
  - Builds one `div.__msg__`, includes:
    - timestamp span `.__ts__`
    - username span `.__who__`
    - message span `.__txt__`
    - reply button `button.__reply__`
- `setSidebarLabel(item, isOpen)`
  - Updates leftbar label/hint/title.
- `fetchMessages({reset})`
  - Pulls messages after `lastId`, appends to log, updates `lastId`.
- `sendMessage()`
  - Posts message; optimistic append.
- `startPolling() / stopPolling()`
  - setInterval poller.
- `setOpen(nextOpen)`
  - Show/hide panel; resets lastId; triggers fetch.
- `init()`
  - Boot wiring, listeners for:
    - leftbar item click
    - room change
    - send click
    - Enter to send

### Events / Observers
- Uses `setInterval` polling when open
- Uses `window.addEventListener("load", init, {once:true})`

### Notes
- Linkify is “safe by construction” (escape first, allowlist domains after parsing).
- Reply button injects `@username` prefix, replacing any existing `@someone`.

---

## 02 — Chat Height Resizer

### Purpose
Adds a draggable bottom handle that resizes chat wrapper height and keeps `#__ncz_chat_log__` filling remaining space.

### Install / Flag
- `window.__NCZ_CHAT_RESIZER_INSTALLED__`

### Storage Key
- `NCZ_CHAT_HEIGHT_PX`

### DOM Created
- style: `#__ncz_chat_resizer_style__`
- handle: `#__ncz_chat_resizer_handle__`

### Key Helpers
- `pickChatWrapper()`
  - Picks wrapper around `#__ncz_chat_log__`, else tries common selectors.
- `getMaxHeight(chatEl)`
  - Max = viewport height minus wrapper top minus padding.
- `ensureFlexWhenVisible(chatEl)`
  - Only forces flex layout when wrapper is visible (won’t break hide/show).
- `init()`
  - Attaches handle, restores saved height, binds pointer events.
- `bootWithRetry()`
  - Retries until chat mounts, avoids “randomly doesn’t run”.

### Events / Observers
- MutationObserver on chat wrapper attributes to re-ensure flex when visible.
- MutationObserver on `document.body` to detect remount/rebuild.

---

## 03 — Song List Random Mode Button

### Purpose
Adds “Random” button near Reverse. When ON, Next/Prev/Ended navigates randomly.

### Install / State
- `window.__nczRandomModeState = { enabled, origNext, origPrev }`

### DOM Created
- button: `#__ncz_songlist_random_btn__`
- style: `#__ncz_songlist_random_style__`

### Dependencies
Prefers:
- `window.loadIntoMainPlayer(index, autoplay)`
Uses:
- `window.songs` array
- `window.currentSongIndex` OR matches by player src

### Core Helpers
- `findReverseButton()`
  - Locates Reverse button heuristically.
- `findSongListLabel()`
  - Fallback anchor for button placement.
- `getPlayableIndices()`
  - Skips `__deleted` and requires `url`.
- `currentIndex()`
  - Finds current song index from global or player src.
- `pickRandomIndex()`
  - Picks random index; avoids repeats if possible.
- `playRandom({autoplay})`
  - Forces playlist mode (`window.__nczLastPlaylist="new"`), plays via main system.
- `enableRandomMode(btn)`
  - Saves old handlers; overrides `window.__nczPlayNext/__nczPlayPrev`; plays immediately.
- `disableRandomMode(btn)`
  - Restores old handlers; does not autoplay.

### Notes
If you want other modules to reliably detect Random ON:
- optionally set `window.NCZ_RANDOM_MODE = state.enabled` whenever it changes.

---

## 04 — Chat Suno ▶ Add+Play + Deduper + TaskId Linkify

### Purpose
When a chat row contains a Suno UUID link:
- Adds green ▶ next to ↩
- Fetches `https://cdn1.suno.ai/<uuid>.mp3` → Blob URL
- Registers ONE song entry only (dedupe)
- Plays in main player
- Makes playlist “taskId” a real clickable `https://suno.com/song/<uuid>`

### Install / Flag
- No global install flag shown in your snippet, but uses:
  - `STYLE_ID = "__ncz_chat_suno_play_styles__"`
  - `BTN_CLASS = "__ncz_chat_suno_play__"`

### Globals
- `window.__nczLastSunoChat = { uuid, cdnUrl, blobUrl }`

### DOM Touch
- Chat log: `#__ncz_chat_log__`
- Adds `button.__ncz_chat_suno_play__` into each `div.__msg__`
- Tags playlist rows:
  - `data-suno-uuid`
  - `data-task-id`, `data-output-index`, etc.

### Major Helpers
- `extractUuidFromLink(a)`
  - Extracts UUID from href using `UUID_RE`.
- `isSunoDomain(a)`
  - Strict domain check for `suno.com` / subdomains.
- `buildCdnUrl(uuid)` / `buildSongPage(uuid)`
  - Constructs CDN mp3 and song page URL.
- `getBlobUrl(uuid)`
  - Fetches mp3, caches blob URL in `blobCache`.
- `pickMainPlayerEl()`
  - Picks `#player`, `audio`, or `video`.
- `playViaMainSystem(index)`
  - Prefers `loadIntoMainPlayer(index,true)`, fallback sets player src.
- `songUuidOf(s)`
  - Extracts UUID from song object fields.
- `findSongIndicesByUuid(uuid)` / `findSongIndexByUrl(url)`
  - Locates duplicates.
- `softDisableSongEntry(i)`
  - Marks duplicates unplayable (no splicing).
- `ensureSingleSongEntry(uuid, blobUrl, taskIdUrl, cdnUrl)`
  - Canonicalizes one playable entry; disables extra ones.
- `pickSongListEl()`
  - Finds “Song List” container heuristically.
- `linkifyTaskIdWithin(el, uuid)`
  - Replaces task text with anchor to Suno song page.
- `tagPlaylistEl(...)` / `tagMostLikelyNewPlaylistChild(...)`
  - Tags the DOM row after add.
- `registerWithRealPlaylist(uuid, blobUrl)`
  - Calls `addSongToList` if present, but only once.

### Observers
- MutationObserver on chat log to rescan and inject buttons.

### Notes
Blob URL memory can grow over time. If it ever becomes a problem, implement:
- LRU eviction + `URL.revokeObjectURL()`.

---

## 05 — Default Song on Page Load

### Purpose
Adds a specific archive track to playlist on boot.

### Dependencies
- `window.addSongToList` must exist eventually.

### Helpers
- `tryAdd()` → tries to add once
- `run()` → waits via MutationObserver up to 10s

---

## 06 — Suno Download Fix v2 Scoped

### Purpose
Intercepts ONLY the real `<a id="downloadLink">` inside its `section.card`.  
If current song is Suno, downloads from Suno CDN instead of whatever stale link exists.

### Install / Flag
- `window.__NCZ_SUNO_DOWNLOAD_FIX_V2__`

### Key IDs
- `DOWNLOAD_ID = "downloadLink"`
- `PLAYER_ID = "player"`

### UUID Resolution Priority
1) `window.__nczLastSunoChat.uuid`
2) UUID in current player src
3) UUID from `window.songs[currentSongIndex]`

### Helpers
- `fetchCdnBlob(uuid)` → caches Promise<Blob>
- `forceDownloadBlob(blob, filename)` → creates temporary `<a download=...>`
- `bindOnce()` → attaches listener in capture phase

---

## 07 — Song List Resizer (Sibling Handle)

### Purpose
Resizes `.songListWrap` height using a sibling handle (not inside scroll container).

### Install / Version Gate
- `VERSION = 10`
- `window.__NCZ_SONGLIST_RESIZER_VERSION__`

### Storage
- `NCZ_SONGLIST_HEIGHT_PX`

### Helpers
- `pickWrapper()` → prefers `#songList.closest(.songListWrap)`
- `readSavedPx()` → restores capped to 1000 on init
- `applyHeightImportant(wrapEl, px)` → sets `height: ... !important`
- `strongRestore(wrapEl)` → reassert saved height when stomped
- `placeHandleBelow(wrapEl, handleEl)` → ensures sibling placement
- `persistHeightPx(wrapEl)` → stores current px height
- `bootWithRetry()` → waits for mount

### Watchers
- MutationObserver on wrapper attributes (style/class/hidden)
- Optional watchdog timer to reattach handle if removed

---

## 08 — Disable Reverse While Random Is ON

### Purpose
Prevents the Reverse button from being used while Random mode is ON, and auto-clicks Reverse back to “Normal” order when enabling Random (fix reverse+random bug).

### Install / Flag
- `window.__ncz_patch_disable_reverse_when_random__`

### Dependencies / Assumptions
- Reverse button id: `__ncz_songlist_reverse_btn__`
- Random button detected by:
  - known IDs OR `button[id*="random" i]` OR text “random”

### Random Detection Strategies
1) global boolean flags (if your app sets one)
2) localStorage keys in `LS_KEYS`
3) button attributes/classes
4) fallback internal toggle

### Helpers
- `isReverseModeOn(reverseBtn)` → checks button text equals “Normal”
- `setReverseDisabled(reverseBtn, disabled)`
- `enforce()` → main policy function
- `install()` → binds capture click block on Reverse

---

## 09 — Dark Scrollbars for Chat Log

### Purpose
CSS-only theming for `#__ncz_chat_log__` scrollbars.

### DOM
- style: `#__ncz_chat_dark_scrollbars__`

---

## 10 — Make Lyrics Button Enabler + Gemini Flash via Proxy

### Purpose
Enables `#__ncz_make_lyrics_btn__` only when:
- textarea `#lyrics` length ≥ 25
- and content is not exactly equal to last AI-generated output

On click:
- POSTs to your proxy with:
  - provider `gemini`
  - model `gemini-2.5-flash` (override allowed)
- Replaces textarea with reply and disables until user edits again.

### Install / Flag
- `window.__NCZ_MAKE_LYRICS_PATCH_INSTALLED__`

### Config
- `MIN_CHARS = 25`
- `SYS_PROMPT = "Use this data to make a song, only return song lyrics and nothing else"`
- `CHAT_PROXY_URL = window.CHAT_PROXY_URL || "https://xtdevelopment.net/chat-proxy/chat-proxy.php"`
- `MODEL = window.MEQ_LYRICS_MODEL || "gemini-2.5-flash"`

### Helpers
- `setBtnVisual(btn, enabled)` → opacity/cursor/disabled
- `shouldEnable(btn, ta)` → gating logic
- `syncState(btn, ta)` → apply gate
- `callProxyMakeLyrics(text)` → fetch JSON reply

---

## 11 — Chat .mp3/.m4a Linkify + ▶ Add+Play (Any Domain)

### Purpose
Finds `.mp3` and `.m4a` URLs inside chat text and:
- converts them into clickable links (absolute or `/relative`)
- adds a green ▶ button next to each
- clicking ▶ fetches blob when possible, else uses direct URL
- registers with playlist and plays

### Install / Flag
- `window.__NCZ_CHAT_AUDIO_PLAY_INSTALLED__`

### Supported Extensions
- `EXTENSIONS = ["mp3", "m4a"]`

### Helpers (Parsing)
- `stripTrailingPunct(u)`
- `extFromPathname(pathname)`
- `isAllowedAudioUrlString(raw)`
- `toAbsoluteUrl(raw)`
- `normKey(url)` → used for dedupe cache keys
- `niceNameFromUrl(url)` → filename label

### Helpers (Play + Dedupe)
- `getPlayableUrl(originalAbsUrl)` → fetch blob if possible
- `ensureSingleSongEntryAudio({key, playUrl, originalUrl, title})`
- `registerWithRealPlaylist(...)`
- `playViaMainSystem(index)`

### Linkify Implementation
Uses a TreeWalker over text nodes in `span.__txt__` to avoid corrupting existing anchors/buttons.

---

## 12 — Left Sidebar Resizer (Drag Right Edge)

### Purpose
Adds a drag handle on the right edge of `#__ncz_leftbar__` to resize expanded width, persisting in localStorage.  
Updates the CSS variable:
- `--ncz-leftbar-expanded: <px>`

### Storage
- `NCZ_UI_LEFTBAR_WIDTH`

### DOM
- style: `#__ncz_leftbar_resize_style__`
- handle: `#__ncz_leftbar_resize_handle__`

### Helpers
- `setExpandedWidth(px)` → clamps and sets CSS var + storage
- `getSavedWidth()`
- `ensureStyle()`
- `attach(side)` → binds mouse drag listeners, capture phase
- `init()` + MutationObserver waiting for sidebar mount

---

## 13 — Chat Ban List + ⛔ Block Buttons

### Purpose
Adds:
- header dropdown “Ban List” that lists blocked users and unblocks on selection
- ⛔ button beside usernames to block them
Blocked users’ rows are hidden client-side.

### Install / Flag
- `window.__NCZ_CHAT_BANLIST_PATCH__`

### Storage
- `NCZ_CHAT_BANLIST_USERS_V1` storing `[{k,name}]`

### DOM
- dropdown: `#__ncz_chat_banlist__`
- style: `#__ncz_chat_banlist_style__`
- row hide class: `.__ncz_banned__`

### Helpers
- `normKey(s)` → casefold key
- `loadBanlist()` / `saveBanlist()`
- `ensureBanSelect()` / `refreshBanSelect(sel)`
- `ensureBlockButton(rowEl, authorName)`
- `applyBanVisibilityToRow(rowEl)` / `applyBanVisibilityToAll()`
- `attachDelegatedClick(logEl)` → capture click on ⛔
- `watchNewMessages(logEl)` → hides newly added rows if banned

---

## 14 — Chat Select Min-Width Override

### Purpose
Overrides earlier chat CSS so selects can fit tighter:
- `#__ncz_chat_panel__ select { min-width: 55px !important; }`

### DOM
- style: `#__ncz_chat_select_minwidth0__`

---

## 15 — Remove flex-wrap Only (Banlist Header Parent)

### Purpose
Removes `flex-wrap: wrap` from the immediate parent of `#__ncz_chat_banlist__` to prevent wrapping/stacking in header.

### Technique
- Removes inline `flex-wrap` property
- Also cleans raw style attribute string as a fallback

---

## 16 — Producer/Riffusion Chat Link Patch + ▶ Add+Play

### Purpose
Detects links:
- `classic.riffusion.com/song/<uuid>`
- `producer.ai/song/<uuid>`
Then:
- rewrites href to canonical: `https://www.producer.ai/song/<uuid>`
- injects green ▶
- plays audio from: `https://storage.googleapis.com/producer-app-public/clips/<uuid>.m4a`
- adds to playlist via `window.addSongToList`

### Install / Flag
- `window.__NCZ_CHAT_PRODUCER_PLAY_INSTALLED__`

### Globals
- `window.__nczLastProducerChat = { uuid, pageUrl, audioUrl, playUrl }`

### Helpers
- `parseProducerOrRiffusionUrl(rawUrl)` → strict host allowlist + `/song/<uuid>`
- `canonicalProducerPage(uuid)`
- `buildAudioUrl(uuid)`
- `getPlayableUrlForUuid(uuid)` → blob cache; fallback to direct URL
- `ensureSingleSongEntryProducer(uuid, playUrl)` → dedupe in `window.songs`
- `registerWithRealPlaylistProducer(uuid, blobUrl)` → addSongToList + DOM tagging
- `linkifyProducerLinksInTxtSpan(txtSpan)` → safely linkifies inside message text

---

## 17 — Chat Meta Split v5 (Toggle Timestamp + Block UI)

### Purpose
Reformats each chat row into flex with a left “meta bar” containing:
- toggle button (triangle)
- timestamp `.__ts__`
- block buttons `.__ncz_block_btn__`

Default: timestamp + block hidden. Toggle shows both.

### Install / Flag
- `window.__NCZ_CHAT_TS_SPLIT_V5_INSTALLED__`

### Key Safety Rule
**Never touches anything inside `span.__txt__`** (so it remains linkify-safe).

### Helpers
- `ensureMetaBar(row)` → creates `. __ncz_meta_bar__`
- `moveIntoMeta(el)` → moves `.__ts__` and block buttons into bar
- `patchRow(row)` → initializes row open/closed state, moves elements
- `processAddedNode(n)` → handles injected block buttons later

### Row State
- `row.dataset.__nczMetaInit`
- `row.dataset.__nczMetaOpen` ("1"/"0")

---

## 18 — Leftbar MEQUAVIS Link Item

### Purpose
Adds a leftbar item that opens:
- `https://mequavis.com/`

### DOM
- `#__ncz_lb_mequavis_link__` appended to `#__ncz_leftbar__ .__ncz_lb_body__`

---

## 19 — YouTube Chat ▶ + Reusable Iframe Modal Player

### Purpose
For YouTube links in chat:
- Injects ▶ next to link
- Opens a modal with an iframe player
- Attempts autoplay and sound toggling via YouTube JS postMessage commands
- Reuses the iframe instead of rebuilding
- Pauses other media players before starting

### Install / Flag
- `window.__NCZ_YT_IFRAME_PATCH__`

### Storage
- `NCZ_YT_SOUND_ON` ("1" or "0")

### DOM
- style: `#__ncz_youtube_iframe_style__`
- modal: `#__ncz_youtube_modal__`
- iframe: `#__ncz_youtube_iframe__`

### Helpers
- `pauseOtherMediaPlayers()`
- `extractYouTubeIdAndStart(href)` → supports youtu.be, watch?v=, shorts, live, embed
- `buildEmbedUrl(id, start)`
- `ytCmd(iframe, func, args)` → postMessage wrapper
- `kickPlayback(iframe, wantSound)` → multiple timed bursts for reliability
- `fetchTitleViaOgProxy(watchUrl, id)` → uses OG proxy and caches titles

### Notes
Browser autoplay rules still apply; this patch is “best effort” after user click.

---

## 20 — Suno Hook Video in Existing Video Player

### Purpose
If a chat row contains `https://suno.com/hook/<uuid>`:
- intercepts click on Suno ▶ (`.__ncz_chat_suno_play__`)
- pauses main audio `#player`
- waits `LOAD_DELAY_MS` then plays MP4 in:
  - `<video id="__ncz_right_lyrics_video__">`
- shows controls + unmutes during hook playback
- re-mutes/hides controls when other media starts

### Install / Flag
- `window.__NCZ_SUNO_HOOK_VIDEOPLAYER_PATCH__`

### Config
- `LOAD_DELAY_MS = 300`

### OG Proxy Override
- default: `https://xtdevelopment.net/og-proxy/?ttl=86400&url=`
- override:
  - `window.NCZ_HOOK_OG_PROXY` (string base OR function)

### Helpers (high level)
- `canonicalHookUrlFromAnySunoUrl(href)` → extracts hook UUID
- `resolveEmbedUrlForHook(uuid, hookUrl)` → OG JSON + HTML fallbacks + guesses
- `guessHookCdnMp4(uuid)` → `https://cdn1.suno.ai/hook_<uuid>.mp4`
- `playHookDelayed(uuid, token)` → pause audio now, delay setting `video.src`
- `armGuessErrorFallback(...)` → if guessed mp4 fails, swap to resolved
- `installMediaPlayWatcher()` → re-mutes video when other media starts
- `armAntiPauseRetry(v, token)` → attempts replay if another script pauses quickly

### Load Order Requirement
This patch must be loaded **after** the Suno chat ▶ patch because it intercepts that button.

---

## 21 — Page Hook Embed Button (Card Insertion)

### Purpose
Inserts a page button after “last card - 3” that opens a specific hook in an iframe modal using OG/Twitter player URLs.

### Install / Flag
- `window.__NCZ_PAGE_HOOK_EMBED_BTN_PATCH__`

### Target Hook
- `HOOK_URL = "https://suno.com/hook/2aad90ed-20c6-4ee1-ad45-43c28ac25c41"`

### DOM
- wrap: `#__ncz_page_hook_embed_wrap__`
- button: `#__ncz_page_hook_embed_btn__`
- modal: `#__ncz_page_hook_embed_modal__`
- iframe: `#__ncz_page_hook_embed_iframe__`

### Helpers
- `insertAfterLastMinus3Card(wrap)`
- `fetchHtmlWithFallbacks(url)` → tries direct, user proxy, AllOrigins, Jina
- `pickEmbedFromDoc(doc, hookUrl, uuid)` → OG/twitter meta parsing
- `resolveEmbedUrlForHook(uuid, hookUrl)` → embed cache + guesses

---

## 22 — Modal Drag + Resize (Generic NCZ Modals)

### Purpose
Makes NCZ modals draggable by header and resizable via a top-left 📌 pin.

### Install / Flag
- `window.__NCZ_MODAL_DRAG_RESIZE_PATCH__`

### Requirements
Modal structure must roughly match:
- `div#..._modal__`
  - `div.__box__`
    - `div.__hdr__`

### Helpers
- `centerInit(box)` → converts box to fixed + px-based and centers
- `clampBox(box)` → ensures within viewport, enforces min sizes
- `ensureHandle(box, hdr)` → inserts pin button
- pointer handlers on header for drag
- pointer handlers on pin for resize

---

## 23 — Iframe Guard (Prevent Auto-Close Unless Close Clicked)

### Purpose
Prevents the `#__ncz_page_hook_embed_iframe__` modal/container from being removed/hidden unless a “Close” button is clicked.

### Behavior
- Patches `container.remove()` and `iframe.remove()` to restore instead of remove
- Patches parent `removeChild()` to block removing those nodes
- MutationObserver watches for:
  - `display:none`, `hidden`, `aria-hidden`, etc.
- Heartbeat restore every 500ms
- Disarms permanently if a Close-looking button is clicked (capture phase)

### Caution
This is intentionally aggressive. If a modal becomes “impossible to close” or fights your UI, disable this module first.

---

## Recommended Load Order

1) Core app scripts (playlist + player)
2) Chat Panel + Leftbar Toggle (01)
3) Chat resizer + scrollbars (02, 09)
4) Banlist + meta split (13, 17)  
5) Song list random + disable reverse (03, 08)
6) Suno chat ▶ (04)
7) Suno hook video interceptor (20) **after 04**
8) Producer/riffusion ▶ (16)
9) Generic chat audio ▶ (11)
10) YouTube ▶ modal (19)
11) Leftbar resizer (12), MEQUAVIS link (18)
12) Page hook embed button + draggable modals (21, 22)
13) Iframe guard (23) only if needed
14) Suno download fix (06) anywhere after `#downloadLink` exists
15) Default song add (05) anytime after `addSongToList` exists

---

## Core App Hooks Expected

These modules work best if your app provides:

### Playlist + Playback
- `window.addSongToList(url, meta)`
  - Should add to the Song List UI and ideally return the created row element.
- `window.loadIntoMainPlayer(index, autoplay)`
  - Plays from `window.songs[index]`.

### Shared State (optional but helpful)
- `window.songs` (array of song objects)
- `window.currentSongIndex` (number)
- `window.__nczLastPlaylist` (string like `"new"` for navigation semantics)

### Expected DOM Players
- Main audio:
  - `<audio id="player">`
- Right video:
  - `<video id="__ncz_right_lyrics_video__" muted ...>`

---







------------
multipart.sj
------------


