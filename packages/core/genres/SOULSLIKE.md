# What makes a soulslike compelling

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it collects what makes a soulslike hold a player through dozens of deaths, and what separates it from a game that is only hard, for a 2D game a small indie team can build. It is not published (`package.json` `files` leaves `genres/` out), and nothing in the skills points at it yet. If a principle moves into a skill, it carries its sources with it, as [`PROTOTYPE.md`](../PROTOTYPE.md) does for `ritmo-prototype`.

It builds on the other genre docs and does not repeat them. [`PLATFORMER.md`](PLATFORMER.md) covers forgiving controls, instant retries, and Celeste's Assist Mode; [`RPG.md`](RPG.md) covers growth, builds, and failure that costs something in a long game. This file is about the soulslike's own loop: a fair, hard test, a death that teaches, something at stake, and a world that bends around the player's walls.

Each principle is stated first, then the sources behind it, quoted with a link. Most have two or more sources from different kinds of source (the makers of the games, design writers, and critics); where a principle is our own reading of several sources, it says so. Quotes were checked against the text of the linked page on 2026-11-01, read through a fetch tool (the pages could not be downloaded directly), by asking whether the exact string was on the page. A quote marked "via" was checked on that secondary page, not in the original. A long sentence is quoted in part, with "…".

## The short answer

- **The goal is accomplishment; difficulty is one way to get there.** Miyazaki: "Having the game be "difficult" was never the goal." … "What we set out to do was strictly to provide a sense of accomplishment." ([Game Informer, 2009][gi-2009]). A soulslike is a promise that the wall in front of you can be beaten by you, and that beating it will feel like it was yours.
- **Hard is a number; a soulslike is a loop.** The loop is: meet something you cannot yet beat, die, understand why, come back knowing more, with something to lose. Miyazaki calls it "death and learning as part of the core game cycle" (via [Notebookcheck][nbc-2025]). Every part of the loop has to work, and a game that only turns up the damage has the death without the learning.
- **What makes one work**, in order: deaths the player can explain; enemies whose attacks can be read and punished; actions that commit the player, so every press is a decision; a stake lost on death that can be won back; rest points that feel like relief, in a world that folds back on itself through shortcuts; more than one way past a wall; and a world that tells its story in fragments. The sections below give the sources for each.

## Where the sources disagree

- **Difficulty options.** FromSoftware refuses them: "We feel if there's different difficulties, that's going to segment and fragment the user base" (Miyazaki, [GameSpot][gs-2018]). Lies of P added easier modes two years after launch, keeping the original as the hardest, because many players "couldn't even get halfway" (Neowiz, via [eXputer][lop]). Celeste offers an Assist Mode (see [`PLATFORMER.md`](PLATFORMER.md)). What all of them agree on is narrower: there is one challenge as designed, and the player should be able to get past a wall "in some way that suits them as a player" (Miyazaki, [GameSpot][gs-2018]). FromSoftware puts those ways inside the world (summons, other paths, levels, builds); others put them in a menu. See [A wall, with ways around it](#a-wall-with-ways-around-it).
- **How much death costs.** Miyazaki holds that losing souls is "necessary to give players that sense of accomplishment" ([Game Informer, 2009][gi-2009]). Critics name the run back as the genre's worst chore: "Nothing's more discouraging than backtracking through enemies you've already defeated countless times" ([Shaw][shaw]). FromSoftware itself added resurrection to Sekiro because "We were dying a lot, and it just spoiled the game's tempo" ([Game Informer, 2018][gi-sekiro]). The principle that holds across them: the stake is real and recoverable, and the cost in time stays small enough that the next attempt starts soon. See [Something at stake](#something-at-stake-and-a-way-to-get-it-back).
- **Whether it has to be hard at all.** The Game Kitchen, before making Blasphemous: "I don't think that is absolutely necessary for an action game to be rewarding to be difficult," and "Dark Souls works the other way around, it accumulates frustration…" before releasing it as reward ([Cliqist][cliqist]). We read this as: a soulslike chooses to be hard because its reward is release from built-up tension; a game that wants a different reward does not need the difficulty.

## Accomplishment is the goal; difficulty is a means

The player chooses an activity where they will fail again and again. They keep going because failing makes them want to stop feeling incompetent, and the only way out is to get better. That is the reward a soulslike sells, and every system serves it. Difficulty that does not lead to that release (a wall with no way to learn it) is cost with no payoff.

- Miyazaki, [Game Informer, 2009][gi-2009]: "Having the game be "difficult" was never the goal." … "What we set out to do was strictly to provide a sense of accomplishment." … "Our goal of a sense of accomplishment was the basis of the game since the early stages of development,"
- Miyazaki, via [NME][nme] (from *The New Yorker*, 2022): "hardship is what gives meaning to the experience." He wants "as many players as possible to experience the joy that comes from overcoming hardship." And: "How do I make death enjoyable?"
- Miyazaki, [PlayStation Blog, 2022][ps-2022]: "But we try to design the games to make the cycle of repeatedly trying to overcome these challenges enjoyable in itself."
- Juul, *The Art of Failure* ([about the book][juul]): "Humans may have a fundamental desire to succeed and feel competent, but game players choose to engage in an activity in which they are nearly certain to fail and feel incompetent."
- Kubodera, [Game Developer][kubodera]: "Any challenge that feels fair will be satisfying to overcome."

## A death the player can explain

The test of a fair death: the player can say what killed them and what they will do differently. If they can, the death was a lesson; if they cannot ("it hit me through the wall", "I couldn't see it coming", "it was luck"), it was a punishment, and players quit over punishments. Fairness here is felt, not measured: the rules the player was taught must hold, every time.

- Miyazaki, [Game Informer, 2024][gi-2024]: difficulty "is not a matter of simply cranking up the difficulty" … "We believe in difficult games, but not games that are unjustly or unfairly so." When players are killed "and they can understand why they were killed in an instance," … the studio tries to ensure "a learning curve and a feedback loop".
- Miyazaki, [PlayStation Blog, 2022][ps-2022]: "We don't want players to feel like the game is unfairly punishing,"
- Pellen (Team Cherry) on Hollow Knight's controls, [Game Informer, 2018][gi-hk]: "any hit they take or mistake they make could have been avoided right up until the last second."
- Bycer, [Game Developer][bycer-masochism]: "The quandary and where a good designer is needed, is being able to separate hard from challenging." … "There is a fine line between creating something that is a challenge, and something that is just masochistic for the player."
- The failure, named by a critic ([Shaw][shaw]) about Sekiro: "defeating its bosses feels like more luck than skill at times".

## Enemies that read: telegraph, act, recover

Every attack has three parts the player can see: a wind-up that says what is coming, the hit, and a recovery where the enemy is open. The wind-up is the question, the dodge or block is the answer, and the recovery is the reward for answering. A visual language, once taught, must stay consistent across every enemy, and how dangerous an attack looks must match how much it hurts.

- Zhang, "Anatomy of an Enemy Attack in Dark Souls 3", [Game Developer][zhang]: the opening pose: "It's telegraphing an attack, notifying the player to prepare for a response." The attack: "Hitbox takes effect in this phase." The return is "usually the phase that gives players the Window of Opportunity". Clear phases, enough time to react, and instant input response together lay "the solid foundation for the fairness of the combat" (his reading of the Black Knight).
- Kubodera, "Designing for Difficulty: Readability in ARPGs", [Game Developer][kubodera]: "Readability is about making a fight feel fair." … "Readability can be broken down into telegraphing (what happens before) and expectations (what happens after)" … "Large gestures, color coded attacks, voice and sound cues, are all forms of telegraphing" … "It's also important that the relative damage numbers match the perceived danger."
- Steighner, [COGconnected][steighner], on what imitators do instead: "The game stripped away a lot of the tools players need for success, while unfairly giving enemies punishing abilities."

## Every action commits you

The player's own actions follow the same rule as the enemy's: an attack, a roll, or a heal plays out and cannot be cancelled at will, and a stamina meter limits how many can be chained. That turns every button press into a decision with a cost, and it is why a soulslike's fights are about timing and spacing, not speed of input. It is also what makes a death explainable: "I swung when I should have waited."

- Wikipedia, [Soulslike][wiki]: combat may require "the player to monitor stamina to avoid overexertion of their character."
- Wagar, "Treatise on Commitment in Action Games", [CritPoints][wagar]: commitment is "making a move feel like there's some weight or momentum behind it," and where attacks commit, "attack or defending must be considered more carefully as there is a greater commitment to attacks overall."
- Klepek on Salt and Sanctuary, the 2D soulslike, [Kotaku][klepek]: "You're stuck with a stamina meter that limits attacks and moves."
- The limit is responsiveness: commitment is in the length of an action, never in input lag. Pellen ([Game Informer, 2018][gi-hk]): a mistake "could have been avoided right up until the last second." Zhang ([Game Developer][zhang]) lists instant input response among the foundations of fair combat.

## Something at stake, and a way to get it back

Dying drops what the player carried (souls, Geo, salt) at the place they died. They get one chance to walk back and take it; dying on the way loses it for good. This puts tension into the walk back (the player now plays carefully, through ground they know), and gives the death a story. It works because the loss is recoverable and is never progress itself: levels, items, and opened shortcuts stay. FromSoftware went further and dropped the idea; permanent death was "going too far".

- Miyazaki, [Game Informer, 2009][gi-2009]: "if the Souls could be recovered anytime, there would be no suspense or sense of accomplishment" … the "element of failure, the fact that you can lose lots of souls when you die," was "necessary to give players that sense of accomplishment." The mindset he wanted: "I can't die until I get all those souls back."
- Wikipedia, [Demon's Souls][wiki-ds]: "One scrapped idea was to introduce permanent death, but this was seen by staff as going too far."
- Pellen on Hollow Knight's shade, [Game Informer, 2018][gi-hk]: it grew into "the idea of leaving behind a ghost of your previous life that attacks you." The 2D genre keeps the stake and makes it a small fight of its own.
- The limit, from FromSoftware itself: Sekiro's resurrection exists because "We were dying a lot, and it just spoiled the game's tempo" … but "We hope that it's not going to be something that makes the game easier; it's not going to numb the player to death." (Miyazaki, via [Game Informer, 2018][gi-sekiro], from *EDGE*.) And from a critic ([Shaw][shaw]): "Nothing's more discouraging than backtracking through enemies you've already defeated countless times". The stake is in what is lost, not in minutes of walking.

## Rest points are relief, and the world folds back to them

Checkpoints are few, and each one is an event: the relief of a safe place after danger, where the player levels up and the world resets its enemies. Between them, the level is a loop: the player pushes out, opens a shortcut back to the last rest point, and the world gets smaller. A shortcut is a reward for exploring and a way to shorten every later run back, so it does double work.

- Wikipedia, [Soulslike][wiki]: the genre's conventions are "difficult combat, hostile environments, limited checkpoints, recoverable resources lost on death".
- Wikipedia, [Bonfire (Dark Souls)][wiki-bonfire], citing the PlayStation Blog: Miyazaki's favourite addition to Dark Souls was the bonfire, a place where players "gather together and communicate – not verbally communicate, but emotionally communicate". Citing *Vice*: resting there is "receiving a badge of honor—the reason you're able to rest here is testament to what you've previously overcome."
- Klepek on Salt and Sanctuary, [Kotaku][klepek]: "The world is a large maze that gets smaller as you find shortcuts."
- Bycer on Dark Souls, [Game Developer][bycer-fog], on the cost of spacing them too far: "bonfires are placed far and away from each other, requiring the player to trek back through areas filled with enemies." Our reading, with the section above: the distance to the boss is part of its difficulty, and a shortcut should bring it down once the player has earned it.

## A wall, with ways around it

A soulslike has walls (a boss, a hard area) and the player will hit them. What keeps them playing is having choices at the wall: try again with what they learned, go somewhere else and come back stronger, change their build, call for help. Being stuck with one door and no other move is where players quit. The tools for getting past the wall should be as wide as the wall is hard.

- Miyazaki, [GameSpot, 2018][gs-2018]: "So we want everyone … to first face that challenge and to overcome it in some way that suits them as a player."
- Miyazaki on Elden Ring, [PlayStation Blog, 2022][ps-2022]: "They can come back to something later when they're at an impasse"
- Gibson (Team Cherry) on Silksong, via [Nintendo Life][nl-silksong] (reported by Dexerto): "part of allowing a higher level of freedom within the world means that you have choices all the time" … "The important thing for us is that we allow you to go way off the path." Players "have ways to mitigate the difficulty via exploration, or learning, or even circumventing the challenge entirely".
- Steighner, [COGconnected][steighner]: "Make your bosses as hard as you can, but give players an equal range of options to approach them."
- Wikipedia, citing *Wired*, 2016 ([Miyazaki][wiki-miyazaki]): the difficulty gives "a sense of accomplishment by" … "overcoming tremendous odds," which also encourages players to experiment with builds and weapons.

## Bosses are patterns to learn, each one different

A boss is the loop at its sharpest: a set of patterns the player cannot beat on sight, learns over attempts, and finally answers. Each boss asks a different question, so the player cannot win the same way twice. The pace matters both ways: patterns arrive slowly enough to be learned, and new ones keep arriving before the player is bored. What does not make a good boss is more of the same: more health, more damage, more enemies at once.

- Miyazaki, [Game Informer, 2009][gi-2009]: "I prepared different gameplay and strategies for each one so that players didn't get tired of the same fight every time." … "We wanted to surprise players and encourage them to figure out different tactics, to think on their feet."
- Kubodera, [Game Developer][kubodera]: the balancing act is "giving players enough time and information to chunk patterns" … "Most players get bored if they are deciphering patterns faster than the game introduces new ones."
- Bycer, "The Design Lessons Designers Fail to Learn From Dark Souls", [Game Developer][bycer-lessons]: "Many games that try to emulate a Souls title go for continued escalation as part of the difficulty curve." … "This often means extending combat, giving the enemy unfair or rule breaking advantages, or just overwhelming the player."

## The world tells its story in fragments

A soulslike tells its story through places, item descriptions, and a few cryptic characters, and leaves gaps. The player who wants to know more pieces it together; the player who does not can still play. This suits a small team (a line of item text is cheaper than a cutscene), and it turns exploration into a second reward next to combat: the player finds out what happened here.

- Miyazaki, via [GamingBolt][gamingbolt] (from the [PlayStation Blog, 2018][ps-2018]): "I'm a fan of stories that require you to use a little bit of your imagination in order to really understand the whole thing." As a child he read books too hard for him, "using my imagination to fill in the gaps." … "where you use your imagination to bridge those gaps."
- Wikipedia, [Soulslike][wiki]: the genre's "emphasis on environmental storytelling".
- The Game Kitchen on Blasphemous, [Cliqist][cliqist]: "Players will be able to connect the dots and make sense of the game's lore." And, via [Heavy][heavy], the aim of "a bunch of narrative layers" players uncover at their own pace.
- Gibson and Pellen (Team Cherry) on Hollow Knight, [MCV][mcv]: "The game just keeps expanding beyond what your initial expectation of it was." … "anything could be behind a broken wall or around the corner and you can't see the end of it."

## Alone, together

Even a single-player soulslike can let players feel others are going through the same thing: a message left on the floor, a glimpse of someone else's death, a summon for one boss. It makes a hard game feel shared, not lonely, and it is where the community's talk about the game comes from. FromSoftware's refusal of difficulty options rests partly on this: everyone faced the same thing.

- Wikipedia, [Demon's Souls][wiki-ds], citing *Eurogamer*, 2010: "The multiplayer mechanics were inspired by Miyazaki's experience of driving on a hillside after some heavy snow." … "Miyazaki wanted to emulate a sense of silent cooperation in the face of adversity." [Wikipedia's Miyazaki page][wiki-miyazaki] describes cars ahead slipping back "and were pushed uphill by other people in the area."
- Miyazaki, [GameSpot, 2018][gs-2018]: "We want everyone to feel elated and to join that discussion on the same level."
- This is the one part of the genre that needs a server; an indie game can keep only the cheap half (a shared message board, ghosts of other players' deaths) or skip it. Our reading, no source.

## What separates a soulslike from a game that is only hard

The critics agree on what imitators copy wrongly. Each item is the loop above with a part missing:

- **Escalation instead of a new question.** "Many games that try to emulate a Souls title go for continued escalation" ([Bycer][bycer-lessons]); "if every title tries to be the most challenging, nothing feels fun anymore" ([Shaw][shaw]).
- **Enemies that break the rules the player was taught.** "giving the enemy unfair or rule breaking advantages" ([Bycer][bycer-lessons]); "unfairly giving enemies punishing abilities" ([Steighner][steighner]).
- **Fewer tools for the player, not more.** "The game stripped away a lot of the tools players need for success" ([Steighner][steighner]).
- **Deaths that feel like luck.** "more luck than skill at times" ([Shaw][shaw]). The player cannot explain the death, so it teaches nothing.
- **Long walks back.** "backtracking through enemies you've already defeated countless times" ([Shaw][shaw]).
- **Copying the parts players disliked.** "Quite often, developers will playfully steal those elements that FromSoft's ardent players hate the most." … "Hard for hard's sake isn't actually fun." ([Steighner][steighner])
- And the positive version, from Bycer ([Game Developer][bycer-lessons]): "A Souls game does expect a level of competency on the player's part, but it does not get much harder than that." … "There is a fine line between challenging and frustrating, and a good Souls-Like knows how to straddle it."

## In 2D

The 2D soulslikes (Hollow Knight, Salt and Sanctuary, Blasphemous, Nine Sols) keep the loop and change the fight. With one axis of movement there is no circling around an enemy, so the answers to an attack become jumping over it, rolling through it, or blocking it. That makes it more important that the player can see exactly where their own body and the enemy's hitbox are, and when they pass through. The map is usually a Metroidvania (see [`PLATFORMER.md`](PLATFORMER.md), "When the game is a map"), and the rest points and shortcuts live in it.

- Klepek on Salt and Sanctuary, [Kotaku][klepek]: "Losing the ability to circle around an enemy, a hallmark of Dark Souls combat, takes some getting used to." … "there's a fluidity to Salt and Sanctuary that makes it feels faster and more dynamic". The problem he names: "it's really difficult to judge if a roll lets me move past an enemy". And: "It's both Dark Souls and its own thing."
- Red Candle on Nine Sols, [Into Indie Games][nine-sols]: the aim was to "Recreate the deflection-focused Sekiro combat experience in 2D and meld it with classic side-scrolling exploration." The fights put "an emphasis on close-range encounters and the use of deflection and charging attacks."
- Pellen on Hollow Knight, [Game Informer, 2018][gi-hk]: "any hit they take or mistake they make could have been avoided right up until the last second." Gibson: "It's a game based largely on Metroid, so the whole experience is about the joy of getting lost and finding your way."
- Wikipedia, [Soulslike][wiki]: Salt and Sanctuary's James Silva describes the genre as giving "deliberate and meaningful exploration".

## Scope for an indie team

The soulslike is costly in hand-made fights: each boss is its own design, animated and tuned by hand, and each area needs its loop of shortcuts. The 2D indie examples were made by very small teams that cut whole areas to keep the rest good.

- Pellen, [MCV][mcv]: "the core team for the vast bulk of the project was me, Ari and Dave" … "Not one or even two things in themselves were super hard, but we just kept going and going, so there was a lot of it."
- Gibson, [Game Informer, 2018][gi-hk]: cutting the Boneforest area was "totally the right thing to do".
- The Game Kitchen's producer on Blasphemous, [Game Developer][blasphemous-2]: "There were many things we had to leave behind for the first game,"

## What to prototype first

Our reading, for a game made with the `ritmo-prototype` skill: the smallest soulslike that can be fun is one enemy, one boss, and one rest point. The enemy has two or three attacks with a wind-up, a hit, and a recovery; the player has an attack, a roll, and stamina; dying drops a stake at the spot; the boss is a short walk from the rest point. If that loop is not fun with shapes, no world, lore, or build system will carry it; if it is, the rest goes on top. The question for the first round is what the player will do: "after dying to the boss, can the player say why, and do they try something different on the next attempt?"

[gi-2009]: https://www.gameinformer.com/games/demons_souls/b/ps3/archive/2009/11/05/feature-demon-s-souls-director-discusses-difficulty-sequels-and-more.aspx
[gs-2018]: https://www.gamespot.com/articles/e3-2018-from-software-explains-why-dark-souls-bloo/1100-6459827/
[gi-2024]: https://gameinformer.com/interview/2024/06/24/from-softwares-hidetaka-miyazaki-discusses-the-studios-approach-to-difficulty
[gi-sekiro]: https://www.gameinformer.com/2018/07/20/sekiro-shadows-die-twice-director-wants-players-to-constantly-feel-near-death
[ps-2022]: https://blog.playstation.com/2022/01/28/an-interview-with-fromsoftwares-hidetaka-miyazki/
[ps-2018]: https://blog.us.playstation.com/2018/07/13/interview-miyazaki-on-the-limbs-and-lore-of-sekiro-shadows-die-twice/
[gamingbolt]: https://gamingbolt.com/dark-souls-director-explains-storytelling-approach-and-why-he-likes-working-on-multiple-projects-at-once
[nme]: https://www.nme.com/news/elden-ring-creator-hidetaka-miyazaki-wants-to-make-dying-in-games-enjoyable-3170114
[nbc-2025]: https://www.notebookcheck.net/FromSoftware-s-Miyazaki-credits-gamer-desire-for-punishing-difficulty-with-birth-of-soulslike-genre.1194513.0.html
[juul]: https://jesperjuul.net/artoffailure/about.html
[wiki]: https://en.wikipedia.org/wiki/Soulslike
[wiki-ds]: https://en.wikipedia.org/wiki/Demon%27s_Souls
[wiki-bonfire]: https://en.wikipedia.org/wiki/Bonfire_(Dark_Souls)
[wiki-miyazaki]: https://en.wikipedia.org/wiki/Hidetaka_Miyazaki
[zhang]: https://www.gamedeveloper.com/game-platforms/anatomy-of-an-enemy-attack-in-dark-souls-3
[kubodera]: https://www.gamedeveloper.com/game-platforms/designing-for-difficulty-readability-in-arpgs
[bycer-lessons]: https://www.gamedeveloper.com/design/the-design-lessons-designers-fail-to-learn-from-dark-souls
[bycer-masochism]: https://www.gamedeveloper.com/design/the-fine-line-between-challenge-and-masochism-
[bycer-fog]: https://www.gamedeveloper.com/design/cutting-through-the-fog-of-dark-souls-part-one-
[wagar]: https://critpoints.net/2015/03/24/treatise-on-commitment-in-action-games/
[steighner]: https://cogconnected.com/feature/developers-youre-still-not-getting-it-hard-isnt-the-point/
[shaw]: https://gamecritics.com/gc-staff/why-im-sick-of-soulslikes/
[lop]: https://exputer.com/news/games/lies-p-difficulty-option-devs-added-later/
[gi-hk]: https://gameinformer.com/2018/10/16/the-making-of-hollow-knight
[mcv]: https://mcvuk.com/when-we-made-hollow-knight/
[nl-silksong]: https://www.nintendolife.com/news/2025/09/team-cherry-explains-hollow-knight-silksongs-steep-difficulty
[klepek]: https://kotaku.com/salt-and-scantuary-is-an-excellent-2d-dark-souls-1765572896
[nine-sols]: https://intoindiegames.com/features/nine-sols-an-interview-with-red-candle-games/
[cliqist]: https://cliqist.com/2017/06/12/diving-minds-behind-blasphemous-interview-game-kitchen/
[heavy]: https://heavymag.com.au/interview-blasphemous-the-game-kitchen/
[blasphemous-2]: https://www.gamedeveloper.com/design/making-huge-genre-specific-swings-in-blasphemous-ii
