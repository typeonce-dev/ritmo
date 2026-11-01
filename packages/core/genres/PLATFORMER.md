# What makes a platformer work

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it collects the principles shared by 2D platformers that an indie team can build, each one traced to the people who made or studied those games. It is not published (`package.json` `files` leaves `genres/` out), and nothing in the skills points at it yet. If a principle moves into a skill, it carries its sources with it, as [`PROTOTYPE.md`](../PROTOTYPE.md) does for `ritmo-prototype`.

Every principle below has at least two sources, or one maker speaking about their own game plus a second that agrees from another game. Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. A principle states what holds across the genre and leaves the numbers to the game: a fixed jump height, a level template, or a step-by-step recipe does not go in, even with a source.

## The short answer

- **The core is movement through space, under real-time control.** A platformer's "core objective is to move the player character between points in an environment" ([Wikipedia][wiki]), and what the player feels is "the tactile sensation of manipulating a digital agent" ([Swink][swink]). The jump is the verb, the level is the opponent, and the challenge is getting from here to there.
- **It is not mostly a puzzle.** Puzzle-platformers (Braid, Limbo) are one branch, where the challenge is knowing what to do and doing it is easy: Carlsen on Limbo, "It's very important that the correct solution is fairly easy to execute" ([Carlsen][carlsen]). Most platformers are the opposite: the player knows exactly what to do (the goal is in sight) and the challenge is doing it. A third branch tests navigation (Metroidvanias: where to go), a fourth adaptation (Spelunky: unseen levels). A game picks which of these it tests, and keeps the others easy.
- **What makes one work** is, in order: a character that feels good to steer before any level exists; small forgiveness rules that bend the physics toward what the player meant; levels that introduce one idea at a time and then twist it; failure that costs seconds, not minutes; and a camera that shows what is coming. The sections below give the sources for each.

## Where the sources disagree

- **How much the game forgives.** Celeste and Super Meat Boy remove almost every cost of failure; Shovel Knight keeps a cost (dropped gold) and Spelunky makes a run the cost. Both work. The principle that holds across them is narrower: a failure must teach, and its cost must match what the game tests (an execution game makes retries instant; a run-based game makes the run the stake).
- **Hand-made levels or generated ones.** Most of the sources design every screen by hand. Spelunky generates them, and gains a different game: "not allowing you to master the stages means you'll need to master the mechanics instead" (GMTK on Spelunky, [link][gmtk-spelunky]). Generation is a choice of what the game tests, not a shortcut to content; it still needs hand-made rooms and a guaranteed path.
- **Rhythm as the organising idea.** Rhythm explains linear levels well (Mario, Sonic), but Whitehead notes that in Super Metroid "the notion of rhythm is no longer the guiding principle" ([Whitehead][whitehead]). Exploration games are paced by the map instead.

## The character comes first

### Feel the character in an empty room before building a level

- Swink, "Game Feel: The Secret Ingredient", 2007 ([link][swink]): "The tactile sensation of manipulating a digital agent." … "Moment to moment, it just feels good to steer around and feel out the space."
- Monteiro, "The guide to implementing 2D platformers", 2012 ([link][monteiro]): "One of the factors that affects the feel of a platformer the most is the acceleration of the character." Too little makes the character "feel "slippery", and can be hard to master."
- Liz England's review of Swink's *Game Feel* ([link][england]): "Game feel, as the author defines it, is a Venn diagram of real-time response, simulated space, and polish." Real-time means a game "that responds within a correction cycle" "of under 100 milliseconds".

### Design the jump by its shape, not by its physics

The designer chooses how high and how far the jump goes, and how long it takes; gravity and launch speed are derived from those. The rise and the fall are tuned apart.

- Pittman, "Math for Game Programmers: Building a Better Jump", GDC 2016, via [Patterson's GDC notes][patterson]: "If a gap distance and maximum height are known, the value of g and v_y can be calculated so that it is possible for the character to complete the jump." … "Mario's jump physics included increasing the acceleration due to gravity by a factor of three once the jump reached it's maximum height."
- Brown, GMTK Platformer Toolkit, "Behind the Code", 2022 ([link][gmtk-toolkit]): "The jumping panel allows us to define Kit's jump by two simple numbers: how high should she jump" … "if Kit's velocity is negative (i.e, she's falling), we kick on the downward gravity multiplier."

### The player controls how high they jump

- Swink ([link][swink]) on Super Mario Bros.: "In addition, holding down the jump button longer meant a higher jump, another kind of sensitivity: across time."
- Brown ([link][gmtk-toolkit]): "Variable jump height means the height of your jump is determined by how long you hold down the button." … "make it so the character drops when you let go of the jump button."

### Bend the rules in the player's favour, invisibly

Small windows that turn a near-miss into what the player meant: a jump just after leaving a ledge, a jump pressed just before landing, a nudge around a corner the head clipped, a softer peak while the button is held. The player never sees them; they only notice when they are missing.

- Thorson, "Celeste & Forgiveness", 2020 ([link][thorson-forgive]): "You can still jump for a short time after leaving a ledge." … "If you press and hold the jump button a short time before landing, you will jump on the exact frame that you land." … "If you bonk your head on a corner, the game tries to wiggle you to the side around it." … "If you hold the jump button, the top of your jump has half gravity applied." … "so that everything is fudged a tiny bit in the player's favor." … "I think that this is a big reason why Celeste can feel kind even though it's very difficult — it wants you to succeed."
- Brown ([link][gmtk-toolkit]), the same two windows in a second game: "you can still jump even if you've just run off the edge of a platform." … "we can press jump a few frames before hitting the ground".

### Collision is simple, and moves one axis at a time

For an indie 2D platformer the world is a tile grid with smooth (not tile-stepped) movement; per-pixel terrain is a cost to choose only when the game needs it.

- Monteiro ([link][monteiro]): "I can think of four major ways in which a platform game can be implemented." (tile-based pure, tile-based smooth, bitmask, vectorial). "Decompose movement into X and Y axes, step one at a time." On bitmask terrain: "I only recommend it if you absolutely must have detailed terrain."
- Thorson ([link][thorson-forgive]) lists the forgiveness rules as small adjustments to exactly this kind of axis-by-axis movement (a sideways wiggle when moving up, a pop-up when moving sideways).
- Ritmo: `@typeonce/ritmo-math` has `Box2` boxes and `Collide2`, which sweeps a circle; a platformer's box-against-tiles step, one axis at a time, is the game's own code today. A fact about the library, not a design claim.

## The camera shows what is coming

- Keren, "Scroll Back: The Theory and Practice of Cameras in Side-Scrollers", 2015 ([link][keren]): the camera's job is "choosing what the player needs to see" and "how to do it in a way that's fluid and comfortable for the player". On Sonic: "the player must always maintain a clear vision of what's quickly coming ahead".
- Keren ([link][keren]) on the common tools: a window that pushes the camera only "as the player hits the window edge"; platform snapping, where the "Camera snaps to the player only as it lands on a platform" (so jumps do not bob the view); and forward focus, "Extra view space in the principal progression direction".
- McMillen, Super Meat Boy postmortem, 2011 ([link][smb-post]): "keep the goal always in sight." A level designed to fit one screen needs no camera work at all; Celeste's rooms and Super Meat Boy's levels are built so the whole challenge is visible.

## Levels teach without words

### Introduce one idea, develop it, twist it, then let the player show mastery

- Hayashida, via Kohler, "The Secret to Mario Level Design", 2012 ([link][hayashida]): "First, you have to learn how to use that gameplay mechanic" … "the stage will offer you a slightly more complicated scenario in which you have to use it." … "And then the next step is something crazy happens that makes you think about it in a way you weren't expecting." … "And then you get to demonstrate, finally, what sort of mastery you've gained over it,"
- Miyamoto, via "How Miyamoto built Super Mario Bros.' legendary World 1-1", 2015 ([link][miyamoto]): the first level holds everything the player needs to "gradually and naturally understand what they're doing", so that they "learn what the game is all about" and can "start to play more freely."
- Brown, GMTK, "How Jonathan Blow Designs a Puzzle" ([transcript][gmtk-blow]), on Braid's stages: "Most are about exploring just one idea", and "the stages are small enough so you can consider all the moving parts at once".

### Pace a level in beats: effort, then rest

- Sorenson & Pasquier, "The Evolution of Fun", ICCC 2010 ([text][sorenson]): "A rhythm group is considered a fundamental unit in platform level design," which "consists of a moment of high challenge followed by a moment of low challenge." … "Clearly, variation in a level's challenge is desired."
- Smith, *Expressive Design Tools*, PhD thesis, 2012 ([pdf][smith]), on a Super Mario World level: "The rhythm groups are separated by a platform where no action is required to be taken, allowing the player a brief rest". The rhythm is "the rhythm the player feels with her hands while playing".
- Whitehead ([link][whitehead]): in "2D platform games such as Super Mario World and Sonic the Hedgehog" "the notion of player rhythm explains much about level design".

### A route the game does not want taken looks obviously impossible

- Thorson, GDC 2017 level design talk, via Vida Extra ([link][vidaextra], Spanish; translated here): when testers kept trying a route that could not be done, it was not enough for it to be impossible, it had to be *obviously* impossible ("No bastaba con que fuese imposible. Tenía que ser obviamente imposible."); the fix was more and taller spikes, not a new layout.
- Carlsen on Limbo, via [Game Developer][carlsen]: wrong approaches should clearly show they are wrong, because players get attached to near-solutions (the article's paraphrase, not a quote).

## Failure costs seconds, and teaches

- McMillen, Super Meat Boy postmortem ([link][smb-post]): "Remove lives, reduce respawn time, keep the levels short and keep the goal always in sight." … "Frustration was the biggest part of retro difficulty and something we felt needed to be removed at all costs" … "The replay feature was a way to remind the player that they were getting better through their own actions".
- McMillen, "Why So Hard?", 2010 ([link][smb-hard]): "The time it takes for Meat Boy to die and respawn is almost instantaneous." … "It was very important that the levels in Super Meat Boy be bite-sized." … "Removing lives altogether lets the designer base difficulty more on the actual level design and challenge" … "When you are trying to teach someone something, you don't punish them when they make a mistake." … "The player should always feel good about completing something hard".
- Carlsen on Limbo ([link][carlsen]): "We wanted the player to die a lot in this game, I think it really works with the theme." … "You don't ever really get penalized for dying, it's just how the game plays."

## Difficulty is the experience, and the player can still change it

- Celeste's Assist Mode screen, via [Vice][vice]: "Celeste was designed to be a challenging, but accessible game." "We believe that its difficulty is essential to the experience." "We recommend playing without Assist Mode your first time." "However, we understand that every player is different."
- Thorson, via [Vice][vice]: "In Celeste, we try to gently push the player to do things that they thought was impossible for them," … "We also accept that every player is different, and that people come into the game at many different skill levels."
- McMillen ([link][smb-hard]): "The player should always feel good about completing something hard". The hard path is the main path; options that lower it are the player's choice, offered plainly, never a penalty.

## When the game is a puzzle

The puzzle-platformer keeps the jump simple and makes the challenge an idea. Its own rules:

- **Each idea is surprising, or it is cut.** Blow, via GMTK ([transcript][gmtk-blow]): designing Braid felt more like "discovering things that already exist than it was like creating something new and arbitrary". Brown's narration: Blow would "edit out mechanics, rules, and puzzles that lack a sense of surprise", and "killed off rules, like Braid's weird turn-based world, because their consequences weren't surprising".
- **Ideas come from the mechanic, found by building it.** Blow ([transcript][gmtk-blow]): "more ideas came out of the development process". Brown's narration: "In the process of coding that, new ideas emerged."
- **Hard to see, easy to do.** Carlsen ([link][carlsen]): "It's very important that the correct solution is fairly easy to execute," and "Getting that balance right is really important in making a puzzle game that's entertaining to play."

## When the game is a map

A Metroidvania tests navigation: where to go, and what the player can now reach.

- **Connect areas generously; soften hard gates.** Gibson and Pellen (Team Cherry), via PC Gamer, "How to design a great Metroidvania map" ([link][pcgamer]): "We chipped away at a lot of the hard gating in the game" … "It's super annoying to get to a point that's 2 centimeters from somewhere you want to be and you can't get there." … "One of the things we were really keen on is getting as many connections between areas as we could."
- **Getting lost is allowed, staying lost is not.** Pellen ([link][pcgamer]): "if you do get lost, if you explore you'll eventually find your way."
- **Discovery is new things, not more collectibles.** Gibson ([link][pcgamer]): "discovery, for us, doesn't just mean finding 500 flags or something." "It means actually coming upon unique sights, unique characters, unique systems". Skilled players get their own reward: "There's flying enemies we put in specifically so you can bounce off them and skip bits, as well."
- Whitehead ([link][whitehead]): here "the notion of rhythm is no longer the guiding principle"; the map paces the game.

## When the levels are generated

- **Generated levels make the player master the mechanics, not the stages.** GMTK on Spelunky ([transcript][gmtk-spelunky]): "not allowing you to master the stages means you'll need to master the mechanics instead."
- **Every generated level is beatable without help.** GMTK on Spelunky ([transcript][gmtk-spelunky]): "What you end up with is a guaranteed path through the level" "that you'll always be able to get through without using ropes or bombs." Rooms come from hand-made templates, partly randomised: "Next, each room is randomly given a template." "But these templates are not set in stone, and parts of them are randomly generated."
- **Randomness alone is a slot machine; systems make it a game.** Yu, via Game Developer ([link][yu]): "In a game with randomized levels, people will keep playing just to see what comes up." "But to make it more than a glorified slot machine requires putting together a collection of systems and rules". Yu, via GMTK ([transcript][gmtk-spelunky]): "I wanted to force [the player] to make difficult decisions and experience both the satisfaction of choosing correctly" "and the regret of choosing poorly".

## Scope for an indie team

- **Constraints are chosen, and broken where they hurt play.** Yacht Club Games, "Breaking the NES for Shovel Knight", 2014 ([link][shovel]): "Instead of emulating the NES exactly, we would create a rose-tinted view of an 8-bit game." … "we decided to eliminate any drawback that would hamstring the gameplay experience." … "we tried to avoid cluttering the screen with onscreen objects".
- **Small rooms, many of them.** Super Meat Boy's "bite-sized" levels ([link][smb-hard]) and Braid's stages, "small enough so you can consider all the moving parts at once" ([transcript][gmtk-blow]) are cheaper to build, faster to retry, and easier to read than long ones.
- **Finishing is its own skill.** Yu, via Game Developer ([link][yu]): "finishing is a skill as much as being able to design, draw, program, or make music" … "Remember that the last 10% is the last 90%. You're never as close to being finished as you think you are."

[wiki]: https://en.wikipedia.org/wiki/Platformer
[swink]: https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient
[england]: https://lizengland.com/blog/review-game-feel-by-steve-swink/
[monteiro]: https://devnehe.gamedev.net/tutorials/programming/general-and-gameplay-programming/the-guide-to-implementing-2d-platformers-r2936
[patterson]: https://blogs.jccc.edu/dpatter/2016/03/15
[gmtk-toolkit]: https://gmtk.itch.io/platformer-toolkit/devlog/395523/behind-the-code
[thorson-forgive]: https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html
[keren]: https://www.gamedeveloper.com/design/scroll-back-the-theory-and-practice-of-cameras-in-side-scrollers
[hayashida]: https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design
[miyamoto]: https://gamedeveloper.com/design/how-miyamoto-built-i-super-mario-bros-i-legendary-world-1-1
[gmtk-blow]: https://amara.org/subtitles/LaGKzzSXnuQl/en-gb/1/download/How%20Jonathan%20Blow%20Designs%20a%20Puzzle%20%20Game%20Makers%20Toolkit.en-gb.txt
[sorenson]: https://kt.ijs.si/senja_pollak/CC_resources/corpus/Proc_folders/2010/2010_30.txt
[smith]: https://escholarship.org/content/qt0fn558gq/qt0fn558gq.pdf
[whitehead]: https://eis-blog.soe.ucsc.edu/2010/11/analyzing-level-design-a-genre-specific-approach-depaul-friday/
[vidaextra]: https://vidaextra.com/aventura-plataformas/creadores-celeste-pusieron-pinchos-mortales-a-mala-leche-niveles-para-enganarte-forma-brillante-posible
[carlsen]: https://www.gamedeveloper.com/game-platforms/gdc-europe-i-limbo-i-s-carlsen-on-making-players-your-worst-enemy-and-your-best-friend
[smb-post]: https://www.gamedeveloper.com/audio/postmortem-team-meat-s-i-super-meat-boy-i-
[smb-hard]: https://www.gamedeveloper.com/game-platforms/-i-super-meat-boy-i-s-mcmillen-explains-why-so-hard-
[vice]: https://www.vice.com/en/article/celeste-difficulty-assist-mode
[pcgamer]: https://pcgamer.com/how-to-design-a-great-metroidvania-map
[gmtk-spelunky]: https://amara.org/subtitles/p6MHlmreohsY/en-gb/1/download/How%20and%20Why%20Spelunky%20Makes%20its%20Own%20Levels%20%20Game%20Makers%20Toolkit.en-gb.txt
[yu]: https://www.gamedeveloper.com/design/how-i-spelunky-i-got-its-procedural-hook-actually-got-finished
[shovel]: https://www.gamedeveloper.com/design/breaking-the-nes-for-shovel-knight
