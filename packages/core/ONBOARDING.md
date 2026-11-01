# Why the `ritmo-onboarding` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not published: `package.json` `files` leaves it out (`pnpm pack:check` fails if it ships), and the website does not read it.

Every rule in [`skills/ritmo-onboarding`](skills/ritmo-onboarding/SKILL.md) traces back to one of two things:

- **Practice:** advice from people who teach games to players (designers' talks and postmortems, playtesting and usability research, mobile first-session practice, jam rules), quoted below with a link.
- **Ritmo:** how the library works (the repo's `AGENTS.md`), or what the maintainer saw in the Still Time jam game (October 2026): a one-mechanic, real-time action game for the phone whose first rooms went through about forty rounds of playtests with strangers before they taught the rule. These are conventions and one game's evidence, not design claims, and are marked as such.

A rule that is neither does not go in the skill. The skill states principles and leaves the procedure to the agent: a template, a fixed number of rooms, words, seconds, or rounds does not go in, even with a source, because it makes every game start from the same script. The skill says so itself: it was drawn from one game, and names the action-game case in parentheses where a rule is general. A review before shipping (one Opus 5.5 reviewer and four agents each handed a game unlike Still Time: a mouse-only deduction game, a keyboard platformer, a turn-based tactics game on a phone, a four-gamepad party game) rewrote its vocabulary from rooms, threats, fights, hit screens and taps to what every game has, and that is the wording below. When you change the skill, change this file in the same commit.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. Three sources are other agent skill packs (pstack, CCGS, gamestack): they show what others have built, not established authority, so they are never the only source for a design claim. Still Time's own numbers (how long a door waits, how far a bullet starts) are the game's, not the skill's.

## Where we chose against a source

- **The words can be skipped; the doing cannot.** Adams lists "Force the player to take the tutorial." and "Force the player to complete the whole tutorial." among the ways to make a bad one, and Apple's game onboarding guidance says to "consider providing a way to skip introductory sequences and tutorials". Andersen's study found that "restricting player freedom in order to focus the player's attention on a target concept" did not improve learnability. We keep a skip on the scene that tells the rule, and none on the lesson that makes the player do it: in Still Time every room that could be passed without the lesson was passed without it, and the player came out believing the rule did not matter. The cost to a player who knows the rule is bounded instead: the gate takes only the time to do the lesson. See [Impossible to pass by chance](#impossible-to-pass-by-chance).
- **Tell and show, then do; the words say what the picture cannot.** Vollmer, on Threes: "I strongly believe that 'show don't tell' is the wrong approach for teaching." Kirschner, Sweller and Clark find "minimally guided instruction is less effective and less efficient" for novices. Sweller also warns that "If the text is redundant, processing it imposes an extraneous cognitive load." So the skill's scene tells the rule in words beside the picture of it, in the Threes order (the rule, then a safe place to practise), and the words carry the rule's name, not a description of what is already seen. What it refuses is words as the only channel, which Andersen, Nielsen, Krug and the Still Time playtests all found unread.
- **A lesson for what contradicts expectation, not for every rule.** Andersen found tutorials "did not significantly improve player engagement in the two simpler games" and "may not be justified for games with mechanics that can be discovered through experimentation". The skill agrees for a rule that is the genre's default, and teaches a rule that contradicts what a player of the genre expects (time that stops when they do), which is not discovered by experimentation while a jam judge gives the game minutes. See [Teach what contradicts what the player expects](#teach-what-contradicts-what-the-player-expects).
- **Something at stake first, but a first contact that costs nothing.** Koster, *A Theory of Fun*, 2004 (book, via [Goodreads][koster]): "Fun is about learning in a context where there is no pressure from consequence". Gee: newcomers cannot learn "if they feel too much pressure". The skill puts the stake on screen in the first seconds because, without one, Still Time's rooms taught nothing, and makes the first contact free (the bullet shown before it can act, or an instant retry in place) so the first lesson has no cost. The consequence is real from the second contact on.
- **Controls in the game, never only on the page.** Jams disagree: one forbids using the page for controls, another says "Controls: on the page or in the pause menu." The skill follows the first, since the Still Time judge's pass and the jam write-ups agree nobody reads the page before playing. Page copy is a bonus. See [Controls](#controls).
- **The user is not the playtester here.** `ritmo-prototype` treats the user as the nearest playtester there is. Fullerton and Budiu warn the designer is too close to the work, and Valve says "Use external playtesters". The maintainer finished Still Time and thought the rooms worked; the first stranger showed they did not. So this skill asks for strangers, and reads the user's own play as a round about feel, not about teaching.

## The intro: strangers, a few minutes, no reading; the user knows the rule

- Lovell, "Words to ban #4: Tutorial", 2019 ([link][lovell]): "the purpose of the FTUE is not teach; it is to demonstrate the fun of the game to players who may not yet be engaged." … "Ban the word Tutorial and focus on delivering the fun to earn the next 30 seconds of Playtime, and the next, and the next."
- Campbell, "Big list of game jam advice", Defold, 2022 ([link][defold]): "People will most likely play your game for between 3 and 10 minutes" … "you have that amount of time to introduce your mechanic and make the game stand out from others."
- Ludum Dare rules, 2017 ([link][ld-rules]): "The ideal Ludum Dare game can be played right in the browser, in a few minutes, alone." … "Games that are hard to play have a hard time getting ratings."
- Fernandez, "Unity Game Jam Manila 2012 Part 3", Game Developer, 2012 ([link][fernandez]): "the judges couldn't understand how the game works even with the presentation that was made." … "NO ONE WILL WANT TO BOTHER READING THE HELP/CONTROLS SCREEN."
- Budiu, "You Are Not the User", NN/g, 2017 ([link][nng-false]): "The false-consensus effect refers to people's tendency to assume that others share their beliefs and will behave similarly in a given context." … "Know who your users are and how they respond to your designs by watching them use these designs."
- Faliszek (Valve), via Remo, Gamasutra, 2008 ([link][faliszek]): "'I'm an idiot. This is pretty obvious this doesn't work. It's not their fault, it's our fault.'" … "Playtesting is just proof to you. There's no way you can argue with that."
- Valve, "Half-Life 2 design process", GDC 2006 slides ([pdf][valve-slides]): "Simulate the player in their living room" / "Dont give them hints" / "Dont answer any questions" / "Use external playtesters" (the PDF's text layer drops the apostrophes).
- **Ritmo:** the maintainer, after completing Still Time themselves: "Play tested this with another person. She did not read text. Alas, not many people do. She did not understand that time slows down and speeds up, that she had to reach the goal in the first level (she got there by accident) … and the third she was completely lost". And after the next round: "even after they complete the first three levels (by chance) they still can't tell that time was involved."

## The first minute

### The rule on screen, in action, before anything is asked; no screen of instructions; the title plays the game

- Apple, "Onboarding for Games" ([link][apple-onboarding]): "Start onboarding at launch. When possible, avoid showing splash screens, menus, agreements, or disclaimers when a new player opens your app, as these create a delay in quickly getting into gameplay."
- Laubheimer, "Onboarding Tutorials vs. Contextual Help", NN/g, 2023 ([link][nng-onboarding]): "Tutorials interrupt users, don't necessarily improve task performance, and are quickly forgotten." … "Users want to start using the product right away." … "we find that users frequently skip them."
- Katkoff, "Clash Royale", Deconstructor of Fun, 2016 ([link][katkoff-cr]): "it takes only a handful of seconds to open the app, go to matchmaking and start a battle".
- George Fan, "How I Got My Mom to Play Through Plants vs. Zombies", GDC 2012, via Calender, Filament Games, 2017 ([link][fan-filament]): rule one, "Blend the tutorial into the game".
- Anthropy, "level design lesson: to the right, hold on tight", 2009 ([archive][anthropy]): "this is the first thing a player sees on starting the game. so what does it teach her? the first and highest concept in the game: that mario's goal is to the right!"
- Blow on The Witness, via Takahashi, GamesBeat, 2014 ([link][blow]): "There's no opening cutscene that you missed. You're in a dark hallway with a thing at the end."
- Wong on Monument Valley, via Graft, Game Developer, 2014 ([link][wong]): "Monument Valley is designed to show its hand from the get-go".
- **Ritmo:** the maintainer on Still Time's "how to play" button: "I know most people will just skip it and blame the game that they don't understand." A briefing screen two agents designed together was cut on the next prompt for the same reason. The title playing a lesson behind itself is a Ritmo convention: the simulation is headless, so a scripted player (Still Time's `Director`) drives it at no cost, and the design notes record that "players see the rule before they press anything."

### Something at stake that the rule changes, at once; the first contact costs nothing, the second is real

- Cook, "Building Tight Game Systems of Cause and Effect", 2012 ([link][cook-cause]): "A tight system has clearly defined cause and effect." … "Too long and the player misses that there is an effect at all." … "These are the systems you need to be most obvious in the first seconds of play".
- Salen & Zimmerman, *Rules of Play*, 2004, p. 34 (book, via [a course page][salen]): "Meaningful play occurs when the relationships between actions and outcomes in a game are both discernible and integrated into the larger context of the game."
- Anthropy ([archive][anthropy]) on the first goomba: "if the allows it to touch mario, it is instantly made clear that this mushroom is bad news and its touch fatal." … "note how long this mushroom's path to mario is: the player is given the opportunity to observe the mushroom's behavior before mario interacts with it." (The typo is in the original.)
- Hayashida (Nintendo), via Nutt, Gamasutra, 2012 ([link][hayashida]): "First, you have to learn how to use that gameplay mechanic," "then the stage will offer you a slightly more complicated scenario in which you have to use it."
- Gee, "Learning by Design", 2004 ([link][gee]): "Sandboxes are game play much like the real game, but where things cannot go too wrong too quickly or, perhaps, even at all." … "You can't expect newcomers to learn if they feel too much pressure, understand too little, and feel like failures."
- gamestack, `onboarding-and-teaching/GUIDE.md` ([L25][gs-guide]): "**Failure mode — "Ambush introduction":** the first time a mechanic is needed it is also immediately lethal. Player dies, attributes it to bad luck rather than a lesson, and forms no mental model." And ([L81][gs-guide]): "A player who experiences a negative consequence and understands its cause learns more durably than one who is told the consequence will occur."
- McMillen, on Super Meat Boy, Game Developer, 2010 ([link][mcmillen]): "When you are trying to teach someone something, you don't punish them when they make a mistake."
- **Ritmo:** Still Time's design notes: "three guided rooms with no threat in them (a stick drill, a clockwork corridor, a door on a timer) taught nothing: while moving, players watch the thumb and the target, never the surroundings, and nothing ever made stillness matter." The maintainer's diagnosis: "when people move they forget about the surroundings and focus on the threat/enemies/movement." The fix that worked opened on a bullet already in flight, shown before it could act. "Something at stake" instead of "a threat" is from the review: a deduction game's stake is the case, a tactics game's the unit that cannot move after it strikes.

### The rule, then the controls; told once in the game's pieces, at the player's pace; one thing per stretch

- Vollmer & Wohlwend, "Threemails", 2013 ([link][threes]): "first we explain the rules clearly and then we give them a safe place to get used to the spawning/merging" … "So we want players to do three things: Listen + Do + See." … "They all finished the tutorial in < 2 minutes and fully understood the game when they were finished."
- Weier (Valve), Portal 2 commentary ([link][portal2]): "Because the ping tool was so important, we decided to train players in its use before we did anything else. We held back on the vast majority of player actions and let the players focus entirely on the ping tool."
- Chin (Valve), Portal commentary ([link][portal]): "Playtesting revealed that this puzzle introduced too many new concepts at once, which ended up frustrating a lot of playtesters. In response, we inserted two test chambers before this one to make the energy-ball redirection training more gradual."
- Fan, via a viewer's notes ([link][fan-notes]): "Let players play with their toys before introducing new ones."
- Apple ([link][apple-onboarding]): "To help players retain information more easily, teach one step at a time using short and clear instructions."
- Telfer, "Mobile Game Tutorials & Storytelling", 2014 ([link][telfer]): "Manage your game complexity so that at no point the player is introduced to too much complexity all at once."
- CCGS, `difficulty-curve.md` ([L114-116][cg-curve]): "Introduce the most essential verb first. Introduce mechanics that modify other mechanics AFTER the base mechanic is internalized. Never introduce two new mechanics in the same encounter."
- Adams, "Eight Ways to Make a Bad Tutorial", 2011 ([link][adams]): ways one and seven, "Force the player to take the tutorial." and "Force the player to complete the whole tutorial." Apple ([link][apple-onboarding]): "consider providing a way to skip introductory sequences and tutorials if they wish to do so." Hence the scene is skippable; the lesson is not (above).
- **Ritmo:** the maintainer, on a first room that taught the rule and the stick together: "Too much at once in the first room, too many moving things, and the same issue of just going straight, ignoring the tutorial, and then be lost later." The split (a scene for the rule, then rooms for the movement) was the maintainer's: "Then the other rooms start to teach the movement itself." "At the player's pace" is from the same playtests: a fixed beat was "too brief, confusing", and minimum holds added after that made "players who had read the line" wait, so each beat holds until the player goes on. That the scene is "in the game's own pieces", not a screen of instructions, is what keeps it from being the briefing the first rule forbids (the review's point).

### Teach what contradicts what the player expects

- Andersen et al., "The Impact of Tutorials on Games of Varying Complexity", CHI 2012 ([pdf][andersen]): "Our results suggest that investment in tutorials may not be justified for games with mechanics that can be discovered through experimentation."
- Fan, via a viewer's notes ([link][fan-notes]): "Don't spoon-feed your players or insult their skills by teaching them concepts they already understand."
- gamestack ([GUIDE L177][gs-guide]): "**Genre conventions change the baseline.** A Soulslike player entering their fifth FromSoftware game has mechanic schema a first-time player does not."
- **Ritmo:** Still Time's drag was "never taught as a stick: the first room's bullet teaches 'drag, and it moves; let go, and it stops', which is all a player needs (a drill of the stick was tried and dropped: it taught dragging, which nobody failed at)." The rule that needed the lesson was the one that contradicted expectation: that standing still is safe.

## What a lesson is

### Teach only what the player can see; a contradiction is fixed in the rule

- Grimes (Valve), Portal 2 commentary ([link][portal2]): "Playtesters also weren't able to report the grid's properties. That indicated to us that we needed to better communicate when an interaction was occurring."
- Norman, *The Psychology of Everyday Things*, 1988 (book, via [an excerpt][norman-poet]): "Make things visible, including the conceptual model of the system, the alternative actions, and the results of action." … "The effect of each action must be both visible and easy to interpret."
- Nielsen, "10 Usability Heuristics", 1994 ([link][nng-heuristics]): "The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time."
- Crawford, *The Art of Computer Game Design*, 1984 ([archive text][crawford]): "A particularly bad case arises when the player's score falls or levels off midway through the learning experience, indicating that the game contains contradictory elements that confuse and distract."
- **Ritmo:** Still Time's rule was "every new piece must be readable from a paused frame". Its analog speed could not be: "the finger covers the stick, and a paused frame cannot show a half pull", so it left the tutorial and the pitch. The contradiction: at the old slow floor "a bullet 4 m away still took a motionless player in ten seconds, and taught that 'still' is not safe"; the fix was a true freeze, not a hint.

### Impossible to pass by chance

- Walker (Valve), Portal commentary ([link][portal]): "Completing the puzzle requires walking through a minimum of five portals in a specific order. This kind of gating, in which a solid understanding of key gameplay concepts is required for success, helped standardize the learning curve of the game tremendously."
- Barnett (Valve), Portal commentary ([link][portal]): "We'll usually rework a level if playtesters discover a way to bypass chunks of the puzzle too easily."
- Anthropy ([archive][anthropy]) on the first pipe: "it makes sure the player can't leave this screen before she knows that she can make mario jump higher by holding down the jump button."
- gamestack ([GUIDE L29][gs-guide]): "The gate must have no alternate path so that success is unambiguous evidence of understanding, not luck."
- Cook, "The Chemistry of Game Design", 2007 ([link][cook-chem]): "Mastery flows down the chain and if players are blocked early on, they'll never reach the further atoms."
- **Ritmo:** the maintainer, round after round: "I can still finish the first room without doing the tutorial. We can just remove the exit and just win when finish the tutorial." … "The tutorial still allows you to compete it by chance, and they are lost." … "you can just run fast onto the wall itself, the time just passes anyway, and the wall is gone and they win." The test that keeps it: `test/teaching.test.ts` plays a charger (full push, never a stop) through the early fights twenty times each and fails if it ever wins one. "Beyond what the game's own luck allows" is from the review: a card or party game cannot promise that a player who skipped the lesson never wins, only that they do no better than its randomness. "The gate costs a player who knows the rule only the time to do it" is the bound we set against Adams and Apple (above).

### Words are never the only channel; a few words where the eyes are; a word that names an act gets done

- Nielsen, "How Users Read on the Web", 1997 ([link][nng-read]): "People rarely read Web pages word by word; instead, they scan the page, picking out individual words and sentences."
- Krug, *Don't Make Me Think, Revisited*, 2014 (book, via [Brikman][krug]): "The main thing you need to know about instructions is that no one is going to read them."
- Fan, via Filament ([link][fan-filament]): "there should be a maximum of eight words on the screen at any given moment"; and rules "Better to have the player 'do' than 'read'" and "Use visuals to teach".
- Harley, "Instructional Overlays and Coach Marks for Mobile Apps", NN/g, 2014 ([link][nng-overlay]): "users tend to dismiss them quickly and do not read thoroughly." Users "cannot read the hint overlay and use the app at the same time, they are forced to memorize the instructions and then apply them." Presenting hints "one-by-one, at the right moment, makes it a lot easier for users to understand and learn instructions."
- Andersen et al. ([pdf][andersen]): "Since players seem to learn more from exploring than from reading text, we believe that it is important to design early levels in a way that maximizes a player's ability to experiment and discover game mechanics."
- Miles (Electric Square), via Orr, PocketGamer.biz, 2021 ([link][miles]): "a tutorial should be played and not read" … "Rather than throw text at players, use the game environment to provide short text that gets straight to the point".
- The Level Design Book, "Wayfinding" ([link][ldb-wayfinding]): "1. Players don't look upwards unless something draws their eye. 2. Players look in the direction they are moving. 3. Players focus on contrast (in color, shape, lighting, and movement.)" Barnett (Valve), Portal commentary ([link][portal]): "One bizarre fact of game design is that, without some serious prompting, players will rarely look up."
- **Ritmo:** "touch it to cut" and "touch the circle" both made players touch the screen: "'touch it to cut' makes the user touch it physically on the screen" and "touch the circle makes people touch the circle around the player, not the pressable one." Still Time's gauge sat "top-left where nobody looks" and was replaced by a pause sign over the hero, "where the eyes are".

### The failure names the rule; retry at once

- Neusesser & Sunwall, "Error-Message Guidelines", NN/g, 2023 ([link][nng-errors]): "Provide descriptions of the exact problems to help users understand what happened." … "Merely stating the problem is also not enough; offer some potential remedies." Nielsen's heuristic ([link][nng-heuristics]): "Error messages should be expressed in plain language (no error codes), precisely indicate the problem, and constructively suggest a solution."
- Norman, *The Design of Everyday Things*, 2002 ed. (book, via [Wikiquote][norman-doet]): "Remember, any problems you have are probably the design's fault, not yours."
- Adams ([link][adams]): "When a player fails at a jump, or any other physical challenge, she should be able to try it again immediately."
- McMillen ([link][mcmillen]): "The time it takes for Meat Boy to die and respawn is almost instantaneous."
- CCGS ([L132-134][cg-curve]): "A well-designed first failure teaches rather than punishes. The player should be able to immediately identify what they did wrong and what they would do differently. If the cause of failure is ambiguous, the player blames the game."
- gamestack ([CHECKLIST L32][gs-checklist]): "Teach through **consequence**: every first-attempt failure must have a single, visible, immediate cause the player can articulate within 5 seconds."
- **Ritmo:** "the playtest showed the user getting confused there" (on being hit). Before the fix, Still Time's first duel "kills a non-learner twenty times with nothing said"; after it, "a hit remembers what took you … and the screen says what the rule was … the shot that took you hangs where it struck". That it is "the most-read screen in the game" is the maintainer's observation, not a measured claim; "the failure" rather than "the hit screen" is from the review, so a lost case or a lost battle counts.

## Controls

### Strangers use the input they already know; show it being done; accept any amount; never the only way

- Nielsen, "Mobile Usability 2nd Research Study", NN/g, 2011 ([link][nng-swipe]): "Swiping is still less discoverable than most other ways of manipulating mobile content" … "we recommend including a visible cue when people can swipe".
- Budiu, "iOS 7 User-Experience Appraisal", NN/g, 2013 ([link][nng-ios7]): "because gestures have low affordance, discoverability, and memorability, some users never use them."
- Babich, "How To Communicate Hidden Gestures in Mobile App", 2016 ([link][babich]): "Hint motion shows a preview of how to interact with an element." … "Avoid mandatory multi-step UI walkthrough and try to educate in context of action (when user actually needs it)."
- Apple Human Interface Guidelines, "Gestures" ([link][apple-gestures]): a custom gesture must be "Discoverable", "Straightforward to perform", "Distinct from other gestures", "Not the only way to perform an important action in your app or game".
- jabuwu, "My Game Jam Philosophy", itch.io, 2022 ([link][jabuwu]): "Put your controls on screen when they are introduced" … "Players want to get to the "good stuff" as soon as possible and will ignore instructions".
- **Ritmo:** "She also did not really keep her finger pressed to drag, more like swipes for the most part." … "The 'slide a little' does not work. They slide all the way up, not realizing the indicator needs to go to the circle before it." … "In room 2 the gesture does not show that much that you need to hold, it looks more like a drag." … "A person tried to 'shoot' the enemy in the third room by clicking on the character". The hand that presses, holds, slides and lifts, and "any walk at all counts", are what finally held up. The key or button for desktop and gamepad games is the same rule on another device (the review).

### Every input the game accepts has a defined result under the rule

- Norman, *The Design of Everyday Things*, 2002 ed. (book, via [Wikiquote][norman-doet]): "Don't think of the user as making errors; think of the actions as approximations of what is desired."
- Fan, via a viewer's notes ([link][fan-notes]): "People will press the shiny button."
- **Ritmo:** the rest is Still Time's. Follow-the-finger controls were dropped because "this pattern also allows the user to keep clicking and get spammed with times stopping events, and the user tries to reach the end without going smooth, but by spamming click one after the other." The wall: "If I am going against a wall, and I don't move, nothing should move?", now the rule "Pushing into a wall … is standing still: you do not move, so neither does time."

### On a phone, the finger hides what is under it; targets bigger than the finger

- Vogel & Baudisch, "Shift", CHI 2007 ([pdf][shift]): "We argue that the main reasons are the occlusion of the target by the user's finger and ambiguity about which part of the finger defines the selection point." … "targets smaller than the finger's contact area are also occluded by the finger, preventing users from seeing visual feedback."
- Harley, "Touch Targets on Touchscreens", NN/g, 2019 ([link][nng-touch]): "the average person's fingertips are 1.6–2cm (0.6–0.8 in) wide." … "the fat fingers are not the real culprit; the blame should lie on the tiny targets."
- **Ritmo:** "the text and place to hold is too small, and it shows exactly on top of my finger, so I cannot read" … "The circles where I need to move my fingers are also hidden by my finger." The stick was then "mirrored up by the caption, where the finger can't hide it".

### The controls are taught in the game, never only on the page

- Fernandez ([link][fernandez]): "NO ONE WILL WANT TO BOTHER READING THE HELP/CONTROLS SCREEN."
- IndieGameClinic, Collab Jam rules, itch.io, 2026 ([link][igc]): "The game page should not be used to provide an external tutorial or guidance for how to control the game."
- Against it, the Proof-of-Play Jam rules, itch.io, 2025 ([link][pop-jam]): "Controls: on the page or in the pause menu." We follow the first (see "Where we chose against a source").
- **Ritmo:** Still Time's design notes keep its controls on the page as a bonus ("controls in two blocks, phone and desktop") and in the game as the lesson.

## The check

### Naive players as bots; the rule's promise as an invariant; a playtest as a replay

- Valve, GDC 2006 slides ([pdf][valve-slides]): "Playtests are your experiments" / "Evaluate your designs as a result of playtests" / "Repeat". Ambinder (Valve), via Brown, GMTK, 2023 ([link][gmtk-valve]): "We see our game designs as hypotheses and our playtests as experiments to validate these hypotheses."
- Cook ([link][cook-chem]): "It is very common that skills acquisition requires multiple passes through the new skill atom before mastery is achieved."
- **Ritmo:** the `ritmo` skill's principles: "Player actions are typed intents a system validates; bots, tests, and replays send the same ones" and "A change is done when a headless test scripts the input and asserts what a player would see." The bots are the strangers Still Time saw (a charger, a swiper, a tap-spammer, a wall-pusher, and one who stood still through the lesson), and the charger is already a test there: "If a room here ever becomes winnable by charging, it stopped teaching." The skill does not list those five, because a list from one game is a template: it names the ways every game has (doing nothing, the obvious thing at full force, one input repeated, the input you did not mean), which the review's four games each produced in their own form (the one-clue accuser, the masher, the attack-first bot, the grower), and asks for a bot per way a stranger was seen to skip the lesson. Running each "many times with variation" is the teaching test's shape (twenty trials, a sideways bias each), without its numbers. Invariants with `Fuzz.run` and replays as regression tests are the `@typeonce/ritmo-devtools` README and the `ritmo` skill's `playbooks/bug-fix.md`, applied to teaching.

## After a playtest

### One stranger at a time, early and often

- Nielsen, "Why You Only Need to Test with 5 Users", 2000 ([link][nng-five]): "The best results come from testing no more than 5 users and running as many small tests as you can afford."
- Krug, *Don't Make Me Think, Revisited*, 3rd ed. (publisher excerpt, [link][krug-one]): "Testing one user is 100 percent better than testing none." … "Testing one user early in the project is better than testing 50 near the end."
- **Ritmo:** "a stranger who played once is no longer one" is the maintainer's: Still Time's second playtest reused the first person ("Tried the playtest again with the same person and another one"), and what she did the second time no longer showed what a first play shows.

### Watch, silent; write what they did, not what they said; a line per round

- Nielsen, "First Rule of Usability? Don't Listen to Users", NN/g, 2001 ([link][nng-listen]): "Watch what people actually do." … "Do not believe what people say they do."
- The Level Design Book, "Playtesting" ([link][ldb-playtest]): "Watching their behavior is more important than their feedback" … "resist the urge to interrupt the playtest to apologize or explain." … "The goal of a playtest is to help the designer predict whether their game works for their audience. It's not about the player's performance."
- Swift, "Thinking With Portals", Game Developer, 2008 ([link][swift]): "We'd sit them down, tell them to play the game just as they would at home, and then watch them play from beginning to end." … "Actually observing someone play your game gives you much more information".
- CCGS, `vertical-slice/SKILL.md` ([L160-163][cg-slice]): "watch them silently without explaining anything. Don't guide them. Their confusion reveals what the game isn't communicating on its own."
- Cook, "Game Design Logs", 2011 ([link][cook-logs]): "This contains daily play notes, prioritized next steps and ideas." (Already the source of `PROTOTYPE.md`'s round log; here the line records what the stranger did.)
- **Ritmo:** the maintainer's prompts that led to a fix each named a behaviour: "They slide all the way up", "A person tried to 'shoot' the enemy in the third room by clicking on the character", "touch the circle makes people touch the circle around the player". The ones that did not ("This does not work", "This is the worst of them all") got another guess. Still Time's design notes keep each cut attempt as "(Tried and cut: …)" so nobody tries it twice.

### Fix the cause; when rounds fail the same way, change the lesson or the rule; agents agreeing is not a playtest

- Pozzi & Zimmerman, "A Primer for Playtesting", rule T ([pdf][primer]): "you can take their suggestions as symptoms of what is and isnʼt working in the project, rather than as directions for the next steps in your design."
- Adams ([link][adams]): "If the player fails at the tutorial, then clearly the tutorial itself has failed."
- pstack, `poteto-mode/SKILL.md` ([link][ps-premise]): "**Attack the Premise.** Two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it."
- Valve slides ([pdf][valve-slides]): "Often you learn more from what playtesters dont experience" and "We felt done as soon as playtesting was no longer painful to watch".
- Brown, GMTK, 2023 ([link][gmtk-valve]), reporting a Portal playtester: "that was a great tutorial, I can't wait to play the actual game." Brown: "Uh. Slight problem. That was the actual game."
- **Ritmo:** about thirty-five prompts over four hours patched Still Time's first three rooms (arrows, circles, captions, a gesture drill, timed doors) and each playtest failed the same way. The fix came from a fresh thread that asked why strangers did not get it, with permission to change the game: the diagnosis was the design (no threat; a rule the player could not see; a creep that contradicted it), not the hints. "Agents agreeing is not a playtest" is from the briefing two models designed together and the next playtest rejected; the maintainer's direction.

## Each round

The reply is the link, the lesson in one line, which naive players the check ran, and what to watch the stranger do: a Ritmo convention, the same shape as `ritmo-prototype`'s round reply, for a user who hands the device to someone and only skims the reply. Naming the lesson in one line is the "charger bot" idea turned on the words: if the agent cannot say what the player must do to get through, the lesson cannot teach it.

[lovell]: https://www.gamesbrief.com/2019/04/words-to-ban-4-tutorial/
[defold]: https://defold.com/2022/07/22/Big-list-of-game-jam-advice/
[ld-rules]: https://ludumdare.com/resources/archive/rules-2017/
[fernandez]: https://www.gamedeveloper.com/game-platforms/unity-game-jam-manila-2012-part-3
[nng-false]: https://www.nngroup.com/articles/false-consensus/
[faliszek]: https://www.gamedeveloper.com/game-platforms/valve-s-faliszek-playtesters-aren-t-idiots-it-s-you
[valve-slides]: https://cdn.fastly.steamstatic.com/apps/valve/2006/GDC2006_HL2DesignProcess.pdf
[koster]: https://www.goodreads.com/author/quotes/10980.Raph_Koster
[apple-onboarding]: https://developer.apple.com/app-store/onboarding-for-games/
[nng-onboarding]: https://www.nngroup.com/articles/onboarding-tutorials/
[katkoff-cr]: https://www.deconstructoroffun.com/blog//2016/02/clash-royale-next-billion-dollar-game.html
[fan-filament]: https://www.filamentgames.com/blog/10-tips-designing-game-tutorial
[fan-notes]: https://notes.hamatti.org/sources/talks/how-i-got-my-mom-to-play-through-plants-vs.-zombies
[anthropy]: https://web.archive.org/web/20121229124040/http://www.auntiepixelante.com/?p=465
[blow]: https://gamesbeat.com/inspired-by-myst-jonathan-blow-aims-to-deliver-indie-creativity-with-the-witness/
[wong]: https://gamedeveloper.com/design/designing-the-surprise-mobile-game-hit-i-monument-valley-i-
[cook-cause]: https://lostgarden.com/2012/07/01/building-tight-game-systems-of-cause-and-effect/
[cook-chem]: https://lostgarden.com/2021/03/13/the-chemistry-of-game-design-2/
[cook-logs]: https://lostgarden.com/2011/05/03/game-design-logs/
[salen]: https://mycours.es/egd/?p=1134
[hayashida]: https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design
[gee]: https://gamedeveloper.com/design/learning-by-design-games-as-learning-machines
[threes]: http://asherv.com/threes/threemails/
[portal]: https://theportalwiki.com/wiki/Portal_developer_commentary
[portal2]: https://theportalwiki.com/wiki/Portal_2_developer_commentary
[telfer]: https://mobilefreetoplay.com/mobile-tutorials-storytelling/
[adams]: https://www.designersnotebook.com/Columns/110_Bad_Tutorial/110_bad_tutorial.htm
[norman-poet]: https://connexions.org/CxLibrary/CX8661.htm
[norman-doet]: https://en.wikiquote.org/wiki/Donald_Norman
[nng-heuristics]: https://www.nngroup.com/articles/ten-usability-heuristics/
[crawford]: https://archive.org/stream/artofcomputergam00chri/artofcomputergam00chri_djvu.txt
[nng-read]: https://www.nngroup.com/articles/how-users-read-on-the-web/
[krug]: https://www.ybrikman.com/blog/2014/09/26/dont-make-me-think-revisited/
[krug-one]: https://www.peachpit.com/articles/article.aspx?p=2209313
[nng-overlay]: https://www.nngroup.com/articles/mobile-instructional-overlay/
[andersen]: https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf
[miles]: http://www.pocketgamer.biz/pgc-digital-how-to-enhance-the-first-time-user-experience/
[ldb-wayfinding]: https://book.leveldesignbook.com/process/blockout/wayfinding
[ldb-playtest]: https://book.leveldesignbook.com/process/blockout/playtesting
[nng-errors]: https://www.nngroup.com/articles/error-message-guidelines/
[mcmillen]: https://www.gamedeveloper.com/game-platforms/-i-super-meat-boy-i-s-mcmillen-explains-why-so-hard-
[nng-swipe]: https://www.nngroup.com/articles/mobile-usability-2nd-study/
[nng-ios7]: https://www.nngroup.com/articles/ios-7/
[babich]: https://babich.biz/blog/how-to-communicate-hidden-gestures-in-mobile-app/
[apple-gestures]: https://developer.apple.com/design/human-interface-guidelines/gestures
[jabuwu]: https://itch.io/devlog/358157/my-game-jam-philosophy.amp
[shift]: https://projects.csail.mit.edu/hci-reading/papers/chi2007-vogel.pdf
[nng-touch]: https://www.nngroup.com/articles/touch-target-size/
[igc]: https://itch.io/post/16160170
[pop-jam]: https://itch.io/jam/proof-of-play-jam
[gmtk-valve]: https://gmtk.substack.com/p/valves-secret-weapon
[nng-listen]: https://www.nngroup.com/articles/first-rule-of-usability-dont-listen-to-users/
[swift]: https://www.gamedeveloper.com/design/thinking-with-portals-creating-valve-s-new-ip
[nng-five]: https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/
[primer]: http://mycours.es/gamedesign2018/files/2018/11/playtesting-primer.pdf
[ps-premise]: https://github.com/cursor/plugins/blob/4dd1d05818d19792e7cd6e818f1667f95f7e1dbe/pstack/skills/poteto-mode/SKILL.md
[gs-guide]: https://github.com/rondorkerin/gamestack/blob/0419358df31455e63820bdd89f3c5b446665f604/plugins/gamestack/skills/onboarding-and-teaching/GUIDE.md
[gs-checklist]: https://github.com/rondorkerin/gamestack/blob/0419358df31455e63820bdd89f3c5b446665f604/plugins/gamestack/skills/onboarding-and-teaching/CHECKLIST.md
[cg-curve]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/docs/templates/difficulty-curve.md
[cg-slice]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/vertical-slice/SKILL.md
