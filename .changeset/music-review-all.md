---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools music` and `sound`: review all of a game's music on one page, and see when something approved has changed.

- **`music review` takes songs, audio files, and folders**, and shows them all on a list with each one's status, filtered by what is left to do. A folder is searched for `*.song.json` and audio files, leaving out what the tool wrote beside a song (its render, its stems, its hum). What the person has not saved yet is written before another piece opens.
- **Plain audio files can be reviewed** (`.wav`, `.flac`, `.mp3`, `.ogg`, `.m4a`): play, loop, hear the loop point, read the length, loudness, and peak, approve or ask for changes, and comment on a stretch of time. Their reviews live in one `music.review.json` beside the game's `package.json`, not beside the files, since those often sit in a folder that ships with the game.
- **Approval keeps what the person heard**, in `music` and `sound` as it already did in `fx`. When an approved song, sound, or file later differs, `music notes`, `music render`, `sound notes`, and `sound render` list `changedSinceApproved`, and the page shows it with **Approve it as it is now**. The status stays approved: only the person changes it. An edit to words alone (an `about`, a track's name) is no change. A review from before this keeps its approval, with nothing to compare against until it is approved again.
- The music page checks a song in a worker, so a long song no longer holds the page for seconds when it opens, and going back to a song is instant.

Breaking: `music notes` now prints `{ summary, music: [...] }` for any paths, one entry per piece, with `file`, `kind`, and `review` beside what it printed before. Replace `.status`, `.note`, `.comments`, `.edits`, and `.next` with `.music[0].status` and so on. `music review` prints `music` (the list of what it found) in place of `song` and `review`.
