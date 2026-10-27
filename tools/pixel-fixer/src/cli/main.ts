/** Runs `pixel` (see commands.ts) on the command line's arguments. */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { CliError, Command } from "effect/cli"
import { Exit, pixel } from "./commands.ts"
import { printJson } from "./io.ts"

const program = Command.run(pixel, { version: "0.0.0" }).pipe(
  Effect.catchTag("CliFailure", (failure) =>
    Effect.gen(function* () {
      yield* Console.error(`pixel: ${failure.message}`)
      if (failure.details !== undefined) yield* printJson({ error: failure.message, ...failure.details })
      return yield* new Exit({ code: 2 })
    })
  ),
  // A usage mistake: the CLI has already printed what went wrong and the help.
  Effect.catchIf(CliError.isCliError, () => Effect.fail(new Exit({ code: 2 })))
)

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
