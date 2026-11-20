import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["no-locale-in-simulation"]!

tester.run("no-locale-in-simulation", rule, {
  valid: [
    // Ordering by what the world holds, or by the strings themselves.
    "const order = heroes.sort((a, b) => a.rank - b.rank)",
    "const order = names.sort()",
    "const order = names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))",
    // Case and text that every engine answers the same.
    "const key = label.toLowerCase(); const shout = label.toUpperCase()",
    "const text = coins.toString(); const fixed = ratio.toFixed(2); const line = `${coins} coins`",
    "const same = a.normalize() === b.normalize()",
    // Locals, parameters, and imports named like the global.
    "const Intl = { NumberFormat: make }; new Intl.NumberFormat()",
    "import { Intl } from \"./words.ts\"; Intl.plural(n)",
    "import * as Intl from \"./words.ts\"; const { NumberFormat } = Intl",
    "const word = (Intl: Words) => new Intl.PluralRules()",
    "function count(n: number) { const Intl = words(); return Intl.NumberFormat(n) }",
    // A field of the same name on another object.
    "const format = config.Intl.NumberFormat; const rules = game.Intl.PluralRules",
    // The global itself runs nothing until a member is read.
    "const has = typeof Intl !== \"undefined\"",
    // Types never run.
    "let format: Intl.NumberFormat; type Rules = typeof Intl.PluralRules; const options = {} as Intl.NumberFormatOptions",
    "const read = (collator: Intl.Collator, at: { toLocaleString: string }) => at",
    // Naming a method is not calling it: an object's keys, a class's own method, a string.
    "const view = { toLocaleString: label, localeCompare: 1 }",
    "class Score { toLocaleString() { return String(this.value) } }",
    "const { toLocaleString, localeCompare } = labels",
    "const hint = \"toLocaleString() belongs to the view\"",
    // An object given its own method asks nothing of a language.
    "score.toLocaleString = () => String(score.value)",
    // Names that only look alike.
    "const tag = settings.locale; const where = save.toLocale; const cmp = a.compare(b)"
  ],
  invalid: [
    // Ordering.
    { code: "const order = heroes.sort((a, b) => a.name.localeCompare(b.name))", errors: [{ messageId: "order", data: { call: "localeCompare()" } }] },
    // A named language still reads the engine's own data for it.
    { code: "const first = a.localeCompare(b, \"en\") < 0", errors: [{ messageId: "order", data: { call: "localeCompare()" } }] },
    { code: "names.sort(new Intl.Collator(\"en\").compare)", errors: [{ messageId: "order", data: { call: "Intl.Collator" } }] },
    // Case.
    { code: "const kind = kinds[label.toLocaleLowerCase()]", errors: [{ messageId: "letterCase", data: { call: "toLocaleLowerCase()" } }] },
    { code: "const shout = label.toLocaleUpperCase(\"tr\")", errors: [{ messageId: "letterCase", data: { call: "toLocaleUpperCase()" } }] },
    // Writing a value.
    { code: "log.lines.push(`Earned ${coins.toLocaleString()} coins`)", errors: [{ messageId: "format", data: { call: "toLocaleString()" } }] },
    { code: "const text = coins.toLocaleString(\"en-US\")", errors: [{ messageId: "format", data: { call: "toLocaleString()" } }] },
    { code: "const day = new Date(save.createdAt).toLocaleDateString()", errors: [{ messageId: "format", data: { call: "toLocaleDateString()" } }] },
    { code: "const hour = at.toLocaleTimeString()", errors: [{ messageId: "format", data: { call: "toLocaleTimeString()" } }] },
    { code: "const text = new Intl.NumberFormat().format(coins)", errors: [{ messageId: "format", data: { call: "Intl.NumberFormat" } }] },
    { code: "const language = Intl.DateTimeFormat().resolvedOptions().locale", errors: [{ messageId: "format", data: { call: "Intl.DateTimeFormat" } }] },
    { code: "const ago = new Intl.RelativeTimeFormat(\"en\").format(-1, \"day\")", errors: [{ messageId: "format", data: { call: "Intl.RelativeTimeFormat" } }] },
    // Choosing words.
    { code: "const form = new Intl.PluralRules(\"en\").select(n)", errors: [{ messageId: "words", data: { call: "Intl.PluralRules" } }] },
    { code: "const all = new Intl.ListFormat().format(names)", errors: [{ messageId: "words", data: { call: "Intl.ListFormat" } }] },
    { code: "const letters = [...new Intl.Segmenter().segment(name)]", errors: [{ messageId: "words", data: { call: "Intl.Segmenter" } }] },
    { code: "const tags = Intl.getCanonicalLocales(tag)", errors: [{ messageId: "words", data: { call: "Intl.getCanonicalLocales" } }] },
    { code: "const mine = held instanceof Intl.Collator", errors: [{ messageId: "order", data: { call: "Intl.Collator" } }] },
    // However the method is reached.
    { code: "const first = a[\"localeCompare\"](b)", errors: [{ messageId: "order" }] },
    { code: "const first = a?.name?.localeCompare(b.name)", errors: [{ messageId: "order" }] },
    { code: "const first = String.prototype.localeCompare.call(a, b)", errors: [{ messageId: "order" }] },
    { code: "const compare = \"\".localeCompare", errors: [{ messageId: "order" }] },
    { code: "const texts = amounts.map((n) => n.toLocaleString())", errors: [{ messageId: "format" }] },
    { code: "class Score { text() { return this.value.toLocaleString() } }", errors: [{ messageId: "format" }] },
    // Each call is reported.
    { code: "const line = `${a.toLocaleString()} of ${b.toLocaleString()}`", errors: [{ messageId: "format" }, { messageId: "format" }] },
    // `Intl` reached through a global object, an alias, or destructuring.
    { code: "const text = new globalThis.Intl.NumberFormat().format(coins)", errors: [{ messageId: "format", data: { call: "Intl.NumberFormat" } }] },
    { code: "const text = new window.Intl.NumberFormat().format(coins) + new self.Intl.ListFormat().format(names)", errors: [{ messageId: "format" }, { messageId: "words" }] },
    { code: "const I = Intl; const collator = new I.Collator()", errors: [{ messageId: "order", data: { call: "Intl.Collator" } }] },
    { code: "const I = globalThis.Intl; const rules = new I.PluralRules()", errors: [{ messageId: "words", data: { call: "Intl.PluralRules" } }] },
    { code: "const text = Intl[\"NumberFormat\"]().format(coins)", errors: [{ messageId: "format", data: { call: "Intl.NumberFormat" } }] },
    // Reported once, where the global is read.
    { code: "const { NumberFormat } = Intl; const text = new NumberFormat().format(coins)", errors: [{ messageId: "format", data: { call: "Intl.NumberFormat" } }] },
    { code: "const { Collator: Order, PluralRules } = Intl", errors: [{ messageId: "order" }, { messageId: "words" }] },
    { code: "const { Intl: { PluralRules } } = globalThis", errors: [{ messageId: "words", data: { call: "Intl.PluralRules" } }] },
    { code: "const { Intl: I } = globalThis; const collator = new I.Collator()", errors: [{ messageId: "order", data: { call: "Intl.Collator" } }] }
  ]
})
