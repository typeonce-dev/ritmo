---
"@typeonce/ritmo-tools": minor
---

The review pages answer only on this machine, and no longer lose what the agent wrote; every tool's `notes` reports the same things; and bad input is refused with what to change.

- **Review servers.** A request whose `Host` is not `localhost`, `127.0.0.1`, or `[::1]` on the page's port (or, with `--host`, an address the server printed) gets 403, so a web page open elsewhere cannot reach a game's files by DNS rebinding. `fx review` reads a draft or a stand-in only inside the bank's folder, links followed, and `music review` writes only the song's hum (`<name>.song.reference.wav`, a WAV).
- **No lost writes.** Every bank, review, and song save from a page carries the version of the file the page read; when the agent wrote the file meanwhile (takes from `sound vary`, a rewritten song, a resolved comment), the server answers 409 and writes nothing, and the page lays the person's change over the agent's and saves again. A save that fails stays owed on the sound and fx pages, as on the music page. Pages, servers, and commands write each file whole (to a file beside it, then renamed).
- **Notes.** `sound notes`, `fx notes`, and `music notes` list `gone` as `pixel notes` does: what was said about a sound or effect the bank no longer has, a song's review with no song beside it, or a plain audio file's review whose file is gone, with where to move or remove it; every summary counts them. An approval with no record of what was seen (from an older version, or edited by hand) is `unrecorded: true`, its `next` says to ask the person to look again, and it is no longer counted among the approved in any tool.
- **Limits.** Pictures are read up to 4096 × 4096 pixels in all and 16384 on a side; a header claiming more is refused before decoding instead of running for minutes. `pixel bake` draws at most 1024 frames of at most 1024 art pixels on a side, and a cylinder has at most 256 `sides`. In the CLI, an fx draft's `draw` that runs past 5 seconds on a frame is stopped and is an error: "draw did not return within 5 s on frame F" (`fx check` and `fx look` exit 3). An unexpected throw prints one line, `<tool> <command> failed: <message>`, with no stack, and exits 1.

**Breaking:** these are refused now where they were taken before. Each says what to change:

- A key `pixel.config.json`, a pixel recipe, a sound bank or recipe, an fx bank, or a song does not know: `unknown key maxColours: did you mean maxColors?`, exit 2. Rename or remove the key. `pixel.config.json` also lists every problem now, not the first.
- An fx bank's draft `file` or `standIn.file` that is absolute or has a `..` in it. Keep the bank in a folder that holds its drafts and art:

  ```diff
  -fx/game.fx.json   { "standIn": { "file": "../public/art/hero.png", ... } }
  +game.fx.json      { "standIn": { "file": "public/art/hero.png", ... } }
  ```

- A number flag outside its range, which some commands clamped or took: `--count` 1 to 12 (it was clamped), `--sequence` 0 to 10, `--cleanup` 0 to 64, `--shrink-to`, `--width`, and `--height` 1 to 16384, `--scale` 1 to 32, `--colors` 1 to 256, `--columns` 1 to 1024 (`fx look`: 1 to 64), `--spacing` 0 to 64, `--strength` 1 to 400, `--fps` 0.1 to 120, `--tempo` 30 to 300, and `--port` 1 to 65535. The usage error names the flag, the value, and the range (exit 2); pass a value inside it. `pixel sheet --boxes` takes only boxes inside the picture, and `--skip` only frames the sheet has.
