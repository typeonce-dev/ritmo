---
"@typeonce/ritmo-browser": minor
---

**Breaking (a fix to 0.24's modal rule): `Keyboard.actions` leaves every key to the page while a modal dialog is open, wherever focus is.** In 0.24 a key was the page's only when its target was inside the modal. When a redraw deleted the focused button inside an open `<dialog>`, focus fell to `<body>` and the game took the keys again: Z and Space pressed game actions behind the menu, and Escape pressed the game's action and was `preventDefault`-ed, so the dialog did not close.

A modal is now open when the key's document holds a `<dialog>` opened with `showModal()`, or an `aria-modal="true"` element that is shown (`checkVisibility({ visibilityProperty: true, opacityProperty: true })`). An `aria-modal` element still in the page but closed (`hidden`, `display: none`, `visibility: hidden`, a closed popover, inside a closed `<dialog>`) leaves the keys with the game, and so does one fading out at `opacity: 0`. `Keyboard.presses` is unchanged.

What a game may need to change:

- An `aria-modal="true"` element left shown during play now takes every key. Hide it when its menu closes, or remove the attribute:

  ```ts
  menu.hidden = true // or menu.hidePopover(), or menu.removeAttribute("aria-modal")
  ```

- A script that hides an `aria-modal` menu on Escape runs before a `window` host hears the key, so the game still gets that Escape. Prevent the key it handled:

  ```ts
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.matches(":popover-open")) {
      event.preventDefault()
      menu.hidePopover()
    }
  })
  ```

- A game that merged a dialog's Escape with the game's Escape action (both arrived in one frame with focus on `<body>`) now gets only the dialog's.
