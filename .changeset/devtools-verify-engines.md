---
"@typeonce/ritmo-devtools": minor
---

Add `ritmo-devtools verify <entry> <replay> --engines node,chromium,webkit,firefox`: plays a replay in Node (twice, and against its recording) and in real browser engines, and prints the first tick whose world differs with every value that differs there. Exit code 1 on a difference or an engine that did not run, 2 on a usage error; `--json` for JSON. `<entry>` exports `replayTarget`, the `make(playback)` factory `Replay.session` takes.

The same check from code is the new `Verify` module (`Verify.acrossEngines(make, file, { engines })`, returning `Verified` or `ReplayInvalid` / `NotVerified` with one `Agreed`, `Diverged`, `EngineMissing`, or `EngineFailed` outcome per engine), and the new `PlaywrightEngine` module (Node host) runs Chromium, WebKit, and Firefox headless. `playwright` and `vite` are optional peer dependencies, needed only for browser engines; `--engines node` needs neither.
