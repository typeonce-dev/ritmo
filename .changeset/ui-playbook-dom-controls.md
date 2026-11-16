---
"@typeonce/ritmo": patch
---

The `ritmo` skill's UI playbook (`ui-and-render.md`) gains two steps for DOM controls and menus: build each control once and update it in place, never rewriting a region that holds one, and give it a name a test can find; a menu that stops play is a modal (`showModal()` on a `<dialog>`, or an `aria-modal` element that moves focus in, keeps it there, and makes the page behind inert itself), whose `cancel` and `close` are intents, with a `popover="manual"` for a splash or wipe over it and a modal dialog of its own for a layer the player presses.
