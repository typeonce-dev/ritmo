# What makes a simulation or management game work, and last for weeks

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it collects the principles that hold across simulation and management games, each traced to people who design them, quoted below with a link, in the same shape as [`PROTOTYPE.md`](../PROTOTYPE.md). It is not published: `package.json` `files` leaves it out, and the website does not read it.

The scope is what one developer or a small team can build, mostly in 2D: colony sims (RimWorld, Dwarf Fortress, Oxygen Not Included), farming and life sims (Stardew Valley, Animal Crossing), factory and logistics games (Factorio, Mini Metro), and idle games. The question is the one Sandro asked: what makes the simulation interesting, fun, and balanced, and what keeps someone playing it over several weeks. A principle is listed only when at least two independent sources support it, or one designer states it and a shipped game shows it. Where sources disagree, the disagreement is written down instead of picking a side quietly.

It builds on the other genre docs and does not repeat them. Read them for what they cover better: [`STRATEGY.md`](STRATEGY.md) for decisions, dominant options, and the snowball (a management game is a strategy game played in slow motion, and all of that applies); [`RPG.md`](RPG.md) for loops and arcs and the next goal being close; [`PUZZLE.md`](PUZZLE.md) for games that fit in a break and last for years.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. Paraphrase is never put in quotation marks.

## The principles in one place

1. The game is the model in the player's head. A system the player cannot see does not exist.
2. Simulate the least that makes the stories you want; depth comes from simple rules touching.
3. Start from a toy, put goals on top, and let the player decide what success is.
4. The economy has taps and drains, and costs outgrow production on purpose.
5. Pressure grows with the player, and eases off when they fall.
6. Failure is part of the story, not the end of it.
7. Choose the clock: a run that ends, or a world that keeps time.
8. Weeks of play come from rituals and things that grow, not from obligations.
9. A ladder of goals the player can see, and room past the last rung.
10. It is about the player's own things, and the stories are made to be told.

The sections below give the sources for each, then where the sources disagree, then what this means for a small prototype.

## 1. The game is the model in the player's head

The simulation the designer builds and the one the player experiences are different things, and only the second one counts. A rich system that the player cannot observe is cost with no return; a simple system the player can read and argue with is the game. Being legible does not mean explaining everything up front: the player learns the model by poking it.

- Tynan Sylvester (RimWorld), "The Simulation Dream", 2013 ([link][sim-dream]): "The whole value of a game is in the mental model of itself it projects into the player's mind." … "In play, the Game Model is irrelevant. Players can't perceive it directly." … "anything in the Game Model that doesn't copy into the Player Model is worthless." On what happens otherwise: "All the interesting stuff in the game ends up lost in the silicon, inaccessible to the human players' understanding."
- Will Wright (SimCity, The Sims), The Replay Interviews ([link][wright]): "SimCity was always meant to be a caricature of the way a city works, not a realistic model of the way a city works." … "In fact, when people start arguing with the model, that's when I think it's been successful."
- Sylvester, on how RimWorld differs from Dwarf Fortress, via Game Developer, 2016 ([link][rim-df]): "Dwarf Fortress' abstract presentation leaves the player's mind to imagine the story from scratch," … "RimWorld is also abstract, but it shows enough that it constrains the imagination a little bit."
- On learning it by playing: Johann Seidenz (Klei, Oxygen Not Included), via Game Developer, 2017 ([link][oni]), under the heading "Tutorials can kill a sense of reward." Eric Barone (Stardew Valley), via a page quoting his Vulture interview ([link][aub]): "I still think that the best way to play the game is to figure everything out yourself".

## 2. Simulate the least that makes the stories you want

The temptation of the genre is to simulate everything. Every source that has shipped one says the opposite: choose the few systems that make the situations you want, keep each one simple, and let the interest come from how they touch. This is the strategy doc's principle 5 (few pieces, small space), seen from the simulation side.

- Sylvester, "The Simulation Dream" ([link][sim-dream]): "Choose the minimum representation that supports the kinds of stories you want to generate." … "In general, lean on the simple side. You don't have to simulate that much." On what happens when systems multiply: "The connections multiply until the whole system appears as a gigantic hairball of complexity."
- Wright ([link][wright]), on what he learned from simple rules: "That they can arise from fairly simple rules and interactions, and that became a major design approach for all the games" … "It feels more like you're dealing with an ecology now rather than an engineering artifact."
- Tarn Adams (Dwarf Fortress), Game Developer Q&A, 2019 ([link][tarn]): "Thinking about what your individual game mechanics add to potential stories is important" … "For us, being as anti-numeric as possible is ideal, since numbers usually make for poor stories."
- Michal Kovařík (Factorio), Software Engineering Daily, 2024 ([link][sed]): "We have a role that it's always fun above realism."
- Mini Metro is the small end of the genre: Lena LeRay, Game Developer, 2016 ([link][mm-gd]), on the player's actions: "the player's actions are limited to building tracks, putting train cars on them" … "That's it." Peter Curry, via Pocket Tactics, 2023 ([link][mm-pt]): "It was honestly the easiest game we've ever designed. We designed it verbally in about half an hour."

## 3. A toy first, goals on top, and the player decides what success is

A simulation is played before it is won: it has to be fun to poke with no goal at all. Goals then point the poking somewhere. The genre's long life comes from leaving room for players to set their own: which part to automate, what kind of city or farm counts as good.

- Wright ([link][wright]): "But I always wanted it to be much more open-ended, more of a toy." … "So a game like chess, there's just one goal structure." … "In a game like SimCity, because we're not formally defining success, there's a lot of psychology involved for the players." … "Players can have different balances of those factors that they consider success".
- Kovařík, Friday Facts #106, "Brain satisfaction tool", 2015 ([link][fff106]), lists the needs Factorio satisfies: "The general need to create and build." … "The need to understand the mechanics of processes." … "The need to overcome obstacles and challenges." In the 2024 interview ([link][sed]): "Basically, the game is about figuring out how to automate it" … "you can always choose what to do manually and what to do automatically."
- Barone, via a page quoting his Vulture interview ([link][aub]): "I wanted it to feel overwhelming with stuff to do, yet you didn't feel stressed about it," … "More just excited that you've got things to do."
- The Project Horseshoe report on cozy games, 2018 ([link][cozy]), warns about leaning on rewards instead of the toy: "Almost any form of extrinsic reward generates a pressing transactional short-term need." Tanya X. Short's summary ([link][cozy-gd]): coziness "requires intrinsic satisfaction from the activity, not satisfaction contributing to some other purpose".

## 4. The economy has taps and drains, and costs outgrow production

A management game is an economy: resources come in, are converted, and leave. Balance is mostly about that flow. Two rules recur. Every source of a resource needs somewhere for it to go, or it piles up and stops meaning anything. And costs should grow faster than production, so the player always meets a wall, and then a new idea (a new building, an upgrade, a reset) to climb it. Without the wall, the economy runs away; without the new idea, the wall is the end.

- Machinations, *Game Mechanics: Advanced Game Design*, chapter 5 ([pdf][dormans]): "gameplay is ultimately determined by the flow of tangible, intangible, and abstract resources through the game system." … "Sources are nodes that create resources." … "Drains are nodes that consume resources; a resource that goes into a drain disappears permanently." … "Converters convert one resource into another." … "These feedback structures determine much of the dynamic behavior of game economies."
- Simon Ludgate, "The F-Words of MMOs: Faucets", 2011 ([link][faucets]), quoting Lance Stites (Aion): "The faucet is the continued injection of 'currency', such as gold being acquired killing monsters or completing quests," … "without the drain, the inflation would be extreme". Ludgate: "Many developers focus on trying to balance the creation and destruction of currency in their games".
- Anthony Pecorella (Kongregate), "The Math of Idle Games, Part I", 2016 ([link][idle1]): "This is typically accomplished by having costs grow exponentially while production grows at a linear or polynomial rate." … "Early on in a run, your production will exceed costs while eventually costs will become prohibitive." On the new idea: "Now the player has choices about what to invest in, and things get more complicated." On the reset: "The result is that each prestige allows the player to get farther through the cost curve before falling behind."
- Pecorella, Part III, 2017 ([link][idle3]), on why resets help: "They rein growth back into a more manageable number." … "They create the "ladder climbing" effect that contributes to why idle games are so compelling." And the honest note: "Balancing progression is hard."
- Kovařík ([link][sed]): "It's about the investment and whether investment helps you the most to move forward". The strategy doc's principle 8 (the snowball) is the same loop seen from the other side: production that feeds production is a positive feedback loop.

## 5. Pressure grows with the player, and eases off when they fall

Most management games have a threat that grows: raids, demand, winter. The good ones tie it to how well the player is doing, so a strong colony is tested and a broken one gets room to recover. That is how a simulation fights the snowball without taking the player's progress away.

- Sylvester, on RimWorld's storyteller, via Game Developer, 2016 ([link][rim-df]): "The storyteller eases off when the colony population drops." … "The game tries to hurt but not kill the colony," … "Raiders, when they win a battle, will steal or kidnap and leave, instead of killing everyone."
- Mini Metro grows the pressure until it wins, on purpose. LeRay ([link][mm-gd]): "As the city grows and the number of passengers increases, so does the pressure to make the most efficient network possible." … "Eventually, the player won't be able to keep up with demand; stations will overcrowd and the game will end." Rob Curry, via Pocket Tactics ([link][mm-pt]): "When things hit this crisis point, we think that it's a key part of driving the game to a conclusion."
- Nikhil Murthy's Downwell point, quoted in [`STRATEGY.md`](STRATEGY.md) (principle 8), is the general rule: difficulty that rises with power.

## 6. Failure is part of the story

In most genres losing ends the game. In a simulation, a collapse is often the most memorable thing that happened, as long as the player can see why it happened (principle 1) and it plays out instead of cutting off. The player reads intent and drama into the systems, and the game's job is to give them material.

- Dwarf Fortress wiki, "Losing" ([link][df-lose]), the community's motto: "Losing is fun!"
- Sylvester, via Game Developer ([link][rim-df]): "The process of losing is very dramatic, and I want to drag it out because drama is good." … "The goal here is to not just cut off the story, but let the spiral down into death play out over a long dramatic arc,"
- Sylvester, "The Simulation Dream" ([link][sim-dream]): "Apophenia is seeing meaningful patterns in random or meaningless data." … "This apophenia – this perception of personality and intent where there is none – is the key to making a simulation game work." … "The game is a co-author, not an author."
- Adams ([link][tarn]): "This allows them to be actors in their own stories, which is a large part of where emergent narrative comes from."
- Sylvester ([link][rim-df]): "The real engine of story is the gameplay systems themselves" … "Also, I tried to design the incidents so they could interact and overlap,"

## 7. Choose the clock: a run that ends, or a world that keeps time

Lasting over weeks does not need one endless save. There are two shapes, and a game should pick one on purpose. A run that ends (Mini Metro, roguelike colony sims) gives each session a beginning and an end, and the weeks come from wanting another run. A world that keeps time (Animal Crossing's real-world clock, an idle game's offline progress) gives the player a reason to come back tomorrow, and asks less of each session.

- A run that ends: LeRay ([link][mm-gd]): "a typical game in normal mode will only last 10-20 minutes." Rob Curry ([link][mm-pt]): "But for us, it has to end somewhere."
- A world that keeps time: Iwata Asks, Animal Crossing: New Leaf ([link][newleaf]), Moro, on the real clock: "the sense of unity that comes from time passing in sync with the real world" … "everyone gets to share that sense of the seasons and the time passing". Director Aya Kyogoku, on why the shops still close at night: with them open all hours, "there would be no difference between day and night", "defeating the whole point of having time in sync with the real world."
- Progress while away: Pecorella, via Simon Parkin, Game Developer, 2015 ([link][idle-rise]): "A quick check-in to the game allows you to advance much more quickly by shifting up the growth curve" … "the longer you're away from the game, the greater your incentive to return to the game."
- The cost of the real clock, from the same Iwata Asks ([link][newleaf]), Kyogoku: "I would often come home late from work only to find that Tom Nook's shop was closed." Stardew Valley keeps the calendar (days and seasons) but runs it on the game's own clock: a day ends when the player sleeps, not when the real day does.

## 8. Weeks of play come from rituals and things that grow, not obligations

The daily loop of a long-lived sim is small and repetitive on purpose: water the crops, check the shop, collect what grew. That repetition is a pleasure while it is chosen, and it turns into a chore list the moment missing a day is punished. The sources agree on the line: reward coming back, never punish staying away.

- Barone, NPR, 2025 ([link][npr]): "There's no high, grand adventure." … "You're watering your crops. You might go in and talk to people." … "But that's the sort of thing that, you know, we all do every day, and that's just part of life." … "So I think there's something about that that does tap into a certain - a human drive that we have." And on the nickname: "You know, some people have called it Chores: The Game. And I can kind of see that, yeah."
- Daniel Cook for the Project Horseshoe cozy group, 2018 ([link][cozy]): "Repeated low risk tasks allow the player to relax." … "a self-appointed task — harvest and replant the crops — can be relaxing." On Animal Crossing's fruit trees: shaking one "is inherently pleasurable even after thousands of repetitions." On what breaks it, the report lists "any form of mandatory maintenance, needy pets", and "Time pressure on sales and event generates a fear of missing out." On why it lasts: "Coziness reduces these drop-off points via an absence of harsh, demanding, and needy motives."
- Jordan Blackman on FarmVille-style withering, via Adrian Crook, 2014 ([link][wither]): the mechanic "also ensures a genuine "appointment" mechanic", but for a player who did not come back it makes "their next experience less fun and probably less balanced." His conclusion is that "a wither mechanic isn't" a best practice, while a daily return reward is.
- Offline gains have a size. Pecorella, Part III ([link][idle3]), on one idle game: "Players are limited to 2 hours of offline play by the game." … "Clicker Heroes, on the other hand, has no such limits to offline gains." A cap keeps playing worth more than waiting; no cap makes waiting the game.

## 9. A ladder of goals the player can see, and room past the last rung

Over weeks, the player needs to see the next goal and the one after it (the RPG doc's "the next goal is close"), and each rung should change how the game is played, not just make a number bigger. Past the last rung, the long tail is the player's own goals (principle 3), challenge settings, and other people's mods. More content is not always more life.

- Pecorella, Part III ([link][idle3]), on the "ladder climbing" effect quoted under principle 4, and on milestones: "a player who just hit a big milestone is likely to keep going for a while since that's a fast section of the game." Part I ([link][idle1]): "As you progress through the game, different generators take priority and have the biggest impact on income."
- Wright ([link][wright]), on SimCity: "It didn't have this really short lifespan, like most games."
- Kovařík ([link][sed]), on what mods do to Factorio: "Basically, the mods make extreme settings, extreme interactions of stuff, and it's so much harder." And on content: "we are trying to improve the density of fun."
- Barone, NPR ([link][npr]): "I think a game can have too much content." … "to the point where it's detrimental to the game's, like, entertainment factor."

## 10. It is about the player's own things, and the stories are made to be told

A sim lasts when what is in it is the player's: their colonists, their house, their family playing the same town. And its stories travel: players retell what happened in their world, and that retelling is a large part of why others start, and why players keep going.

- Wright ([link][wright]), on The Sims: "Anything that's about them is going to be 10 times more fascinating than anything else, no matter how boring it is."
- Katsuya Eguchi (Animal Crossing), Nintendo World Report, 2006 ([link][eguchi]): "It really came out of desire for me to improve communication within my own family." … "have some sort of shared experience".
- Moro, Iwata Asks ([link][newleaf]): "everyone gets to share that sense of the seasons and the time passing".
- Adams ([link][tarn]): "The forums and streamers and so forth have the good stories." Sylvester ([link][rim-df]): "Dwarf Fortress amazed me because of the stories people wrote from it,"

## Where the sources disagree

- **Pressure or comfort.** RimWorld wants the player hurt: "drama is good" ([link][rim-df]). The cozy report wants "no impending *loss* or *threat*" ([link][cozy]). Both games last for years, so neither is wrong; they are two genres sharing a toolbox. Stardew sits between them: much to do, "yet you didn't feel stressed about it" ([link][aub]). A game should pick its side early, because the pressure system (principle 5) and the daily ritual (principle 8) pull against each other.
- **An ending or none.** Mini Metro "has to end somewhere" ([link][mm-pt]). Dwarf Fortress has no ending, and losing is the closest thing to one ([link][df-lose]). Factorio has a goal (launching a rocket) that most players play well past. Pick by the clock (principle 7): a run that ends needs an ending; a world that keeps time needs room after the last goal (principle 9).
- **How deep to simulate.** Adams builds one of the deepest simulations there is. Sylvester, who learned from it, says "lean on the simple side" ([link][sim-dream]) and made RimWorld show more and simulate less. For a small team, the second is the only one that fits the budget, and principle 1 says the extra depth is worth only what the player can see.
- **The real-world clock.** Kyogoku keeps the shops closing at night, since otherwise there is no "point of having time in sync with the real world", and in the same interview describes finding the shop closed when coming home late ([link][newleaf]). Pecorella says time away should pay off ([link][idle-rise]); the cozy report counts time pressure as a cause of "fear of missing out" ([link][cozy]). The real clock is fine as long as it only ever gives (things grew, a visitor came), never takes (things withered, the event is gone).
- **Offline gains.** Capped in one idle game, unlimited in Clicker Heroes ([link][idle3]). No source settles it; the question is whether the game is about playing or about coming back.

## For a small 2D prototype

Read with the `ritmo-prototype` skill, whose rules come first. These are the principles above turned into what to look for in a first playable, not a recipe:

- Start from the toy (principle 3) and the fewest systems that make one interesting situation (principle 2): one resource, one converter, one drain, one pressure. A good prototype question names a moment: "if winter doubles food use, will the player start storing food in autumn without being told?"
- Show every system's state on screen, even as text (principle 1): stockpiles, rates, why a worker is idle. If the human cannot say why something happened, that is the bug, not the balance.
- The simulation is headless and deterministic in Ritmo (a Ritmo convention), so a script can play many days in seconds. Use it for principle 4: print production against cost by day for a few weeks of game time, and find the walls before a human has to.
- Decide the clock (principle 7) before tuning anything else; it changes every number. A run that ends is quicker to playtest; a world that keeps time can be faked in a prototype with a key that skips a day.
- Weeks of play cannot be tested in a prototype. What can be tested is whether the human, after a session, wants to see what grew overnight, and whether skipping a day ever felt like losing something (principle 8).

[sim-dream]: https://www.gamedeveloper.com/design/the-simulation-dream
[rim-df]: https://www.gamedeveloper.com/design/how-i-rimworld-i-fleshes-out-the-i-dwarf-fortress-i-formula
[wright]: https://www.gamedeveloper.com/business/the-replay-interviews-will-wright
[tarn]: https://www.gamedeveloper.com/design/q-a-dissecting-the-development-of-i-dwarf-fortress-i-with-creator-tarn-adams
[df-lose]: https://dwarffortresswiki.org/index.php/v0.31:Losing
[oni]: https://www.gamedeveloper.com/design/behind-the-design-of-hit-sim-game-i-oxygen-not-included-i-
[aub]: https://graduateschool.aub.ac.uk/top-news/how-a-first-time-developer-created-stardew-valley-2016-s-best-game-to-date.html
[npr]: https://www.npr.org/transcripts/g-s1-44510
[sed]: https://softwareengineeringdaily.com/wp-content/uploads/2024/10/SED1762-Factorio.txt
[fff106]: https://factorio.com/blog/post/fff-106
[mm-gd]: https://www.gamedeveloper.com/design/let-s-talk-about-mini-metro
[mm-pt]: https://www.pockettactics.com/dinosaur-polo-club/interview
[cozy]: https://lostgarden.com/2018/01/24/cozy-games/
[cozy-gd]: https://www.gamedeveloper.com/design/designing-for-coziness
[dormans]: https://ptgmedia.pearsoncmg.com/imprint_downloads/peachpit/peachpit/samplechapters/0321820274/0321820274_gamemechanics_ch05section.pdf
[faucets]: https://www.gamedeveloper.com/design/the-f-words-of-mmos-faucets
[idle1]: https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i
[idle3]: https://www.gamedeveloper.com/design/the-math-of-idle-games-part-iii
[idle-rise]: https://www.gamedeveloper.com/design/the-rise-of-games-you-mostly-don-t-play
[newleaf]: https://iwataasks.nintendo.com/interviews/3ds/animalcrossing-newleaf/0/1
[eguchi]: https://nintendoworldreport.com/interview/11229/animal-crossing-interview
[wither]: https://adriancrook.com/?p=4890
