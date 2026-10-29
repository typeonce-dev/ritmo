#!/usr/bin/env node
/**
 * `ritmo-tools`: the asset tools for games made with Ritmo, run by agents.
 *
 *   ritmo-tools pixel <command>   checks, fixes, and makes pixel art and animations
 *   ritmo-tools sound <command>   checks, renders, and varies game sounds, and opens the review page
 *   ritmo-tools music <command>   listens to a hum, checks and renders songs, and opens the review page
 *
 * Every command prints JSON on stdout and exits with what to do next (see
 * each tool's `--help`). Built on Effect; nothing a game imports depends on it.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { CliError, Command } from "effect/cli"
import { toolsVersion } from "./internal/version.ts"
import { Exit, pixel } from "./pixel/cli/commands.ts"
import { printJson } from "./pixel/cli/io.ts"
import { music } from "./music/cli/commands.ts"
import { sound } from "./sound/cli/commands.ts"

const tools = Command.make("ritmo-tools").pipe(
  Command.withDescription("Ritmo's asset tools for agents: `pixel` for pixel art and animations, `sound` for sound effects, `music` for game music. Each prints JSON and exits with what to do next."),
  Command.withSubcommands([pixel, sound, music])
)

const program = Command.run(tools, { version: toolsVersion }).pipe(
  Effect.catchTag("CliFailure", (failure) =>
    Effect.gen(function* () {
      yield* Console.error(`ritmo-tools: ${failure.message}`)
      if (failure.details !== undefined) yield* printJson({ error: failure.message, ...failure.details })
      return yield* new Exit({ code: 2 })
    })
  ),
  // A usage mistake: the CLI has already printed what went wrong and the help.
  Effect.catchIf(CliError.isCliError, () => Effect.fail(new Exit({ code: 2 })))
)

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
