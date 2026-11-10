#!/usr/bin/env node
/**
 * `ritmo-tools`: the asset tools for games made with Ritmo, run by agents.
 *
 *   ritmo-tools pixel <command>   checks, fixes, and makes pixel art and animations, and opens the review page
 *   ritmo-tools sound <command>   checks, renders, and varies game sounds, and opens the review page
 *   ritmo-tools music <command>   listens to a hum, checks and renders songs, and opens the review page
 *   ritmo-tools fx <command>      checks, looks at, and renders pixel art effects written as code, and opens the review page
 *
 * Every command prints JSON on stdout and exits with what to do next (see
 * each tool's `--help`). Built on Effect; nothing a game imports depends on it.
 */
import { NodeServices } from "@effect/platform-node"
import { Console, Effect, Runtime } from "effect"
import { CliError, Command } from "effect/cli"
import { toolsVersion } from "./internal/version.ts"
import { fx } from "./fx/cli/commands.ts"
import { Exit, pixel } from "./pixel/cli/commands.ts"
import { printJson } from "./pixel/cli/io.ts"
import { music } from "./music/cli/commands.ts"
import { sound } from "./sound/cli/commands.ts"

const tools = Command.make("ritmo-tools").pipe(
  Command.withDescription("Ritmo's asset tools for agents: `pixel` for pixel art and animations, `sound` for sound effects, `music` for game music, `fx` for pixel art effects. Each prints JSON and exits with what to do next."),
  Command.withSubcommands([pixel, sound, music, fx])
)

const program = Command.run(tools, { version: toolsVersion }).pipe(
  Effect.catchTag("CliFailure", (failure) =>
    Effect.gen(function* () {
      yield* Console.error(`ritmo-tools: ${failure.message}`)
      if (failure.details !== undefined) yield* printJson({ error: failure.message, ...failure.details })
      return yield* new Exit({ code: failure.code ?? 2 })
    })
  ),
  // A usage mistake: the CLI has already printed what went wrong and the help.
  Effect.catchIf(CliError.isCliError, () => Effect.fail(new Exit({ code: 2 }))),
  // Anything else thrown was not expected (a draft's own code, or a bug): said in one line, with no stack, and exit 1.
  Effect.catchDefect((defect) =>
    Effect.gen(function* () {
      const command = process.argv.slice(2).filter((arg) => !arg.startsWith("-")).slice(0, 2).join(" ")
      const message = `${command === "" ? "ritmo-tools" : command} failed: ${defect instanceof Error ? defect.message : String(defect)}`
      yield* Console.error(`ritmo-tools: ${message}`)
      yield* printJson({ error: message, next: "Not a failure the tool expected: the error says what threw. If it is not in your own code (a draft) or input, report it with the command and its input." })
      return yield* new Exit({ code: 1 })
    })
  )
)

/**
 * Runs the CLI as `NodeRuntime.runMain` does, without its SIGINT and SIGTERM
 * listeners: a listener runs on the event loop, so a command stuck in
 * synchronous work (a draft that loops as it loads, a large bake) would never
 * hear the signal, and would outlive `kill` and `timeout`. Every command keeps
 * Node's default (the signal ends it); a review server, the one command with
 * something to stop, listens for them itself (`untilStopped`).
 */
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) =>
    teardown(exit, (code) => {
      if (code !== 0) process.exit(code)
    })
  )
})

program.pipe(Effect.provide(NodeServices.layer), runMain)
