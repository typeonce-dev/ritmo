/** Whether a binding entry is an analog binding (`Keyboard.analog`, `Gamepad.analog`). */
export const isAnalogBinding = (entry: unknown): entry is { readonly _tag: "Analog" } =>
  typeof entry === "object" && entry !== null && !Array.isArray(entry) && (entry as { readonly _tag?: unknown })._tag === "Analog"

/** Every analog action of `bindings` at rest. */
export const idleAnalogs = (bindings: object): Record<string, number> => {
  const analogs: Record<string, number> = {}
  for (const [name, entry] of Object.entries(bindings)) if (isAnalogBinding(entry)) analogs[name] = 0
  return analogs
}

/** `value` as an analog reading: from 0 to 1, and 0 for anything not a finite number. */
export const unit = (value: number): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
