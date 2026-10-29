---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": minor
---

`ritmo-tools music`: game music as JSON songs (a tempo, a key, bars, and tracks of notes, each track one of sixteen synthesized instruments: piano, electric piano, acoustic and distorted guitar, bass guitar and a reese bass, strings, flute, marimba, bells, a pad, a supersaw lead, two chiptune voices, and a clean and a punchy drum kit; `"compressor": true` squeezes a rock or electronic song louder and punchier). `music listen <song> <audio.wav>` hears a hum, a whistle, a tapped beat, or a recording and writes its tempo, key, and melody into the song as its reference, for the agent to build the song around; a voice that sits off pitch the whole way is heard in tune. `music check` measures the song and lists what usually sounds wrong (clipping, notes outside the key or an instrument's range, a buried track, a melody that wandered from the reference); `music render` writes a seamless looping WAV, a MIDI file, and with `--stems` each track alone. `music review <song>` opens a local page where a person plays the song, records a hum from the microphone, edits notes on a grid, swaps instruments, and comments on bars; `music notes` gives the agent the comments and a list of the person's edits.

`@typeonce/ritmo` ships a new skill, `skills/ritmo-music`. Link it next to the others:

```sh
ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-music .agents/skills/ritmo-music
```
