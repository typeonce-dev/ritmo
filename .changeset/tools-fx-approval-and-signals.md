---
"@typeonce/ritmo-tools": minor
---

An fx approval covers everything `fx render` hands the game, a broken draft exits 3 in every `fx` command, and `kill` ends a stuck command.

- **fx approvals.** Approving an effect (on the page, as before) now also keeps whether it loops, its canvas size, and its anchor, beside the draft, fps, and frame hashes. `fx notes` and `fx render` say when one of them changed (`changedSinceApproved: "its anchor moved from 12,12 to 0,0"`); before, an effect whose anchor moved still read as approved while the game drew it somewhere else. An approval stored before this keeps no anchor or loop: it is not reported as changed for that, but as `unrecorded: true`, with a `next` naming what it did not keep ("Approved, with no record of its anchor or whether it loops: ask the person to look again"), and is not counted among the approved. Ask the person to approve it again on the page.
- **Exit 3 for a broken draft.** `fx render` and `fx look` exit 3, as `fx check` does, for a draft that does not load or whose `draw` throws, names a color or ramp the bank does not have, or runs past the time limit, with `{ error, effect, draft, errors, next }` on stdout. Before, `fx render` exited 2 (a usage error) and `fx look` exited 2 for a draft that does not load and 0 for one whose `draw` throws.
- **Stopping.** SIGTERM and SIGINT end any command at once, even one stuck in synchronous work (a draft that loops as it loads, a large bake); before, the CLI listened for them on its event loop, so such a command outlived `kill` and `timeout` until SIGKILL. A review server still stops on either and exits 130.
