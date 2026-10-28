---
name: ritmo-sounds
description: "Apply whenever a game's sound effects are made, changed, or reviewed with a person. Says how to write sounds as recipes in a bank, check them with `ritmo-tools sound`, offer takes, open the review page, and act on the person's notes."
---

# Game sounds with `ritmo-tools sound`

`ritmo-tools sound` keeps a game's sounds as JSON recipes in one bank file. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools sound <command>` (add the package as a dev dependency to pin it to the game's Ritmo version). Below, `sound <command>` stands for that; `sound <command> --help` lists every flag, and the package's README lists the layer types and their fields. You cannot hear the sounds: you write and measure, the person listens and decides. Every command prints JSON and exits 0 (clean; warnings are your call), 2 (usage error, missing file, broken bank: read `problems`), or 3 (a sound has errors: fix its recipe).

## The loop

1. **Write or change recipes** in the bank (`sound init` starts one). Give each sound an `about`: what it is for, in a few words; the person reads it. Layer types and fields are in the README; `sound check` names any field that is wrong.
2. **Check** with `sound check <bank>`: fix every error (clipping, silence, empty) before showing it; weigh warnings (much louder or quieter than its kind, a late start, a click at the end).
3. **Offer takes** where you are unsure, or where the person asked for a direction: `sound vary <bank> <name> --toward heavier`. Picking among four takes is quicker and surer for the person than describing a sound.
4. **Open the review**: `sound review <bank>` (add `--host` for a phone; it runs until stopped, so start it in the background), and send the person the `url` it prints. Tell them which sounds to listen to and what you changed.
5. **Read back** with `sound notes <bank>`: each sound's status and note, changes first. A take the person picked is already the sound in the bank; a tune they set is the recipe's `tune`. Act on each note, then go back to 2.

## Rules

- Never call a sound done because it checks clean: only the person's `approved` says it sounds right.
- Keep the person's `tune` when you change a recipe, unless their note asks otherwise; fold it in (change the layers, drop the tune) only when they agree.
- One bank per game. Keep similar sounds similar: a family (hits, UI) shares instruments and loudness, so `sound check`'s kind comparison stays meaningful.
- `sound render <bank> -o <dir>` writes WAV files when the game needs the sounds: the game plays the files, and its own audio code carries a recipe's `heavy` (duck the others for a moment) and `interval` (the least time between two plays).
