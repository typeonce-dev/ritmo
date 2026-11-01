# What keeps RPG players going

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it is not published (`package.json` `files` leaves `genres/` out), and no skill reads it yet. It collects the principles that make a role-playing game hold a player for hours and fit together as one system, for a 2D game a small indie team can build. A later skill or playbook can quote it the way [`PROTOTYPE.md`](../PROTOTYPE.md) backs `ritmo-prototype`.

Each principle is stated first, then the sources behind it, quoted with a link. A principle with one source is marked as such; most have two or more, from different kinds of source (designers of shipped RPGs, design writers, and published psychology). Where a principle is our own reading of several sources, it says so.

Quotes were checked against the text of the linked page on 2026-11-01, read through a fetch tool (the pages could not be downloaded directly), by asking whether the exact string was on the page. A quote marked "via" was checked on that secondary page, not in the original. Quotes from Goodreads are community-entered and marked as such.

## Where the sources disagree

- **How harsh failure should be.** Supergiant set out to "take the sting out of failure" in Hades, and Dragon Quest costs half your gold, not your progress. Darkest Dungeon chose the opposite on purpose: "We set out to make you feel like there's a cost", and its designers accept that this is "alienating a lot of players". Both agree on the shape: failure costs something the player can see, and the game keeps going. See [Failure costs something and moves you forward](#failure-costs-something-and-moves-you-forward).
- **Random loot as the engine.** Diablo's designers describe "basically making a slot machine", and behaviorist research backs the steady play variable rewards produce. Self-determination research finds the long pull comes from competence, autonomy, and relatedness instead, and the Diablo designers themselves warn "anything can be exploited for good or evil". We keep variable rewards as a spice on top of growth the player earns, never the only reason to play, and never sold.
- **How long an RPG should be.** Jeff Vogel, who has shipped indie RPGs for thirty years, says "Single-player video games are too long". Idle and loot games are built to stretch the same loop for hundreds of hours. Both hold once you split loops from arcs: the story (an arc) should be short, and only a loop that keeps teaching can run long.

## The promise: you grow, and you can see it

An RPG's core promise is growth: the character gets stronger, and the player gets better at using it. Every gain has to be big enough to notice in play, the next fight should feel different because of it. A +5% that never changes how many hits a fight takes is not a reward.

- Sawyer, "Five Hard Lessons of RPG Design", GDC Europe 2011, reported by Christian Nutt ([link][sawyer-lessons]): "What you can perceive is the most important thing." … "What's the chance that a 5 percent difference is going to make you take the enemy down in one fewer hit?"
- Ryan, Rigby & Przybylski, "The Motivational Pull of Video Games: A Self-Determination Theory Approach", *Motivation and Emotion*, 2006, as reported by ScienceDaily ([link][sdt]): "the psychological 'pull' of games is largely due to their capacity to engender feelings of autonomy, competence, and relatedness." … "those that do may be the best at keeping players coming back."
- Koster, *A Theory of Fun for Game Design*, 2004 (book, via [Goodreads][koster-gr], community-entered): "Fun is just another word for learning." … "Boredom is the opposite of learning. When a game stops teaching us, we feel bored."
- Sid Meier, via Soren Johnson, "Sid's Rules", 2009 ([link][sids-rules]): "If a unit seems too weak, don't lower its cost by 5%; instead, double its strength." (On tuning, but the same reason: small changes are not felt.)

## There is always a next goal, and it is close

A player stops when nothing is pulling them forward. Keep goals running at several lengths at once (this fight, this level-up, this quest, this act), so that finishing one always leaves another nearly done. Players speed up as a goal gets close, so show how close it is. Rewards that arrive on a fixed count produce a pause right after each one, the moment players put the game down; overlapping goals and some variable rewards fill that pause. Never cut the reward rate sharply.

- Hopson, "Behavioral Game Design", Game Developer, 2001 ([link][hopson]): "The short answer is to make sure that there is always, always a reason for the player to be playing." On fixed ratios: "First there is a long pause, then a steady burst of activity as fast as possible until a reward is given." … "Having a period of time where there is little incentive to play the game can lead to the player walking away." … "Sudden loss of reward is very aversive and should be avoided when possible."
- Kivetz, Urminsky & Zheng, "The Goal-Gradient Hypothesis Resurrected", *Journal of Marketing Research*, 2006 ([pdf][kivetz]): "the illusion of progress toward the goal induces purchase acceleration (e.g., customers who receive a 12-stamp coffee card with 2 preexisting "bonus" stamps complete the 10 required purchases faster". A first level-up that comes almost at once, and an experience bar shown filling, are the bonus stamps.
- Pecorella, "The Math of Idle Games, Part I", Game Developer, 2016 ([link][pecorella]): "This is typically accomplished by having costs grow exponentially while production grows at a linear or polynomial rate." … "Early on, your production rate is high and you can keep buying, and the multipliers bump you back up whenever it gets close." This is the level curve of most RPGs, and the multiplier is the new skill, item, or area that resets the pace.
- Brevik, via Nathan Grayson, Kotaku, 2021 ([link][kotaku-loot]): "It was more that we liked the addictive feeling of just one more monster, just one more piece of loot."

## Loops carry the hours, arcs carry the meaning

An RPG is two kinds of thing. Loops (fight, loot, spend, explore) repeat and hold the hours; arcs (story, quests, a character's reveal) are spent once. Arcs burn out fast and cost the most to make, so a small team cannot pay for hours of play with content alone. Hours come from a loop that keeps teaching: new skills, enemies, and combinations that change how the same loop is played. When a skill stops having new uses, the player burns out on it, and everything built on it goes with it.

- Cook, "Loops and Arcs", 2012 ([link][cook-loops]): "Loops tend to deliver value through the act of being exercised." … "An arc is a broken loop you exit immediately." … "One of the common issues with arcs is that people burn out on them rapidly," … "The simplest method of analysis is to ask "What repeats and what does not?""
- Cook, "The Chemistry of Game Design", 2007 ([link][cook-chem]): "The player only experiences the joy of mastery for an atom only once." … "They master a new skill, they play with it but fail to find any interesting use for it." … "When a player burns out on a particular atom, the consquences [sic] ripples up and down the chain."
- Koster (above): "When a game stops teaching us, we feel bored."
- Kasavin, Inven Global interview, 2021 ([link][inven-hades]): "Another reason we chose Roguelike is that it can give different pleasures every time over repeated playthroughs." Hades runs its story (the arc) on top of a short repeated run (the loop), so each run both plays the loop and advances the arc.

## One thing the player wants, and every system feeds it

Coherence is what makes an RPG a system and not a pile of features. Pick the few things the player ultimately wants (getting stronger, seeing what is next, a character they care about) and trace every resource to one of them: gold buys gear, gear wins fights, fights give experience, experience opens skills, skills open new areas. A resource that leads nowhere the player cares about is noise, and one with no sink piles up until it means nothing. Diablo is the clean case: one pillar, loot, that every system serves.

- Cook, "Value Chains", 2021 ([link][cook-value]): "The chain terminates with an anchor node representing player motivations." … "These extract resources from the game and thus limit accumulation and pooling." … "If you don't identify how each node serves your psychological anchors, you'll very likely end up with disconnected nodes of isolated atomic meaning."
- Brevik, via Kotaku ([link][kotaku-loot]): "The game was really designed from the get-go to be about loot and about gaining that loot."
- Ryan et al., via ScienceDaily ([link][sdt]): the anchors Cook asks for are, in self-determination research, autonomy, competence, and relatedness (above).
- Our reading: Cook's chains and the self-determination needs are the same idea seen from the designer's and the player's side. A new system earns its place by feeding a chain that already ends in one of them.

## Builds are interesting decisions, and every build is supported

The player's build is their autonomy: choices with a real trade-off, whose best answer depends on the situation, and that combine into something the designer did not list. Make roles distinct, allow strong synergies, and then make sure the game gives every build things to do; a build the content never uses is a broken promise.

- Meier, GDC 2012, via Game Developer ([link][meier]): "Games are a series of interesting decisions" … interesting decisions often "involve some kind of tradeoff" … "Good decisions are situational."
- Giovannetti (Slay the Spire), "Road to the IGF", Game Developer, 2020 ([link][sts-igf]): "Allowing for combos and strong synergies is definitely a hallmark of our design process." … "when building a deck, the player would want to keep multiple things in mind." … "our replayability, even early in playtesting, was off the charts."
- Sawyer, via PC Gamer, 2026 ([link][karma]): "I want people to build characters and have a good time with them." … "however you built your character, it's not gonna be the same experience, but we're not gonna let you down," Obsidian's informal "Karma Police" go through the scripts counting how often each skill is checked.
- Avellone, "Project Eternity and Characterization", 2012 ([link][avellone]): on a companion's role, "This shouldn't overlap with another companion's specialty if you can help it."

## Failure costs something, and moves you forward

The worst RPG failure is a long-term choice the player could not judge, punished hours later (a build that cannot finish the game). Avoid that: let builds be reshaped, or warn early. A lost fight should cost something the player can see and plan around (gold, a hero, a run), so it has weight, but it should feed the next attempt: new knowledge, a story beat, a reaction from the world. Well-made failure can be the best moment in the game.

- Sawyer, "Five Hard Lessons" ([link][sawyer-lessons]): "Strategic failures are the biggest disappointing failures for players." … "you're making long-term decisions," … "but many RPGs effectively punish you for making bad choices." … "Yes, the player made the error but we placed a high demand on them."
- Kasavin, via *The Inlander*, 2021 ([link][inlander]): the team's language was to "Take the sting out of failure." … "What we find really fascinating about that genre is it is about failure and learning," GameSpot on Hades ([link][gamespot-hades]): "Progress and narrative advancement isn't tied to winning like it is in many other roguelikes."
- Kurvitz (Disco Elysium), "Choose Your Own Misadventure, Part 2", 2019 ([link][disco]): "Getting it wrong makes the game more fun." … "I think people feel closer to their character when he gets something wrong than when he gets it right." … "A mistake should affect how you react in future, by responding to what just happened."
- Horii, via Automaton, 2024 ([link][horii]): Dragon Quest takes half your gold on death, not your progress or experience, and lets you bank gold to protect it; "I decided to keep the penalty at just that,"
- Sigman (Darkest Dungeon), via GamesBeat ([link][dd-gamesbeat]): "We set out to make you feel like there's a cost." … "We didn't set out to kill everybody." Bourassa: "We're asking players to take a long view of the campaign and use their heroes as a means to an end, as opposed to ends in themselves."

## Randomness surprises, it does not decide

Variable rewards keep play steady, and a drop that could be anything is exciting, especially with a sound and a color that say "something good" before the player looks. But randomness that decides whether the player's plan worked, in a game where they can reload, only teaches them to reload. Put the dice on what the player gets and meets, not on whether a good decision pays off.

- Hopson ([link][hopson]): "Under variable ratio schedules, participants typically respond with a steady flow of activity at a reasonably high rate." … "it is more consistent and lacks the pausing that can cause trouble."
- Erich Schaefer, via Kotaku ([link][kotaku-loot]): "So the sound became kinda emblematic of "Something cool has dropped. I've gotta scour for it."" … "Gold for the uniques was specifically because it looked more important. It looked cooler."
- Sawyer, "Five Hard Lessons" ([link][sawyer-lessons]): "Mechanical chaos is frustrating." … "In some cases, where you can reload, mechanical chaos is pointless."
- The limit: Brevik, via Kotaku: "we were basically making a slot machine where every time that you killed a monster, you were pulling that lever." Schaefer: "But anything can be exploited for good or evil." ScienceDaily, summarizing Ryan et al.: "Those benefits trumped a shallow sense of fun, which doesn't keep players as interested."

## The world answers you, and some of it is beyond you

What players remember is that the world noticed them: characters who react to what they did, a choice that changes how someone speaks to them. That is the third need, relatedness, and in a single-player game it comes from characters. The world should also hold powers the player cannot control, so choices have weight against something. A kind choice that costs nothing means nothing.

- Ryan et al., via ScienceDaily ([link][sdt]): relatedness, alongside competence and autonomy (above).
- Kasavin, Inven Global ([link][inven-hades]): "We always want players to get deeper into the characters and the lore we created after repeated plays" GameSpot ([link][gamespot-hades]): "With every return to the House of Hades, players will hear new dialogue from characters like Achilles and Hades;"
- Sawyer, on Pentiment, Game Developer, 2026 ([link][pentiment]): RPGs are "at their best" when players can control a lot but "can't control everything" around them; "there are still going to be powers that are beyond you."
- Toby Fox, "The making of Undertale", PC Gamer, 2018 ([link][undertale]): "In games, I noticed that the 'good path' was sometimes the easiest one," … "But if you do things without effort, then it doesn't feel meaningful."
- Avellone ([link][avellone]): "The player should feel that they are gaining something of value from the interaction, even if the interaction isn't mandatory"

## Indie scope: short, small, and different

Every principle above has to fit a small team. Keep the story short and the cast small (players forget most factions); words are cheap to write but must be edited; choose a corner of the genre few others are making; and tune the loop with real play data and many playtests, early, in public if you can.

- Vogel, "Tips For Writing a Video Game Story That WORKS", 2024 ([link][vogel-story]): "Single-player video games are too long." … "Every minute a player spends away from the story is a minute of forgetting the story." … "Don't make a game bloated with nations and factions and characters and settings." … "This is particularly a plague in RPGs."
- Vogel, via PC Gamer, 2016 ([link][vogel-pc]): "you need to do that work in an area that a thousand people aren't doing already" … "I think there is always a peril in flooding the player with words." … "You can almost always make a piece of writing better by shortening it."
- Kasavin, Inven Global ([link][inven-hades]): "We only have about 20 people on our team." … "Hades probably would not show the same level of perfection if it had been developed in the traditional way" (on Early Access).
- Giovannetti ([link][sts-igf]): "From there, it is all about rigorous and extensive playtesting and iteration." Slay the Spire's GDC 2019 talk, as announced by Game Developer ([link][sts-metrics]): the team "took a metric-driven focus early in development."

## What to prototype first

Our reading, for a game made with the `ritmo-prototype` skill: the smallest RPG that can be fun is one loop and one chain. A fight, a reward, a place to spend it, and a next fight that the spend visibly changes. If that loop is not fun with shapes, no amount of story or content will carry it (Cook's loops carry the hours); if it is, the arcs, the cast, and the build space go on top, each traced to what the player wants. The question for the first round is what the player will do: "after a level-up, does the player play the next fight differently?"

[sawyer-lessons]: https://www.gamedeveloper.com/design/gdc-europe-obsidian-s-five-hard-lessons-of-rpg-design
[sdt]: https://www.sciencedaily.com/releases/2006/12/061226134706.htm
[koster-gr]: https://www.goodreads.com/author/quotes/10980.Raph_Koster
[sids-rules]: https://www.designer-notes.com/?p=119
[hopson]: https://www.gamedeveloper.com/design/behavioral-game-design
[kivetz]: https://business.columbia.edu/sites/default/files-efs/pubfiles/1200/goalgradient.pdf
[pecorella]: https://www.gamedeveloper.com/design/the-math-of-idle-games-part-i
[kotaku-loot]: https://kotaku.com/why-video-game-loot-is-so-addictive-according-to-the-c-1846695147
[cook-loops]: https://lostgarden.com/2012/04/30/loops-and-arcs/
[cook-chem]: https://www.gamedeveloper.com/design/the-chemistry-of-game-design
[cook-value]: https://lostgarden.com/2021/12/12/value-chains/
[inven-hades]: https://www.invenglobal.com/datalab/articles/14783/supergiant-games-how-indie-developers-made-goty-hades
[meier]: https://www.gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions
[sts-igf]: https://www.gamedeveloper.com/disciplines/road-to-the-igf-mega-crit-games-i-slay-the-spire-i-
[sts-metrics]: https://www.gamedeveloper.com/design/learn-i-slay-the-spire-i-s-metrics-driven-approach-to-game-balancing-at-gdc-2019
[karma]: https://www.pcgamer.com/games/fallout/fallout-new-vegas-director-josh-sawyer-says-obsidian-has-karma-police-who-go-through-the-game-making-sure-every-skill-gets-enough-cool-stuff-to-do-were-not-gonna-leave-you-out-to-dry/
[avellone]: https://www.gamebanshee.com/kahp
[inlander]: https://inlander.com/culture/hades-writer-greg-kasavin-on-how-he-made-video-game-deaths-drive-a-feel-good-story-22725237
[gamespot-hades]: https://gamespot.com/articles/hades-changes-what-it-means-to-be-a-roguelike/1100-6483420/
[disco]: https://discoelysium.com/devblog/2019/07/23/choose-your-own-misadventure-part-2
[horii]: https://automaton-media.com/en/news/dragon-quest-creator-yuji-horii-finally-reveals-why-you-lose-half-your-money-when-you-die-in-the-games/
[dd-gamesbeat]: https://gamesbeat.com/darkest-dungeon-designers-really-arent-sadists-were-realists/3/
[pentiment]: https://www.gamedeveloper.com/design/pentiment-director-emphasizes-the-importance-of-rpg-players-not-controlling-everything
[undertale]: https://www.pcgamer.com/the-making-of-undertale/
[vogel-story]: https://bottomfeeder.substack.com/p/tips-for-writing-a-video-game-story
[vogel-pc]: https://www.pcgamer.com/how-one-indie-developer-has-kept-the-classic-crpg-alive-for-20-years/
