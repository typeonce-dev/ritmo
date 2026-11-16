---
"@typeonce/ritmo-browser": minor
---

**Breaking: `Keyboard.actions` and `Keyboard.presses` leave keys the page is using to the page.** Before, only a key typed into a form field was left alone: a bound Enter or Space on a focused `<button>` was `preventDefault`-ed, so a player who reached a menu with Tab could not press it, and Escape did not close a modal `<dialog>`. Now a key presses no action and is not `preventDefault`-ed when any of these holds:

- the target is a form field (unchanged);
- the target took focus by keyboard: it matched `:focus-visible` when focus arrived (Tab to a button, link, `<summary>`, or any element with `tabindex`);
- the target is inside an open modal dialog (`<dialog>` opened with `showModal()`, or `aria-modal="true"`), however it was opened;
- a listener nearer the target already called `preventDefault()` on the key (a roving-focus group's arrows, a custom slider, a menu).

A button the player clicked with the mouse keeps focus but not the keys: the game keeps playing and Space does not press it again. A focused `<canvas>`, or the element passed as the host, is the game. Releases are processed wherever focus is, as before.

`KeyboardHost` gains `focusin` listeners (`window` and every element already have them), and `KeyEvent` gains an optional `defaultPrevented`. A test host whose `addEventListener` takes any `type: string` needs no change; a host written with one overload per event adds:

```ts
addEventListener(type: "focusin", listener: (event: Keyboard.FocusInEvent) => void): void
removeEventListener(type: "focusin", listener: (event: Keyboard.FocusInEvent) => void): void
```

Remove the workarounds this replaces: `tabIndex = -1` on every HUD button and `button.blur()` after each click are no longer needed for the game to keep its keys. A game's own modal menu that it drove through `Keyboard.actions` (Escape or arrows while focus is inside an `aria-modal` element) now gets no actions there: handle those keys on the dialog element, or use a native `<dialog>`, whose Escape closes it. A raw `window` listener that calls `preventDefault()` on a key before the keyboard sees it now keeps that key from the game; bind the key with `Keyboard.actions` instead (`ritmo/use-keyboard-for-game-keys` reports such listeners).
