---
"@typeonce/ritmo": patch
---

The `ritmo` skill has a performance playbook (`playbooks/performance.md`, listed in `SKILL.md`): measure ticks on a real host clock without `debug`, name the system with `session.report()` on the same clock (a test clock makes every timing 0), fix the usual causes, and compare the same number before and after.

`SETUP.md` starts with what a game needs: Node 22.19 or newer for the commands the setup and the skills run, and TypeScript 5.9 or newer with `strict` on and `noErrorTruncation` off.

The spatial grid reference says where the grid lives in a schedule that rewinds, where `local` does not compile: in the system's body, made each run.
