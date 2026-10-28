---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": minor
---

`ritmo-tools sound`: game sounds as JSON recipes. Agents write sounds into one bank file, check them (`sound check`: length, loudness, clipping, a late start, a click at the end, much louder or quieter than their kind), make takes nudged one way (`sound vary --toward heavier`), and write WAV files (`sound render`). `sound review <bank>` opens a local page where a person listens, picks among takes, tunes with sliders, and approves or notes each sound; `sound notes` gives the agent the person's answers.

`@typeonce/ritmo` ships a new skill, `skills/ritmo-sounds`. Link it next to the others:

```sh
ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-sounds .agents/skills/ritmo-sounds
```
