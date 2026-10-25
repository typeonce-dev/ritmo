/**
 * Browser host integrations kept outside the renderer-agnostic ECS core:
 * animation-frame timing (`BrowserTickSource`, `BrowserHostClock`), tab
 * visibility for networked sessions (`BrowserVisibility`), input
 * devices bound to actions (`Keyboard`, `Gamepad`, `Pointer`, `Touch`),
 * merging and local multiplayer (`Controls`), and the system that copies
 * input into a resource (`InputCapture`).
 */
export * as BrowserHostClock from "./BrowserHostClock.ts"
export * as BrowserTickSource from "./BrowserTickSource.ts"
export * as BrowserVisibility from "./BrowserVisibility.ts"
export * as Controls from "./Controls.ts"
export * as Gamepad from "./Gamepad.ts"
export * as InputCapture from "./InputCapture.ts"
export * as Keyboard from "./Keyboard.ts"
export * as Pointer from "./Pointer.ts"
export * as Touch from "./Touch.ts"

/** The package's tag, `"browser"`. */
export const packageTag = "browser" as const
