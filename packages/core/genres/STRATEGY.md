# What makes a strategy game work

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it collects the principles that hold across strategy games, each traced to people who design them, quoted below with a link, in the same shape as [`PROTOTYPE.md`](../PROTOTYPE.md). It is not published: `package.json` `files` leaves it out, and the website does not read it.

The scope is what one developer or a small team can build, mostly in 2D: turn-based tactics (Into the Breach, XCOM), small-board games (Imbroglio, 868-HACK), and the lessons from 4X games (Civilization, Old World, Stellaris) that survive being made small. A principle is listed only when at least two independent sources support it, or one designer states it and a shipped game shows it. Where sources disagree, the disagreement is written down instead of picking a side quietly.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original (a talk, a podcast, a book). Paraphrase is never put in quotation marks.

## The principles in one place

1. A strategy game is a stream of decisions, and a good decision is right only in some situations.
2. No option dominates; every option is the best one somewhere, and the useless ones are cut.
3. Show the player everything the decision needs, so a loss can be traced to a choice.
4. Put randomness before the decision, not between the decision and its result.
5. Depth comes from a few pieces interacting in a small space, not from many pieces.
6. Every decision gets a visible consequence.
7. Start with a handful of decisions and let each one open more.
8. Watch the snowball: winning should not make the game easier forever, and losing should not make it hopeless.
9. The meaning is in the mechanics; the theme has to match what the player actually does.
10. The player is the star: the opponent exists to make the player's decisions interesting, not to be smart.

The sections below give the sources for each, then where the sources disagree, then what this means for a small prototype.

## 1. A stream of decisions, each right only in some situations

The genre's oldest definition, and still the test every other principle serves. A decision with one right answer is not a decision; a decision whose right answer depends on the board is.

- Sid Meier, GDC 2012, via Game Developer ([link][meier-decisions]): "Games are a series of interesting decisions" … "Good decisions are situational." … "This interesting decision would allow you to express your personal play style".
- Soren Johnson (Civilization IV lead, Old World), "Water Finds a Crack", 2011 ([link][soren-crack]): "The sweet spot for game design is when a specific decision is right in some circumstances but not in others, with a wide grey area between the two extremes."
- Bruce Shelley (Civilization, Age of Empires), Game Design Workshop profile ([link][shelley]), on what makes a strategy game great: "a great stream of interesting decisions".

## 2. No option dominates; cut the useless ones

Players search for the best move, and once one move is best everywhere, every other option is gone. The fix is not to remove every strong option, but to make each option the right one somewhere and to delete the ones that never are.

- Soren Johnson, "Water Finds a Crack" ([link][soren-crack]): "Given the opportunity, players will optimize the fun out of a game." … "a single, dominant strategy actually takes away choice from a game because all other options are provably sub-optimal." … "Games lose their dynamic quality once a strategy emerges that dominates under all conditions."
- David Sirlin, "Balancing Multiplayer Games, Part 2: Viable Options", 2014 ([link][sirlin]), on a dominant move: "a move that is strictly better than any other you could do, so its very existence reduces the strategy of the game." On counters: "If you know what the opponent will do, you should generally have some way of dealing with that." On variety: "When everything is too similar in a game, it feels like one-note design rather than a symphony."
- Sirlin ([link][sirlin]) on what to do with weak options: "Eliminate all the worthless options because they confuse the player and add nothing".
- Sid Meier, GDC 2012 ([link][meier-decisions]), on a decision that does not work: "Maybe the decision is just one you should take out of your game."
- The limit, from Soren Johnson ([link][soren-crack]): "However, designers can go too far by trying to remove all exploits from a game." In a single-player game, an exploit the player enjoys can stay if they can choose to switch it off: "If possible, designers should provide the ability to turn an exploit on or off".

## 3. Show everything the decision needs; a loss must trace to a choice

Planning needs information. Into the Breach, the indie reference for the genre, built its whole design on showing every enemy's next attack, and its developers name clear failure as the goal. Meier gives the same advice for a 4X.

- Justin Ma (Subset Games), Road to the IGF, 2018 ([link][itb-igf]): "This lead us to use of telegraphed enemy attacks as a core mechanic." … "it's very clear how or why you failed so that you can feel like you can improve." … "We prefer games with clear rulesets, and were interested in pursuing something with less randomness than FTL."
- Sid Meier, GDC 2012 ([link][meier-decisions]): "It's almost worth erring on the side of providing the player with too much information, or at least enough that they're comfortable with understanding the choices".
- Chris Bam Harrison, "Into the Breach's UX makes you feel smart" ([link][itb-ux]): "Into the Breach takes a different approach, and provides you with perfect information at every point. You see the outcome of your actions before you've committed to them."
- Soren Johnson, GDC 2011 strategy panel, via Game Developer ([link][gdc11-panel]), names "transparent rules" among the genre's challenges.

## 4. Randomness before the decision, not after it

Randomness that sets up the situation (the map, the draw, which enemies arrive) gives the player something new to plan around. Randomness between the choice and its result (a 70% shot that misses) hides whether the choice was good. Most designers here prefer the first; see "Where the sources disagree" for the case for the second.

- Keith Burgun, "Three types of bad randomness, and one good one" ([link][burgun-bad]): "Output Randomness: random information that is brought into the game after a decision is made." … "Input Randomness: random information that is brought into the game before a decision is made." … "Input and output randomness are not binary qualities, but rather exist on a spectrum."
- Burgun, "Randomness and Game Design", 2014 ([link][burgun-rand]): "Essentially, random games delay learning - the essential fun part of games - by injecting false signals into the engine." … "You may have played perfectly, and still lost."
- Matthew Davis (Subset Games), PC Gamer, 2018 ([link][itb-pcg]): "Part of our vision for Into the Breach is a push to be more deterministic in the moment-to-moment gameplay." Justin Ma ([link][itb-igf]): "we hope the limited reliance on random chance in Into the Breach helps make the player feel in control." Into the Breach still randomizes the maps, the enemies, and the squad: the randomness is all input.

## 5. A few pieces interacting in a small space

Depth does not come from the number of units or rules. It comes from how often the pieces touch. A small board forces interaction, and it is also what a small team can build, balance, and show clearly on a phone.

- Michael Brough (Imbroglio, 868-HACK), Road to the IGF, 2017 ([link][brough]): "I prefer how things end up playing out on these smaller grids; put the same number of elements into a smaller space and they'll bump into each other and interact more often."
- Justin Ma, PC Gamer ([link][itb-pcg]): "For Into the Breach, it's more about the systems and how they interact." Matthew Davis: "I'd describe Into the Breach as something more like a board game." Into the Breach's battles are on an eight-by-eight grid.
- Sid Meier, via Soren Johnson, "Sid's Rules", 2009 ([link][sids-rules]), on Covert Action, whose action and mystery halves were each good: "Together, they fought with each other." One game, with one kind of decision done well, beats two.
- Justin Ma, Kotaku Splitscreen at GDC 2019 ([link][itb-kotaku]), on how Into the Breach was saved: "Cut all that, and just focus on the part that does work." … "So maybe 60 percent of the game, we just dropped it all". What was left: "Everything besides the combat."
- Sid Meier, GDC 2012 ([link][meier-decisions]): "Be ruthless in terms of cutting things out".

## 6. Every decision gets a visible consequence

A decision the game does not answer teaches nothing and feels like a bug. This is what makes a turn readable: the player acts, and the board shows what changed and why.

- Sid Meier, GDC 2012 ([link][meier-decisions]): "The worst thing you can do is just move on." … "There's nothing more paranoia-inducing than having made a decision and the game just kind of goes on."
- Justin Ma ([link][itb-igf]): "it's very clear how or why you failed so that you can feel like you can improve." (See principle 3: information before the decision and a visible result after it are the same loop.)

## 7. Start with a handful of decisions; let each open more

A strategy game should not open with its whole decision space. It starts with one unit and one choice, and the space grows as the player builds it, so learning the game and playing it are the same thing.

- Bruce Shelley, The Life & Times of Video Games podcast ([link][shelley-pyramid]), on his "inverted pyramid of decision making": "So the idea is that you start the game with one unit and you make a decision with it and then that opens up a door." … "it starts off as a tiny bunch of decisions and it quickly grows, balloons."
- Shelley ([link][shelley]) lists, among good strategy design, "hidden maps, inverted pyramid of decision making, a great first 15 minutes".

## 8. Watch the snowball

In most strategy games, winning gives you more to win with. That is satisfying, and it ends games, but left alone it makes the game easier for the players who need it least and hopeless for the ones who fell behind. Every long strategy game fights its own endgame for this reason.

- GDC 2009 Game Design Workshop handout ([pdf][gdw-feedback]): "Positive Feedback: Drives the system towards an unstable state (e.g. a "snowball effect.")." … "A game system that gives the winning player an advantage will drive the players further apart." … "A game system that gives the losing player an advantage will drive the players closer together."
- Tom Francis (Gunpoint, Heat Signature), "Solving XCOM's Snowball Problem", 2016 ([link][francis]): "If you're finding the game easy, it gets easier. If you're finding the game hard, it gets harder." One of his fixes: "I'd take squad size completely out of your hands, and make it a per-mission variable."
- Nikhil Murthy, "Second Looks at Snowballing", Game Developer, 2019 ([link][murthy]): "So, the challenge decreases for the players that are most capable of dealing with additional challenge." On Downwell's answer: "the game's difficulty increases at a rate similar to your power" and "It avoids the issue of negative snowballing with the simple expedient of quickly killing the player."
- PCGamesN, on the strategy endgame ([link][pcgn-endgame]): William Dyce (Humankind): "The 'economic snowball' problem is pretty endemic to turn-based strategy games". Stephen Muray (Stellaris): "The AI often can't keep up with the growth of a high-skill player". Jack Lusted (Total War: Three Kingdoms), on their fix: "This moved the endgame from a direct threat of size of other factions to one of time pressure".
- For an indie game, the short run is the cheapest fix: a run that lasts minutes, not hours, can let the snowball roll because the next run starts fresh (Murthy's Downwell point, and the roguelike structure of Into the Breach and FTL).

## 9. The meaning is in the mechanics

Players learn what the game rewards, not what its theme says. A strategy game about diplomacy whose decisions are all about combat is a combat game. The theme earns its place by making the mechanics easy to understand.

- Soren Johnson, "What Is Your Game Actually About?", 2010 ([link][soren-theme]): "Ultimately, designers need to recognize that a game's theme does not determine its meaning." … "Instead, meaning emerges from a game's mechanics — the set of decisions and consequences unique to each one." … "Isn't a game about what one actually does during play and how that feels to the player?"
- Sid Meier, via Soren Johnson, "Sid's Rules" ([link][sids-rules]): "the player shouldn't have to read the same books the designer has read in order to be able to play."
- Bruce Shelley ([link][shelley]): "Don't imitate great games—people have had that experience and probably won't pay to repeat it."

## 10. The player is the star; the opponent serves the player's decisions

The opponent in a single-player strategy game is part of the puzzle, not a rival to beat the player. Into the Breach made its enemies simple and predictable on purpose, so the interest is in the player's answer.

- Sid Meier, via Soren Johnson, "Sid's Rules" ([link][sids-rules]): the player must "always be the star."
- Justin Ma, PC Gamer ([link][itb-pcg]): "We wanted to come up with something that would be fun regardless of the AI."
- Soren Johnson, "Playing to Lose: AI and Civilization", GDC 2008 ([link][soren-ai]): the talk "highlighted the difference between "good" AI and "fun" AI."
- Jon Shafer (Civilization V), GDC 2011 panel, via Game Developer ([link][gdc11-panel]): "I don't think it makes financial sense to make great AI".
- Sid Meier, GDC 2010 keynote, via VentureBeat ([link][meier-2010]), on how players read odds: "Even when players were in a battle with 1: 3 odds, they felt they could win." … "They complain the game is broken, the AI is cheating, or something in the game is wrong." If the game shows odds, players read them in their own favour; an opponent that wins on luck feels like a cheat.

## Where the sources disagree

- **Output randomness.** Burgun says "never, ever use hard output randomness in your strategy game" ([link][burgun-bad]); Into the Breach removed it. But XCOM, the best-known tactics game, is built on hit chances, and Ross Przybylski argues for them ([link][przybylski]): "Random outcomes teach us how to plan for uncertainty". The two can meet: output randomness the player can plan around (a known chance, ways to raise it, a fallback when it fails) is a decision about risk. Hidden or unplannable output randomness is the noise Burgun means, and Meier's 2010 keynote shows players do not read odds as numbers. For a small game whose fun is planning, follow Into the Breach; reach for hit chances only when deciding how much to risk is the point.
- **Rewarding the winner.** Ed Beach (Civilization VI), via PCGamesN ([link][pcgn-endgame]): "you want to reward players who are making smart decisions during their course of play". Murthy and Francis show what that reward does to difficulty. Both are right: the reward is the feeling of progress, and the designer's job is to keep the challenge rising with it (Downwell), or keep the game short enough that it ends first.
- **Removing every exploit.** Sirlin, writing about competitive multiplayer, treats a dominant move as "the worst thing you can have" ([link][sirlin]). Soren Johnson, writing about single-player games, warns against removing all exploits ([link][soren-crack]). In a single-player strategy game, an exploit that is fun and optional can stay; one that makes every other option pointless cannot.

## For a small 2D prototype

Read with the `ritmo-prototype` skill, whose rules come first. These are the principles above turned into what to look for in a first playable, not a recipe:

- The toy for a strategy game is one decision with a tradeoff on a small board (principles 1 and 5). A good prototype question names that decision: "if enemies show their next attack, will the player spend the turn blocking it or scoring?"
- Show the consequence of every action before and after it (principles 3 and 6), even with placeholder shapes. Arrows and tinted tiles are enough.
- When one option is always taken, or never taken, that is the first thing to change (principle 2), and a variant that removes the option is a fair comparison.
- Keep runs short at first (principle 8): it makes rounds quick to play, and it hides the snowball until the game is worth fixing it for.

[meier-decisions]: https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions
[soren-crack]: https://www.designer-notes.com/?p=369
[shelley]: https://www.gamedesignworkshop.com/bruce-shelley
[shelley-pyramid]: https://lifeandtimes.games/episodes/files/soundbite-bruce-shelley
[sirlin]: https://sirlin.net/articles/balancing-multiplayer-games-part-2-viable-options
[itb-igf]: https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-
[itb-ux]: https://blog.prototypr.io/into-the-breachs-ux-makes-you-feel-smart-a9cb03210757
[itb-pcg]: https://www.pcgamer.com/au/into-the-breach-preview
[itb-kotaku]: https://kotaku.com/the-creators-of-into-the-breach-came-very-close-to-givi-1833498295
[gdc11-panel]: https://www.gamedeveloper.com/game-platforms/gdc-2011-strategy-game-veterans-look-at-the-genre-s-biggest-challenges
[burgun-bad]: https://keithburgun.net/three-types-of-bad-randomness-and-one-good-one/
[burgun-rand]: https://www.gamedeveloper.com/design/randomness-and-game-design
[przybylski]: https://www.gamedeveloper.com/design/how-randomness-contributes-to-strategic-thinking
[brough]: https://www.gamedeveloper.com/design/road-to-the-igf-michael-brough-s-i-imbroglio-i-
[sids-rules]: https://www.designer-notes.com/?p=119
[gdw-feedback]: https://www.8kindsoffun.com/algorithmancy/Workshop/2009/Handout.pdf
[francis]: https://www.pentadact.com/2016-02-25-solving-xcoms-snowball-problem/
[murthy]: https://www.gamedeveloper.com/design/second-looks-at-snowballing
[pcgn-endgame]: https://pcgamesn.com/civilization-vi/strategy-game-endgame-design
[soren-theme]: https://www.gamedeveloper.com/design/what-is-your-game-actually-i-about-i-
[soren-ai]: https://www.designer-notes.com/?p=1318
[meier-2010]: https://venturebeat.com/2010/03/12/quotes-from-sid-meiers-keynote-gdc-speech
