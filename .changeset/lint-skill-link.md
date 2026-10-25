---
"@typeonce/ritmo-devtools": minor
---

`ritmo-devtools lint` notes when the project does not link the Ritmo skill from the installed package (`skill-not-linked`: neither `.agents/skills/ritmo` nor `.claude/skills/ritmo` links `node_modules/@typeonce/ritmo/skills/ritmo`), or holds a copy that goes stale on upgrade (`skill-copied`). Both are notes: the exit code is unchanged.
