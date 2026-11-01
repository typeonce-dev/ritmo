# What makes a turn-based game fair, fun, and worth coming back to

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it collects the principles that hold across turn-based games, each traced to people who design them, quoted below with a link, in the same shape as [`PROTOTYPE.md`](../PROTOTYPE.md). It is not published: `package.json` `files` leaves it out, and the website does not read it.

It builds on [`STRATEGY.md`](STRATEGY.md), which already covers what makes a decision interesting: situational choices, no dominant option, showing what the decision needs, input over output randomness, small boards, visible consequences, the snowball, and the opponent serving the player. Those are not repeated here. This file is about four questions that sit on top of them: what "fair" means to a player and how it trades against fun, what brings a player back for another game, what makes an AI opponent good to play against, and what makes a turn-based game good with other people.

The scope is what one developer or a small team can build, mostly in 2D: tactics and roguelike games (Into the Breach, Slay the Spire, XCOM, Fire Emblem), card games (Hearthstone), turn-based multiplayer (Frozen Synapse, asynchronous play), and the lessons from Civilization and board games that survive being made small. A principle is listed only when at least two independent sources support it, or one designer states it and a shipped game shows it. Where sources disagree, the disagreement is written down instead of picking a side quietly.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original (a talk, a book, an interview). Paraphrase is never put in quotation marks.

## The principles in one place

1. A turn is the game waiting for the player, so every turn must hold a decision worth the wait.
2. Fair, to a player, means a setback they can explain and learn from.
3. Fairness is felt, not calculated: players misread odds, and a game may bend chance toward what it shows, but help the player discovers spoils itself.
4. Luck has jobs (a chance for the weaker player, a different game each time, stories), and the skill is in playing around it.
5. Players come back while there is more to learn: new situations, rising difficulty they choose, and a seed of the next game planted in this one.
6. An AI opponent is a design for the player's experience: never dumb, readable about what it will do, beatable, and with a personality.
7. An AI that cheats is fine when the game is openly asymmetric or the help is a visible handicap; a hidden cheat the player catches ends their trust.
8. In multiplayer, waiting is the cost of turns: let everyone decide every turn, and let a turn be taken whenever the player has a minute.
9. Against a person, the fun is reading them, and a single wrong read must not end the game.
10. Multiplayer fairness has three known holes: going first, the player who falls behind, and the player who can no longer win but still picks the winner.

The sections below give the sources for each, then where the sources disagree, then what this means for a small prototype.

## 1. A turn is the game waiting for the player

Real-time games ask the player to keep up; a turn-based game stops until the player acts. That is what makes the player the author of what happens, and it is also the genre's obligation: a turn that only asks the player to press "end turn" wastes the pause it was built on. Civilization started real-time and became turn-based for this reason; asynchronous games are built around the same rule.

- Sid Meier, GDC 2010 keynote, via VentureBeat ([link][meier-2010]): "My first mistake was to make it real time." … "But what we found was that in real-time gaming the player becomes the observer." … "When we made Civ a turn-based game, the player became the star, they made things happen."
- Soren Johnson, "Asynchronicity in Game Design", Game Developer, 2009 ([link][soren-async]), on why simultaneous-turn games suit asynchronous play: "This format is ideal for an asynchronous experience because all players get to make a decision every single turn." On classic turn-based board games: "the vast majority of turns are spent waiting for other players to make their moves."
- See `STRATEGY.md`, principle 1: the decision itself has to be situational to be worth the turn.

## 2. Fair means a setback the player can explain

Players never question a reward; they question every loss. A setback reads as fair when the player can see why it happened and what to do differently next time, and as cheating when they cannot. `STRATEGY.md` principles 3 and 6 give the mechanics (show the information, show the consequence); this is why they matter to whether a player stays.

- Sid Meier, GDC 2010, via VentureBeat ([link][meier-2010]): "the player never really questions rewards." … "If something bad happens, if there is a setback to the player, the react much differently." … "They complain the game is broken, the AI is cheating, or something in the game is wrong." … "You have to be careful with setbacks. It's important to explain why these things happen," … "and how to avoid these things in the future."
- Soren Johnson, "Our Cheatin' Hearts", 2009 ([link][soren-cheat]): "Once again, perception is reality." … "The question is not whether the AI is playing "fairly" but what is the game experience for the player?"
- Simon Parkin, "How Designers Engineer Luck Into Video Games", Nautilus, 2017 ([link][nautilus]): "Fairness is the unspoken promise of most video games." … "A game that always beats you is a game you'll soon stop playing."
- Meier, on Railroad Tycoon, via Darenn Keller's write-up of his memoir ([link][keller-meier]): the article paraphrases Meier as agreeing that floods the player could not respond to were unfair. The failure was the lack of a response, not the setback.

## 3. Fairness is felt, not calculated

Players do not read a percentage as a number. A 33% chance that fails twice feels rigged, and a 90% that misses feels like a lie. Several well-loved games answer by bending chance toward what the player expects: Fire Emblem's displayed hit rate understates high chances and overstates low ones, and Civilization has guaranteed a win after repeated losses at fixed odds. The same sources warn that once players notice the bending, the luck they enjoyed stops meaning anything.

- Sid Meier, GDC 2010, via VentureBeat ([link][meier-2010]): "Even when players were in a battle with 1: 3 odds, they felt they could win." … "Something is going on there. But it's not mathematics." … "When random things happen, paranoia strikes the heart of the gamer."
- Fire Emblem Wiki, "True hit" ([link][fe-truehit]): "As its name suggests, true hit differs from the displayed hit rate." The game rolls two numbers and the attack lands if "the average number is less than the hit rate."
- Diplograph, "Lie about probability" ([link][diplograph]): "Some games lie about the chance that something will occur." … "This makes attacks feel more consistent: if you appear likely to hit, you probably will." … "It also means luck (as in the random generator) has a deemphasized effect compared to unit stats."
- Simon Parkin, Nautilus ([link][nautilus]), on Civilization: "if your odds of winning a battle were 1 in 3, the game guaranteed that you'd win on the third attempt", "a misrepresentation of true probability that nevertheless gave the illusion of fairness". And the warning: "Call it the Lucky Paradox: Lucky is fun, but too lucky is unreal." Riot's Sottosanti: "As soon as the player becomes aware of any sort of pseudo-randomness, it risks undermining the joy of getting lucky". Parkin: "A player who senses that he's secretly being helped by the game will feel patronized".
- Jason Kapalka (Peggle), via Nautilus ([link][nautilus]): "we do apply a lot of extra 'luck' to players in their first half-dozen levels" … "Today, players almost always perceive patterns of manipulation where there are none".

## 4. Luck has jobs; the skill is in playing around it

`STRATEGY.md` principle 4 argues for randomness before the decision, so the player can plan. That holds for a solo puzzle-like game. Card and multiplayer designers add what luck is *for*: it lets a weaker player win sometimes (which keeps them playing), it makes each game different, and it creates the swings players tell stories about. The skill moves from executing a known line to adapting to an unplanned situation.

- Richard Garfield (Magic: The Gathering), NYU Game Center interview, 2012 ([link][garfield-nyu]): "As long as your goal is a broad group of people; beginners, experts, casual, serious, young, old – luck will have a place." … "Luck in sports will always be better if it feels like the player is in control."
- Zach Gage (Really Bad Chess), via Nautilus ([link][nautilus]): "It makes weaker players feel like they have a chance against stronger players".
- Ben Brode (Hearthstone), via Matthew Gallant, "A Taxonomy of Randomness in Hearthstone", 2016 ([link][gallant]): "they make every game a little bit different, and it gives opportunities to really good players to show off their skills." Mike Donais, same page: "RNG gets your emotions really high and really low." Gallant on random targets: "In practice, these cards reward skillful play because players can modify the board state to favour their desired result." His conclusion: "Randomness is not a single tool, it's an entire toolbox."
- Yong Woo (Hearthstone producer), via PCGamesN ([link][hs-woo]): "What [RNG] does is force you to problem solve in circumstances that you never thought you'd be in." … "There's no guarantee that if I do A, B, C every time then X, Y, Z is going to happen and I'm going to win."

## 5. Players come back while there is more to learn

A turn-based game is replayed for the same reason it is enjoyed: it keeps teaching. Once a player has solved it, they stop. The games that last keep new situations coming (generated runs, different enemies that test different plans), let the player raise the difficulty when they are ready, and end each game with a reason to start another.

- Raph Koster, *A Theory of Fun*, via Chad Prevost ([link][koster]): "That's what games are, in the end. Teachers. Fun is just another word for learning."
- Sid Meier, GDC 2010, via VentureBeat ([link][meier-2010]): "I see a big value is replayability." … "Whenever there is an opportunity to plant the seed of replayability, you're on your way to a satisfied customer." On difficulty: "I once gave a talk on how games should be split into four different difficulty levels. I was wrong." … "Now, Civilization V has nine difficulty levels. As players move on they continually get better and receive rewards." … "You want to feel they are above average."
- Anthony Giovannetti (Slay the Spire), Road to the IGF, 2020 ([link][sts-igf]): "We wanted a wide gamut of enemies that would challenge different strategies in unique ways." … "our replayability, even early in playtesting, was off the charts." Slay the Spire's difficulty rises one step per win, by the player's choice: "Up to 20 Ascension difficulty levels unlock with each successfully completed run" (via Wikipedia, [link][sts-wiki]).
- Jake Solomon (XCOM 2), via Game Developer, 2016 ([link][xcom2-diff]), on making the game harder late in development: "if we don't make the game hard, a lot of the design systems don't engage." … "when the game got more difficult then you started to see people engaging, you felt that spark of life".
- Soren Johnson, "AI Fallibility and the Chick Parabola", 2010 ([link][soren-chick]): once players find the mechanic the AI cannot handle, they master the system and lose interest; he names the curve after it. Replay value can end at the AI's weakest point (see principle 6).

## 6. An AI opponent is a design for the player's experience

`STRATEGY.md` principle 10 says the opponent serves the player. These are the properties the sources ask of it. Avoiding blunders matters more than finding brilliant moves, because an obvious mistake breaks the illusion. Telling the player what it intends makes it look smarter, not weaker: Slay the Spire added enemy intents after playtests and Into the Breach is built on them. It must leave room to win, and it can have a style. And the game should not ask it to do what it cannot: a mechanic the AI never uses well becomes the hole every player finds.

- Jon Shafer (Civilization V, At the Gates), "The Recipe for Good AI", 2012 ([link][shafer-ai]): "It’s much more important for an AI to be not dumb than for it to be smart." … "Another tactic that, perhaps counter-intuitively, makes an AI seem much smarter is to have it explain what it’s doing." … "Sure, it sounds obvious, but how predictable or wacky an AI should behave is an important design decision." … "Even those who want a serious challenge wouldn’t enjoy losing every game." … "Some people are looking to roleplay, or just would prefer the AI keep the gloves on even when it has an advantage."
- Slay the Spire, via Wikipedia ([link][sts-wiki]): "Originally, enemies did not show their next intended action", and "they discovered through playtesters that having the numbers available was more engaging". Today "Each opponent on the field will telegraph what move they will make".
- Soren Johnson, "AI Fallibility and the Chick Parabola" ([link][soren-chick]): "The games which suffer the most are ones where the computer is forced to play the same game as the human." In asymmetrical games, "the AI is simply a speed bump that can be easily tuned to provide the right level of challenge." On a trust-and-betrayal mechanic: "Artificial intelligence is notoriously poor at handling issues of trust and betrayal".
- Ashton Anderson and colleagues (Maia, a chess engine trained to play like people at each rating), University of Toronto, 2021 ([link][maia]): earlier engines "made relatively lousy teachers"; the aim is to capture "human style, human ability, and crucially, human errors". An opponent that makes the mistakes a player of that level makes is easier to learn from than one that is simply weaker.
- Soren Johnson, "Playing to Lose: AI and Civilization", GDC 2008 ([link][soren-ai]), cited in `STRATEGY.md`: the difference between "good" AI and "fun" AI.

## 7. AI cheating: open handicaps yes, hidden cheats no

A symmetric opponent built by a small team will not match a good human, so it needs help. The sources agree on how to give it: openly, as a difficulty setting the player chose or an asymmetry built into the game, never as a secret the player discovers. When the player suspects a hidden cheat, every unlucky outcome after that is blamed on it (principle 2).

- Soren Johnson, "Our Cheatin' Hearts", 2009 ([link][soren-cheat]): "under symmetrical conditions, artificial intelligence often needs to cheat just to be able to compete with the player." … "For asymmetrical games, cheating is simply bad game design." … "With cheating, perception becomes reality, so transparency is the antidote to suspicion and distrust." On visible, incremental handicaps: "Because of their incremental nature, these cheats have never earned much ire from the players." His example of a hidden cheat: "In the original version of the game, the AI could create units for free under the fog-of-war". On Puzzle Quest, where players accused the AI of lucky drops, he suggests luck that only ever favours the player: "The game code could ensure that fortunate drops only happen for the human and never for the AI."
- Sid Meier, GDC 2010, via VentureBeat ([link][meier-2010]): players who meet a setback "complain the game is broken, the AI is cheating".

## 8. In multiplayer, waiting is the cost of turns

A turn-based game with other people has a problem a solo game does not: while one player thinks, everyone else waits. Two answers recur. Simultaneous turns, where everyone plans at once and the turn resolves together (Diplomacy, Frozen Synapse). And asynchronous play, where a turn is taken whenever the player has a minute and the game waits for days if it must, which also suits a phone.

- Soren Johnson, "Asynchronicity in Game Design" ([link][soren-async]): "No more are 4 or 5 other gamers sitting around a table, waiting for the slow player to make up his mind." … "the time pressure of a standard turn-based game is eliminated." On time: "Few adults can afford the total devotion required to participate in a five-hour, 40-man MMO raid." The risk he names: Diplomacy "can still hang if one player neglects to send in a turn."
- Paul Taylor (Mode 7), "Postmortem: Frozen Synapse", 2012 ([link][fs-postmortem]): the game began as "a simultaneous turn-based game which foregrounded tactics rather than strategy." On launch: "This was largely down to the fact that Frozen Synapse is an asynchronous game!" Players "wanted to sit online for long periods and play multiple concurrent games."

## 9. Against a person, the fun is reading them

Against an AI, the player solves a puzzle. Against a person, they guess what the other will do, and the satisfaction is in guessing right. Hidden information (cards in hand, units in fog, simultaneous orders) is what makes guessing possible. The sources add a limit: a game of guesses where one wrong guess loses is a coin toss, not a contest.

- Caleb Compton, "Know Thy Enemy: Designing for Yomi in Games", 2019 ([link][compton-yomi]): Yomi "refers to the ability to read your opponent's intentions before they actually act." … "One of the most satisfying feelings in any competitive game is being able to perfectly predict and counter your opponent's moves." … "In a game of predictions it is not very fun if a single wrong prediction can lead to inescapable death." On Stratego, players "must use your knowledge of your opponent to determine where he placed his various ranks."
- David Sirlin, cited in `STRATEGY.md` ([link][sirlin]): "If you know what the opponent will do, you should generally have some way of dealing with that." Reading the opponent only pays if a counter exists.

## 10. Multiplayer fairness: going first, falling behind, picking the winner

Three problems come with turns and more than one player, and each has known answers.

**Going first.** Turns give someone the first move. Hearthstone measured it and compensated the second player with a card (The Coin) and an extra draw, and still found a small edge for the first.

- Hearthstone Wiki, "The Coin" ([link][hs-coin]): "Together with the fourth starting card, The Coin is intended to counter some of the disadvantage of going second." Ben Brode, February 2014: "It's about three percent better to go first over second." March 2015: "the win rate is very close to 50-50 regardless of who has the coin," but "Going 1st is slightly better."

**Falling behind.** `STRATEGY.md` principle 8 covers the snowball. In multiplayer the usual fix is a comeback mechanic, and it has its own cost: it can reward losing.

- Celia Wagar, "Comeback Mechanics & Slippery Slopes", 2017 ([link][wagar]): "Comeback mechanics are basically when, as you get closer to losing, you're given more power to hurt the other player." … "The intent with comeback factors is frequently to make the game easier for beginners." Against them: "They tend to make it so that losing puts you closer to winning." Against the snowball: "Positive feedback or slippery slopes have the downside of creating lame duck scenarios more commonly."

**Picking the winner.** With three or more players, someone who can no longer win may still decide who does (kingmaking).

- The Thoughtful Gamer, "Losing Propositions: Kingmaking As A Design Challenge", 2017 ([link][kingmaking]): "kingmaking is when a person who (ostensibly) has no chance at winning affects who ultimately wins the game". Remedies it describes: scores that are hard to read until the end (Dominant Species: "a significant number of points are scored in the final scoring phase at the end of the game"), and short games where everyone stays close to winning (Kemet, "played to only 7 points before it's over").

## Where the sources disagree

- **Lying about odds.** Fire Emblem's true hit and Civilization's guaranteed third win are loved, and Diplograph defends them as making attacks "feel more consistent". Sottosanti and Parkin warn that discovered pseudo-randomness undermines "the joy of getting lucky" and that secret help feels patronizing ([link][nautilus]). Jake Solomon, who made XCOM's results repeat on reload so reloading could not reroll them, later said of a non-synchronised option: "I probably should have done that, actually. Sorry." ([link][solomon-regret]). The middle ground the sources support: bend chance only toward what is shown (a 90% that nearly always hits), never against the player, and prefer making the display honest (show the real chance) over hiding a correction. `STRATEGY.md` principle 4 removes the question by moving randomness before the decision.
- **Luck in competitive play.** Garfield, Gage, and Brode want luck so that weaker players win sometimes and games vary; Burgun (cited in `STRATEGY.md`) says random games "delay learning". Both describe real effects. For a solo game whose fun is planning, follow Burgun; for a game played against friends of mixed skill, some luck is what keeps the weaker friend playing.
- **Kingmaking.** The Thoughtful Gamer treats it as a problem to design out. Cole Wehrle (Root) defended it at GDC 2019 ([link][wehrle]) as part of what gives conflict-driven multiplayer games their stories. The difference is the game: in a game sold on negotiation and table politics it is a feature, in one sold as a fair contest it is a flaw.
- **How smart the AI should be.** Shafer wants it "not dumb" more than smart and ready to "keep the gloves on"; Solomon found XCOM came alive only when it was hard ([link][xcom2-diff]). They meet in difficulty levels: Meier's nine levels and Slay the Spire's Ascension let the player choose how hard the opponent plays (principle 5).

## For a small 2D prototype

Read with the `ritmo-prototype` skill, whose rules come first, and with `STRATEGY.md`'s own prototype notes. These are the principles above turned into what to look for in a first playable, not a recipe:

- A prototype question about fairness names a setback: "when the player loses a unit, can they say why?" Ask the director after a loss; an answer of "bad luck" or "the AI cheated" is the signal (principles 2 and 3).
- Make the AI announce its next move before making it smarter (principle 6). A telegraph is a cheap first version of a readable opponent, and its failures (moves the AI never makes, a mechanic it ignores) show where the design asks too much of it.
- If the opponent needs help to compete, make the help a visible setting (principle 7), so a variant with and without it is a fair comparison.
- For multiplayer, prototype hot-seat or simultaneous turns first; asynchronous play needs a server and is a later question (principle 8).
- Ritmo's simulation is deterministic: randomness comes from `Random` with a seed, so the same seed and the same inputs replay the same game (the repo's `AGENTS.md`). That makes an undo, a replay of a lost game, a shared seed for a daily challenge, and asynchronous play by exchanging moves cheap to try, but which of these a game wants is a design question to ask the director, not a default. (Ritmo convention, not a design claim.)

[meier-2010]: https://venturebeat.com/2010/03/12/quotes-from-sid-meiers-keynote-gdc-speech
[soren-async]: https://www.gamedeveloper.com/game-platforms/analysis-asynchronicity-in-game-design
[soren-cheat]: https://www.designer-notes.com/?p=132
[soren-chick]: https://www.gamedeveloper.com/game-platforms/analysis-ai-fallibility-and-the-chick-parabola
[soren-ai]: https://www.designer-notes.com/?p=1318
[keller-meier]: https://www.gamedeveloper.com/game-platforms/just-one-more-turn---game-development-tips-and-tricks-from-the-creator-of-civilization-sid-meier-
[nautilus]: https://nautil.us/how-designers-engineer-luck-into-video-games-236363
[fe-truehit]: https://fireemblemwiki.org/wiki/True_hit
[diplograph]: https://diplograph.net/notes/games/randomness/lie-about-probability
[garfield-nyu]: https://gamecenter.nyu.edu/game-designers-in-detail-richard-garfield/
[gallant]: https://gangles.ca/2016/09/12/hearthstone-randomness/
[hs-woo]: https://pcgamesn.com/hearthstone-heroes-of-warcraft/blizzard-hearthstone-rng-actually-increases-the-level-of-skill-required-to-master-the-game
[koster]: https://chadprevost.com/2014/03/27/a-theory-of-fun-10-years-on-fun-is-just-another-word-for-learning/
[sts-igf]: https://www.gamedeveloper.com/game-platforms/road-to-the-igf-mega-crit-games-i-slay-the-spire-i-
[sts-wiki]: https://en.wikipedia.org/wiki/Slay_the_Spire
[xcom2-diff]: https://www.gamedeveloper.com/design/-i-xcom-2-s-i-difficulty-ramped-up-very-late-in-development
[solomon-regret]: https://games.softpedia.com/blog/Lead-XCOM-Designer-Regrets-Fixed-Hit-Chance-Results-319573.shtml
[shafer-ai]: https://www.gamedeveloper.com/design/the-recipe-for-good-ai
[maia]: https://www.utoronto.ca/node/168184
[fs-postmortem]: https://www.gamedeveloper.com/audio/postmortem-mode-7-games-i-frozen-synapse-i-
[compton-yomi]: https://www.gamedeveloper.com/design/know-thy-enemy-designing-for-yomi-in-games
[sirlin]: https://sirlin.net/articles/balancing-multiplayer-games-part-2-viable-options
[hs-coin]: https://hearthstone.wiki.gg/wiki/The_Coin
[wagar]: https://critpoints.net/2017/04/01/comeback-mechanics-2/
[kingmaking]: https://thethoughtfulgamer.com/2017/09/16/losing-propositions/
[wehrle]: https://www.gdcvault.com/play/1025683/Board-Game-Design-Day-King
