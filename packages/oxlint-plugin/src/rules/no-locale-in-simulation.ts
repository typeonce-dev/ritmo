import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { docsUrl, globalRead, propertyName } from "../internal/ast.ts"

type Message = "order" | "letterCase" | "format" | "words"

/**
 * The methods that answer by a language's rules, by name: the receiver's type
 * is not known to a lint rule, and no other method shares these names.
 */
const methods = new Map<string, Message>([
  ["localeCompare", "order"],
  ["toLocaleLowerCase", "letterCase"],
  ["toLocaleUpperCase", "letterCase"],
  ["toLocaleString", "format"],
  ["toLocaleDateString", "format"],
  ["toLocaleTimeString", "format"]
])

/** The members of `Intl` with a message of their own; every other member is `words`. */
const intl = new Map<string, Message>([
  ["Collator", "order"],
  ["NumberFormat", "format"],
  ["DateTimeFormat", "format"],
  ["RelativeTimeFormat", "format"],
  ["DurationFormat", "format"]
])

/**
 * Simulation code never asks how a language orders, cases, or writes a
 * value: the answer comes from the machine's language settings and its
 * engine's language data, so it differs between machines and a replay or an
 * online session diverges.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Keep language rules out of simulation code: no Intl, localeCompare, or toLocale* methods.",
      url: docsUrl("no-locale-in-simulation")
    },
    messages: {
      order:
        "`{{call}}` orders text by a language's rules, taken from the machine's settings and its engine's language data, so two machines sort the same names differently and a replay or an online session diverges. Order by a number the world holds (an index, a rank), or compare the strings themselves, which every engine does the same way: `a < b ? -1 : a > b ? 1 : 0`.",
      letterCase:
        "`{{call}}` changes case by a language's rules (on a Turkish machine \"I\" lowers to \"ı\" and \"i\" raises to \"İ\"), so a lookup or a comparison made with it differs between machines. Use `toLowerCase()` or `toUpperCase()`, which answer the same everywhere. Case as a language writes it is for text the player reads, in view or UI code.",
      format:
        "`{{call}}` writes a value as a language writes it (\"1,234.5\", \"1.234,5\"), from the machine's settings and its engine's language data, so the text differs between machines; kept in the world, it is saved, checksummed, and replayed as written. Keep the value itself in the world, and write it where the world is read into view data (an inspector run with `runtime.inspect(...)`, or a system of a render schedule), outside the simulation's files.",
      words:
        "`{{call}}` reads the engine's language data, which differs between browsers and Node versions and follows the machine's settings, so it does not answer the same on every machine. The simulation holds ids and numbers; their words (a plural, a list, a name) are chosen where the world is read into view data (an inspector run with `runtime.inspect(...)`, or a system of a render schedule), outside the simulation's files."
    },
    schema: []
  },
  create(context) {
    /** Reports a member of the global `Intl`, however it is reached; `true` when `node` reads one. */
    const checkIntl = (node: ESTree.Node): boolean => {
      const read = globalRead(context, node)
      if (read?.from !== "Intl") return false
      context.report({ node, messageId: intl.get(read.path.slice("Intl.".length)) ?? "words", data: { call: read.path } })
      return true
    }
    return {
      MemberExpression(node) {
        if (checkIntl(node)) return
        const name = propertyName(node)
        const messageId = name === undefined ? undefined : methods.get(name)
        if (messageId === undefined) return
        // `score.toLocaleString = ...` gives an object its own method: nothing is asked of a language there.
        if (node.parent.type === "AssignmentExpression" && node.parent.left === node) return
        context.report({ node, messageId, data: { call: `${name}()` } })
      },
      // `const { Collator } = Intl`
      Property(node) {
        checkIntl(node)
      }
    }
  }
})
