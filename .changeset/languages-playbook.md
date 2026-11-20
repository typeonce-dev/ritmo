---
"@typeonce/ritmo": patch
---

The `ritmo` skill gains a playbook for a game in several languages, `playbooks/languages.md`: a language is one plain object checked against the first one's shape (`satisfies Catalog`), names are tables over the game's closed sets, grammar and its `Intl` formatters stay in one file for each language, and the catalog in use is a service only the projection and the UI are given, so the simulation holds no words. It comes with `references/wording.ts` to copy into the game: `say(table, event)` words a tagged value the simulation reported, and `satisfies Wording<Event>` makes a new tag fail to compile in every language until each has worded it.

The mechanic playbook (`mechanic.md`) has a new step 4: what a system tells the player (news, a failure's reason, a toast) is a tagged value with its ids and numbers, never a sentence. Its later steps move down by one.
