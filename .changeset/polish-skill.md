---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": patch
---

**A skill for finishing a game: `skills/ritmo-polish`.** When a game is past its prototype and the user asks to polish it, make it feel better or more finished, add juice, or review its feedback, transitions, or UI, the agent reads it next to the `ritmo` skill. It says what polish is (every effect that changes what the player perceives without changing the simulation, so the headless tests and replays pass with the effects on or off), how to work (list what the game already has, walk the player's path, rank the gaps from the core verb out, let the human pick, one round at a time, never claim a touch feels good), and the principles that decide whether a touch reads right: every input gets an answer on the channel where the eyes are; the biggest answer goes to the rarest moment, scaled and capped; sound, visual and vibration for one event land on the same tick; motion says what it means; nothing reads as something else; each mode has its own language; the moments between play (death to retry at once, the results as the reward); never make the player wait for what they can skip; UI that holds still; shake, flash and vibration as the player's choice; and sound by the same rules. `SETUP.md` step 2 links it; the `ritmo` skill points to it.

`ritmo-devtools lint` notes `ritmo-polish` as well when the project does not link it (`note  skill-not-linked  ritmo-polish`), without changing the exit code, so a project set up before this release sees it until it adds the link.
