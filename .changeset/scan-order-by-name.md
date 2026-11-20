---
"@typeonce/ritmo-devtools": patch
---

`ritmo-devtools scan` lists packages in the same order on every machine. It ordered their names with `localeCompare`, which follows the machine's language; it now compares the names themselves, so two names that differ in case or punctuation can change places in the output (and in `--json`'s `packages`).
