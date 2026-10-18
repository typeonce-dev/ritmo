/** The native entry point receives its host explicitly. */
import type { KeyboardHost } from "@typeonce/ritmo-browser/Keyboard"
import type { PointerTarget, BlurHost } from "@typeonce/ritmo-browser/Pointer"
import type { TouchTarget } from "@typeonce/ritmo-browser/Touch"
import type { Gfx } from "./NativeGfx.ts"

export interface Host {
  readonly clock: { now(): number }
  readonly frames: { subscribe(callback: (deltaMS: number) => void): { stop(): void } }
  readonly keyboard: KeyboardHost
  readonly pointer: PointerTarget & TouchTarget
  readonly blur: BlurHost
  readonly gfx: Gfx
  /** Scripted action timeline supplied by --input, validated by the game's input module. */
  readonly input: unknown
  readonly headless: boolean
  /** Register the world's snapshot for --snapshots and the exact oracle. */
  snapshots(read: () => unknown): void
  /** Stops the app with an explicit error and nonzero exit status. */
  fail(message: string): void
}
export type Entry = (host: Host) => void | { stop(): void } | Promise<void | { stop(): void }>
/** Declares the default export the native loader invokes once. */
export const main = <E extends Entry>(entry: E): E => entry
