# Why the `ritmo-polish` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not published: `package.json` `files` leaves it out (`pnpm pack:check` fails if it ships), and the website does not read it.

Every rule in [`skills/ritmo-polish`](skills/ritmo-polish/SKILL.md) traces back to one of two things:

- **Practice:** advice from people who make games feel finished (designers, animators, sound designers, UX and accessibility bodies), quoted below with a link.
- **Ritmo:** how the library works (the repo's `AGENTS.md`), or a direction from the maintainer. These are conventions, not design claims, and are marked as such.

A rule that is neither does not go in the skill. The skill states principles and leaves the procedure to the agent: a checklist of effects to add, a fixed list of screens, or a recipe per effect does not go in, even with a source, because it makes every game end up with the same touches. A perceptual threshold (how late a sound is noticed, how many flashes a second) is a fact about people, not a recipe, and may go in. When you change the skill, change this file in the same commit.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. A quote marked "captions" is from a talk's subtitle track (manual unless marked "auto"), reproduced as captioned. Several agent skills on GitHub (gamestack, abagames, vibedgames, and others, pinned by commit) are prior art: they show what others have built, not established authority, so they are never the only source for a design claim.

Evidence from one Ritmo game, Still Time (a mobile top-down game, Oct 2026, 30 hours of polish rounds in its development thread), is marked **Still Time**. It is one game: a rule with only that behind it is a Ritmo convention until a second game confirms it.

## Where we chose against a source

- **Polish comes after the core is fun, not from day one.** Rob Pardo (Blizzard) says "We do the polish right from the beginning" and "There's this big assumption that polish is something you do in the end" ([Koster's notes][pardo-koster]). Valve says "Don't worry about how it looks" during iteration ([HL2 process][valve-hl2], p. 17), and Cook that polishing a prototype "locks in the game play too early" ([pitfalls][cook-pitfalls]). Ritmo follows Valve and Cook: `ritmo-prototype` defers looks, and this skill starts at graduation. Pardo's point survives as "polish the core verb first, and in every later round": polish is cumulative ("people notice 1000s of polished features, not the single polished feature").
- **Screen shake is a choice, not a default.** Nijman: "probably every game would benefit from having screen Shake even if you're like oh my puzzle game doesn't need screen Shake you're wrong" ([captions, auto][nijman]). Brown: "if it's about jumping, give your character friction and keep the camera stay still so you can land each jump" ([GMTK][gmtk]). The skill follows Brown and Eiserloh ("Camera shake is like salt"): shake where the game's meaning is impact, always with a toggle (Nijman himself: "we had to put like an option in nuclear drone to disable the screen Shake because some people were getting really nauseous").
- **Particles are not free.** Jonasson and Purho: "There's this saying, like you can't ever have too many particles in your game" ([captions][juice]). Riot: "visual noise adds up quickly and can make it difficult to react properly" ([Clarity in League][riot-clarity]); Nielsen: "Every extra unit of information in an interface competes with the relevant units of information" ([heuristics][nng-heur]). The skill sides with Riot and Nielsen; in Still Time every "too much" verdict was about noise.
- **Forgiveness windows are mechanics, not polish.** Celeste's coyote time and jump buffering ([Thorson][celeste]; `JumpGraceTime = 0.1f` in [Player.cs][celeste-code] L48) change outcomes, so they fail Swink's test for polish (below). They go through the `ritmo` skill's `playbooks/mechanic.md` with a headless test, and the polish skill says so.
- **A wind-up goes on what the player watches, not on their own input.** Thomas and Johnston's anticipation ("prepare the audience for an action", [Wikipedia][disney]) is for an audience; Swink's reader is a player whose input must be answered within "100ms or less" ([OCR][swink-book]). The skill puts anticipation on enemy attacks and scripted motion, and gives the player's own action an immediate start, one bright frame at impact, and a slow out. `ritmo-fx` keeps the gathering phase for effects, which the player watches.
- **A freeze is host pacing, never a world write.** Sakurai and Nijman both stop the game on impact. In Ritmo the host decides how many steps run per frame, so a freeze of a few frames is the host holding its steps: the simulation's tests and replays are unchanged (Swink's test below), and the freeze has no place where the clock itself is the rule (a rhythm game's song). Slow motion that changes what the player can do is a mechanic.
- **Few numbers.** Sakurai gives no frame counts ([flossbud skill][sak-skill] L61: "Sakurai gives no hitstop frame counts, no shake amplitudes"). The skill gives perceptual thresholds (100 ms response, 45 ms sound lead, three flashes a second, a 44 pt target) and no effect durations; where a duration is cited here (hit-stop 0.1–0.2 s) it is for the maintainers' judgement, not the skill.

## The intro: polish changes what the player perceives, never the simulation; it comes after the core is fun and goes to the core verb first

- Swink, *Game Feel*, 2008, ch. 1 (book, via the [archive.org OCR][swink-book]): "Polish refers to any effect that artificially enhances interaction without changing the underlying simulation." … "The point is, if these effects were removed, the essential functionality of the game would be unaltered." … "changes in polish have completely altered the perception of their masses."
- Swink, "Game Feel: The Secret Ingredient", 2007 ([link][swink]): "The interactive impression of physicality created by the harmony of animation, sounds, and effects with input-driven motion." … "As polish is a notorious time sink, you want to limit the amount of time you spend creating effects to those which are crucial".
- Sakurai, "Eight Hit Stop Techniques" (subtitles, via the [flossbud transcripts][sak-047] L20): "Technique two: don't move the hit box."
- Cook, "Visualizing the Creative Process", 2010 ([link][cook-creative]): "If you try to polish everything, the surface area of your project grows huge in very short order." … "what we did right was polish the heck out of the core mechanic of movement and attacking." … "by focusing on the heart of the game, none of the other issues really mattered." … "So one day prototyping yields one month polishing."
- Yu, "Finishing a Game", 2010 (via a [credited repost][yu]): "It should be fun to execute the most basic interactions, because that's what players will be doing the most" … "They say the last 10 percent is really 90 percent, and there is truth to this."
- Brown, "Secrets of Game Feel and Juice", 2015 ([captions][gmtk]): "this stuff, which some call juice, is all about doubling down on whatever your game is about." … "making every lick of polish speak to what the game is really about."
- Sakurai, "Do Graphics Impact Fun?" ([transcript][sak-152] L22): "you could say that graphics multiply the fun of a game."
- **Still Time:** the audit's first item was "This is the main moment of the game, and right now it's the least punchy one" (the cut), and the human picked it first.
- **Ritmo:** polish is host and render code (`ui-and-render.md` steps 3–4): render-only state, cosmetic randomness from its own `Random.make` stream, so the simulation's headless tests and replays pass unchanged with effects on or off. That is Swink's test made mechanical.

## The audit

### List what exists before adding anything

- **Still Time:** "Do we already have some of these? Check, and give me the list of the top 10 that you would suggest adding". The check found death feedback, cut feedback, frozen-time visuals, 41 sounds with pre-attack warnings, timed star chimes, ducked music, safe areas and an eased camera already done; the list of ten was what was missing.
- Petersen, `polish-game-feel` skill ([pinned][gp-skill] L13–14): "Inspect the actual renderer, audio, action events and existing settings before adding effects."
- **Ritmo:** the `ritmo` skill's "Extend what exists before adding", applied to effects.

### Walk the player's path, and rank gaps by value for the time

- Valve, "Valve's Design Process for Creating Half-Life 2", GDC 2006 ([slides][valve-hl2], p. 13 and 28): "Use playtest to prioritize work for next week" … "Allow for a final iteration over your entire game once it's playable from beginning to end".
- Cook, "Visualizing the Creative Process" ([link][cook-creative]): "every experimental feature you start takes 30 times as much effort to finish." … "The user doesn't see your effort."
- Aonuma, Iwata Asks: Twilight Princess ([link][tea-table]): "the more experienced developers have to tighten the screws, so to speak, so all the elements in the game fit together."
- **Still Time:** the agent's own summary of what reads as professional was "consistency, responsiveness and care at the edges: what happens between rooms, on failure, on odd devices, and in the first ten seconds"; the top ten were ordered "best value first".

### The human picks; one change per round; the verdict is theirs

- The same sources as `PROTOTYPE.md`, "Never say it is fun": Fullerton, Budiu ("You Are Not the User"), Swink ("know it when you feel it").
- m4bwav, `juice-apply` skill ([pinned][m4-skill] L42): "Feel is confirmed by playing (P-20), not by the diff." Petersen ([pinned][gp-skill] L78): "Distinguish technical verification from an actual listening/playtesting verdict."
- vibedgames, `game-feel` skill ([pinned][vg-skill] L12): "feel is tuned in motion, never designed on paper."
- **Still Time:** the human picked 5 of the 10 (hit-stop, vibration, results screen, toggles, icons and crash fallback) and 4 of 6 cutscene cues; the agent wrote "I haven't watched it in motion" and that hit-stop "needs a phone test"; no verdict on hit-stop ever came.
- **Ritmo:** the same round shape as `ritmo-prototype`: the link, what changed, what the check did not judge.

### What the human reports is a symptom: read the motion's meaning, not its intensity

- Pozzi and Zimmerman, rule T, and Gaiman, as in `PROTOTYPE.md`.
- **Still Time:** "The ninja goes a way instantly, way too fast, so much that's becomes unclear" was fixed by adding a held beat, and the next verdict, "looks more like the ninja is evaporating, it should more like a fast move to fade in place", was about what the motion said, not its speed. "people thought it was some sort of laser" (a dashed line) and "that red arrow I have no idea what it is" (a hit counter) were both misreadings, not intensity. "The colour is too saturated, and also intense still" and "too intense" were both fixed with a muted hue and lower opacity after a thinner line had not worked.
- **Ritmo:** the three readings in step 5 ("too fast" is a missing beat, "too strong" is unearned attention, "looks like X" is a wrong statement) are this one game's rounds made into a convention, until a second game confirms them.

### The check: the simulation unchanged with effects on or off; sound and visual of one event in one tick

- Swink's removal test (above).
- gamestack, `game-feel-and-juice` `CHECKLIST.md` ([pinned][gs-check] L20): "Mute sound + disable particles + strip screen effects: does the core still feel right?" abagames, `maximizing-game-feel` ([pinned][ab-skill] L69): seeded simulated players must give identical results before and after a presentation pass.
- **Ritmo:** the game's headless tests and replays are that check for free, because effects live in host code: the simulation imports no render or audio code (`ui-and-render.md` step 6, a `no-restricted-imports` rule the game configures) and cosmetic randomness draws from its own `Random.make` stream (step 4). No devtools lint flags a render system that writes world state (checked 2026-11-01): the import rule and the tests are the guard. A test that steps the runtime with a recording audio service and asserts the sound on the event's tick is the sync check (see "Same event, same moment").

## Principles

### Every input gets an answer, every change that matters gets a signal, the same kind every time, where the eyes are, on a second channel when it matters, and it stays

- Falstein and Barwood, *The 400 Project*, rule 69, contributed by Bob Bates ([master list, GDC 2006][p400]): "Provide a Reaction to Every Player Action" … "Ideally, every action a player can take should have some sort of feedback, visual, audible, or both." Rule 28: "Be Consistent in Feedback to the Player". Rule 108 (Meretzky): "provide direct audio and visual feedback every time the score changes - like a sound and floating numbers."
- Nielsen, "10 Usability Heuristics", #1 ([link][nng-heur]): "keep users informed about what is going on, through appropriate feedback within a reasonable amount of time" … "no action with consequences to users should be taken without informing them."
- Schell, "The Lens of Juiciness" (via [Schell Games][schell]): "Is my interface giving the player continuous feedback for their actions? If not, why not?" … "Juicy systems reward the player many ways at once."
- Gabler et al., 2005, quoted by Jonasson and Purho ([captions][juice]): "a juicy game feels alive and responds to everything you do,".
- Hodent, "The Gamer's Brain", GDC 2015 ([link][hodent-15]): "It's harder then to spot the red feedback telling you're getting hurt and need to react." (they moved it "closer to the reticule, where attention usually is").
- Game Accessibility Guidelines ([sounds alone][gag-sound]): "An easy test is to ask someone to play through for the first time with the sound muted." ([colour alone][gag-colour]): "Wherever you can, use colour as a back-up for another means of communicating the information". WCAG 2.1, SC 1.4.1 ([link][wcag]): "Color is not used as the only visual means of conveying information".
- Apple, Human Interface Guidelines, "Motion" ([link][apple-motion]): "avoid using it as the only way to communicate important information."
- Falstein and Barwood, rule 28 ([master list][p400]): "Be Consistent in Feedback to the Player". "The same kind every time" rather than "the same": the quieter repeated sting and the varied footstep below change strength and voice, never meaning.
- Nijman ([captions, auto][nijman], 14:35): "that sense of permanence is really important"; Berbece, "Why Your Death Animation Sucks", GDC Europe 2015 ([captions, auto][berbece], 15:12): "I need a way to show where a character died".
- **Still Time:** silent taps in the prologue made players tap more ("so they tap more"); the gesture circles were "hidden by my finger", so the live feedback moved to a panel at the top where the eyes are; broken planks stay on the floor.
- **Ritmo:** "on a touch screen" scopes the finger rule; on a desktop the cursor is where the eyes are, and feedback at the cursor is the convention (Nielsen's "Follow platform and industry conventions", [heuristics][nng-heur]).

### The biggest answer goes to the rarest, most important moment; it scales, and it has a cap

- Sakurai, "Thoughts on Hitstop", Famitsu 2015 (via [Source Gaming][sak-hitstop]): "In general, the more damage an attack inflicts, the longer the hitstop period." … "Regardless of how much damage an attack inflicts, the hitstop period will never exceed this limit."
- Sakurai, "Strike a Balance with Sound Effects" ([captions][sak-sound]): "the priority and volume of sounds should be based on the idea of making the sounds that are most relevant to the player louder".
- Riot, "Clarity in League", 2021 ([link][riot-clarity]): "the most important thing at any given moment (like a major ultimate or CC) should draw the most attention."
- Eiserloh, "Juicing Your Cameras With Math", GDC 2016 ([slides][eiserloh]): "Camera shake is like salt" … "Maintain a "trauma" level in [0,1]" … "Trauma decreases (linearly) over time" … "Trauma .30, .60, .90 means 3%, 22%, 73% shake" (shake is trauma squared or cubed, so escalation is perceptible) … "then add it to the camera for that frame (preserve the base camera)".
- Thomas and Johnston, *The Illusion of Life*, via [Wikipedia][disney]: "It is important to employ a certain level of restraint when using exaggeration." … "The important thing about secondary actions is that they emphasize, rather than take attention away from the main action."
- gamestack `CHECKLIST.md` ([pinned][gs-check] L70): "Don't spend peak effects on routine actions (spectacle inflation leaves nothing for climaxes)."
- **Ritmo:** "added to the camera's resting position each frame and decays to zero" is Eiserloh's "preserve the base camera" in plain words, with the randomness from the render's own `Random.make` stream (`ui-and-render.md` step 4), because shake is the likeliest place an agent draws from the world's random resource. The freeze as host pacing is under "Where we chose against a source".
- **Still Time:** enemy halos and a red bullet glow were removed ("with this many small threats it was just noise"); "The colour is too saturated, and also intense still"; "reduce the contrast and intensity of the circle used to show the gesture on screen, too intense"; "That 'TITLE' beside the arrow in the UI adds to much weight and not much direction." Every fix was a muted hue and lower opacity, never a thinner line.

### Same event, same moment: sound, visual and haptic for one event land together, from one source

- ITU-R BT.1359-1, 1998 ([pdf][itu]): "thresholds of detectability are about + 45 ms to –125 ms" (positive: sound ahead of vision) … "thresholds of acceptability are about +90 ms to –185 ms on the average". A sound that leads its visual by three 60 Hz frames is noticed.
- Schmid et al., "Measuring the Just Noticeable Difference for Audio Latency", 2024 ([pdf][jnd]): "humans can perceive a latency difference of less than 20 ms when pushing a touch-sensitive button". Halbhuber et al., 2022 ([pdf][fps-latency]): "auditory latency in video games increases the perceived tension, decreases positive feelings towards the game".
- Kondo on Miyamoto, Iwata Asks: Super Mario Galaxy ([link][iwata-galaxy]): "his adamant demands for sound effects "You Can Feel" that are completely synchronized with the way the game feels".
- Swink, *Game Feel*, ch. 2 ([OCR][swink-book]): "At 50ms, response feels instantaneous. Above 100ms, the lag is noticeable but ignorable." … "At 200ms, the response feels sluggish." Nielsen, "Response Times: The 3 Important Limits", 1993 ([link][nng-times]): "0.1 second is about the limit for having the user feel that the system is reacting instantaneously".
- Apple, "Motion" ([link][apple-motion]): "maintaining a consistent frame rate of 30 to 60 fps typically results in a smooth, visually appealing experience."
- Schmid et al. ([pdf][jnd]): "Results suggest that users are able to perceive latencies of 10 ms in certain situations.": why rhythm and fast action games need less than the tenth of a second.
- **Ritmo:** online, the local answer does not wait for the server: `@typeonce/ritmo-netcode` predicts the local player's intents (its README), and the host answers the input from the predicted state.
- **Still Time:** "The star sound now comes before the stars are shown." The chimes ran on a fixed schedule from an older panel timing; the fix was one timing table that both the HUD and the audio read, "so they can't drift apart again".
- **Ritmo:** events are per-reader streams published in the tick they happen (`Descriptor.Event`), so an audio service and a render reader that react to one event see it in the same tick; a timing that lives in one place cannot drift. A headless test can assert both reads on one tick.

### Motion says what it means: the answer starts at once, a wind-up on what must be seen coming, one bright frame at impact, a slow out, and enough time to be read

- Thomas and Johnston, via [Wikipedia][disney]: "Anticipation is used to prepare the audience for an action, and to make the action appear more realistic." … "Timing refers to the number of drawings or frames for a given action, which translates to the speed of the action on film." … "more pictures are drawn near the beginning and end of an action, creating a slow in and slow out effect" … "animated motions that strive for a perfect imitation of reality can look static and dull."
- Penner, "Motion, Tweening, and Easing", 2002 ([pdf][penner]): "I don't care much for linear tweens. They look stiff, artificial, mechanical." … "In the real world, velocity doesn't suddenly jump from one value to another."
- Material Design 1, "Duration & easing" ([link][material]): "Motion appears more natural and delightful when acceleration and deceleration occur asymmetrically." … "Objects leaving the screen may have shorter durations, as they require less attention." … "Transitions on mobile typically occur over 300ms".
- Sakurai, "Stop for Big Moments!" ([transcript][sak-003] L22, L38): "This is vital for letting the player really feel that impact." … "In your game's big moments, stop! Let your players feel those moments of success—or defeat." Sakurai, "Follow-Throughs Make the Impact" ([transcript][sak-077] L28): "The follow-through after an attack determines the impact of the attack itself."
- Fukuda, Inoue and Tetsutani, 2023 ([abstract][fukuda]): "the optimum duration for Hit-Stop effects was approx. 0.1 to 0.2 seconds". Nijman uses less ([captions, auto][nijman], 18:20): "when I hit an enemy it will pause for 20 milliseconds or something and your brain won't notice that". The two disagree, which is why the skill gives no number.
- Berbece ([captions, auto][berbece], 06:46): "The characters disappear instantly. It feels bad. It doesn't feel rewarding to eliminate your opponent."
- **Still Time:** the vanish (a scripted move the player watches) was "way too fast, so much that's becomes unclear" until it got a 0.35 s gathering beat, a pop, and a slower fade; the spear load (an enemy attack) had to read as a thrust, "going back as it charges and then fast up when it hits"; the cutscene camera move was "too fast" until it became a slow two-shot. Each is a wind-up on something the player watches, never on their own input. The held pose that a frozen frame shows is this game's rule (its frames are often paused) and stays out of the skill.
- **Ritmo:** for sprite effects, the `ritmo-fx` skill's Craft section ("Choreography in phases", "Fast in, slow out, and frames are weight") already says this; the polish skill applies it to the game's motion: UI, camera, transitions, bodies. `Scalar.spring` and `Scalar.decayToward` give eased motion without a tween library (procedural animation decision, PR #121).

### Nothing reads as something else, and every element earns the attention it takes

- Thomas and Johnston, staging, quoted in [Wikipedia][disney]: "the presentation of any idea so that it is completely and unmistakably clear" … "The essence of this principle is keeping focus on what is relevant, and avoiding unnecessary detail."
- Nielsen, heuristic #8 ([link][nng-heur]): "Interfaces should not contain information that is irrelevant or rarely needed." … "Don't let unnecessary elements distract users from the information they really need."
- Riot ([link][riot-clarity]): clarity is "the ability to understand what's happening in League and respond to it."; Petras (Overwatch), via [Creative Bloq][petras]: "Ultimately, the Overwatch art style is focused on readability of gameplay."
- Hodent ([link][hodent-19]): "All the stimuli in the game (aka "signs and feedback") need to be clear, consistent, and perceived as intended."
- Saltsman, "Screenshot Theory", 2018 ([link][saltsman]): "can a passerby tell what just happened in the game by glancing at a screenshot?" … "spend 'em on stuff that speaks to your main attraction." (legibility budget). This is the one-frame test: the agent can take that one screenshot.
- **Ritmo:** an element the player never acts on is proposed for removal, never deleted: the human directs the game, and in Still Time every removal (the room name, the hit counter, the goal icon, the "TITLE" label) was the human's call.
- **Still Time:** "people thought it was some sort of laser" (a dashed trajectory); "That red arrow I have no idea what it is, and often times I don't care about the name of the room I am in" (a hit counter and a label, both removed); a bullet border "looked like a target icon rather than a bullet"; "'touch it to cut' makes the user touch it physically on the screen".

### Each mode has its own language, and nothing leaks between modes

- Falstein and Barwood, rule 14 ([master list][p400]): "Differentiate Interactivity from Non-Interactivity" … "Always make it clear to the player when they are expected to shift from interactive to passive (e.g. cut scenes) and back."
- Nielsen, heuristic #4 ([link][nng-heur]): "Users should not have to wonder whether different words, situations, or actions mean the same thing."
- Wwise, "Understanding interactive music" ([link][wwise-music]): "These states define which music Wwise will play at any point in game, ensuring that the soundtrack is adapted to the Action." Phillips, *A Composer's Guide to Game Music*, via her [GDC 2021 article][phillips]: "a nonlinear musical composition adjusts itself to the state of gameplay".
- **Still Time:** "Is there something in games that make a level read like a cut scene?" The cues undercutting the prologue were the teal cut ring and the "II" pause sign ("exactly the wrong message here") and silent taps; the cues added were bars that slide in ("The transition into the letterbox is what reads as 'cutscene starts'"), hidden control cues, "A camera that moves on its own is the clearest sign that nobody is steering", and a softer grade. The prologue playing the clear's star chimes was a leak the other way.
- **Ritmo:** the game's phase is a resource or `Game.StateMachine` (the `ritmo` skill); what each mode shows, plays and mutes is a function of that state, in one place, never a set of flags in the host. "Your turn and the opponent's" extends rule 14 to turn-based and multiplayer games (a convention: Still Time has no turns). The letterbox and the free camera stay out of the skill as cutscene recipes; the rule is "hides every cue that says you control this".

### The moments between play: failure back into play quickly, a quieter repeated sting, the end shows what was achieved

- McMillen, "Super Meat Boy's McMillen Explains 'Why So Hard?'", 2010 ([link][mcmillen]): "It was imperative that the action never stop, even when the player was killed." … "The time it takes for Meat Boy to die and respawn is almost instantaneous." … "penalty equals frustration". Refenes, postmortem, 2011 ([link][refenes]): "Remove lives, reduce respawn time, keep the levels short and keep the goal always in sight."
- Andersen (Playdead), in Designing Sound, 2016 ([link][fail-states]): "Death can be really rough and scary but the time before you're back in the game has to be quick." … "one of the things we did in Inside was to let the sound continue across death-respawn". McGladdery, same page: "the following stings are less dramatic if you die consecutively in a short amount of time".
- Sakurai, "Stop for Big Moments!" ([transcript][sak-003] L26): "If players are left wondering what happened, it's a real missed opportunity."
- Falstein and Barwood, rule 67 ([master list][p400]): "Provide Outward and Visible Signs of Accomplishment"; rule 61: "The satisfaction of achieving a goal is magnified when the goal has been clear (and/or literally visible) for some time."
- Nakago relaying Miyamoto, Iwata Asks: New Super Mario Bros. Wii ([link][iwata-nsmb]): "Even right at the start of World 1-1, all of the elements of Super Mario were present and correct."
- **Still Time:** the results screen was named "the reward moment" (count-up, "NEW BEST!", an unmissable next); the hit screen freezes with the spear through you so the cause is seen; the human chose a results screen and instant retry over title cards and an ending screen. Left out of the skill: "to have it fade in as the level starts" (the start mirroring the end) is one game's choice with no source, and the count-up and the best callout are recipes; the rule is "shows what the player achieved, and the next step cannot be missed" (Falstein rules 67 and 61). What the failure says (the rule's words, the thing that took you left on screen) is `ritmo-onboarding`'s; the speed and the music carrying across are this skill's.

### Never make the player wait for something they are ready to skip; a cutscene skips, and replays when the story matters; input never blocked without a sign

- Apple, Human Interface Guidelines, "Motion" ([link][apple-motion]): "As much as possible, don't make people wait for an animation to complete before they can do anything" … "Aim for brevity and precision in feedback animations."
- Material Design 1 ([link][material]): "Animate quickly so that the user doesn't have to wait for the animation to finish."
- Game Accessibility Guidelines ([own pace][gag-pace]): "Instead of a timer, dismiss information on a player action, allowing it to be stepped through." ([skip][gag-skip]): "Offer a means to bypass gameplay elements that aren't part of the core mechanic, via settings or in-game skip option". Xbox Accessibility Guideline 109 ([link][xag-109]): "Provide the ability to revisit the game's narrative (for example, the ability to replay cutscenes or view a written summary of the story thus far)."
- **Ritmo:** "a sign that input is waiting" is from Still Time's "tap to continue", shown at once; the response rate itself is under "Same event, same moment". "Replayed when the story matters" scales XAG 109 to a small game: a replay gallery is not a jam-game ask.
- **Still Time:** "minimum holds of up to 3 s were tried: players who had read the line were made to wait" (design log); "tap to continue" shows at once; "skip" in the top bar; "Let me take the prologue at my own pace".

### UI that holds still, and one hand drew it: no layout shift, measured margins, few spacing sizes, one font, palette, icon set and easing, one word per action, targets for the pointer, focus for keys and pads, the visible area, a way back

- web.dev, "Cumulative Layout Shift" ([link][cls]): "A layout shift occurs any time a visible element changes its position from one rendered frame to the next." ([optimize][cls-fix]): "reserve the required space" for content that arrives late (a counter's widest value, a font).
- Nielsen, heuristic #4 ([link][nng-heur]): "Users should not have to wonder whether different words, situations, or actions mean the same thing." … "Follow platform and industry conventions."
- Aonuma, Iwata Asks: Twilight Princess ([link][tea-table]): "the more experienced developers have to tighten the screws, so to speak, so all the elements in the game fit together." Pardo, via [Koster][pardo-koster]: "people notice 1000s of polished features, not the single polished feature."
- Xbox Accessibility Guideline 112 ([link][xag-112]): "The movement of focus should always be predictable."
- Apple HIG, "Accessibility" ([data][apple-access]): default control size "44x44 pt", minimum "28x28 pt"; "Layout" ([data][apple-layout]): "Respecting the safe area is essential to make sure system UI and hardware features like the Dynamic Island don't obstruct content and controls." Android accessibility help ([link][android-touch]): "Consider making touch targets at least 48x48dp, separated by 8dp of space or more".
- Game Accessibility Guidelines ([touch][gag-touch]): "Buttons also shouldn't be close to each other." … "If they are, they need to be larger again to compensate."
- Xbox Accessibility Guideline 112 ([link][xag-112]): "Provide persistent links back to the main menu screen or the initial interactive screen on all submenus." … "The movement of focus should always be predictable."
- **Ritmo:** "measure the margins", "two or three spacing sizes", and "a working control never looks disabled" are Still Time's rounds made into conventions (below); "one font family, one palette, one icon set, one easing" is Nielsen's consistency and Aonuma's screws applied to a game's screens.
- **Still Time:** "There is layout shift in the top panel, make sure it span the full width that it has available" (a clock sized to "188.8", measured at 0.0, 88.8 and 188.8); "The homepage does not look centred, the space at the bottom looks way more than the one at the top"; "every time we display a sub label ... the padding breaks" (one smaller size step for every sub-label); "the restart button turns 'grey' when complete level, but it still works, maybe no need of that status colour"; the same word "Home" on every screen; "not sure how (and if I can) come back to the main menu".

### Intensity is the player's choice: a toggle for each of shake, flash and vibration the game uses, separate volumes, motion that can be reduced, and a flash budget

- Xbox Accessibility Guideline 117 ([link][xag-117]): "Avoid or allow disabling camera shake, camera bobbing, motion blur, and mouse blur." Guideline 118 ([link][xag-118]): "Flashes occur too frequently (approximately more than three per second)." … "All games should be tested for photosensitive seizure triggers, regardless of whether the game includes intentional flashing."
- WCAG 2.1, SC 2.3.1 ([link][wcag]): "Web pages do not contain anything that flashes more than three times in any one second period, or the flash is below the general flash and red flash thresholds."; SC 2.3.3: "Motion animation triggered by interaction can be disabled, unless the animation is essential".
- Apple HIG, "Motion" ([link][apple-motion]): "Make motion optional." … "avoid using it as the only way to communicate important information."
- Nijman ([captions, auto][nijman], 32:16 and 32:25): the Nuclear Throne toggle for nausea, and "a warning with screen Shake is that it gets kind of addictive and you get used to it and you put a ton of it in your games".
- Game Accessibility Guidelines ([volumes][gag-volume]): "Loss of hearing can affect certain frequencies more than others, so being able to control volume independently is essential."
- **Still Time:** the human picked "Accessibility settings. Toggles for screen shake, flashing and vibration, next to Sound and Music" from the ten; Flash off removes the red hit flash, the grenade flash and the enemy death flash; the toggles are saved on the device with the game's progress.
- **Ritmo:** "saved on the device" is a convention from that round: a toggle that resets every launch is a toggle the player sets every launch.
- Note: gameaccessibilityguidelines.com has no entry on screen shake and none titled "Allow all narrative and cutscenes to be skipped" (site search, 2026-11-01); cite XAG 117 and the GAG entries above instead.

### Sound follows the same rules: the core verb richest, repeats varied, copies capped, the important ducking the rest, music by mode

- Sakurai, "Strike a Balance with Sound Effects" ([captions][sak-sound]): "This is a moment when the result of your actions is directly reflected back to you, so it should be properly portrayed." … "we make them stand out to some extent because they are the result of pressing a button" … "For things like footsteps, we make sure to create variation in the sound." … "If the same sound is repeated, it becomes too mechanical."
- Kondo, Iwata Asks: Super Mario Bros. 25th ([link][iwata-kondo]): "When I was first asked to make a jumping sound, I remember saying, "Jumping doesn't make a sound!"" … "In the end, I played the game and came up with a sound that would match what was happening on-screen."
- Jonasson and Purho ([captions][juice], 07:50): "this is the most cost-effective thing you can add to a game to make it juicier, which is sound."
- FMOD Studio manual, "Stealing and Virtualization" ([link][fmod-steal]): "Limiting the number of event instances in play at one time provides a less cluttered listening experience for the player"; "Max Instances" ([link][fmod-max]): "This is especially helpful when a game includes frequent collision-triggered events". Wwise, "Managing priority" ([link][wwise-priority]): "you must determine how many can play simultaneously, and which ones take priority".
- Designing Sound, "Finding Your Way With High Dynamic Range Audio In Wwise", 2013 ([link][hdr]): "In this workflow, loudness values should be seen as a measure of priority." … "every sound is important, but not at the same time" (quoting DICE's GDC 2009 slides).
- **Still Time:** music slows and muffles on freeze; "A cutscene mutes gameplay sounds" after the prologue leaked the star chimes; pre-attack warning sounds per enemy.
- **Ritmo:** the `ritmo-sounds` skill makes the sounds and defines a recipe's `heavy` (duck the others) and `interval` (least time between two plays); the game's audio code carries them, which is where this principle lives. The polish skill says where and when sounds play, never how to make them. "Unless its exact pitch is the game" is a convention from review: in a rhythm game a varied hit sound would blur the timing the player is judged on. Music by mode is under "Each mode has its own language".

## Negative findings (do not cite these)

Checked 2026-11-01, so that no future agent invents them:

- No `ritmo-devtools lint` code flags a render system that writes world state; the guard is the game's import-direction lint and its headless tests.
- Derek Yu's "Finishing a Game" does not say "polishing is not the same as adding features".
- Berbece's "Why Your Death Animation Sucks" (GDC Europe 2015, not 2017) contains no hit-stop, anticipation, "every action needs a reaction", retry or respawn rule.
- gameaccessibilityguidelines.com has no entry on screen shake, none titled "Allow all narrative and cutscenes to be skipped", and the colour entry reads "a fixed colour alone".
- Material Design m2/m3 duration ranges ("100–200 ms simple, 200–500 ms complex") could not be verified; the pages are JavaScript shells. Material 1 numbers above are verified.
- Norman's *The Design of Everyday Things* could not be checked in text; cite it by chapter, not by quote.
- "A delayed game is eventually good" is misattributed to Miyamoto. No Miyamoto "first ten seconds" quote exists.
- Swink's 2007 article has neither the three building blocks nor the "without changing the simulation" definition; both are in the 2008 book.
- Nijman's "The Art of Screenshake" has no transcript; the ordered list of 30 tweaks exists only as a commenter's outline.
- No Blizzard or Riot source states a "threats, then interactables, then characters, then environment" order verbatim; Riot's "most important thing ... should draw the most attention" is the nearest.
- No primary source says "the sound must land on the same frame as its visual" in those words; the ITU and latency figures back it as a derived rule.
- No Celeste or Hotline Miami developer statement on respawn speed was found; Super Meat Boy's is the sourced one.

[swink]: https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient
[swink-book]: https://archive.org/download/game-feel/2-game-feel_djvu.txt
[sak-047]: https://raw.githubusercontent.com/flossbud/sakurai-game-design/b6ddbf46278d828affc4e625d4ae3deadb522919/episodes/transcripts/047-eight-hit-stop-techniques.md
[sak-003]: https://raw.githubusercontent.com/flossbud/sakurai-game-design/b6ddbf46278d828affc4e625d4ae3deadb522919/episodes/transcripts/003-stop-for-big-moments.md
[sak-077]: https://raw.githubusercontent.com/flossbud/sakurai-game-design/b6ddbf46278d828affc4e625d4ae3deadb522919/episodes/transcripts/077-follow-throughs-make-the-impact.md
[sak-152]: https://raw.githubusercontent.com/flossbud/sakurai-game-design/b6ddbf46278d828affc4e625d4ae3deadb522919/episodes/transcripts/152-do-graphics-impact-fun.md
[sak-skill]: https://raw.githubusercontent.com/flossbud/sakurai-game-design/b6ddbf46278d828affc4e625d4ae3deadb522919/skills/sakurai-game-design/SKILL.md
[sak-hitstop]: https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/
[sak-sound]: https://www.youtube.com/watch?v=qKjD5qbLUeI
[cook-creative]: https://lostgarden.com/2010/08/17/visualizing-the-creative-process/
[cook-pitfalls]: https://lostgarden.com/2005/08/21/common-game-prototyping-pitfalls/
[yu]: https://tusharvaghela.wordpress.com/2014/06/18/make-games-finishing-a-game/
[gmtk]: https://www.youtube.com/watch?v=216_5nu4aVQ
[nijman]: https://www.youtube.com/watch?v=AJdEqssNZ-U
[juice]: https://www.youtube.com/watch?v=Fy0aCDmgnxg
[berbece]: https://www.youtube.com/watch?v=pmSAG51BybY
[schell]: https://schellgames.com/blog/the-lens-of-juiciness
[pardo-koster]: https://www.raphkoster.com/2006/09/06/agc-rob-pardos-keynote/
[valve-hl2]: https://cdn.fastly.steamstatic.com/apps/valve/2006/GDC2006_HL2DesignProcess.pdf
[tea-table]: https://iwataasks.nintendo.com/interviews/wii/twilight_princess/0/4
[riot-clarity]: https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/
[petras]: https://www.creativebloq.com/digital-art/blizzards-new-online-game-too-little-too-late-21514147
[nng-heur]: https://www.nngroup.com/articles/ten-usability-heuristics/
[nng-times]: https://www.nngroup.com/articles/response-times-3-important-limits/
[p400]: http://www.finitearts.com/Storage/400_Project_Master_Rule_List_032306.zip
[hodent-15]: https://celiahodent.com/video-game-ux-psychology/
[hodent-19]: https://celiahodent.com/understanding-the-success-of-fortnite-ux/
[gag-sound]: https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-sounds-alone/
[gag-colour]: https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-a-fixed-colour-alone/
[gag-pace]: https://gameaccessibilityguidelines.com/allow-players-to-progress-through-text-prompts-at-their-own-pace/
[gag-skip]: https://gameaccessibilityguidelines.com/offer-a-means-to-bypass-gameplay-elements-that-arent-part-of-the-core-mechanic-via-settings-or-in-game-skip-option/
[gag-touch]: https://gameaccessibilityguidelines.com/ensure-interactive-elements-virtual-controls-are-large-and-well-spaced-particularly-on-small-or-touch-screens/
[gag-volume]: https://gameaccessibilityguidelines.com/provide-separate-volume-controls-or-mutes-for-effects-speech-and-background-music/
[wcag]: https://www.w3.org/TR/WCAG21/
[xag-109]: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/109
[xag-112]: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/112
[xag-117]: https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-117-visual-distractions-motion
[xag-118]: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/118
[eiserloh]: http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf
[disney]: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
[penner]: https://robertpenner.com/easing/penner_chapter7_tweening.pdf
[material]: https://m1.material.io/motion/duration-easing.html
[apple-motion]: https://developer.apple.com/design/human-interface-guidelines/motion
[apple-access]: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json
[apple-layout]: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json
[android-touch]: https://support.google.com/accessibility/android/answer/7101858
[cls]: https://web.dev/articles/cls
[cls-fix]: https://web.dev/articles/optimize-cls
[itu]: https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-1-199811-I!!PDF-E.pdf
[jnd]: https://epub.uni-regensburg.de/59003/3/3678299.3678331.pdf
[fps-latency]: https://epub.uni-regensburg.de/53766/1/3543758.3543760.pdf
[iwata-galaxy]: https://iwataasks.nintendo.com/interviews/wii/super_mario_galaxy/2/3/
[iwata-kondo]: https://iwataasks.nintendo.com/interviews/wii/mario25th/4/5/
[iwata-nsmb]: https://iwataasks.nintendo.com/interviews/wii/nsmb/1/4/
[fukuda]: https://ken.ieice.org/ken/paper/20230315OCSt/eng/
[mcmillen]: https://www.gamedeveloper.com/game-platforms/-i-super-meat-boy-i-s-mcmillen-explains-why-so-hard-
[refenes]: https://www.gamedeveloper.com/audio/postmortem-team-meat-s-i-super-meat-boy-i-
[fail-states]: https://designingsound.org/2016/09/30/thoughts-and-opinions-on-sonically-handling-fail-states-in-video-games/
[hdr]: https://designingsound.org/2013/06/21/finding-your-way-with-high-dynamic-range-audio-in-wwise/
[fmod-steal]: https://www.fmod.com/docs/2.03/studio/advanced-topics.html#stealing-and-virtualization
[fmod-max]: https://www.fmod.com/docs/2.03/studio/event-macro-controls-reference.html#max-instances
[wwise-priority]: https://www.audiokinetic.com/en/library/edge/?source=Help&id=managing_priority
[wwise-music]: https://www.audiokinetic.com/en/library/edge/?source=Help&id=understanding_interactive_music
[phillips]: https://www.gamedeveloper.com/game-platforms/hybrid-linear-dynamic-music-for-game-composers-from-spyder-to-sackboy-gdc-2021-
[saltsman]: https://blog.adamatomic.com/post/172749451585
[celeste]: https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html
[celeste-code]: https://github.com/NoelFB/Celeste/blob/7fd7ae760bc98bc1659c035d807cb47a3463e9b7/Source/Player/Player.cs
[gs-check]: https://raw.githubusercontent.com/rondorkerin/gamestack/0419358df31455e63820bdd89f3c5b446665f604/plugins/gamestack/skills/game-feel-and-juice/CHECKLIST.md
[ab-skill]: https://raw.githubusercontent.com/abagames/agentic-gamedev-skills/4ed8d751d08b5c1be14ccca02ce0b9a9bea60593/.agents/skills/maximizing-game-feel/SKILL.md
[gp-skill]: https://raw.githubusercontent.com/GarrettPetersen/indie-game-vibe-coding-skills/272f38bde700195ba194dfe1eddba7cef3dcd917/skills/polish-game-feel/SKILL.md
[m4-skill]: https://raw.githubusercontent.com/m4bwav/game-juice/e593419be3e0ec6c774f6a5e4a559d4e188d75a1/skills/juice-apply/SKILL.md
[vg-skill]: https://raw.githubusercontent.com/kyh/vibedgames/741bcc32c4480a2b5fb613943303e0e9a6775f18/plugins/vibedgames/skills/game-feel/SKILL.md
