---
name: ritmo-music
description: "Apply whenever a game's music is made, changed, or reviewed with a person. Says how to turn the person's hum or reference into a song with `ritmo-tools music`, write tracks of notes, check them, open the review page, and act on the person's comments and edits."
---

# Game music with `ritmo-tools music`

`ritmo-tools music` keeps a piece of game music as one JSON song: a tempo, a key, bars, and tracks of notes, each track one instrument. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools music <command>` (add the package as a dev dependency to pin it to the game's Ritmo version). Below, `music <command>` stands for that; `music <command> --help` lists every flag, and the package's README has the song format. You cannot hear: the tool listens for you (`music listen`), you write notes and measure them (`music check`), and the person listens and decides. Every command prints JSON and exits 0 (clean; warnings are your call), 2 (usage error, missing file, broken song: read `problems`), or 3 (errors: the song clips or is silent).

## The loop

1. **Start from the person's reference.** Ask for one: a hum, a whistle, a tapped beat, or a recording, recorded on the review page or given as a WAV. `music listen <song> <audio.wav>` writes what it heard into the song's `reference` (tempo, key, the melody as notes) and makes the song if it does not exist. With no reference, ask for a mood, a place in the game, and instruments, and start from `music init`.
2. **Write the tracks** around the reference. `music instruments` lists the instruments, their ranges, the drums, and the scales. Keep the reference's melody (an octave up or down to fit the instrument is fine), cleaned up and in the key; add chords, a bass line, and drums that suit the person's direction. Give the song an `about`: what it is for, in a sentence; the person reads it.
3. **Check** with `music check <song>`: fix every error, weigh the warnings (notes outside the key or an instrument's range, a buried track, a doubled note, a melody that wandered from the reference: `follows` says how closely the closest track plays the reference's notes).
4. **Open the review**: `music review <song>` (add `--host` for a phone; it runs until stopped, so start it in the background) and send the person the `url` it prints. Say what you wrote and where to listen.
5. **Read back** with `music notes <song>`: the status, the person's note, comments pinned to bars (and a track), and the edits they made by hand. Their edits are already in the song: keep them. Act on each comment in its bars, then go back to 3.

## Rules

- Never call a song done because it checks clean: only the person's `approved` says it sounds right.
- Change only what a comment asks for, in its bars and track; the rest of the song stays as the person last heard it.
- Game music mostly loops (`loop`, on by default): write whole bars, and let the last bar lead back into the first.
- Keep the song's tempo equal to the reference's, or the reference sits off the grid (`music listen` and the page say so).
- `music render <song>` writes the WAV the game plays (a looping song loops without a seam) and a MIDI file of the notes; `--stems` writes each track alone, for a game that layers them (calm, then drums join in a fight). Playing them in the game is the game's own audio code.
