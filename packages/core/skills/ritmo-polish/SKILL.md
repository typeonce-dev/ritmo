---
name: ritmo-polish
description: "Apply when a game built on @typeonce/ritmo is past its prototype and the user asks to polish it, make it feel better or more finished, add juice, or review its feedback, transitions, or UI. Says what polish is (what the player perceives, never the simulation), how to audit what the game already has, rank the gaps, let the human pick, and the principles that decide whether a touch reads right."
---

# Polishing a Ritmo game

Polish is every effect that changes what the player perceives without changing the simulation: animation, sound, haptics, camera, transitions, UI. Removed, the game plays the same; present, it tells the player what happened, how much it weighed, and what to do next. It comes after the core is fun and the content is in (a game that still has a `PROTOTYPE.md` follows `ritmo-prototype`, where looks wait), and it goes to the **core verb** first: the action the player repeats most (a slide, a confirm, a cut) is the one to make land, and polish spread over everything finishes nothing.

Not polish: anything that changes a rule or an outcome. Forgiveness windows (coyote time, input buffering), hit boxes, speeds and distances that change where things end up, and difficulty are mechanics: the `ritmo` skill's `playbooks/mechanic.md`, with a headless test. In a game whose rule is timing against sound, the song and its clock are the simulation too. What teaches the game to a stranger is the `ritmo-onboarding` skill. Making the sounds, music, effects and sprites is the `ritmo-sounds`, `ritmo-music`, `ritmo-fx` and `ritmo-pixel-art` skills; this skill decides where, when and how strongly they play.

## The audit

1. **List what exists before adding.** Read the host's render, audio, UI and input code and the banks of sounds, effects and music already made. A list of "professional touches" usually names things the game already has.
2. **Walk the player's path** against the principles below: the core verb, a failure and the way back into play (a hit, a miss, a wrong answer; the retry or undo), a success, each transition, each menu, and the game on each device it targets. The first minute is `ritmo-onboarding`. Write each gap as what the player sees now and what they would see.
3. **Rank by value for the time.** The core verb's moment first, then the moments between play, then the edges (devices, options, icons). Removing something that exists is a proposal, never a change.
4. **The human picks.** Build one change at a time, send the link to the build, and say what the check could not judge: motion, sound, timing on a device. Never say it feels good: you have not played it.
5. **A verdict is a symptom.** "Too fast" usually means a beat is missing (a pause before, a hold after), not that the whole should be slower. "Too strong" means it pulls the eye from something more important: lower its saturation or opacity, or shorten it, before making it thinner. "Looks like X" means the mark says X: change what it says.

**Check:** the simulation's headless tests and replays pass unchanged with the host's effects on or off: polish is render or host state, the simulation imports no render or audio code, and cosmetic randomness draws from its own `Random.make` stream (`ui-and-render.md` steps 4 and 6). The game's check passes (`SETUP.md`). Where a sound and a visual answer one event, both read the same simulation event, never a host timer; a headless test with a recording audio service shows the sound on the event's tick.

## Principles

How much, whether a motion reads, and whether a sound is right are the human's to judge on the device: say so each round.

**Every input gets an answer, and every change that matters gets a signal.** A press, a hit, a pickup, a locked door: each gets a reaction, the same kind every time, beside the thing acted on where the eyes already are (on a touch screen, never under the finger). What matters gets a second channel (sound, or vibration where the device has it), and no essential information is carried by a colour, a sound or a motion alone. A silent input makes players repeat it. A change that matters stays visible after its effect ends (a mark, a changed tile, a counter, a log line).

**The biggest answer goes to the rarest, most important moment.** Feedback scales with what it means, and it has a cap. The strongest effects (a freeze of a few frames, shake, flash) go to the core verb landing and the biggest turns of the game (a death, a puzzle solved, a round won), never to routine motion. A freeze is the host not stepping the simulation for a few frames, never a write to the world, and has no place where the game's own clock is the rule (a rhythm game). Shake is added to the camera's resting position each frame and decays to zero; it never moves the resting position.

**Same event, same moment.** Sound, visual and vibration for one event land on the same tick, read from one event stream or one timing table, so they cannot drift. A sound that leads its picture by three frames is noticed. The answer to an input starts within a tenth of a second (rhythm and fast action games need far less; online, the local answer does not wait for the server), and the frame rate holds steady: a hitch reads as lag.

**Motion says what it means.** The answer to the player's input starts at once; a wind-up belongs to what the player must see coming (an enemy's attack, a scripted move). A response has one bright frame at the moment of impact and a slow out; linear motion reads as machinery; exits are quicker than entries. An effect gets the time it needs to be read, and is judged by what it looks like it means, not by how intense it is. Sprite effects follow the `ritmo-fx` skill's Craft; this holds for UI, camera, transitions and bodies.

**Nothing reads as something else, and every element earns the attention it takes.** A dashed line that reads as a laser, a number that reads as an icon, a label that adds weight and no direction: each is a bug. Take one screenshot of ordinary play: it must show what the game is and what just happened. An overlay or HUD element the player never acts on is a candidate to remove: propose it.

**Each mode has its own language, and nothing leaks.** Play, menu, cutscene, pause, failure, success, your turn and the opponent's: each shows, plays and mutes its own set. A cutscene hides every cue that says "you control this" and adds its own; a menu never plays a gameplay sting (a short sound or music cue). What each mode shows and plays, music included, is a function of the game's phase, in one place.

**The moments between play are where care shows.** Failure leads back into play quickly, with its cause visible for a beat and the music carrying across (what the failure says is `ritmo-onboarding`); a repeated failure gets a quieter sting, not the same one. The end of a level or run shows what the player achieved, and the next step cannot be missed.

**Never make the player wait for something they are ready to skip.** Text advances on an input, not a timer; a cutscene can be skipped, and replayed when the story matters; an animation never blocks input without a sign that input is waiting.

**UI holds still, and one hand drew it.**
- No layout shift (nothing visible moves between frames unless the player moved it): a counter is sized to its widest value, a panel to its longest content.
- Anything centred has equal margins, measured; use two or three spacing sizes across all screens; one font family, one palette, one icon set, one easing.
- One word per action everywhere; a working control never looks disabled.
- Targets fit the pointer: a finger needs 44 pt or more, spaced apart; with keys or a pad, every menu works without a pointer and focus moves predictably.
- Everything sits inside the visible area of every screen the game targets (notches, rounded corners, browser bars), and every screen has a way back.

**Intensity is the player's choice.** Each of shake, flash and vibration the game uses has a toggle, saved on the device; sound effects and music have separate volumes; motion that is not essential can be reduced. Nothing flashes more than three times a second.

**Sound follows the same rules.** The core verb has the richest sound, even when the real action would be silent (a jump); a sound heard many times a second varies in pitch and volume, unless its exact pitch is the game; the game's audio code honours each recipe's `heavy` (duck: lower the others for a moment) and `interval` (least time between two plays) from `ritmo-sounds`.

## Self-check

- Does the simulation's test suite pass with every effect off? If not, something I called polish is a mechanic.
- Where is the moment the player repeats most, and is it the richest moment in the game?
- Which sound and visual answer the same event, and do they read it on the same tick?
- Can any mark or motion on screen be read as something else? What does the effect look like it means?
- Which cue of play is still visible in the cutscene, and which cue of the cutscene leaks into play?
- From a failure to play again, how long does the player wait, and what do they see meanwhile?
- Which panel changes width when its number changes?
- Which effect has no toggle, and what information would be lost with it off?
- What did I not judge, and did I say so?
