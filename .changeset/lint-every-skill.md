---
"@typeonce/ritmo-devtools": patch
---

`ritmo-devtools lint` notes every skill `@typeonce/ritmo` ships that the project does not link, read from the installed package's `skills` folder. It checked only `ritmo`, `ritmo-prototype`, `ritmo-onboarding`, and `ritmo-polish`, so an unlinked or copied `ritmo-pixel-art`, `ritmo-fx`, `ritmo-sounds`, or `ritmo-music` went unnoticed. The README's replay recorder snippet now imports `ReplayViteSink` and `ReplayVitePlugin` from their subpaths and records with `HostClock.standard`, and its list of `run.data.stop` reasons is complete.
