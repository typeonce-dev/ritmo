# What makes a puzzle game, and why people play one for years

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it is not published (`package.json` `files` leaves `genres/` out), and no skill quotes it yet. It follows the shape of [`PROTOTYPE.md`](../PROTOTYPE.md): each principle is a heading, and under it the sources it comes from, quoted with a link. A principle with no source does not go in.

The scope is 2D puzzle games an indie team (one to three people) can build: grid and block pushers (*Stephen's Sausage Roll*, *Baba Is You*), falling and matching games (*Tetris*, *Bejeweled*, *Threes*), logic grids (sudoku, nonograms), daily puzzles (*Wordle*), and open-ended machine builders (Zachtronics). Most sources are people who made these games.

Quotes were checked against the text of the linked page on 2026-11-01, through a fetch tool (the session could not download the pages directly). A quote marked "via" was checked on that secondary page, not in the original. Two sources are talk descriptions or a video transcript (GDC Vault, Game Maker's Toolkit) and are never the only source for a principle.

## The short answer: why the same puzzle game lasts for years

There are two kinds of puzzle games, and only one kind lasts for years.

- **Authored puzzles are consumed.** A hand-made level is solved once; the insight is the reward, and once you have it the level is spent. These games are great and finite (*Braid*, *Baba Is You*, *Stephen's Sausage Roll*).
- **Systemic puzzles keep coming.** A small rule set that keeps producing new, slightly different situations (falling pieces, a random tile, a generated grid, a new daily word, a score to beat) is never used up. That is what people play for years (*Tetris*, sudoku, match-3, *Threes*, *Wordle*, Zachtronics' histograms).

What makes the second kind addictive, across the sources: rules learned in a minute, a pattern to find in every move (making order out of chaos), a skill that keeps growing because the situations vary, sessions short enough to fit in a break, no punishment for a mistake, and, for the long run, either scarcity (one a day, everyone on the same puzzle) or a way to do better than "solved" (a score, a distribution to climb). Each of these is below, with its sources.

## Where the sources disagree

- **Hand-made against generated.** Nikoli's editor says "Computer-generated Sudoku puzzles are lacking a vital ingredient that makes puzzles enjoyable -- the sense of communication between solver and author"; Wayne Gould, who popularised generated sudoku, says "if it's well done, a handmade puzzle is the same as a computer generated one" ([Globe and Mail][globe-sudoku]). Both are right for their kind: an authored puzzle is a message from the designer (see [The puzzle is a message](#the-puzzle-is-a-message-from-the-designer-keep-only-what-surprises)); a systemic game's variety is the generator's job. A generator that guarantees a fair, logical solve is how the second kind keeps the first kind's fairness.
- **Endless against limited.** *Tetris* and match-3 never end; Wardle limited *Wordle* to one a day because "being able to play endlessly just meant that you would eventually lose interest" ([Newsweek][wordle]). Both last for years: endless play works when the system keeps varying (Koster), a limit works when the content is small and shared.
- **Fun first, or truth first.** Blow: "I will get rid of fun if it means I can get at something deeper or more complete" ([Game Developer][blow-indiecade]). Most of the other sources aim at fun. For an indie game this is a choice of audience, not a rule: the deep, hard games (*The Witness*, *Stephen's Sausage Roll*) found a smaller, loyal audience.
- **Undo.** Puzzle designers give a full undo (see [Failure costs nothing](#failure-costs-nothing-undo-restart-and-a-clear-dead-end)); a strategy designer warns that "Not having an undo also provides important tension to the player's decision making" ([enceledean][undo]). In a puzzle the tension is in thinking, not in risk, so undo stays; a puzzle game built on pressure (*Tetris*) has none, because the pressure is the game.

## What a puzzle is

### A problem with a right answer; the reward is the insight

- Scott Kim, TED talk *The Art of Puzzles*, via [AMS Graduate Student Blog][kim], 2016: a puzzle is a "problem that is fun to solve and has a right answer."
- Teikari on *Baba Is You*, Game Developer, 2018 ([link][baba]): "solving the puzzle is about figuring out that *one* neat trick/twist."
- Mark Brown, "How Jonathan Blow Designs a Puzzle", Game Maker's Toolkit ([transcript][gmtk-blow]): "It's simply seeing something that was there all along."
- Alan Hazelden, Thinky Games, 2023 ([link][hazelden-thinky]): puzzle games are "the only genre where you'll find deep systems, surprising interactions, and that eureka moment".
- Koster, "Theory of Fun 10 Years Later" (slides, [pdf][koster-10]): "Fun in games arises out of mastery. It arises out of comprehension. It is the act of solving puzzles that makes games fun. With games, learning is the drug."

### Once the pattern is mastered, it is boring; lasting games keep varying it

- Koster, "A Theory of Fun" (talk slides, [pdf][koster-talk]): "When you're playing a game, you'll only play it until you master the pattern once you've mastered it The game becomes boring." And: "Most long-lasting games in the past have been competitive, because they lead to an endless supply of similar yet subtly varied puzzles."
- Cook, "Loops and Arcs", 2012 ([link][cook-loops]), on arcs (content experienced once, like a hand-made level): "One of the common issues with arcs is that people burn out on them rapidly, rarely desiring to experience them more than once." On loops (systems): "They are almost always exercised multiple times, either within a game or by playing the game multiple times."
- Juul, "Swap Adjacent Gems to Make Sets of Three", *Artifact*, 2007 ([link][juul]), on matching games: "Looking for a pattern, finding it, and moving on, in search of ever more patterns."

This is the root of [the short answer](#the-short-answer-why-the-same-puzzle-game-lasts-for-years): decide early which kind the game is, since an authored game needs many levels and a systemic game needs a generator worth replaying.

## Finding the puzzles

### Find puzzles in the rules, not on top of them

- Blow, IndieCade 2011, via Game Developer ([link][blow-indiecade]), on a rule in *The Witness*: "that's something that came from exploration, not from a top-down decision about what I wanted the puzzles to be."
- Teikari, *Baba Is You* ([link][baba]): levels come from "thinking of cool or amusing combinations/interactions between the words, and then working backwards", and he would "brainstorm interesting and/or wild ways the objects in the world can interact".
- Hazelden on *Stephen's Sausage Roll*, Thinky Games, 2026 ([link][ssr]): "never adding anything new, but constantly surprising you with the consequences of the mechanics that were always there."

### Few pieces, deep consequences

- Patrick Traynor (*Patrick's Parabox*) on *Stephen's Sausage Roll* ([link][ssr]): "Player. Fork. Sausage. Grill. Block. Ladder. So much comes from just these 6 objects!"
- Corey Martin (*Bonfire Peaks*), same article: "3 inputs, no time pressure, no reflex-based pressure, and yet somehow among the richest experiences I had ever had with a game."
- Vollmer on *Threes*, PocketGamer.biz, 2014 ([link][threes]): "As soon as we set the rule ‘only twins can merge with each other’ the game design went from 10 percent complete to 90 percent complete." And his lesson from an earlier job: "build systems with elegance."
- Pajitnov on *Tetris*, Globe and Mail ([link][globe-tetris]): "The simplicity is a very important part of it".

### When it is boring, take things away

- Vollmer on *Threes* ([link][threes]): the features they added "were addressing the symptom of ‘this is a boring game’ and not the underlying cause." … "It was only after we started stripping those things away did the true boring begin to show." … "When there were just numbers left on the grid I felt free to tweak the foundational rules to the game."

## The puzzle is a message from the designer: keep only what surprises

### A puzzle the player can predict says nothing

- Blow ([link][blow-indiecade]): "Surprise is sort of the same thing as the information content of a message," and a message that "only says exactly what they expected to get from you" carries none.
- Brown on Blow ([transcript][gmtk-blow]): "a puzzle is never just a puzzle. It's a communication of an idea from the designer to the player." And: "Blow's final job is to be ruthlessly curatorial", cutting mechanics, rules, and puzzles that lack surprise.
- Nikoli's editor Kanamoto, via [Globe and Mail][globe-sudoku]: "Good Sudoku authors are always considering a solver's feelings." … "Can a computer take account of the way a solver thinks?"

### One idea, all of it on screen, and nothing that does not matter

- Brown on Blow's puzzles ([transcript][gmtk-blow]): most "are about exploring just one idea and the stages are small enough so you can consider all the moving parts at once."
- Tom Hermans, "How to make a good puzzle", Game Developer, 2018 ([link][hermans]): "A good puzzle shows all puzzle pieces." … "Use the smallest amount of space and puzzle pieces for the puzzle will work" … "A red herring is a puzzle element that seems relevant, but isn't required to use to solve the puzzle." (He counts red herrings as clutter.)
- Blow ([link][blow-indiecade]): "when you came upon a puzzle, you knew instantly that it was a puzzle."
- Hermans ([link][hermans]): "A good puzzle should explain itself." In 2D this is mostly the art's job: a piece's look tells what it does.

## Fairness

### Every puzzle is solvable by reasoning, and only the intended way

- Teikari ([link][baba]): "I go through the level a couple times more to catch what unintended solutions I can find" … and from playtests, "it's extremely easy to be blind to certain types of unintended solutions". An unintended shortcut skips the insight, which is the whole reward.
- Kanamoto ([Globe and Mail][globe-sudoku]): a generated puzzle lacks "the sense of communication between solver and author". A generator for a logic puzzle has to guarantee the same: one solution, reachable without guessing.
- Team Thinky on *Stephen's Sausage Roll* ([link][ssr]): an "uncompromising, yet always fair, difficulty curve".

### The order of puzzles teaches; no text needed

- Hermans ([link][hermans]): "No puzzle lives in isolation from the others, and this is why you need to be careful with the ordering of puzzles."
- Elyot Grant, "Designing 10,000 Handcrafted Puzzles for 'Islands of Insight'", GDC 2025 (talk description, [GDC Vault][grant]): the talk covers "structuring content to avoid sticking points" and "balancing puzzle-heavy content for flow and pacing."
- Chen, *Flow in Games* ([link][chen]): to stay in flow, players "balance the challenges to their abilities", in a zone where "anxiety and boredom would not occur". In an authored game the level order does the balancing; in a systemic game the system does (*Tetris* speeds up).

## Failure costs nothing: undo, restart, and a clear dead end

- Ian Stocker, "Some Thoughts on Puzzle Design", 2011 ([link][stocker]), on *Escape Goat*: in one kind of room "you can undo moves all the way back to the original state of the puzzle"; in the other, the game must show when a room is lost, as "Braid did a good job of conveying the unsolvable state, usually with a green door that was shut". Before that, "you were forced to question whether you had messed up the puzzle"; after, "the testers really understood the puzzles better, enjoyed experimenting, and felt rewarded when they completed them."
- Juul ([link][juul]): casual games "avoid punishing the player for mistakes", and "the untimed mode is perhaps the most important popular influence of *Bejeweled*."
- Experimenting is how a puzzle is solved; anything that makes an experiment slow or risky (a long restart, a lost run, a timer the puzzle does not need) taxes the thing the player came for.

## What keeps people playing for years

### Learned in a minute, mastered over years

- Bushnell, via [Wikipedia][bushnell]: "All the best games are easy to learn and difficult to master. They should reward the first quarter and the hundredth."
- Abby Taylor (Dell) on sudoku, via [Globe and Mail][globe-sudoku]: "people look at it and they get hooked because it's not really hard".
- Juul ([link][juul]): casual games "provide players with the experience of success very early on."

### Making order out of chaos

- Pajitnov on *Tetris* ([Globe and Mail][globe-tetris]): "It takes the chaos of the falling pieces and tries to make them into some sort of order - to build something reasonable out of it." Henk Rogers, same article: "Order out of chaos is basic human nature."
- A randomized input (the next piece, the next tile) that the player's skill turns into order is the engine of the systemic kind: every game is new, the skill carries over.

### It fits in a break and resumes where you left it

- Juul ([link][juul]): "The key is that casual games *allow* short play sessions", and "a player can easily put down and resume a game at a later time."
- Simon Tatham, *Portable Puzzle Collection* ([link][tatham]): "I wrote this collection because I thought there should be more small desktop toys available: little games you can pop up in a window and play for two or three minutes while you take a break from whatever else you were doing." Each game is generated from a random seed, so it never runs out.

### Scarcity, and everyone on the same puzzle

- Wardle on *Wordle*, Newsweek, 2022 ([link][wordle]): "I found that being able to play endlessly just meant that you would eventually lose interest." … "But if you limit how much people can play, then you keep them hooked without taking over their lives." … "I liked the idea that everyone around the world was trying to solve the exact same word at the exact same time."
- [Wikipedia][wordle-wiki]: the share grid came from players: "Wardle discovered that a group of friends in New Zealand had developed an emoji-style display for sharing their results." … "Inspired by this, he incorporated the feature into the game."

### Room to do better than "solved"

- Koster ([pdf][koster-talk]): "games will never be mature as long as the designers create them with complete answers to their own puzzles in mind".
- Zach Barth, Software Engineering Daily, 2025 ([transcript][sed]): "We have this thing where you can solve a puzzle any number of ways, but we can add arbitrary metrics". On why histograms replaced leaderboards: "we don't really need to like attribute the top hundred people who all copied the best solution, right? We can just show what's the distribution of scores." … "we did histograms in SpaceChem, and they were very successful."
- An authored puzzle with several solutions and a score (cycles, moves, pieces used) turns a consumed level back into a loop: solved once, optimised for months.

### Players become makers

- Atlas Obscura on Nikoli ([link][atlas]): "But often readers invent new types." … "The fans had taken over and turned it into a laboratory of puzzle invention unlike anything else in the world."
- A level format players can write and share (*Baba Is You*'s editor, PuzzleScript) is an indie team's cheapest source of endless authored content.

## What this means for a small 2D team

Each line follows from the principles above; none is a separate claim.

- Pick the kind first. Authored: a mechanic with deep consequences, and many small levels, each one idea. Systemic: a few rules, a random input, and a score or a daily seed.
- Prototype the rules, then mine them: play with the mechanic and keep the interactions that surprised you (Blow, Teikari). A jam-sized prototype is enough to find out (*Baba Is You* began at a jam).
- Cut until it is boring, then fix the rules, not the symptoms (Vollmer).
- Show the whole puzzle on one screen, let the art say what each piece does, and keep red herrings out.
- Give an instant undo and restart, and show when a puzzle is lost.
- Test for unintended solutions with people who did not make the level.
- For the long run, add one of: a generator that guarantees a logical solve, one shared puzzle a day, or scores with a distribution to climb.

[blow-indiecade]: https://gamedeveloper.com/design/indiecade-inside-jonathan-blow-s-puzzle-design-process
[gmtk-blow]: https://amara.org/subtitles/LaGKzzSXnuQl/en-gb/1/download/How%20Jonathan%20Blow%20Designs%20a%20Puzzle%20%20Game%20Makers%20Toolkit.en-gb.txt
[threes]: https://www.pocketgamer.biz/fighting-the-monsters-the-making-of-threes
[kim]: https://blogs.ams.org/mathgradblog/2016/06/29/scott-kim-power-puzzle-creation/
[baba]: https://www.gamedeveloper.com/disciplines/road-to-the-igf-hempuli-oy-s-i-baba-is-you-i-
[hazelden-thinky]: https://thinkygames.com/features/alan-hazeldens-thinky-third-thursday/
[ssr]: https://thinkygames.com/features/10-years-of-grilling-stephens-sausage-roll-remains-one-of-the-most-influential-puzzle-games-ever-created/
[koster-10]: https://www.raphkoster.com/wp-content/uploads/2026/07/Theory-of-Fun-10-Years-Later.pdf
[koster-talk]: https://www.raphkoster.com/gaming/atof/theoryoffun.pdf
[cook-loops]: https://lostgarden.com/2012/04/30/loops-and-arcs/
[juul]: https://www.jesperjuul.net/text/swapadjacent/
[globe-tetris]: https://www.theglobeandmail.com/technology/rock-around-the-blocks/article4302366
[globe-sudoku]: https://www.theglobeandmail.com/arts/the-crack-cocaine-of-games/article18242760
[hermans]: https://gamedeveloper.com/design/how-to-make-a-good-puzzle---an-explorable-explanation
[grant]: https://gdcvault.com/play/1035540/Designing-10-000-Handcrafted-Puzzles
[chen]: https://www.jenovachen.com/flowingames/missionstatement.htm
[stocker]: https://www.magicaltimebean.com/?p=454
[undo]: https://enceledean.bearblog.dev/undo/
[bushnell]: https://en.wikipedia.org/wiki/Bushnell%27s_Law
[tatham]: https://www.chiark.greenend.org.uk/~sgtatham/puzzles/
[wordle]: https://www.newsweek.com/wordle-creator-binge-addicted-game-interview-1668457
[wordle-wiki]: https://en.wikipedia.org/wiki/Wordle
[sed]: https://softwareengineeringdaily.com/wp-content/uploads/2025/12/SED1884-Zachtronics.txt
[atlas]: https://atlasobscura.com/articles/nikoli-puzzle-communication
