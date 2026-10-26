# Why the `ritmo-prototype` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not the card a game keeps at its root, and it is not published: `package.json` `files` leaves it out, and the website does not read it.

Every rule in [`skills/ritmo-prototype`](skills/ritmo-prototype/SKILL.md) traces back to one of two things:

- **Practice:** long-standing advice from people who prototype and playtest games, quoted below with a link.
- **Ritmo:** how the library works (the repo's `AGENTS.md`), or a direction from the maintainer. These are conventions, not design claims, and are marked as such.

A rule that is neither does not go in the skill. When you change the skill, change this file in the same commit: add the source for a new rule, or drop the entry for a removed one. Quotes were checked against the text of the linked page on 2026-10-26. A quote marked "via" was checked on that secondary page, not in the original. Two of the sources (pstack and CCGS) are other agent skills: they show what others have built, not established authority, so they are never the only source for a design claim.

## Where we chose against a source

- **Graduation keeps the prototype's code.** EGP calls prototype code "quick throwaway code", and Brooks wrote "plan to throw one away". Both agent skills we learned from rewrite the prototype ([pstack][ps-proto] L3, [CCGS][cg-rule] L40). We follow evolutionary prototyping instead: Brooks retracted the rule ("You ought to plan to continually iterate on it, not just build it, throw it away and start over"), and McConnell sets it out as a deliberate alternative to throwaway prototyping. The skill keeps the one shape that makes this safe (the simulation is the game, intents in, plain data out), so graduation is a refactor. See [Graduation](#graduation).
- **The human who plays is the director, not a stranger.** Hecker and Gingold warn about "prototypes that are only played by their creators". In Ritmo the human directs the game and does not write the code, so they are the nearest playtester there is. Graduation and the full `ritmo` skill are where other players come in.
- **No ratings at all.** Valve uses rating scales in playtests. We drop them because a round's answer must name the next change (Andreasen, Hopson), which a rating does not.
- **Feel is prototyped in the browser.** CCGS says browsers distort feel and sends action prototypes to a native engine; its figure has no source. Ritmo is a browser library, so this is a Ritmo convention.

## SKILL.md

### A prototype answers a question by putting something playable in front of the human fast

- Hecker & Gingold, "Advanced Prototyping", GDC 2006, speaker notes ([slides][hecker]): "Behind every successful prototype stands a good question, a clearly articulated problem to solve." … "You can't compile and execute design docs."
- Cook, "Common Game Prototyping Pitfalls", 2005 ([link][cook-pitfalls]): "In mere hours, the prototype needs to be playable such that the feedback cycle can begin."
- Cook, "Game Design Logs", 2011 ([link][cook-logs]): "Make something you can play as soon as humanly possible."
- Sid Meier, via Soren Johnson, "Sid's Rules", 2009 ([link][sids-rules]): "a simple prototype of the game is built very early and then iterated on repeatedly until the game becomes a shippable product. Sid called this process "finding the fun,""

### The human is the playtester; never say it is fun

- Fullerton, *Game Design Workshop*, 4th ed., p. 4 (book, via the [publisher preview][fullerton]): "it's easy to get too close to your own work and lose perspective." … "Because the experience of a player cannot ever be completely predicted, in an iterative process design, decisions are based on the experience of the prototype in progress."
- Pozzi & Zimmerman, "A Primer for Playtesting", rule N, 2012, reprinted in Fullerton p. 293 ([pdf][primer]): "the main purpose of the playtest, which is to see how OTHER people react to your project."
- Budiu, "You Are Not the User", NN/g, 2017 ([link][nng-false]): "Designers, developers, and even UX researchers fall prey to the false-consensus effect, projecting their behaviors and reactions onto users."
- Hopson, "Why I hate fun", 2019 ([link][hopson]): developers "can easily fool themselves into thinking the game is fun".
- Swink, "Game Feel: The Secret Ingredient", 2007 ([link][swink]): feel is "one of those 'know it when you feel it' kinds of things." No source says "never judge feel from a description" in those words; the rule is our consequence of this.
- Prior art: CCGS reports a build nobody played as "**NOT ASSESSED — built, not played**" and does not "infer one from how the build looks" ([6-debrief.md][cg-debrief] L28-31).

### The mode: `PROTOTYPE.md` switches it on, deleting it is graduation, start only when asked

Ritmo convention. It keeps one way to tell which skill applies and stops prototype mode from becoming a way to skip the `ritmo` skill's checks.

### What stays: the simulation is the game

Ritmo convention (the `ritmo` skill). It is what makes graduation a refactor. See [Graduation](#graduation).

### What stays: every tuned number in `tuning.ts`, as named variants switched by a key

- pstack ([prototype.md][ps-proto] L10): "When comparing alternatives, build them behind one switcher (buttons or a keypress), each variant labeled."
- Pozzi & Zimmerman, rule D ([pdf][primer]): "Variations give you options if something breaks down, and they let you do comparisons to see which variation works best."
- Laming, *Human Judgment*, 2011 (book, via [Whitehouse & Pollitt, AQA 2012][aqa]): "There is no absolute judgement. All judgements are comparisons of one thing with another."
- CCGS says the opposite ("Hardcode values freely", [5-implement.md][cg-impl] L27). We keep the variants because a comparison in one play needs them.

### What waits for graduation, and the check (type check plus a page that loads)

- EGP, "How to Prototype a Game in Under 7 Days", 2005 ([link][egp]): "Nobody Cares About Your Great Engineering … "Correct" or "reusable" solutions are often not what we look for in quick throwaway code."
- Hecker & Gingold ([slides][hecker]): "violate SE norms intentionally" and "robustness – needs to last long enough to get answer".
- pstack ([prototype.md][ps-proto] L9): "No production framework, no tests, no abstractions." CCGS ([prototyper.md][cg-agent] L150): "Test coverage: manual testing only".
- Ritmo: the maintainer's direction that a fast build with a small bug beats a slow, verified one while the question is whether it is fun.
- Not driving the page or taking screenshots goes against pstack, which has the agent drive and screenshot each variant ([prototype.md][ps-proto] L11). It follows CCGS and the sources above: the human is about to play it.

### A reported bug reading cannot explain is reproduced headless

Ritmo convention: the `ritmo` skill's `playbooks/bug-fix.md`, made smaller (one invariant and a `Fuzz.run`).

### Where to read

Ritmo convention, from the first test run: the agent spent its time looking for the factories it needed. These are the modules a toy uses.

### The reply: one question per round

See [The question at the end of a round](#the-question-at-the-end-of-a-round).

## playbooks/start.md

### No question, no prototype

- Hecker & Gingold ([slides][hecker]): "Without a good question, you're wasting your time." … "If you can't articulate criteria for evaluating the result of your prototyping work, you should double check your intentions."
- pstack ([prototype.md][ps-proto] L7): "No decision means no prototype. Route to Feature."
- CCGS ([prototyper.md][cg-agent] L272): "**Do NOT prototype when:** - The design is clear and well-understood".

### Write the card with the user, propose what they did not say, build once they confirm

- CCGS ([4-plan.md][cg-plan] L18): "Present this plan to the user before building. Get confirmation before proceeding." and ([brainstorm][cg-brainstorm] L64) "offer, don't force".
- pstack ([prototype.md][ps-proto] L8): "let the user pick directions before building."
- Letting setup run while the user reads the card is a Ritmo convention, for speed.

### SETUP steps 1 and 2 now, step 3 at graduation

Ritmo convention (see "What waits for graduation").

### The toy: the verb and its feedback, no goal, score, menu or content

- EGP ([link][egp]): "Build the Toy First. Start with the core mechanic. … This "toy" should be the core mechanic of the game minus any goals or decisions. There is no win or lose state, just a fun thing to play with."
- CCGS ([prototype/SKILL.md][cg-proto] L85): "No polish. No menus, no game over, no music, no UI unless it IS the mechanic".

### Shapes first; art waits until the toy is fun

- EGP ([link][egp]): "It's entirely possible to have fun with basic primitives … Prove to yourself that your core mechanic is worthwhile with a simple prototype. Once you're convinced, then you can make it pretty."
- EGP, same article: "But Overall Aesthetic Matters! … it does have the power to make a good game even more playable." So art is not banned, only moved after the toy.

### Draw the feedback that makes cause and effect readable before anything decorative

- Cook, "Loops and Arcs", 2012 ([link][cook-loops]): "Functional feedback that helps players understand causation."
- Cook, "Building Tight Game Systems of Cause and Effect", 2012 ([link][cook-tight]): "A tight system has clearly defined cause and effect." He adds that "often the lowest levels of skill loops need to be the tightest", which is where a toy lives.
- Stout, "Enemy Attacks and Telegraphing", 2015 ([link][stout]): "If the player needs to dodge, block, or otherwise avoid damage – the player must first know the damage is coming."
- Pichlmair & Johansen, "Designing Game Feel. A Survey", 2020 ([link][survey]): "Juice-rich interaction makes it hard to learn what aspects of interactivity have mechanical importance".
- The order (readable first, decoration second) is our synthesis of these; no single source states it.

### The variant's name is on screen

- pstack ([prototype.md][ps-proto] L10): "each variant labeled".

## playbooks/iterate.md

### Read the log; on kill ask, on pivot rewrite the question

- CCGS ([6-debrief.md][cg-debrief] L52): "PROCEED, PIVOT, or KILL — and one sentence why."
- Cook, "Game Design Logs" ([link][cook-logs]): "Game design is a process of informed iteration, not a fixed engineering plan that you implement."

### At the stop condition, or after three pivots, ask whether to kill

- EGP ([link][egp]): "It's important to quickly recognize dead-end game ideas, cut your losses and move on." and "there was no correlation between time spent in development and how successful the game ultimately turned out."
- Hecker & Gingold ([slides][hecker]): "You're going to be wrong a lot, so your failures should cost little, and you can have more of them."
- CCGS ([prototype/SKILL.md][cg-proto] L87): "**3 PIVOT iterations → force a KILL decision.** … A new concept prototyped fresh will almost always beat a fourth iteration of a struggling one." The number three comes from CCGS; EGP's budget is seven days per prototype.

### Change as little as could answer the verdict, one thing per round

- Pozzi & Zimmerman, rule D ([pdf][primer]): "change as little as possible each time (only one element) so that you can understand better the exact effects of your change."
- Cook, "Common Game Prototyping Pitfalls" ([link][cook-pitfalls]): "By making each chunk of work small enough to easily build, you ensure that there is always a constant stream of interesting results".
- Griesemer, "Design in Detail: Changing the Time Between Shots for the Sniper Rifle from 0.5 to 0.7 Seconds for Halo 3", GDC 2010 ([slides][griesemer-sniper], slides 8-9): "Take one tiny Decision, and explore it exhaustively". A whole design talk on one number: tuning is design work, so a number is tried before code.

### Two variants, far enough apart to feel in one play

- Sid Meier, via Soren Johnson ([link][sids-rules]): "If a unit seems too weak, don't lower its cost by 5%; instead, double its strength." In his memoir (book, via [Kartones][kartones]): "double it, or cut it in half".
- Griesemer ([slides][griesemer-sniper], slide 122): "Don't make changes less than 10% / It's very easy to convince yourself you can feel tiny changes / But even if you can, nobody else will be able to".
- Comparing both in the same play is ours, built on the variants above (pstack, Pozzi & Zimmerman).

### A goal only once the toy is fun, grown out of the verb

- EGP ([link][egp]): "The best goals, we found, were an innate part of the gameplay like in "Tower of Goo," where the implicit goal was to simply "build up"." Gabler added score counters only once the toy "felt really satisfying".
- The exception (a card whose question is about the goal) follows from "a prototype answers its question", above.

### Develop the verb through new situations before adding verbs

- Griesemer, via Engadget, "Half-Minute Halo", 2011 ([link][griesemer-30]): "taking that 30 seconds of fun and playing it in different environments, with different weapons, different vehicles, against different enemies, against different combinations of enemies … No 30 second stretch of Halo is ever repeated".
- Hayashida (Super Mario 3D Land), via Game Developer, 2012 ([link][hayashida]): "First, you have to learn how to use that gameplay mechanic, and then the stage will offer you a slightly more complicated scenario in which you have to use it. And then the next step is something crazy happens that makes you think about it in a way you weren't expecting."
- Cook, "SpaceCrack: Verbs", 2005 ([link][cook-verbs]): "it is better to go with a small number of expressive verbs than to overwhelm the player with a truckload of shallow verbs."

### Responsive input and juice before the human judges feel

- Swink, "Game Feel: The Secret Ingredient" ([link][swink]): "a combination of sights, sounds, and instant response to action … If it's off by just a little bit, a game's goose is cooked." and "Game feel needs prototyping too, a test that approximates the final, polished feel of interacting with the game, with all the trimmings."
- Swink, same article: "Polish can include sprays or dustings of particles where things hit or interact, screen shake".
- Jonasson & Purho, "Juice it or lose it", 2012 ([repo][juicy]): "A juicy game feels alive and responds to everything you do".
- "On the frame it arrives" is our engineering wording for Swink's "instant response".
- Hit-stop is a rule, not render code: in the juicy Breakout demo it scales the simulation's time step (`_timestep.gameSpeed *= Freezer.multiplier`, [Main.as][juicy]). The rest of the demo's effects are presentation over unchanged rules, which is why they live in render code.

### Strip the prototype when it grows

- Cook, "Loops and Arcs" ([link][cook-loops]): "removing the arcs to see if what is left stands on its own. … You can remove them and still have a playable game."
- Cook, "Building Tight Game Systems" ([link][cook-tight]): "What systems can I remove to make the results of an action more obvious?"
- CCGS ([5-implement.md][cg-impl] L36): "Every addition beyond the hypothesis is waste."

### Fix a reported bug this round

- Spolsky, "The Joel Test", 2000 ([link][joel]): "Do you fix bugs before writing new code?" … "In general, the longer you wait before fixing a bug, the costlier (in time and money) it is to fix."

## playbooks/graduate.md

### Graduation

- Brooks, *The Mythical Man-Month*, 20th anniversary ed., ch. 19, 1995 (book, via [Walsh][walsh]): "This I now perceived to be wrong, not because it is too radical, but because it is too simplistic."
- Brooks, Computerworld interview, 2010 ([link][brooks-grill]): "You ought to plan to continually iterate on it, not just build it, throw it away and start over."
- McConnell, *Rapid Development*, ch. 21, 1996 (book, via the [O'Reilly preview][mcconnell]): "Evolutionary Prototyping is not the same as Throwaway Prototyping, and making the right choice about whether to develop an evolutionary prototype or a throwaway prototype is one key to success."
- Hecker & Gingold ([slides][hecker]) list "wholesale incorporation into the product" among a prototype's payoffs.
- The steps (schemas, tests, invariants and fuzzing, SETUP step 3, tuned values with `meta`, the refactor playbook) are Ritmo conventions: the `ritmo` skill's checks, applied once.
- Moving the card into design notes: Cook ([link][cook-logs]) keeps the log as "the story of how the game has evolved".

## references/card.md

### Question: what the player will do, never "is it fun?"

- CCGS ([1-question.md][cg-question] L53-61): "*"If the player [does X], they will feel [Y] — we will know this is true if [measurable signal Z]."*" … "Bad: "Does this feel fun?" ← not testable, not falsifiable."
- Hecker & Gingold ([slides][hecker]) on the question "Is it going to be fun?": "You basically are asking for the whole game to be built, which isn't really a prototype."

### Stop when

- Hecker & Gingold ([slides][hecker]): "If you can't articulate criteria for evaluating the result of your prototyping work, you should double check your intentions."
- EGP ([link][egp]): "Each game must be made in less than seven days". The round budget is our adaptation of EGP's time budget.

### Fantasy, and "the fantasy comes first"

- Metzen, Wowhead interview, 2023 ([via Wayback][metzen]): "whatever it is, you know you start with a fantasy. We try to build a structure that enables the player to feel their accomplishments, to feel the fantasy through the gameplay."
- EGP ([link][egp]): "an initial emotional target basically wrote the entire game."
- CCGS ([2-load-context.md][cg-context] L12): "Core fantasy (what the player is supposed to feel)".

### Verb

- Crawford, "The Two Faces of Reality", 2013 ([link][crawford]): "If you examine a game and write down all the verbs available to the player, then give that list of verbs to me, I can tell you exactly what that game is about".
- Cook, "SpaceCrack: Verbs" ([link][cook-verbs]): "a small number of expressive verbs". The card asks for one because the toy is about one.

### Loop: 30 seconds, repeated in changing situations

- Griesemer, via Engadget ([link][griesemer-30]): "In Halo 1, there was maybe 30 seconds of fun that happened over and over and over and over again." Read with his correction under [Develop the verb](#develop-the-verb-through-new-situations-before-adding-verbs): the 30 seconds are never repeated in the same context.
- Cook, "The Chemistry of Game Design", 2007 ([link][cook-chem]): the loop as action, simulation, feedback, and the player updating their mental model.
- "If the 30 seconds are not fun, more content will not make the game fun": Griesemer, via Engadget: "you can have all the great graphics, and all the different characters, and lots of different weapons with amazing effects, but if you don't nail that 30 seconds, you're not gonna have a great game." EGP: "all the art, music, and product tie-ins in the world won't make it a great game."

### Fun looks like: what a player does

- Cook, "The Chemistry of Game Design" ([link][cook-chem]): "We can describe what the player does and how the game reacts." … "when a new player masters how to jump, you'll notice they'll almost immediately start happily hopping about the level."
- Lazzaro, "Why We Play Games", 2004 ([pdf][lazzaro]): "we observed many emotions from gameplay in facial gestures, body language, and verbal comments." … "Overcoming difficult obstacles players raise their arms over their heads."
- CCGS ([1-question.md][cg-question] L58-59): "we'll know if players chain 3+ swings without stopping within 2 minutes of picking it up."

### Not yet

- CCGS ([brainstorm][cg-brainstorm] L61): "**Out of scope:** what they are deliberately not building".
- Cook, "Game Design Logs" ([link][cook-logs]): "Kill graphics, features, plot or anything that gets in the way of making a game you can react to on a tactile and experiential level."

### The log: one line per round

- Cook, "Game Design Logs" ([link][cook-logs]): "This contains daily play notes, prioritized next steps and ideas." Cook writes one entry a day; ours is one line a round.

### The question at the end of a round

**One moment, by what is on screen.**
- Pozzi & Zimmerman, rule S ([pdf][primer]): "Begin with very specific questions … The more concrete your questions, the more useful answers you will get."
- CCGS ([6-debrief.md][cg-debrief] L41): "What was the moment — if any — where it felt like it was working? Be specific."

**Compare the round's variants.**
- Laming (via [AQA][aqa]): "All judgements are comparisons of one thing with another."
- Ambinder, "Valve's Approach to Playtesting", GDC 2009 ([slides][valve]): "Forced choice helpful for revealing preference".

**Answers are behaviour, not opinion; never "is it fun", "how does it feel", or a rating.**
- Nielsen, "First Rule of Usability? Don't Listen to Users", NN/g, 2001 ([link][nielsen]): "pay attention to what users do, not what they say. Self-reported claims are unreliable". He also warns that "people are really telling you what they remember doing", which is why the card asks for one concrete act right after one play, not an account of a session.
- Ambinder ([slides][valve]): "Importance of what people do—not what they say" and "Difficulty in converting ratings to meaningful decisions".
- Hecker & Gingold ([slides][hecker]): "Observations, not suggestions."
- Fitzpatrick, *The Mom Test*, 2013 (book, via [Goodreads][momtest]): "Ask about specifics in the past instead of generics or opinions about the future".
- Hopson ([link][hopson]): "When players say a game isn't fun, there isn't a clear next step based on that statement alone." and "People always tell you to your face that the game is fun unless it's absolutely awful."
- Player Research ([link][player-research]): "Less "was it fun?", more "could players get to the fun?""

**Each answer names the next change.**
- Andreasen, "'Backward' Market Research", HBR, 1985 ([link][andreasen]): "research should be designed to lead to a decision." … "Only by first thinking through the decisions to be made with the research results will the project be started with high likelihood of actionability."
- Ambinder ([slides][valve]): "Game designs are hypotheses / Playtests are experiments".

### One question per prototype; split a big one

- Hecker & Gingold ([slides][hecker]): "If it's not a focused experiment, it's hard to prove anything." … "It has to be small enough to be tractable and focused."
- Pozzi & Zimmerman, rule C ([pdf][primer]): "What is the one key question that you want your playtest to answer?"
- CCGS ([prototype/SKILL.md][cg-proto] L84): "Test ONE mechanic — if scope grows, stop and simplify the question".

### Cut early; a kill is a result, so record why

- EGP ([link][egp]): "failure is ok! That's what prototyping is for … If you fail, there will be dozens more, and chances are, you'll learn something anyway."
- Hecker & Gingold ([slides][hecker]): "You can prove bad ideas are bad, and good ideas are good."
- CCGS ([9-summary.md][cg-summary] L64-70): "not "it was boring" but "players never understood the core action"" … "This file exists so the same mistake doesn't get made twice on the next concept."

[egp]: https://www.gamedeveloper.com/game-platforms/how-to-prototype-a-game-in-under-7-days
[hecker]: https://web.archive.org/web/2023id_/https://www.chrishecker.com/images/9/93/Gdc2006-AdvancedPrototyping.ppt
[sids-rules]: https://www.designer-notes.com/?p=119
[kartones]: https://blog.kartones.net/post/book-review-sid-meiers-memoir/
[griesemer-30]: https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
[griesemer-sniper]: https://files.bungie.org/Griesemer_Jaime_DesignInDetail_Sniper.pdf
[hayashida]: https://www.gamedeveloper.com/design/the-structure-of-fun-learning-from-i-super-mario-3d-land-i-s-director
[cook-chem]: https://www.gamedeveloper.com/design/the-chemistry-of-game-design
[cook-loops]: https://lostgarden.com/2012/04/30/loops-and-arcs/
[cook-tight]: https://lostgarden.com/2012/07/01/building-tight-game-systems-of-cause-and-effect/
[cook-pitfalls]: https://lostgarden.com/2005/08/21/common-game-prototyping-pitfalls/
[cook-logs]: https://lostgarden.com/2011/05/03/game-design-logs/
[cook-verbs]: https://lostgarden.com/2005/06/17/spacecrack-verbs/
[lazzaro]: https://killscreen.com/content/files/xeodesign_whyweplaygames.pdf
[metzen]: https://web.archive.org/web/20250901123724/https://www.wowhead.com/news/chris-metzen-interview-developing-auroboros-coils-of-the-serpent-331372
[crawford]: https://idmaa.org/journalarticle-v1n3-the-two-faces-of-reality/
[swink]: https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient
[juicy]: https://github.com/grapefrukt/juicy-breakout
[stout]: https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing
[survey]: https://arxiv.org/abs/2011.09201
[primer]: http://mycours.es/gamedesign2018/files/2018/11/playtesting-primer.pdf
[fullerton]: https://api.pageplace.de/preview/DT0400.9781351597708_A35121472/preview-9781351597708_A35121472.pdf
[nielsen]: https://www.nngroup.com/articles/first-rule-of-usability-dont-listen-to-users/
[nng-false]: https://www.nngroup.com/articles/false-consensus/
[valve]: https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ValvesApproachToPlaytesting.pdf
[hopson]: https://www.gamesindustry.biz/articles/2019-10-29-why-i-hate-fun
[player-research]: https://www.playerresearch.com/learn/getting-more-from-usability-testing-your-game/
[momtest]: https://www.goodreads.com/author/quotes/243396.Rob_Fitzpatrick
[aqa]: https://filestore.aqa.org.uk/content/research/CERP_RP_CW_20062012_2.pdf
[andreasen]: https://hbr.org/1985/05/backward-market-research
[joel]: https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/
[walsh]: https://so.nwalsh.com/2019/09/01/giveup
[brooks-grill]: https://www.computerworld.com/article/1709141/the-grill-fred-brooks.html
[mcconnell]: https://web.archive.org/web/20240225142859/https://www.oreilly.com/library/view/rapid-development-taming/9780735634725/ch21.html
[ps-proto]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/prototype.md
[cg-proto]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/SKILL.md
[cg-question]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/1-question.md
[cg-context]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/2-load-context.md
[cg-plan]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/4-plan.md
[cg-impl]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/5-implement.md
[cg-debrief]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/6-debrief.md
[cg-summary]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/9-summary.md
[cg-brainstorm]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/brainstorm/SKILL.md
[cg-agent]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/agents/prototyper.md
[cg-rule]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/rules/prototype-code.md
