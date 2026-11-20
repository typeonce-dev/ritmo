import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { say, type Wording } from "../wording.ts"

// What a simulation says, as data: ids and numbers, no words.
type KindId = "mill" | "farm"
type Event =
  | { readonly _tag: "founded"; readonly homes: number }
  | { readonly _tag: "built"; readonly kind: KindId }
  | { readonly _tag: "fire"; readonly kind: KindId; readonly lost: number }
  | { readonly _tag: "calm" }

// English: a noun has two forms, and its article follows its first letter.
const en = (() => {
  interface Noun { readonly one: string; readonly other: string }
  const kinds = { mill: { one: "mill", other: "mills" }, farm: { one: "estate", other: "estates" } } satisfies Record<KindId, Noun>
  const home: Noun = { one: "home", other: "homes" }
  const count = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.one : noun.other}`
  const a = (noun: Noun) => `${/^[aeiou]/.test(noun.one) ? "an" : "a"} ${noun.one}`
  return {
    founded: (said) => `Founded with ${count(said.homes, home)}.`,
    built: (said) => `The town has built ${a(kinds[said.kind])}.`,
    fire: (said) => `Fire at the ${kinds[said.kind].one}: ${count(said.lost, home)} lost.`,
    calm: () => "A quiet season."
  } satisfies Wording<Event>
})()

// Italian: a noun has a gender too, which English never asks for; only the table's shape is shared.
const it_ = (() => {
  interface Noun { readonly one: string; readonly other: string; readonly gender: "m" | "f" }
  const kinds = { mill: { one: "mulino", other: "mulini", gender: "m" }, farm: { one: "fattoria", other: "fattorie", gender: "f" } } satisfies Record<KindId, Noun>
  const home: Noun = { one: "casa", other: "case", gender: "f" }
  const count = (n: number, noun: Noun) => (n === 1 ? `${noun.gender === "f" ? "una" : "un"} ${noun.one}` : `${n} ${noun.other}`)
  const a = (noun: Noun) => `${noun.gender === "f" ? "una" : "un"} ${noun.one}`
  const at = (noun: Noun) => `${noun.gender === "f" ? "alla" : "al"} ${noun.one}`
  return {
    founded: (said) => `Fondato con ${count(said.homes, home)}.`,
    built: (said) => `Il paese ha costruito ${a(kinds[said.kind])}.`,
    // Turned so nothing has to agree with what was lost.
    fire: (said) => `Incendio ${at(kinds[said.kind])}: il fuoco ha distrutto ${count(said.lost, home)}.`,
    calm: () => "Una stagione tranquilla."
  } satisfies Wording<Event>
})()

const events: ReadonlyArray<Event> = [
  { _tag: "founded", homes: 1 },
  { _tag: "built", kind: "farm" },
  { _tag: "fire", kind: "mill", lost: 3 },
  { _tag: "calm" }
]

describe("say", () => {
  it("words each thing the simulation says with its own tag's function, in each language", () => {
    expect(events.map((event) => say(en, event))).toEqual([
      "Founded with 1 home.",
      "The town has built an estate.",
      "Fire at the mill: 3 homes lost.",
      "A quiet season."
    ])
    expect(events.map((event) => say(it_, event))).toEqual([
      "Fondato con una casa.",
      "Il paese ha costruito una fattoria.",
      "Incendio al mulino: il fuoco ha distrutto 3 case.",
      "Una stagione tranquilla."
    ])
  })

  it("returns whatever the table's entries return, and takes one member of the union alone", () => {
    const alarms = {
      founded: () => ({ line: "Founded.", alarm: false }),
      built: () => ({ line: "Built.", alarm: false }),
      fire: (said) => ({ line: `Fire: ${said.lost} lost.`, alarm: true }),
      calm: () => ({ line: "Calm.", alarm: false })
    } satisfies Wording<Event, { readonly line: string; readonly alarm: boolean }>
    const fire: Extract<Event, { readonly _tag: "fire" }> = { _tag: "fire", kind: "mill", lost: 2 }
    const told: { readonly line: string; readonly alarm: boolean } = say(alarms, fire)
    expect(told).toEqual({ line: "Fire: 2 lost.", alarm: true })
    const line: string = say(en, fire)
    expect(line).toBe("Fire at the mill: 2 homes lost.")
  })

  it("does not compile for a language that leaves a tag unworded, or reads a field its tag lacks", () => {
    const partial = {
      founded: () => "Founded.",
      built: () => "Built.",
      fire: () => "Fire."
      // @ts-expect-error Property 'calm' is missing
    } satisfies Wording<Event>
    const misread = {
      founded: () => "Founded.",
      built: () => "Built.",
      fire: () => "Fire.",
      // @ts-expect-error Property 'lost' does not exist
      calm: (said) => `Calm: ${said.lost}.`
    } satisfies Wording<Event>
    // What the compiler stops: the tag has no words, so there is nothing to call.
    // @ts-expect-error Property 'calm' is missing
    expect(() => say(partial, events[3]!)).toThrow()
    expect(Object.keys(misread)).toHaveLength(4)
  })
})

describe("wording source", () => {
  it("is the module the skill's references/wording.ts gives games to copy", () => {
    const reference = readFileSync(new URL("../../../packages/core/skills/ritmo/references/wording.ts", import.meta.url), "utf8")
    const source = readFileSync(new URL("../wording.ts", import.meta.url), "utf8")
    const code = (text: string) => text.slice(text.indexOf("/** Anything the simulation says as data")).trimEnd()
    expect(code(reference)).toContain("export function say")
    expect(code(reference)).toBe(code(source))
  })
})
