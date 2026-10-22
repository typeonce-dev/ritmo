---
name: ritmo
description: "Apply on every change to a game built on @typeonce/ritmo: a mechanic, content, UI or rendering, a bug fix, a refactor, saves, or a Ritmo upgrade. Routes the change to its playbook, says where the Ritmo docs are, and holds the principles for where code and state belong."
---

# Ritmo games

Follow the game's existing structure and conventions. The playbooks give the steps for each kind of change and the check that proves it; the game decides its folders, UI framework, renderer, timing, and design.

## Where the docs are

- The API reference is the JSDoc in `node_modules/@typeonce/*/src`. Read a module's header before using the module, and an export's JSDoc before calling it. Do not work from memory or the web: the API changes between versions.
- Each package's `README.md` in `node_modules` covers its setup and workflow.
- When upgrading, read each package's `CHANGELOG.md` from the installed version up. Breaking entries name the fix.
- Compiler errors and lint messages name the fix. Apply it; never cast around it.

## Pick the playbook

Read the playbook for the change before writing code. A change that spans several kinds reads each.

| Change | Playbook |
|---|---|
| A rule, mechanic, or behaviour | [`playbooks/mechanic.md`](playbooks/mechanic.md) |
| Items, kinds, levels, or tuning that reuse behaviour | [`playbooks/content.md`](playbooks/content.md) |
| A readout, panel, menu, or anything drawn | [`playbooks/ui-and-render.md`](playbooks/ui-and-render.md) |
| Something behaves wrong | [`playbooks/bug-fix.md`](playbooks/bug-fix.md) |
| Moving or splitting code without changing behaviour | [`playbooks/refactor.md`](playbooks/refactor.md) |
| New state, saves, or a Ritmo upgrade | [`playbooks/state-and-upgrades.md`](playbooks/state-and-upgrades.md) |
| Effect in the host: schemas, Results, services, scopes | [`playbooks/effect.md`](playbooks/effect.md) |

## Principles

**The simulation is the game; everything else is a host.** Rules that change the world are systems. Input capture, drawing, UI, storage, network, and audio are host code. Keep the simulation in one folder, so one glob in the simulation override covers it. Any code that changes saved world state is gameplay, wherever it lives.

**Intents in, plain data out.** Player actions are typed intents (host events with `runtime.send(...)`, or an input resource) that one system validates and applies. Bots, tests, and replays send the same intents as the UI. UIs and renderers read the world as plain view data and never change saved world state.

**Each fact has one home.** Define each closed set (items, tools, building kinds) once and derive labels, shortcuts, menus, and lookups from it. Tables that must cover the set are `satisfies Record<Id, T>`, so a new id fails to compile until every table has an entry.

**Each piece of state has an owner and a lifetime.** Every mutable value has one home (saved world state, unsaved runtime state, or host state) and a defined fate on new game, restore, and dispose. Module variables are not a home for gameplay state: they survive restore, ignore rollback, and are shared by every runtime in the process.

**Extend what exists before adding.** Search for an existing system, component, definition, or UI piece first, and extend it or add a variant instead of a near copy. New content that reuses behaviour is data, not a system.

**Make the next mistake fail loudly.** When a rule can be a type, a lint, or a headless test, encode it there instead of in a comment. The game's check runs the type check, `oxlint`, `ritmo-devtools lint <entry>`, and the tests; if any is missing, add it as `node_modules/@typeonce/ritmo/SETUP.md` describes.

## Self-check

- Does any UI or render code change saved world state?
- Did adding this id produce a type error everywhere it is needed?
- What happens to this value on restore?
- Did I extend an existing piece, or copy it?
- What check fails if someone breaks this tomorrow?
