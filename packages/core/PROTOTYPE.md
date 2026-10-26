# Why the `ritmo-prototype` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not the `PROTOTYPE.md` a game keeps at its root, and it is not published: `package.json` `files` leaves it out (`pnpm pack:check` fails if it ships), and the website does not read it.

Every rule in [`skills/ritmo-prototype`](skills/ritmo-prototype/SKILL.md) traces back to one of two things:

- **Practice:** long-standing advice from people who prototype and playtest games, quoted below with a link.
- **Ritmo:** how the library works (the repo's `AGENTS.md`), or a direction from the maintainer. These are conventions, not design claims, and are marked as such.

A rule that is neither does not go in the skill. The skill states principles and leaves the procedure to the agent: a template, a fixed number of variants or rounds, or a step-by-step recipe does not go in, even with a source, because it makes every game start from the same script. When you change the skill, change this file in the same commit.

Quotes were checked against the text of the linked page on 2026-10-26. A quote marked "via" was checked on that secondary page, not in the original. Two sources (pstack and CCGS) are other agent skills: they show what others have built, not established authority, so they are never the only source for a design claim.

## Where we chose against a source

- **Graduation keeps the prototype's code.** EGP calls prototype code "quick throwaway code", and Brooks wrote "plan to throw one away". Both agent skills we learned from rewrite the prototype ([pstack][ps-proto] L3, [CCGS][cg-rule] L40). We follow evolutionary prototyping instead: Brooks retracted the rule, and McConnell sets it out as a deliberate alternative. The skill keeps the one shape that makes this safe (the simulation is the game), so graduation is a refactor. See [Graduation](#graduation).
- **The human who plays is the director, not a stranger.** Hecker and Gingold warn about "prototypes that are only played by their creators". In Ritmo the human directs the game and does not write the code, so they are the nearest playtester there is.
- **No ratings.** Valve uses rating scales in playtests. We drop them because a round's answer must decide the next change (Andreasen, Hopson), which a rating does not.
- **Feel is prototyped in the browser.** CCGS says browsers distort feel and sends action prototypes to a native engine; its figure has no source. Ritmo is a browser library, so this is a Ritmo convention.

## The intro: find the fun fast; the question and the path can change; the human judges the fun

- Hecker & Gingold, "Advanced Prototyping", GDC 2006, speaker notes ([slides][hecker]): "Behind every successful prototype stands a good question, a clearly articulated problem to solve." … "If it's not a focused experiment, it's hard to prove anything." … "You can't compile and execute design docs."
- Cook, "Common Game Prototyping Pitfalls", 2005 ([link][cook-pitfalls]): "In mere hours, the prototype needs to be playable such that the feedback cycle can begin."
- Cook, "Game Design Logs", 2011 ([link][cook-logs]): "Make something you can play as soon as humanly possible."
- Sid Meier, via Soren Johnson, "Sid's Rules", 2009 ([link][sids-rules]): "a simple prototype of the game is built very early and then iterated on repeatedly until the game becomes a shippable product. Sid called this process "finding the fun,""
- Pozzi & Zimmerman, "A Primer for Playtesting", rule C, 2012, reprinted in Fullerton's *Game Design Workshop* p. 293 ([pdf][primer]): "What is the one key question that you want your playtest to answer?"

## The mode

### `PROTOTYPE.md` switches it on, written when the user asks, never to skip checks; deleting it is graduation

Ritmo convention: one way to tell which skill applies, and prototype mode never becomes a way around the `ritmo` skill's checks.

### No question, no prototype

- Hecker & Gingold ([slides][hecker]): "Without a good question, you're wasting your time."
- pstack ([prototype.md][ps-proto] L7): "No decision means no prototype. Route to Feature."
- CCGS ([prototyper.md][cg-agent] L272): "**Do NOT prototype when:** - The design is clear and well-understood".

### The question is about what the player will do

- CCGS ([1-question.md][cg-question] L53-61): "*"If the player [does X], they will feel [Y] — we will know this is true if [measurable signal Z]."*" … "Bad: "Does this feel fun?" ← not testable, not falsifiable."
- Hecker & Gingold ([slides][hecker]) on the question "Is it going to be fun?": "You basically are asking for the whole game to be built, which isn't really a prototype."
- Cook, "The Chemistry of Game Design", 2007 ([link][cook-chem]): "We can describe what the player does and how the game reacts."

### Written with the user

- CCGS ([4-plan.md][cg-plan] L18): "Present this plan to the user before building. Get confirmation before proceeding."
- pstack ([prototype.md][ps-proto] L8): "let the user pick directions before building."

### A line per round, the verdict in the human's words; a change of course rewrites the question

- Cook, "Game Design Logs" ([link][cook-logs]): "Game design is a process of informed iteration" … "This contains daily play notes, prioritized next steps and ideas."
- Rewriting the question and keeping the log is a Ritmo convention, from the Mystery Map test, where the question changed three times and the agent had to work out what to do with the file.

## Keep, and leave for graduation

### The simulation is the game

Ritmo convention (the `ritmo` skill). It is what makes graduation a refactor.

### Variants: named settings (numbers or rules) switched by a key; one can switch off what the question is about

- pstack ([prototype.md][ps-proto] L10): "When comparing alternatives, build them behind one switcher (buttons or a keypress), each variant labeled."
- Pozzi & Zimmerman, rule D ([pdf][primer]): "Variations give you options if something breaks down, and they let you do comparisons to see which variation works best. One tip: change as little as possible each time (only one element) so that you can understand better the exact effects of your change." A variant that switches off the one thing the question is about is that tip taken to its end; in the Mystery Map test (*lean* vs *plenty*) it was the clearest comparison of both runs.
- Laming, *Human Judgment*, 2011 (book, via [Whitehouse & Pollitt, AQA 2012][aqa]): "There is no absolute judgement. All judgements are comparisons of one thing with another."
- CCGS says the opposite ("Hardcode values freely", [5-implement.md][cg-impl] L27). We keep the variants because a comparison in one play needs them.

### Everything else waits

- EGP, "How to Prototype a Game in Under 7 Days", 2005 ([link][egp]): "Nobody Cares About Your Great Engineering … "Correct" or "reusable" solutions are often not what we look for in quick throwaway code."
- Hecker & Gingold ([slides][hecker]): "violate SE norms intentionally" and "robustness – needs to last long enough to get answer".
- pstack ([prototype.md][ps-proto] L9): "No production framework, no tests, no abstractions." CCGS ([prototyper.md][cg-agent] L150): "Test coverage: manual testing only".
- Which setup steps run now is a Ritmo convention.

## The check

- The sources under "Everything else waits", and the maintainer's direction (Ritmo): a fast build with a small bug beats a slow, verified one while the question is whether it is fun.
- Not driving the page or taking screenshots goes against pstack, which has the agent drive and screenshot each variant ([prototype.md][ps-proto] L11). It follows CCGS, which does not "infer one from how the build looks" ([6-debrief.md][cg-debrief] L28-31): the human is about to play it.
- Reproducing a reported bug headless is the `ritmo` skill's `playbooks/bug-fix.md`, made smaller (Ritmo).
- Starting from one compiled whole-game example (the `BrowserTickSource` module header, checked by `pnpm check-examples`) is a Ritmo convention. In every test the agent lost time stitching the factories together from module headers, and the Mystery Map agent only got fast once it found a website demo, which npm does not ship.

## Finding the fun

### Start from the feeling and the smallest thing that can be fun; draw shapes

- EGP ([link][egp]): "Build the Toy First. Start with the core mechanic. … This "toy" should be the core mechanic of the game minus any goals or decisions. There is no win or lose state, just a fun thing to play with." And on goals: "The best goals, we found, were an innate part of the gameplay". Hence "the smallest goal when the game is about goals": in the Grid Tactics and Mystery Map tests, giving and combining meant nothing without something to want.
- Metzen, Wowhead interview, 2023 ([via Wayback][metzen]): "whatever it is, you know you start with a fantasy. We try to build a structure that enables the player to feel their accomplishments, to feel the fantasy through the gameplay." EGP: "an initial emotional target basically wrote the entire game."
- Crawford, "The Two Faces of Reality", 2013 ([link][crawford]): "If you examine a game and write down all the verbs available to the player, then give that list of verbs to me, I can tell you exactly what that game is about".
- Cook, "Loops and Arcs", 2012 ([link][cook-loops]): "Functional feedback that helps players understand causation."
- EGP ([link][egp]): "It's entirely possible to have fun with basic primitives … Prove to yourself that your core mechanic is worthwhile with a simple prototype. Once you're convinced, then you can make it pretty."

### Explore broadly: read all the verdicts together and change course when they point the same way

- Sid Meier, via Soren Johnson ([link][sids-rules]): "The point is not that the new values are likely to be correct - the goal is to stake out more design territory with each successive iteration."
- Hecker & Gingold ([slides][hecker]): "You're going to be wrong a lot, so your failures should cost little, and you can have more of them." … "You can prove bad ideas are bad, and good ideas are good."
- EGP ([link][egp]): "It's important to quickly recognize dead-end game ideas, cut your losses and move on." … "If you fail, there will be dozens more, and chances are, you'll learn something anyway."
- CCGS ([prototype/SKILL.md][cg-proto] L87): "A new concept prototyped fresh will almost always beat a fourth iteration of a struggling one."
- Reading the verdicts together is from both tests (Ritmo): each round fixed the latest complaint, and what the verdicts shared (no pressure to commit, no stakes) was never named until the agent looked across all of them. The maintainer's direction: the prototype explores broadly, so pivots are expected, and the human picks.

### Tune numbers, far enough to feel, only in a direction the human likes

- Sid Meier, via Soren Johnson ([link][sids-rules]): "If a unit seems too weak, don't lower its cost by 5%; instead, double its strength." In his memoir (book, via [Kartones][kartones]): "double it, or cut it in half".
- Griesemer, "Design in Detail", GDC 2010 ([slides][griesemer-sniper], slide 122): "Don't make changes less than 10% / It's very easy to convince yourself you can feel tiny changes / But even if you can, nobody else will be able to".
- "Only in a direction the human likes" is the maintainer's direction (Ritmo): in the Grid Tactics test, tuning a direction nobody liked took four rounds.

### Some fun lives in content: test it with a small hand-written slice

- Cook, "Loops and Arcs" ([link][cook-loops]): "For arcs, the feedback is 99% of the payload and the actions and systems are simply a means to an end." … "The simplest method of analysis is to ask "What repeats and what does not?""
- From the Mystery Map test: six rounds of mechanics never produced what the human was missing, "how intriguing the game becomes".

### What the human reports is a symptom: find the cause behind a named case or a proposed fix

- Pozzi & Zimmerman, rule T ([pdf][primer]): "you can take their suggestions as symptoms of what is and isnʼt working in the project, rather than as directions for the next steps in your design. If someone tells you to tear down a room and make it bigger, they are really telling you that it feels small."
- Gaiman, "Ten rules for writing fiction", 2010 ([link][gaiman]): "when people tell you something's wrong or doesn't work for them, they are almost always right. When they tell you exactly what they think is wrong and how to fix it, they are almost always wrong."
- Gaiman's second sentence covers both halves: people are often wrong about "exactly what they think is wrong", not only about the fix, so a case the human names is a lead to the cause, not the cause itself. Found in the Grid Tactics test: told "healing loops", the agent limited healing, when the stall came from any two options cancelling out.
- The human directs the game (Ritmo), so their fix is always built.

## Each round

The reply is the link, the direction being tried, and any open question, with the keys and the variant's name on screen in the game: a Ritmo convention, from the maintainer, who plays first and only skims the reply afterwards. The question is optional: in the Grid Tactics test the human answered none of the six and gave every verdict in their own words, so a required question only added text. When there is one, the sources below shape it.

### A question, when asked, is about one moment of play

- Pozzi & Zimmerman, rule S ([pdf][primer]): "Begin with very specific questions … The more concrete your questions, the more useful answers you will get."
- CCGS ([6-debrief.md][cg-debrief] L41): "What was the moment — if any — where it felt like it was working? Be specific."

### The answer is something the player did, not an opinion

- Nielsen, "First Rule of Usability? Don't Listen to Users", NN/g, 2001 ([link][nielsen]): "pay attention to what users do, not what they say. Self-reported claims are unreliable". He also warns that "people are really telling you what they remember doing", which is why the question is about one moment, asked right after the play.
- Ambinder, "Valve's Approach to Playtesting", GDC 2009 ([slides][valve]): "Importance of what people do—not what they say" and "Difficulty in converting ratings to meaningful decisions".
- Hecker & Gingold ([slides][hecker]): "Observations, not suggestions."
- Fitzpatrick, *The Mom Test*, 2013 (book, via [Goodreads][momtest]): "Ask about specifics in the past instead of generics or opinions about the future".
- Hopson, "Why I hate fun", 2019 ([link][hopson]): "When players say a game isn't fun, there isn't a clear next step based on that statement alone." and "People always tell you to your face that the game is fun unless it's absolutely awful."
- Player Research ([link][player-research]): "Less "was it fun?", more "could players get to the fun?""

### The answer decides the next change

- Andreasen, "'Backward' Market Research", HBR, 1985 ([link][andreasen]): "research should be designed to lead to a decision." … "Only by first thinking through the decisions to be made with the research results will the project be started with high likelihood of actionability."

### Never say it is fun; a round the human did not play has no verdict

- Fullerton, *Game Design Workshop*, 4th ed., p. 4 (book, via the [publisher preview][fullerton]): "it's easy to get too close to your own work and lose perspective." … "Because the experience of a player cannot ever be completely predicted, in an iterative process design, decisions are based on the experience of the prototype in progress."
- Budiu, "You Are Not the User", NN/g, 2017 ([link][nng-false]): "Designers, developers, and even UX researchers fall prey to the false-consensus effect, projecting their behaviors and reactions onto users."
- Swink, "Game Feel: The Secret Ingredient", 2007 ([link][swink]): feel is "one of those 'know it when you feel it' kinds of things."
- CCGS ([6-debrief.md][cg-debrief] L28-31): "do not ask for a verdict and do not infer one from how the build looks: the recommendation is **NOT ASSESSED — built, not played**."

## Graduation

- Brooks, *The Mythical Man-Month*, 20th anniversary ed., ch. 19, 1995 (book, via [Walsh][walsh]): "This I now perceived to be wrong, not because it is too radical, but because it is too simplistic."
- Brooks, Computerworld interview, 2010 ([link][brooks-grill]): "You ought to plan to continually iterate on it, not just build it, throw it away and start over."
- McConnell, *Rapid Development*, ch. 21, 1996 (book, via the [O'Reilly preview][mcconnell]): "Evolutionary Prototyping is not the same as Throwaway Prototyping, and making the right choice about whether to develop an evolutionary prototype or a throwaway prototype is one key to success."
- Hecker & Gingold ([slides][hecker]) list "wholesale incorporation into the product" among a prototype's payoffs.
- The steps (schemas, tests and fuzzing, SETUP step 3, tuned values with `meta`, the refactor playbook) are Ritmo conventions: the `ritmo` skill's checks, applied once.

[egp]: https://www.gamedeveloper.com/game-platforms/how-to-prototype-a-game-in-under-7-days
[hecker]: https://web.archive.org/web/2023id_/https://www.chrishecker.com/images/9/93/Gdc2006-AdvancedPrototyping.ppt
[sids-rules]: https://www.designer-notes.com/?p=119
[kartones]: https://blog.kartones.net/post/book-review-sid-meiers-memoir/
[griesemer-sniper]: https://files.bungie.org/Griesemer_Jaime_DesignInDetail_Sniper.pdf
[cook-chem]: https://www.gamedeveloper.com/design/the-chemistry-of-game-design
[cook-loops]: https://lostgarden.com/2012/04/30/loops-and-arcs/
[cook-pitfalls]: https://lostgarden.com/2005/08/21/common-game-prototyping-pitfalls/
[cook-logs]: https://lostgarden.com/2011/05/03/game-design-logs/
[metzen]: https://web.archive.org/web/20250901123724/https://www.wowhead.com/news/chris-metzen-interview-developing-auroboros-coils-of-the-serpent-331372
[crawford]: https://idmaa.org/journalarticle-v1n3-the-two-faces-of-reality/
[swink]: https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient
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
[gaiman]: https://www.theguardian.com/books/2010/feb/20/ten-rules-for-writing-fiction-part-one
[walsh]: https://so.nwalsh.com/2019/09/01/giveup
[brooks-grill]: https://www.computerworld.com/article/1709141/the-grill-fred-brooks.html
[mcconnell]: https://web.archive.org/web/20240225142859/https://www.oreilly.com/library/view/rapid-development-taming/9780735634725/ch21.html
[ps-proto]: https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/playbooks/prototype.md
[cg-proto]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/SKILL.md
[cg-question]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/1-question.md
[cg-plan]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/4-plan.md
[cg-impl]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/5-implement.md
[cg-debrief]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/skills/prototype/references/6-debrief.md
[cg-agent]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/agents/prototyper.md
[cg-rule]: https://github.com/Donchitos/Claude-Code-Game-Studios/blob/05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418/.claude/rules/prototype-code.md
