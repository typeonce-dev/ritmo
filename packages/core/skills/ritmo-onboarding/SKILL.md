---
name: ritmo-onboarding
description: "Apply when a game built on @typeonce/ritmo is made for strangers: the title, the first stretch of play, what teaches the core rule and the controls, what the game says when the player fails, and every round after someone other than the user played. Teaches the rule by its consequence, keeps a lesson impossible to pass by chance, and proves headless that a player who never learned the rule cannot win."
---

# Teaching a Ritmo game

A stranger (a jam judge, a friend handed the device) gives the game a few minutes and reads nothing. If they do not get the rule, nothing else in the game counts. The user cannot judge this alone: they know the rule. Only someone who does not can show whether the game teaches it.

## When

A game past its prototype (the `ritmo` skill and its playbooks still apply) that is about to be played by anyone but the user: a playtest, a jam, a release. This skill covers the title, the first stretch of play (the first rooms, levels, cases, or rounds), the moment the player fails, the controls on the device the game is played on, and each round after a stranger played. In the `ritmo-prototype` skill the user is the playtester; here their own play says how the game feels, and only a stranger says whether it teaches. It was drawn from one game, a real-time action game on a phone; the action-game case is in parentheses where the rule is general.

## The first minute

- **The rule is on screen, in action, before anything is asked.** No screen of instructions apart from the game: a splash, a briefing, a "how to play" gets skipped, and the skipper blames the game. The title can show the game playing itself (the simulation is headless, so a scripted player in a lesson costs nothing), and the rule is seen before anyone presses Play.
- **Something at stake that the rule changes, at once.** The lesson is the consequence: the thing the rule is about (the bullet that hangs, the accusation that closes the case, the unit that cannot move after it strikes) is in front of the player from the first seconds, before their first choice. The first contact costs nothing (it is shown before it can act, or the retry is instant and in place); from the second contact on, the consequence is real. A stretch with nothing at stake teaches nothing: while acting, players watch their hands and the target, never the surroundings.
- **The rule, then the controls.** The rule may be told once, in the game's own pieces: the game plays the lesson while a few words say what the picture cannot (the rule's name), at the player's pace and skippable. Then the first stretch in the player's hands teaches the input, and each stretch after it one thing, alone before it is combined.
- **Teach what contradicts what the player expects.** A rule that is the genre's default (jump, tap to select, drag to move) needs a glyph, not a lesson; a lesson is for the rule a player of the genre would get wrong.

## What a lesson is

- **Teach only what the player can see.** If a still frame, or a stranger's glance, cannot show it, it is not taught and not in the pitch; it stays a mastery detail. Look for anything that contradicts the rule (a "safe" state that still hurts) and fix the rule, not the hint.
- **Impossible to pass by chance.** A lesson ends when it is done, not when its end is reached, the clock runs out, or a guess lands: no way on until then, and what follows is not won by a player who skipped it, beyond what the game's own luck allows. A player who got through without the rule learned that the rule does not matter. The gate costs a player who knows the rule only the time to do it.
- **Words are never the only channel.** Strangers do not read. A line is a few words beside the thing it is about, where the eyes are (over the player, on the thing at stake), never under the hand, and never the only way the lesson gets through. A word that names an act on the screen ("touch", "click", "press") gets done to the screen: say what happens in the game ("get close").
- **The failure names the rule.** When the player fails or is stuck (hit, defeated, the case lost) the game says what took them, in the rule's words, leaves the thing that took them on screen, and keeps the retry one input away. That moment is read more than any hint.

## Controls

- **Strangers use the input they already know, not the one you meant:** they swipe where you meant hold, click the enemy where you meant walk to it, press attack where you meant move first. Show the input being done (a hand that presses, holds, slides and lifts; the actual key or button), accept any amount of it (a lesson that asks for "a little" gets "all the way"), and never make a gesture the only way to an important action.
- **Every input the game accepts has a defined result under the rule,** including the ones that do nothing (pushing into a wall is standing still), and none of them gets through a lesson.
- **On a phone, the finger hides what is under it:** the stick, a target, a word. Put what must be seen beside the thumb, never beneath it, and make a target the finger must reach bigger than the finger.
- **The controls are taught in the game, never only on the page** or in a menu nobody opens.

## The check

Bots send the player's intents, so the strangers you saw become the tests the `ritmo` skill's "Prove it headless" asks for:

- **Naive players.** A bot for each way you saw a stranger skip the lesson, and for the ways every game has: doing nothing, doing the obvious thing at full force (charging the nearest enemy, attacking first, accusing at random), repeating one input as fast as possible, and the input you did not mean (a swipe for a hold). No naive bot clears a lesson or wins what follows it, beyond what the game's own luck allows, and a bot that does the lesson does. Run each many times with variation (seed, timing, start): a lesson one of them clears has stopped teaching.
- **The rule's promise is an invariant.** What the rule promises or forbids (hit while still, a second dash in the air, a strike after a move) is an `Invariant`, fuzzed over the first stretch (the `@typeonce/ritmo-devtools` README).
- **A playtest becomes a replay.** What a stranger did that got through a lesson is reproduced headless and kept as a regression test before the fix.

## After a playtest

- **One stranger at a time, as early and often as you can.** One is enough to find the next thing; a stranger who played once is no longer one.
- **Watch, silent, and write what they did**, not what they said or what you think they understood: "she slid all the way up", "he tapped the enemy", "she attacked from where she stood". That is the finding; "they didn't get it" is not. A line per round in the game's design notes, with what was tried and what it taught.
- **Fix the cause.** A stranger's confusion is a symptom: find what in the lesson or the rule produced it. A hint over a lesson that cannot teach is a guess.
- **When rounds fail the same way, stop patching.** Ask whether the design contradicts the lesson (nothing at stake, a rule the player cannot see, two things taught at once) and change the lesson or the rule. Agents agreeing on a design is not a playtest: only a stranger decides.

## Each round

Reply with the link, the lesson in one line (what the player must do to get through), which naive players the check ran, and what to watch the stranger do.
