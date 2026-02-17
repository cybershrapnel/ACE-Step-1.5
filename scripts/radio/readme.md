```md
# YouTube Live “AI Radio Station” (ACE 1.5 + Gradio Auto-Next + Auto Queue)

Turn **ACE 1.5 AI Music Generator (Gradio UI)** into a continuous **YouTube Live radio station** by:
1) auto-clicking Gradio’s **“Next ▶”** button as soon as it’s enabled, and  
2) auto-enqueueing newly-generated **.mp3** outputs into your music player, which you then stream to YouTube via OBS.

This repo contains two scripts that work together:

- **Tampermonkey UserScript**: clicks **Next ▶** every 10 seconds when it becomes enabled.
- **Python watcher**: watches `gradio_outputs/` for new `batch_*` folders and opens the first `.mp3` found (so your player queues it).

---

## Repo Contents

Suggested layout:

```

.
├─ userscripts/
│  └─ ace_autonext.user.js
├─ gradio_outputs/
│  ├─ auto_queue.py
│  └─ (ACE writes batch_* folders here)
└─ README.md

```

> The Python script expects to live **inside** `gradio_outputs/` and be run from there (it uses its own directory as the watch folder).

---

## What You Need

### Required
- **ACE 1.5** running in a **Gradio** web UI that has a **“Next ▶”** button.
- **AutoGen** enabled in ACE (so pressing Next continues generating).
- **Python 3.10+** (the script uses `Path | None` type syntax).
- A music player that can **enqueue** files when opened (example: Winamp).

### For YouTube Live
- **OBS Studio**
- A way to capture your player audio into OBS:
  - Windows: “Desktop Audio” may be enough, or use a virtual audio cable for cleaner routing.
  - macOS: often requires a loopback driver to capture system audio.
  - Linux: PulseAudio/PipeWire routing.

> **Important:** Make sure your stream content complies with YouTube’s policies (copyright, monetization rules, etc.). If you’re generating music with AI, keep your prompts/samples/inputs within rights you own or have permission to use.

---

## How It Works (High Level)

```

ACE 1.5 (Gradio UI)
|
|  (UserScript clicks "Next ▶" whenever enabled)
v
New output saved to: gradio_outputs/batch_##########
|
|  (auto_queue.py detects backlog, opens oldest .mp3)
v
Music player queue (Winamp/VLC/etc.)
|
|  (OBS captures audio output)
v
YouTube Live stream

````

---

## Step-by-Step Setup

### 1) Run ACE 1.5 so outputs land in `gradio_outputs/`
Configure ACE/Gradio so generated audio files are written to:

- `./gradio_outputs/batch_<timestamp>/... .mp3`

Your Python watcher looks for folders named exactly like:
- `batch_1771301445` (pattern: `batch_` + digits)

If ACE outputs elsewhere, either:
- change ACE’s output directory to `gradio_outputs/`, or
- move/modify the watcher script to point at the correct folder.

---

### 2) Install the “Auto Next” UserScript (Tampermonkey)

1. Install **Tampermonkey** (Chrome/Firefox/Edge extension).
2. Create a new script and paste the contents of `userscripts/ace_autonext.user.js`.
3. **IMPORTANT:** Narrow the `@match` so it only runs on your Gradio page.

Right now the script uses:

```js
// @match        *://*/*
````

That’s intentionally broad but not ideal. Change it to something like:

```js
// @match        http://127.0.0.1:7860/*
// or
// @match        http://localhost:7860/*
// or your exact gradio domain:
/// @match       https://your-gradio-host.example.com/*
```

4. Open your ACE Gradio page and confirm the console shows:

* `[AutoNext] Running...`
* and it clicks when the button is enabled.

**What it does:** every 10 seconds it searches for a `<button>` containing the text `Next ▶`.
When the button is not disabled, it clicks it.

---

### 3) Set up your music player to ENQUEUE (not “play now”)

**Windows + Winamp (example)**

* Set `.mp3` files to open with Winamp by default.
* In Winamp preferences, enable the option that makes files **enqueue** instead of immediately playing (wording varies by version/skin).

**Other players**

* VLC and others can work, but behavior varies by OS. The watcher uses the OS default “open” action, so the key is: “opening an mp3 adds it to a queue”.

---

### 4) Run the Python watcher in `gradio_outputs/`

Open a terminal **in** `gradio_outputs/` and run:

```bash
python auto_queue.py
```

You should see logs like:

* `[watch] Base dir: .../gradio_outputs`
* `[watch] Polling every 20s | backlog gate: >= 5 new folders`
* `[watch] Backlog 2 (<5) - waiting...`
* `[watch] Processing oldest unprocessed: batch_...`
* `[watch] Opening: ...somefile.mp3`

**Why the backlog gate exists:** it waits until there are at least 5 unprocessed batches so you don’t starve the player and end up with dead air.

---

### 5) Configure OBS to stream audio to YouTube Live

1. Install **OBS Studio**

2. Add sources as needed (optional visuals):

   * Image/video loop background
   * Text overlays (“Now Playing”, etc. — manual unless you add metadata)

3. Configure audio capture:

   * If your player outputs to system audio and OBS “Desktop Audio” captures it, you’re done.
   * If you want cleaner routing, use a virtual cable / loopback route and set OBS to capture that device.

4. In OBS:

   * Settings → Stream → select YouTube / paste stream key (or connect account)
   * Settings → Output → choose bitrate/encoder appropriate for your system

5. Start Streaming.

---

## Configuration Options

### UserScript (JS)

* `INTERVAL_MS = 10_000`
  How often it checks the button state.

* Button text it searches for:

  * `"Next ▶"`
    If your UI uses different text (or icon-only), you’ll need to update `findNextButton()`.

### Python watcher (auto_queue.py)

* `POLL_SECONDS = 20`
  How often it scans for new batches.

* `MIN_BACKLOG = 5`
  Minimum number of unprocessed `batch_*` folders required before it opens anything.

* Picks **exactly one** batch per poll and always the **oldest** unprocessed folder first.



