#!/usr/bin/env python3
"""
Watch the script's directory for new folders named like: batch_1771301445
Every 20 seconds:
- Only do anything if there are >= 5 unprocessed new folders
- Process ONLY ONE folder per poll
- Always pick the OLDEST unprocessed folder first
- Open the first .mp3 inside it (default OS app)
- I use Winamp, and I set mp3 files to open in winamp by default.
- Then I set songs to enqueue by default in winamp options instead of play by default that way the queue up in order.
- You can use whatever player or option you want of course.
- Put this python script in the gradio_outputs folder and run it from that directory.
"""

import os
import re
import time
import subprocess
from pathlib import Path

POLL_SECONDS = 20
MIN_BACKLOG = 5
BATCH_RE = re.compile(r"^batch_\d+$")

def open_file(path: Path) -> None:
    """Open a file with the default application (cross-platform)."""
    path = path.resolve()
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif os.name == "posix" and getattr(__import__("sys"), "platform", "") == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)

def find_first_mp3(folder: Path) -> Path | None:
    """Return the first mp3 found in folder (including nested), or None."""
    matches = sorted(folder.glob("**/*.mp3"))
    return matches[0] if matches else None

def list_batch_folders(base: Path) -> set[Path]:
    """Return set of existing batch_* folders in base dir."""
    out: set[Path] = set()
    for p in base.iterdir():
        if p.is_dir() and BATCH_RE.match(p.name):
            out.add(p.resolve())
    return out

def oldest_first(paths: set[Path]) -> list[Path]:
    """Sort folders by mtime ascending (oldest first)."""
    return sorted(paths, key=lambda p: p.stat().st_mtime)

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent
    processed = set()  # folders we have attempted to open an mp3 for

    print(f"[watch] Base dir: {base_dir}")
    print(f"[watch] Polling every {POLL_SECONDS}s | backlog gate: >= {MIN_BACKLOG} new folders")

    while True:
        try:
            time.sleep(POLL_SECONDS)

            existing = list_batch_folders(base_dir)
            unprocessed = existing - processed

            backlog = len(unprocessed)
            if backlog < MIN_BACKLOG:
                print(f"[watch] Backlog {backlog} (<{MIN_BACKLOG}) - waiting...")
                continue

            # Process exactly ONE: the oldest unprocessed folder
            folder = oldest_first(unprocessed)[0]
            print(f"[watch] Processing oldest unprocessed: {folder.name} (backlog={backlog})")

            mp3 = find_first_mp3(folder)
            if mp3:
                print(f"[watch] Opening: {mp3}")
                open_file(mp3)
            else:
                print(f"[watch] No mp3 found in {folder.name}")

            # Mark as processed whether or not mp3 was found,
            # so we don't get stuck on a bad folder forever.
            processed.add(folder.resolve())

        except KeyboardInterrupt:
            print("\n[watch] Stopped.")
            break
        except Exception as e:
            print(f"[watch] Error: {e}")
