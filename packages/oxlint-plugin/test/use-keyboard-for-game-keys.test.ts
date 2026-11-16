import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["use-keyboard-for-game-keys"]!
const error = (type = "keydown") => ({ messageId: "pageListener", data: { type } })

tester.run("use-keyboard-for-game-keys", rule, {
  valid: [
    // Audio opens on the first key or press, and the key goes on to the game and the page.
    "const unlockAudio = (): void => audio.unlock(); window.addEventListener(\"keydown\", unlockAudio); window.addEventListener(\"pointerdown\", unlockAudio)",
    "const onGesture = (): void => { pressed = true; audio.unlock() }; window.addEventListener(\"keydown\", onGesture, { capture: true })",
    // One element's own keys: a name field, a dialog's Escape, a menu's arrows.
    "input.addEventListener(\"keydown\", (event) => { if (event.key === \"Enter\") { event.preventDefault(); input.blur() } })",
    "dialog.addEventListener(\"keydown\", (event) => { if (event.key === \"Escape\") { event.preventDefault(); close() } })",
    "menu.addEventListener(\"keydown\", (event: KeyboardEvent) => { if (event.key === \"ArrowDown\") { event.preventDefault(); next() } })",
    // A page listener that leaves the key's default to the page.
    "window.addEventListener(\"keydown\", (event) => { if (event.code === \"KeyM\" && !(event.target instanceof HTMLInputElement)) setMuted(!muted()) })",
    // Not a key event.
    "window.addEventListener(\"pointerdown\", (event) => event.preventDefault())",
    "document.addEventListener(\"wheel\", (event) => event.preventDefault(), { passive: false })",
    // A nested function's own event is not the key's.
    "window.addEventListener(\"keydown\", (event) => { link.addEventListener(\"click\", (event) => event.preventDefault()); show(event.key) })",
    // A local that shadows the page's globals, and a host passed in.
    "const window = makeEmitter(); window.addEventListener(\"keydown\", (event) => event.preventDefault())",
    "function listen(host: EventTarget) { host.addEventListener(\"keydown\", (event) => event.preventDefault()) }",
    // The keyboard module's own host listeners are not this rule's.
    "const keyboard = Keyboard.actions(window, { pause: [\"Escape\"] }); if (keyboard.snapshot().actions.pause.pressed) pause()"
  ],
  invalid: [
    {
      // still-time: Escape and M pause, the moves are prevented.
      code: `window.addEventListener("keydown", (e) => {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        if (e.repeat) return
        if (key === "Escape" || key === "m") {
          menu.toggle()
          e.preventDefault()
          return
        }
        if (key === " " || key === "Enter") thumb.tap()
        else return
        e.preventDefault()
      })`,
      errors: [error()]
    },
    {
      // emberworks: Space and Enter strike, inside a switch.
      code: `window.addEventListener("keydown", (event) => {
        if (event.repeat) return
        switch (event.key.toLowerCase()) {
          case " ":
          case "enter":
            event.preventDefault()
            send({ kind: "strike" })
            break
          case "r":
            send({ kind: "restart" })
            break
        }
      })`,
      errors: [error()]
    },
    {
      // dubplate: held buttons by physical key, with their releases.
      code: `window.addEventListener("keydown", (event) => {
        const button = KEYS[event.code]
        if (button !== undefined) {
          if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault()
          input("press", button, event)
        }
      })
      window.addEventListener("keyup", (event) => { const button = KEYS[event.code]; if (button !== undefined) input("release", button, event) })`,
      errors: [error()]
    },
    {
      // landkeep: a listener that checks the target by hand is still the page's.
      code: `window.addEventListener("keydown", (event) => {
        if (event.target instanceof Element && event.target.closest("textarea, input") !== null) return
        if (event.metaKey || event.ctrlKey) return
        if (event.key === "z") undo()
        else return
        event.preventDefault()
      })`,
      errors: [error()]
    },
    {
      // A named listener, declared as a const or a function.
      code: "const onKey = (event: KeyboardEvent): void => { if (event.key === \" \") { event.preventDefault(); jump() } }; window.addEventListener(\"keydown\", onKey)",
      errors: [error()]
    },
    {
      code: "function onKey(event: KeyboardEvent) { if (event.key === \"Escape\") event.preventDefault() } document.addEventListener(\"keydown\", onKey, true)",
      errors: [error()]
    },
    // Every page-wide target: the global, document, its body and root, through window or globalThis.
    { code: "addEventListener(\"keydown\", (e) => { if (e.key === \" \") e.preventDefault() })", errors: [error()] },
    { code: "globalThis.addEventListener(\"keyup\", (e) => e.preventDefault())", errors: [error("keyup")] },
    { code: "window.document.addEventListener(\"keypress\", (e) => e.preventDefault())", errors: [error("keypress")] },
    { code: "document.body.addEventListener(\"keydown\", function (e) { e.preventDefault() })", errors: [error()] },
    { code: "document.documentElement.addEventListener(\"keydown\", (e) => { e.preventDefault() })", errors: [error()] }
  ]
})
