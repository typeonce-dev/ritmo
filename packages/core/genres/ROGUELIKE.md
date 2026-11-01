# What makes a roguelike, or a roguelite, worth another run

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it collects the principles that hold across roguelikes and roguelites, each traced to people who design them, quoted below with a link, in the same shape as [`PROTOTYPE.md`](../PROTOTYPE.md). It is not published: `package.json` `files` leaves it out, and the website does not read it.

It builds on the other genre files and does not repeat them. [`STRATEGY.md`](STRATEGY.md) covers randomness before the decision rather than after it, and the short run as the cure for a snowball. [`TURN-BASED.md`](TURN-BASED.md) covers coming back while there is more to learn, and difficulty ladders the player climbs (Slay the Spire's Ascension). [`RPG.md`](RPG.md) covers Hades running a story on top of a repeated run, failure that costs something and moves you forward, and synergy as a hallmark of Slay the Spire. [`PLATFORMER.md`](PLATFORMER.md) covers Spelunky's generator: hand-made room templates, a guaranteed path, and randomness that is more than a slot machine only with systems behind it. This file is about what sits on top: what the two words mean, why the game has to kill you, what makes one run different from the last in a way the player notices, how a build is put together during a run, and what (if anything) should survive death.

The scope is what one developer or a small team can build, mostly in 2D: action roguelites (Spelunky, The Binding of Isaac, Dead Cells, Downwell, Hades, Rogue Legacy), run-based strategy and deckbuilders (FTL, Into the Breach, Slay the Spire, Balatro), and the traditional roguelikes the genre is named after (Rogue, NetHack, Angband). A principle is listed only when at least two independent sources support it, or one designer states it and a shipped game shows it. Where sources disagree, the disagreement is written down instead of picking a side quietly.

Quotes were checked against the text of the linked page on 2026-11-01, read through a fetch tool (the pages could not be downloaded directly), by asking whether the exact string was on the page. A quote marked "via" was checked on that secondary page, not in the original (a talk, a video, an interview). Two quotes come from a community transcript of a video interview and are marked as such. Paraphrase is never put in quotation marks.

## The principles in one place

1. The two words name what survives death: in a roguelike, only what the player learned; in a roguelite, also something in the game.
2. The game has to kill you, so a run is short enough that losing one is a fair price for starting the next.
3. Variety counts only when the player perceives it: generate from hand-made pieces, so each run looks and plays different and the world still holds together.
4. Most runs can be won: the generator promises a way through, and the start of a run is never already lost.
5. The build is put together during the run, from offers the player cannot always take, and the best pick changes from run to run.
6. In a single-player game, let builds break the game: strong combos are the reward for mastery.
7. Discovery is a pillar: what things do is learned by trying them, and that knowledge is the progression every roguelike keeps.
8. A run keeps moving: a clock or a scarce resource stops the player from stalling to grind.
9. The run's route is a decision of its own: choosing a path on what the build needs is a second layer of planning.
10. Whatever survives death widens the player's options before it adds power, and power that carries over is a floor for players who need it, never the main way to win.

## 1. The two words name what survives death

"Roguelike" first meant a game like Rogue: generated dungeons, permadeath, turns, a grid, and a lot of rules. The Berlin Interpretation (2008) lists those factors, and says itself that a game missing some is still a roguelike. "Roguelite" (also "rogue-lite", "roguelike-like", "procedural death labyrinth") came later for games that keep the generated runs and the permadeath and drop the rest, usually real-time and shorter. The difference that matters to a designer is not turns or a grid but what survives the death: in the traditional form, nothing in the game carries over and only the player's knowledge grows; in most roguelites, something the player earned in one run (an unlock, a currency, a permanent upgrade) is still there in the next. That one choice changes how failure feels, how difficulty is tuned, and what keeps a player coming back (principle 10).

- RogueBasin, "Berlin Interpretation", 2008 ([link][berlin]): "The genre is represented by its canon." … "Permadeath" … "You are not expected to win the game with your first character." … "The game world is randomly generated in a way that increases replayability." … "Missing some points does not mean the game is not a roguelike." … "It is not to place constraints on developers or games."
- Wikipedia, "Roguelike" ([link][wiki-roguelike]), on the later games: "they retain the notion of permadeath and random level generation but lack the other high-value factors" … "Rogue-lites favor short gameplay runs with victory conditions" … "many rogue-lites feature a metagame, whereby achieving certain goals will unlock persistent features" … "The phrase "procedural death labyrinth" has also been applied to such games".
- Mark Brown, "Roguelikes, Persistency, and Progression", Game Maker's Toolkit (transcript, [link][gmtk-persist]): "Because the game never changes from run to run, the overall difficulty level of the game" … "across multiple attempts, that is - is completely flat." … "Roguelites, however, do allow for that slow accumulation of power".
- Cellar Door Games, "Rogue Legacy Design Notes" ([link][rl-notes]), on the line between the two: "The old XP system provided that rogue-like idea of consequence, because every time you died you lost all your XP." Rogue Legacy kept the gold instead, and became the reference roguelite.

## 2. The game has to kill you, so a run is short

The genre's pleasure is that each run is different, and the player only sees the range by starting over, often. So death is not a punishment bolted on; it is the thing that shows the player the rest of the game. Two things follow. A run has to be short enough that losing it costs minutes or an hour, not an evening (FTL's own designers felt two or three hours was too much to ask). And risk has to stay real all the way through: at any moment the run could end, which is what gives each decision weight.

- Greg Kasavin (Hades), interviewed by Marshall Honorof, Tom's Guide, 2021 ([link][kasavin-tg]): "the unique part of roguelike games is that they're different every time you play." … "Roguelikes have to kill you off so you can start over and experience the range of possibilities" … "dying and losing all your progress can also be frustrating enough to make you not want to start over!"
- Kasavin, via Tomas Franzese, Inverse, 2021 ([link][kasavin-inv]): "The part where roguelikes can be brutally difficult is, ironically, directly at odds with the part where they’re so replayable" … "To experience that, they’ve got to kill you".
- Andrew Doull, "The Game Design Lessons of Permadeath", Game Developer, 2009 ([link][doull]): permadeath is "the one compelling design feature that you need to appreciate to understand the genre." … "At any point in time, there should be a non-zero chance that the player will die"
- Matthew Davis (Subset Games), interviewed by John Harris, Game Developer, 2018 ([link][subset-jump]), on FTL: "asking the player to commit to the two or three hours to finish it wasn't great." On Into the Breach: "I wanted to be able to let the players to be able to customize the play length a bit more."
- Berlin Interpretation ([link][berlin]): "You are not expected to win the game with your first character."

## 3. Variety counts only when the player perceives it

A generator can make endless levels that are all the same level. What the player needs is perceptual difference: this run does not look or play like the last one. Fully random layouts tend to fail the other way, reading as chaos with no world behind them. The games that work generate from hand-made pieces (rooms, encounters, items) put together by rules, so the variety is real and the world still makes sense. `PLATFORMER.md` has Spelunky's version of this; Dead Cells and Compton add why.

- Kate Compton, "So you want to build a generator…", 2016 ([link][compton]): "I like to call this problem the 10,000 Bowls of Oatmeal problem." … "I can easily generate 10,000 bowls of plain oatmeal, with each oat being in a different position" … "But the user will likely just see a lot of oatmeal." … "Perceptual uniqueness is the real metric, and it’s darn tough." … "Perceptual differentiation is the feeling that this piece of content is not identical to the last."
- Sébastien Bénard (Dead Cells), "The Level Design of Dead Cells: a Hybrid Approach", 2017 ([link][deepnight]), on fully generated levels: "In short it was illogical, chaotic and left you with no feeling of consistency or immersion in the world." The fix was fixed elements first, "acting a bit like a frame in which the procedural generation can express itself", for "a feeling of consistency between runs and levels."
- Steve Filby (Motion Twin), interviewed by Alex Forbes-Calvin, PCGamesInsider ([link][dc-pcgi]): "What we came up with was about 50:50 random and curated."
- Edmund McMillen, "Postmortem: McMillen and Himsl's The Binding of Isaac", Game Developer, 2012 ([link][isaac-pm]): "These items are random, but still designed".
- Derek Yu, via Game Developer ([link][yu]): "It's easy to add more and more things to a randomized game and rely on what I think of as the "free value" that randomization offers." The free value runs out; what lasts is what the systems do with it (see `PLATFORMER.md`).

## 4. Most runs can be won

Permadeath is fair only if the loss traces to the player (`TURN-BASED.md` principle 2). In a generated game that means two promises. The generator never produces a run that cannot be finished (Spelunky's guaranteed path, in `PLATFORMER.md`). And the start of a run is not already decided by bad luck: a run with nothing but weak finds is a run the player loses before playing it. Dead Cells chose fewer, stronger items for exactly this reason, citing Isaac's long list of weak ones. A final test the player could not prepare for breaks the same promise, at the other end of the run.

- Sébastien Bénard, via Marie Dealessandri, MCV, 2018 ([link][dc-mcv]): Isaac is "a good reference but for its flaws as well": with so many items, a new run has "a very low chance to have a good run" because "most of them are not that powerful." … "That's something we wanted to avoid as much as possible, to make sure that when you play, most runs should be viable."
- Doull ([link][doull]): "Randomized levels require some form of grinding be present in order to guarantee the game is winnable."
- Davis, via Game Developer ([link][subset-jump]): "A lot of people felt that the FTL boss kind of came out of nowhere in its difficulty." He calls the finale "inherently unfair" because players could not prepare for its new mechanics.

## 5. The build is put together during the run

In a roguelike the character (or deck, or ship) is not chosen up front; it is assembled from what the run offers: a few cards after a fight, an item in a room, an upgrade between levels. That is where the genre's decisions live. Two conditions make it work. The offers differ each run, so the build does too and the player has to adapt, not repeat. And no pick is always right: each comes with a trade-off against what the build already has, so the same offer is a good take in one run and a skip in another. A decision the player makes the same way every time is not a decision.

- Justin Ma (Subset Games), via Game Developer ([link][subset-jump]): "if it's a decision, it should be a decision that you don't make the same choice every single time."
- Anthony Giovannetti (Slay the Spire), "Road to the IGF", Game Developer, 2020 ([link][sts-igf]): "There are so many different permutations of decks that you can build in Slay the Spire" … "The important thing is to quickly allow the player to start carving out new strategies" … "It was important to us that there would not just be a single dominant strategy that the player could always do". On finding the pieces: "Our process was to brainstorm thousands of different card designs" … "cut out the chaff down to the designs that we felt had the most impact."
- Mark Brown, "Downwell's Dual Purpose Design", Game Maker's Toolkit (transcript, [link][gmtk-downwell]): "The styles come with tricky trade-offs, as do the upgrades collected between levels." … "Making your bullet casings deadly sounds good, but it could screw up your combo game."
- LocalThunk (Balatro), in a video interview (community transcript, [link][balatro-transcript]): "the complexity is better when it emerges between you know more nodes than just like a couple." Balatro's own pieces are simple; the depth is in how a handful of them combine.

## 6. In a single-player game, let builds break the game

The moment players remember is the run where the pieces clicked and the game could no longer touch them. Designers of these games allow it on purpose: with no opponent to be unfair to, a broken combo is the reward for having seen it. The cost is testing: when most items stack and touch everything, the combinations outgrow what anyone can check by hand. That is the trade, and the games here take it. What is avoided is a combo that wins without the player having built toward it, which is principle 4's unfair start turned upside down.

- Giovannetti ([link][sts-igf]): "Since we are a single player card game, we don't have to worry about the typical downside of strong combos" … "In general, we believe in rewarding player mastery". `RPG.md` quotes his line that strong synergies are "a hallmark of our design process".
- McMillen ([link][isaac-pm]): "70 percent of the items in Isaac stack, and all the item abilities will affect Isaac in some way." The cost, in the same postmortem: "there were so many variables to keep track of that all the testing in the world couldn't have prepared us for launch."
- LocalThunk, in a video interview (community transcript, [link][balatro-transcript]), on testing each new piece: "how far can I push this thing before it really starts to like show its cracks" … and on what does not work: "you have to be really ruthless I think with your design."

## 7. Discovery is a pillar, and knowledge is the progression every roguelike keeps

Traditional roguelikes hide what things do (an unidentified potion, an item with no description) and let the player find out by trying. Isaac kept that from Rogue. The deeper reason it matters: across runs, the one thing that always carries over is what the player learned (what an item does, how an enemy moves, which risks are worth it). Generation keeps that learning about the systems and not about one layout, because the layout will not come back. A game that wants this needs to make things learnable (consistent rules, readable enemies) and then leave room to learn.

- Berlin Interpretation ([link][berlin]): "Exploration and discovery" … "The game requires careful exploration of the dungeon levels and discovery of the usage of unidentified items." … "The game has enough complexity to allow several solutions to common goals."
- McMillen ([link][isaac-pm]): "You weren't sure what things did until you experimented with them."
- Doull ([link][doull]): "Information becomes a precious commodity in a game with randomized levels" … "Without randomized levels, it is possible for a player to progress simply through rote learning."
- Bénard ([link][deepnight]): Dead Cells wanted "difficulty which is based on the players reaction to an evolving situation rather than rote learning."
- Brown ([link][gmtk-persist]), on games where nothing carries over: "the only way to smash through that barrier and win is to improve your own skill."

## 8. A run keeps moving

If the player can make a run safer by waiting (farming easy enemies, resting until full), the best strategy becomes the dullest one, and the run's tension drains away. Roguelikes have always put a clock on the run: food in Rogue, the ghost that comes for a slow Spelunky player, the fleet chasing the ship in FTL. The clock does not have to be a timer; any resource that runs out while the player stalls does the same job. Rogue Legacy applied the same idea between runs: it makes the player spend the gold before going back in, so a run is not a bank.

- Doull ([link][doull]): "any time spent grinding at an early phase of the game, is time wasted." … pacing comes from "explicit timers, such as food in Rogue, and the ghost in Spelunky."
- Berlin Interpretation ([link][berlin]): "Resource management" … "You have to manage your limited resources (e.g. food, healing potions) and find uses for the resources you receive."
- Cellar Door Games ([link][rl-notes]): "Rather than remove your gold on death, we forced you to spend it before re-entering the castle."
- Our reading: Doull also says some grinding has to exist to keep the game winnable (principle 4). The two meet in a clock: the player can buy safety, but only by spending something the run will not give back.

## 9. The run's route is a decision of its own

Between the fights there is a second game: which way to go. FTL's sector map, and Slay the Spire's after it, let the player choose a path (harder fights for better rewards, a shop, a rest) on what the build needs right now. That makes the build and the route plan each other, which is where a run's longer-range strategy lives. It also lets the player tune the run's length and risk from inside it.

- Giovannetti ([link][sts-igf]): "The paths that the player can take were inspired by FTL." … "I think it is valuable to have layered decision-making in a strategy game" … "Choosing a path based on the meta strategy elements adds a lot of richness and depth".
- Casey Yano (Slay the Spire), *Think Like a Game Designer* podcast, show notes ([link][yano]): "We came up with a map system because we wanted to do more planning ahead."
- Davis ([link][subset-jump]), on Into the Breach letting the player "customize the play length a bit more."

## 10. What survives death widens options before it adds power

This is the roguelite's big choice, and the sources split on it (see "Where the sources disagree"). What they agree on is the order. An unlock that adds options (a new character, more items in the pool, a new path) keeps every run a test of skill and still gives the player a reason to have played. Power that carries over (more health, stronger starts) makes the next run easier whether or not the player got better, which blurs what a win means; designers who use it on purpose treat it as the floor that lets weaker players finish, and keep skill as the faster way through. Hades adds a rule of its own: the many channels of progress are there so that no death feels like a "game over", not to make the game compulsive. Unlocks that arrive one at a time also pace the game: a new kind of item arrives after the player has learned the last.

- Brown ([link][gmtk-persist]), on Enter the Gungeon's unlocks: "Instead, it simply adds more weapons to the game's already bursting selection of randomly dropped guns." … "By letting players unlock stuff that's fun, but has no meaningful impact on their chances at finishing the game." … "It just adds extra variety to future attempts at the game." On power that carries over: "Did you get better, or did the game just get easier?" … "that creates a weirdo backwards difficulty curve that brings in an unpleasant ambiguity" … but "this also allows pretty much all players, regardless of skill, to finish the game eventually" and "When you die in Rogue Legacy you don't feel like you've wasted your time".
- Cellar Door Games ([link][rl-notes]): "Skill >>>>> Grind." … "we still wanted people who weren't very good at the game to complete it, so grinding had to be a feasible option." Upgrades were tuned to "not feel critical in the short run, but have it play a big impact in the long".
- Kasavin, Tom's Guide ([link][kasavin-tg]): "We specifically decided that we would have many channels of permanent progression" … "We wanted there to be no sense of a “game over” moment," … "We wanted the game to be engrossing but were not interested in making it addictive."
- Kasavin, via Inverse ([link][kasavin-inv]), on Hades's God Mode (damage resistance that grows a little with each death): "If you could just blow through it, what’s interesting about the game goes away" … "What if we just make you a little bit tougher?" … "God Mode reinforces our belief that the way to approach difficulty settings may need to be proprietary to the game".
- McMillen ([link][isaac-pm]): "When the player beats the final chapter, they unlock new playable characters and items." Dead Cells unlocks paths instead: "Runes, permanent upgrades that let you access a type of path initially blocked." (MCV, [link][dc-mcv]).

## Where the sources disagree

- **Purity or persistence.** Brown: "Personally, I love the purity of roguelikes." He finds carried-over power makes success ambiguous ([link][gmtk-persist]). Kasavin and Cellar Door chose persistence on purpose, so that a death never wastes the player's time and players of any skill can finish ([link][kasavin-tg], [link][rl-notes]). Both sides agree a win should come mostly from skill; they differ on whether the game should ever help. The middle the sources support is principle 10: carry over options freely, carry over power only as an opt-in floor (God Mode is a setting the player turns on), and keep a record of wins without help for players who want the pure version (Spelunky's shortcuts keep a run off the leaderboard, [link][gmtk-persist]).
- **Many weak items, or few strong ones.** Isaac has a very large item pool, most of it stacking with the rest, and is loved for the breadth ([link][isaac-pm]). Bénard calls the same thing its flaw, because most finds are weak and a new run often starts lost ([link][dc-mcv]). The difference is the run: in a short run with many finds, weak items are filler between the good ones; in a longer run with few finds, every weak one is a lost chance. Giovannetti's process (thousands of designs, cut to the ones with "the most impact", [link][sts-igf]) is the version both would accept.
- **How hard.** Yu wants difficulty for what it does to the player: "The difficulty is only one part of the equation. It's the heat part of spicy food." … "I don't eat spicy food to feel pain. But the pain wakes me up" (via NME, [link][yu-spicy]). Kasavin sets out to take the sting out of failure and sees brutal difficulty as "directly at odds" with replay ([link][kasavin-inv]). They meet where `TURN-BASED.md` does: a hard base game, and difficulty the player chooses, upward (Ascension, Hades's Heat) or downward (God Mode).

## For a small 2D prototype

Read with the `ritmo-prototype` skill, whose rules come first, and with the prototype notes in `STRATEGY.md` and `TURN-BASED.md`. These are the principles above turned into what to look for in a first playable, not a recipe:

- A first prototype question is about one run: "is losing a run fun enough to start another at once?" Ask the director right after a death. "One more" is the signal; "that was unfair" points to principle 4, and "that took too long" to principle 2.
- Prototype the run before anything that survives it. Meta-progression is tuned against a run that already works, and Rogue Legacy's own notes say "it's best to keep it detail-light." (our reading of principles 2 and 10, and Cellar Door's note, [link][rl-notes]).
- For the build, a few offers with real trade-offs and a skip beat many items. A variant with half the pool shows whether the depth is in the combinations (principle 5) or only in the count (principle 3's oatmeal).
- Generate from a handful of hand-made rooms or encounters first; a fully random layout is the variant to compare against, not the start (principle 3).
- Ritmo's simulation is deterministic: randomness comes from `Random` with a seed, so the same seed and the same inputs replay the same run (the repo's `AGENTS.md`). That makes a replay of the run that just ended, a fixed seed while tuning, and a shared seed cheap to try. Spelunky's daily challenge is the shape of the last one: "a single generated level that's the same for all players that day, and at which everyone gets a single attempt at completion" (via GamingTrend, [link][spelunky-daily]). Which of these a game wants is a design question to ask the director, not a default. (Ritmo convention, not a design claim.)
- What survives death is the account, not the run: it is stored outside the simulation, and the run is entered with it and reports a result. Ritmo holds no storage of its own; the game brings it. (Ritmo convention, not a design claim.)

[berlin]: http://www.roguebasin.com/index.php?title=Berlin_Interpretation
[wiki-roguelike]: https://en.wikipedia.org/wiki/Roguelike
[gmtk-persist]: https://amara.org/subtitles/7doGHxwrhRpX/en/1/download/Roguelikes%20Persistency%20and%20Progression%20%20Game%20Makers%20Toolkit.en.txt
[gmtk-downwell]: https://amara.org/subtitles/ugr1vJiH2Dpo/en-gb/1/download/Downwells%20Dual%20Purpose%20Design%20%20Game%20Makers%20Toolkit.en-gb.vtt
[rl-notes]: https://cellardoorgames.com/rogue-legacy-design-notes
[kasavin-tg]: https://www.tomsguide.com/uk/features/hades-exclusive-interview-supergiant
[kasavin-inv]: https://www.inverse.com/gaming/hades-god-mode-interview
[doull]: https://www.gamedeveloper.com/pc/analysis-the-game-design-lessons-of-permadeath
[subset-jump]: https://www.gamedeveloper.com/business/how-subset-games-made-the-jump-from-i-ftl-i-to-i-into-the-breach-i-
[compton]: https://galaxykate0.tumblr.com/post/139774965871/so-you-want-to-build-a-generator
[deepnight]: https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/
[dc-pcgi]: https://www.pcgamesinsider.biz/indie-interview/66988/how-motion-twin-stopped-dead-cells-being-just-another-roguelike-pixel-art-metroidvania-game/
[dc-mcv]: https://mcvuk.com/development-news/when-we-made-dead-cells/
[isaac-pm]: https://gamedeveloper.com/business/postmortem-mcmillen-and-himsl-s-i-the-binding-of-isaac-i-
[yu]: https://www.gamedeveloper.com/design/how-i-spelunky-i-got-its-procedural-hook-actually-got-finished
[yu-spicy]: https://www.nme.com/news/spelunky-creator-compares-video-game-difficulty-to-spicy-food-2999148
[sts-igf]: https://www.gamedeveloper.com/disciplines/road-to-the-igf-mega-crit-games-i-slay-the-spire-i-
[yano]: https://justingarydesign.substack.com/p/casey-yano-designing-with-detail
[balatro-transcript]: https://sozai.app/transcript/balatro-creator-localthunk-inspirations-jokers/
[spelunky-daily]: https://gamingtrend.com/news/spelunkys-daily-challenge-system-will-provide-competition-rage-on-steam
