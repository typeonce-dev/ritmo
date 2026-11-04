---
name: ritmo-music
description: "Apply whenever a game's music is made, changed, or reviewed with a person, songs or plain audio files. Says how to turn the person's hum or reference into a song with `ritmo-tools music`, write tracks of notes, check them, open the review page on all the music, and act on the person's comments and edits."
---

# Game music with `ritmo-tools music`

`ritmo-tools music` keeps a piece of game music as one JSON song: a tempo, a key, bars, and tracks of notes, each track one instrument. It ships in `@typeonce/ritmo-tools`: run it as `npx @typeonce/ritmo-tools music <command>` (add the package as a dev dependency to pin it to the game's Ritmo version). Below, `music <command>` stands for that; `music <command> --help` lists every flag, and the package's README has the song format. You cannot hear: the tool listens for you (`music listen`), you write notes and measure them (`music check`), and the person listens and decides. Every command prints JSON and exits 0 (clean; warnings are your call), 2 (usage error, missing file, broken song: read `problems`), or 3 (errors: the song clips or is silent).

## The loop

1. **Start from the person's reference.** Ask for one: a hum, a whistle, a tapped beat, or a recording of one voice, recorded on the review page or given as a WAV (a full song gives its tempo and key, not its tune: `music listen` says so). `music listen <song> <audio.wav>` writes what it heard into the song's `reference` (tempo, key, the melody as notes) and makes the song if it does not exist. With no reference, ask for a mood, a place in the game, and instruments, and start from `music init`.
2. **Write the tracks** around the reference. `music instruments` lists the instruments, their ranges, the drums, and the scales. Keep the reference's melody (an octave up or down to fit the instrument is fine), cleaned up and in the key; add chords, a bass line, and drums that suit the person's direction. For rock, drum & bass, or electronic music, use `rockGuitar`, `reese`, `synthLead`, and the `breaks` kit, and set `"compressor": true`: the other voices sound acoustic or retro. Give the song an `about`: what it is for, in a sentence; the person reads it.
3. **Check** with `music check <song>`: fix every error, weigh the warnings (notes outside the key or an instrument's range, a buried track, a doubled note, a melody that wandered from the reference: `follows` says how closely the closest track plays the reference's notes).
4. **Open the review**: `music review <paths...>` with the folders the game's music is in, or one song (add `--host` for a phone; it runs until stopped, so start it in the background), and send the person the `url` it prints. Say what you wrote and where to listen.
5. **Read back** with `music notes <paths...>`, the same paths: a `summary`, then under `music` each piece's status, the person's note, comments pinned to bars (and a track), and the edits they made by hand, changes first. Their edits are already in the song: keep them. Act on each comment in its bars, then go back to 3.

## Music that is not a song

A plain audio file (`.wav`, `.flac`, `.mp3`, `.ogg`, `.m4a`) goes through the same review: the person hears it as it is, approves it or asks for changes, and comments on a stretch of it, so `music notes` gives those comments as times. There are no notes to edit. Open the files the game plays when what it plays differs from what the page's instruments play, a mix from the game's own renderer say: that is what the person should judge. A folder that ships with the game stays clean: these reviews live in one `music.review.json` beside the game's `package.json`.

## Rules

- Never call a song done because it checks clean: only the person's `approved` says it sounds right.
- `changedSinceApproved` on a piece means it no longer matches what the person approved. Tell them what changed and ask them to listen again; approving is theirs.
- Change only what a comment asks for, in its bars and track; the rest of the song stays as the person last heard it.
- Game music mostly loops (`loop`, on by default): write whole bars, and let the last bar lead back into the first.
- Keep the song's tempo equal to the reference's, or the reference sits off the grid (`music listen` and the page say so).
- `music render <song>` writes the WAV the game plays (a looping song loops without a seam) and a MIDI file of the notes; `--stems` writes each track alone, for a game that layers them (calm, then drums join in a fight). Playing them in the game is the game's own audio code.
