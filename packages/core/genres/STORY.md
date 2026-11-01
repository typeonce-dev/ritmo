# What makes a story game work

This file is research for the maintainers and the agents working on this repo, written the way [`PROTOTYPE.md`](../PROTOTYPE.md) is: each principle is stated once and backed by people who make these games, quoted with a link. It is not published (`package.json` `files` leaves `genres/` out) and no skill reads it yet. If a skill later takes a rule from here, the rule keeps its sources.

The genre here is games where the story is the reason to play: mysteries and deduction, games of talking to characters, and games where what you learn or choose drives what happens. The focus is 2D and what a small indie team can build. Big-budget examples appear only where the principle carries over to a small game.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. Quotes are kept short on purpose; read the page for the full argument.

## The principles in one list

1. In a mystery the player makes the deduction, not the character.
2. Play fair: every step of the answer is shown, and every answer makes sense.
3. Give each conclusion more than one way in.
4. Check answers in a way that rewards reasoning and defeats guessing.
5. Knowledge is the progression: the player advances by understanding, and curiosity is the objective.
6. Let the player pull the story out of the world, and let some of it be missable.
7. Tell the player what is coming: suspense needs information.
8. Choices matter by being acknowledged, not by branching forever.
9. Characters notice what the player did, and say so.
10. Failure moves the story on; it never locks the player out.
11. The verbs are the story: what the player does must agree with what the story says.
12. A story worth replaying gets deeper each time, not just different.
13. Build the story out of small pieces, so it can grow and be tested in slices.

## Mystery and deduction

### 1. The player makes the deduction, not the character

The difference between a detective game and a game about a detective. The fun is the "aha", and it only happens in the player's head. A game that solves the case once the player has clicked every hotspot has put the detective costume on a checklist.

- Klavins (Color Gray Games, *The Case of the Golden Idol*), via Rose, Thinky Games, 2024 ([link][thinky-idol]): "Games geared towards you making the deductions," … "not you roleplaying someone who's making the deductions."
- Klavins, in Couture, Game Developer, 2022 ([link][gd-idol]): "Those precious "Aha!" moments are something that we strived for."
- Diaz, "We Are Terrible Detectives", Game Developer, 2018 ([link][diaz]): "Most games out there about being a detective only get the dressing right" … "Every single detail in your game could be narrowing the possibilities and guiding the player."
- Barlow on *Her Story*, in Game Informer, 2015 ([link][barlow-gi]): "You're heavily involved in it, you're thinking a lot inside and outside of the game."

### 2. Play fair: every step is shown, every answer makes sense

The rules of the Golden Age detective novel apply unchanged: the player can only be asked to work out what they were shown. An answer that needed a clue they never saw, or a leap only the designer would make, reads as the game cheating.

- Knox, "Detective Story Decalogue", 1929 ([link][knox]), rule 1: "The criminal must be someone mentioned in the early part of the story" … rule 6: "No accident must ever help the detective, nor must he ever have an unaccountable intuition which proves to be right."
- Gilbert, "Why Adventure Games Suck", 1989, via Maher, The Digital Antiquarian, 2017 ([link][gilbert]): "Puzzles and their solutions need to make sense." … "They don't have to be obvious, just make sense."
- Kohler, Kotaku review of *Obra Dinn*, 2018 ([link][kotaku-obra]): "There is enough information to figure everything out without guessing—but it's just enough information." The same review's complaint ("it can take a little bit of guessing what the game wants you to say") is where fairness slips: the player knows the answer but not the game's word for it.

### 3. Give each conclusion more than one way in

Players miss clues, and players who found the clue still miss the deduction. A mystery with one path to each conclusion stalls on the first miss. This comes from tabletop mystery design, but a game's designer is a game master who cannot improvise, so it applies harder.

- Alexander, "Three Clue Rule", The Alexandrian, 2008 ([link][three-clue]): "*For any conclusion you want the PCs to make, include at least three clues.*" … two ways it breaks: "failing to find a particular clue" and "The PCs could fail to make the correct deduction."
- Alexander, same page, on stuck players: "You specifically want to have the event give them a new clue (or, better yet, multiple clues)".
- Diaz ([link][diaz]): "Usually it's either complete the puzzle or get stuck forever."

### 4. Check answers so reasoning wins and guessing loses

How the game says "right" is the mechanic of a deduction game. Telling the player instantly whether each answer is right turns deduction into trial and error. Telling them only when the whole case is solved leaves them lost. The two games most cited by the genre each found a middle: confirm in groups, or say how close the player is without saying where.

- *Return of the Obra Dinn* (Pope, 2018), via Wikipedia ([link][wiki-obra]): "to deter guesswork, correct fates are validated only in sets of three". "Figure it Out", Unwinnable, 2018 ([link][unwinnable-obra]) on what that does to the player: "You're never quite sure if you've gotten a handle on what happened in a given scene".
- Klavins ([link][gd-idol]), on *Golden Idol*'s fill-in-the-blank answers: "evaluating the whole puzzle as wrong or right frustrated the players" … "Thus, we settled on adding the indicator "two or fewer slots are incorrect"." And why it is limited: "Given the opportunity, players will optimize the fun out of a game".
- The answer format itself is part of this. *Golden Idol* hands the player words to place ("here is a bunch of phrases, where do you think they fit?", [link][gd-idol]); a strong decoy among them is deliberate: "We also added a strong red herring (the bloody writing on the wall)."

## Story driven by learning

### 5. Knowledge is the progression; curiosity is the objective

In the strongest story games of the last decade, the thing that unlocks the next part is an idea in the player's head, not an item or a stat. This is the cheapest kind of progression an indie can build (no new mechanics, just new understanding), and the one players remember. The game's job is to make the player ask questions, and to plant the next question in each answer.

- Beachum on *Outer Wilds*, Game Developer, 2015 ([link][beachum]): an open world "where the sole purpose of exploration is to answer questions about the world you're in" … "I wanted to avoid giving players explicit objectives without making the game feel aimless." … characters "incite player curiosity by telling stories of distant places".
- Kasavin on *Hades*, in Graft, Game Developer, 2021 ([link][kasavin-gd]), on what survives a lost run: "there is in fact, something that you carry forward, which is your knowledge of the mechanics in the game".
- Barlow on *Her Story* ([link][barlow-gi]): the story works by "chopping it up in the database and finding it in this disordered fashion".

### 6. Let the player pull the story out of the world, and let some of it be missable

A story told by the room the player is standing in (what is broken, what was left behind) is read, not watched, and the player who reads it feels it as their own discovery. That only works if it is possible not to see it. In 2D this is the cheapest storytelling there is: one tile, one prop, one line on an examined object.

- Smith & Worch, "What Happened Here? Environmental Storytelling", GDC 2010, via Nieman Storyboard, 2011 ([link][smith]): environmental storytelling "fundamentally integrates player perception and active problem solving, which builds investment." … "The player is pulling the narrative." … "You walk past it, you observe the scene, and you infer what happened."
- Same talk ([link][smith]): "It has to be possible to miss some things to make finding them meaningful." … and against filler: "Every anonymous environmental storytelling moment wastes the opportunity to say something about the game."
- Barlow ([link][barlow-gi]), on leaving the answer partly open: "I don't want to give you everything, where you can neatly put it in a box and forget about it," … "That way it continues to percolate in your head".

### 7. Tell the player what is coming: suspense needs information

A mystery tempts the designer to hide everything until the twist. Hitchcock's point is that hiding buys a moment of surprise, while telling buys a long stretch of tension. In a game this is the clock the player can see, the suspect the player knows is lying, the loop the player knows will end.

- Hitchcock, in Truffaut's *Hitchcock/Truffaut*, 1966 (book, via [No Film School][hitchcock]): "There is a distinct difference between 'suspense' and 'surprise,'" … "we have given the public fifteen seconds of surprise at the moment of the explosion." … "we have provided them with fifteen minutes of suspense." … "The conclusion is that whenever possible the public must be informed."

## Choice and characters

### 8. Choices matter by being acknowledged, not by branching forever

A tree that branches at every choice doubles its writing with each one, and most players never see most of it. The structures that ship rejoin the branches and carry the choice forward as state: the story goes through the same events, and the choices change how they play and what is said about them. inkle's point goes further: much of what makes a choice feel real is the act of choosing and the game noticing it.

- Ashwell, "Standard Patterns in Choice-Based Games", 2015, via IFWiki ([link][ashwell]): branch and bottleneck: "The game branches, but the branches regularly rejoin, usually around events that are common to all versions of the story." … "To avoid obliterating the effect of past choices, branch-and-bottleneck structures almost always rely on heavy use of state-tracking." And on the fully branching "time cave": "Even with multiple playthroughs, most players will probably miss a good deal of the content."
- Short, "Beyond Branching", 2016 ([link][short-bb]), on combinatorial branching, "where as an author you're punished for writing new content".
- inkle, "Just being there", 2012 ([link][inkle-there]): "But do the choices affect the story? Yes. Of course they do." … "Partly because you're performing the act of choosing." … "that's the point of the interactivity - to conjure up the moments in which the story occurs."

### 9. Characters notice what the player did, and say so

The cheapest reactivity is a character mentioning it. *Hades* is the indie benchmark: a small team, a simple system that picks a line whose conditions match what just happened, and conditions added as the game grew. Levine's version for systemic games: give each character a few visible likes and dislikes, and let the player's actions move them.

- Kasavin on *Hades*, via GameSpot, 2020 ([link][kasavin-gs]): "What would these characters talk about and what would they notice? Add those interactions." … "It's a simple system at heart, we just kept adding more types of conditions to check against as the game grew."
- Kasavin, Game Developer ([link][kasavin-gd]): "every time you run into a boss, they remember, you start keeping a tally of who won this time, who won last time."
- Short ([link][short-bb]) on salience-based dialogue, which picks "a bit of content out of a large pool depending on which content element is judged to be most applicable at the moment", and its effect: "the NPCs were changing what they said based on your input".
- Levine, "Narrative Legos", GDC 2014, as summarized by Game Informer ([link][levine]): characters have passions "obvious to the player" that "respond to the player's actions"; replay comes from choices where helping one character hurts another. (A summary, not his words.)

### 10. Failure moves the story on; it never locks the player out

In a story game, a failed check, a wrong accusation, or a lost fight is more story, not a reload. It is often the best story: the character the player gets wrong is the one they remember. What a failure must never do is cut the player off from the rest of the game or force a restart to see it.

- Kurvitz on *Disco Elysium*, ZA/UM devblog, 2019 ([link][disco]): "Getting it wrong makes the game more fun." … "I think people feel closer to their character when he gets something wrong than when he gets it right." … "You never prevent them from accessing a part of the game." … "A mistake should affect how you react in future, by responding to what just happened."
- Gilbert, 1989, via Maher ([link][gilbert]): "Danger is inherent in drama, but danger should be survivable if the player is clever." … "Never require a player to pick up an item that is used later in the game".
- Diaz ([link][diaz]): "Why aren't we allowing players to fail?" … "It should all be about giving players yet more freedom, even if that means they might fail."
- Kasavin, Game Developer ([link][kasavin-gd]): "There's nothing more frustrating in games where you're really engaged with the story" … "So we try to build systems into our games that mitigate those kinds of moments". *Hades* makes each death the way back to the characters, so losing is progress in the story.

## Story through play

### 11. The verbs are the story

What the player does over and over says more than any cutscene. When the rules and the plot pull in different directions, the player feels it. When they agree, a small game with almost no text can carry a large story: *Papers, Please* is a stamping job that becomes a moral story because the job itself is where the choices are.

- Hocking, "Ludonarrative Dissonance in Bioshock", 2007 ([link][hocking]): "Bioshock seems to suffer from a powerful dissonance between what it is about as a game, and what it is about as a story."
- Pope on *Papers, Please*, in Alexander, Game Developer, 2013 ([link][pope-papers]): "The bureaucratic structure is something that fits naturally," … "This system made it easy to interleave scripted encounters with fully or partially-random ones." … "If you put enough of those together, the choices start to build up".
- Crawford's verb test, already in [`PROTOTYPE.md`](../PROTOTYPE.md) ([link][crawford]), applies directly: "write down all the verbs available to the player … I can tell you exactly what that game is about".

### 12. A story worth replaying gets deeper each time, not just different

Most players never replay a story game to see the other branch. The ones that are replayed reward the second time with understanding: the player now sees what the first time meant.

- Ingold (inkle), in Shoemaker, MCV/Develop, 2023 ([link][ingold-replay]): "in a game, it's extremely rare to have a narrative where you want to actively go through the same storyline again." … "We talk a lot about New Game Plus for mechanics, but very little about New Game Plus for narrative." … "That was quite a deliberate attempt to make something that gets deeper every time you dig."

## Building it as an indie

### 13. Build the story out of small pieces, so it can grow and be tested in slices

Every indie story game cited here is made of small modular pieces (storylets, lines with conditions, encounters dropped into a day) rather than one long script. Small pieces keep the writing bounded, let content be added late without rewiring the whole, and make a playable slice possible early, which is the only way to test a mystery: whether it is intriguing lives in the content, not in the mechanics ([`PROTOTYPE.md`](../PROTOTYPE.md), "Some fun lives in content").

- Short ([link][short-bb]) on storylets: "A major advantage of QBN is that it allows a lot of short stories to slot together in interesting ways." … "it's possible to drop in modular elements of new content alongside old content".
- Pope ([link][pope-papers]): "Under the structure I ended up with, it was easy to add a little story arc here or encounter there".
- Kasavin ([link][kasavin-gs]): "we just kept adding more types of conditions to check against as the game grew."
- Klavins ([link][gd-idol]) on testing a mystery: "showing it to others, seeing what's clicking with them, and seeing what needs a bit more work." And the failure mode, via Thinky Games ([link][thinky-idol]): "You're developing your perfect amazing game, and you test it only when you've finished it."
- Vanaman (Campo Santo) on scope, Red Bull ([link][firewatch]): "You can make a Firewatch in 18 uninterrupted months if you know what you're doing."

## Where the sources disagree

- **How open the ending should be.** Barlow leaves *Her Story* partly unresolved on purpose so it "continues to percolate"; Knox's fair-play rules, and every deduction game here, give one checkable answer. Both are right for their genre: a deduction game owes the player a confirmed answer; a story about people can leave a question open, as long as the player has enough to form their own answer.
- **How much feedback on answers.** Obra Dinn's sets of three and Golden Idol's "two or fewer slots" are different points on the same scale, and Diaz argues for letting the player be wrong without the game stepping in at all. None is universal; the right amount is found by watching players (principle 13), which is also what Klavins describes doing.
- **Missable content.** Smith wants things missable so finding them means something; Gilbert, from the era of unwinnable adventure games, forbids anything missable that the ending needs. The line between them: flavour and backstory can be missed, what the solution needs cannot (principle 3).

[thinky-idol]: https://thinkygames.com/features/how-the-case-of-the-golden-idol-developers-made-one-of-the-decades-best-detective-games-twice/
[gd-idol]: https://www.gamedeveloper.com/design/case-of-the-golden-idol
[diaz]: https://www.gamedeveloper.com/design/we-are-terrible-detectives
[barlow-gi]: https://gameinformer.com/b/features/archive/2015/07/03/inside-her-story-the-indie-mystery-game-that-people-can-t-stop-analyzing
[knox]: https://www.umsl.edu/~gradyf/film/knoxdecalogue.htm
[gilbert]: https://www.filfre.net/2017/03/monkey-island-or-how-ron-gilbert-made-an-adventure-game-that-didnt-suck
[kotaku-obra]: https://kotaku.com/return-of-the-obra-dinn-the-kotaku-review-1829797772
[three-clue]: https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule
[wiki-obra]: https://en.wikipedia.org/wiki/Return_of_the_Obra_Dinn
[unwinnable-obra]: https://unwinnable.com/2018/12/05/obra-dinn/
[beachum]: https://www.gamedeveloper.com/design/road-to-the-igf-alex-beachum-s-i-outer-wilds-i-
[kasavin-gd]: https://www.gamedeveloper.com/design/roguelikes-and-narrative-design-with-i-hades-i-creative-director-greg-kasavin
[kasavin-gs]: https://gamespot.com/articles/hades-writer-explains-script-philosophy-after-player-discovers-incredible-detail/1100-6482650/
[smith]: https://niemanstoryboard.org/2011/01/14/harvey-smith-on-environmental-storytelling-and-embedding-narrative/
[hitchcock]: https://nofilmschool.com/alfred-hitchcock-and-francois-truffaut-explain-surprise-vs-suspense
[ashwell]: https://www.ifwiki.org/Standard_Patterns_in_Choice-Based_Games
[short-bb]: https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/
[inkle-there]: https://www.inklestudios.com/2012/10/12/just-being-there.html
[levine]: https://gameinformer.com/b/news/archive/2014/03/22/ken-levine-talks-player-participation-and-breaking-away-from-linear-narratives
[disco]: https://discoelysium.com/devblog/2019/07/23/choose-your-own-misadventure-part-2
[hocking]: https://clicknothing.com/2007/10/07/ludonarrative-d/
[pope-papers]: https://www.gamedeveloper.com/design/designing-the-bleak-genius-of-i-papers-please-i-
[crawford]: https://idmaa.org/journalarticle-v1n3-the-two-faces-of-reality/
[ingold-replay]: https://mcvuk.com/?p=224121
[firewatch]: https://www.redbull.com/int-en/firewatch-interview-with-campo-santo
