---
"@typeonce/oxlint-plugin-ritmo": patch
---

`ritmo/handle-runtime-result` no longer reports a `tick`, `tryTick`, `restore`, or `rewind` result passed to a function: that function is a helper that checks it (`expectOk(runtime.tick(update))`, `orCrash(runtime.tick(setup), "Setup")`). It still reports one passed to `JSON.stringify`, `String`, or `console.*`, and any unchecked `snapshot()` or `checksum()` result, which is data on its way to a save or a log. Spirit Call's 180 reports on 0.16.0 were all checking helpers.
