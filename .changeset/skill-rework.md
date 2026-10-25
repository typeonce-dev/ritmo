---
"@typeonce/ritmo": patch
---

The skill is a front door: `SKILL.md` says where the docs are, routes each change to its playbook, and holds the principles (new: "Prove it headless"). Each playbook states its goal, the principles that apply, the steps whose order matters, and the check that proves the change; steps that only listed APIs now point to the JSDoc or README that documents them.

Reference material moved to `skills/ritmo/references/`, loaded from the playbook step that needs it:

- `references/schemas.md`: one schema library, guards and brands per library (was the skill's "Validating and saving values" and "Branded values").
- `references/zod.md` and `references/effect.md`: the codec helpers (were `playbooks/zod.md` and `playbooks/effect.md`).
- `references/third-party.md`: what `ritmo-devtools scan` cannot see (was the skill's "Third-party code").
- `references/spatial-grid.ts`, with a note in `references/spatial-grid.md`: the broad phase to copy (was `playbooks/spatial-grid.md`). A game that copied the old module needs no change: the code is the same.
