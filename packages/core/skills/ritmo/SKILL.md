---
name: ritmo
description: "Apply on every change to a game built on @typeonce/ritmo: a mechanic, content, UI or rendering, a bug fix, a refactor, saves, netcode, or a Ritmo upgrade. Says where the docs are, routes the change to its playbook, and holds the principles for where code and state belong."
---

# Ritmo games

Follow the game's existing structure; the game decides its folders, UI framework, renderer, and design. This file holds the principles; each playbook holds the steps that matter for one kind of change, the check that proves it, and links to the references it needs.

## Where the docs are

- The API reference is the JSDoc in `node_modules/@typeonce/*/src`: read a module's header before using it and an export's JSDoc before calling it, never memory or the web (the API changes between versions).
- Each package's `README.md` covers its setup and workflow; on upgrade, its `CHANGELOG.md` from the installed version up.
- Compiler errors and lint messages name the fix. Apply it; never cast around it.

## Prototypes

When the game has a `PROTOTYPE.md` at its root, follow the [`ritmo-prototype`](../ritmo-prototype/SKILL.md) skill: its check replaces the playbooks' checks here, and these principles still hold. Start one only when the user asks to prototype a mechanic or find the fun.

## Strangers

When the change is about what teaches the game (the title, the first stretch of play, what the game says when the player fails, the controls) or follows a playtest by someone other than the user, read the [`ritmo-onboarding`](../ritmo-onboarding/SKILL.md) skill too: the playbooks here still apply, and it adds the check that a player who never learned the rule cannot win.

## Pick the playbook

Read it before writing code; a change of several kinds reads each.

| Change | Playbook |
|---|---|
| A rule, mechanic, or behaviour | [`playbooks/mechanic.md`](playbooks/mechanic.md) |
| Items, kinds, levels, or tuning that reuse behaviour | [`playbooks/content.md`](playbooks/content.md) |
| A readout, panel, menu, or anything drawn | [`playbooks/ui-and-render.md`](playbooks/ui-and-render.md) |
| Something behaves wrong | [`playbooks/bug-fix.md`](playbooks/bug-fix.md) |
| Moving or splitting code without changing behaviour | [`playbooks/refactor.md`](playbooks/refactor.md) |
| New state, saves, schemas, or a Ritmo upgrade | [`playbooks/state-and-upgrades.md`](playbooks/state-and-upgrades.md) |
| Online multiplayer, rollback, or prediction | [`playbooks/netcode.md`](playbooks/netcode.md) |

## Principles

**The simulation is the game; everything else is a host.** Rules that change the world are systems in one folder, covered by one glob in the simulation lint override. Input capture, drawing, UI, storage, network, and audio are host code.

**Intents in, plain data out.** Player actions are typed intents a system validates; bots, tests, and replays send the same ones. UIs and renderers read plain view data and never change saved world state.

**Each fact has one home.** Define each closed set (items, kinds) once and derive labels, menus, and lookups from it; tables that must cover it are `satisfies Record<Id, T>`, so a new id fails to compile until each has an entry.

**Each piece of state has an owner and a lifetime.** Every mutable value lives in saved world state, unsaved runtime state, or host state, with a defined fate on new game, restore, and dispose. Never a module variable: it survives restore, ignores rollback, and is shared by every runtime.

**Make impossible states unrepresentable.** A field that means something only in one state belongs to that state (`Descriptor.EntityState` per entity, `Game.StateMachine` game-wide), never next to a mode field or boolean flag where it can go stale. Two values that must agree are one state.

**A handle is not proof the entity is alive.** A stored id can outlive its entity, so a lookup through it can fail. A link between entities is a `Descriptor.Relation`, whose dropped edge a system reacts to once.

**Extend what exists before adding.** Find the system, component, or UI piece that already does most of it and extend it; content that reuses behaviour is data, not a system.

**Prove it headless.** A change is done when a headless test scripts the input and asserts what a player would see. A bug is reproduced headless first and fixed in the system that wrote the wrong value.

**Make the next mistake fail loudly.** A rule that can be a type, a lint, an invariant, or a test is encoded there, not in a comment. The game's check runs the type check, `oxlint`, `ritmo-devtools lint <entry>`, and the tests (`node_modules/@typeonce/ritmo/SETUP.md`).

## Self-check

- Does any UI or render code change saved world state?
- Did the new id fail to compile everywhere it needs an entry?
- What happens to this value on restore?
- Can a value I store describe something that cannot happen? A nullable field next to a `kind` or `phase`, or a system returning early on a mode field, says it can.
- Did I extend an existing piece, or copy it?
- What check fails if someone breaks this tomorrow?
