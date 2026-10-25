/**
 * Oxlint rules for Ritmo games.
 *
 * Types catch wrong calls and devtools catch wrong runs; these rules catch
 * the source patterns neither can see: simulation code that reads the wall
 * clock, `Math.random`, engine-dependent math, or the page, timers counted
 * in floats, data that cannot be saved, casts that skip a brand's check,
 * state values that keep a previous state's fields, and runtime results that
 * are dropped. Every report names the Ritmo API to use instead.
 *
 * Register the plugin in `.oxlintrc.json` with `"jsPlugins":
 * ["@typeonce/oxlint-plugin-ritmo"]`. Its rules are named `ritmo/<rule>`.
 * Turn the simulation rules on only for the game's simulation files (with
 * `overrides`), so host, render, tool, and unrelated files keep using the
 * platform freely:
 *
 * - Simulation files: `ritmo/use-clock-for-time`,
 *   `ritmo/use-random-for-randomness`, `ritmo/use-ops-for-math`,
 *   `ritmo/keep-simulation-headless`, `ritmo/no-infinity-in-simulation-data`,
 *   `ritmo/no-float-timers`, `ritmo/no-brand-cast`.
 * - Every file: `ritmo/handle-runtime-result`,
 *   `ritmo/prefix-descriptor-and-system-names`, `ritmo/use-cell-value`,
 *   `ritmo/no-state-spread`.
 *
 * @module oxlint-plugin-ritmo
 */
import { definePlugin } from "@oxlint/plugins"

import handleRuntimeResult from "./rules/handle-runtime-result.ts"
import keepSimulationHeadless from "./rules/keep-simulation-headless.ts"
import noBrandCast from "./rules/no-brand-cast.ts"
import noFloatTimers from "./rules/no-float-timers.ts"
import noInfinityInSimulationData from "./rules/no-infinity-in-simulation-data.ts"
import noStateSpread from "./rules/no-state-spread.ts"
import prefixDescriptorAndSystemNames from "./rules/prefix-descriptor-and-system-names.ts"
import useCellValue from "./rules/use-cell-value.ts"
import useClockForTime from "./rules/use-clock-for-time.ts"
import useOpsForMath from "./rules/use-ops-for-math.ts"
import useRandomForRandomness from "./rules/use-random-for-randomness.ts"

export default definePlugin({
  meta: { name: "ritmo" },
  rules: {
    "use-clock-for-time": useClockForTime,
    "use-random-for-randomness": useRandomForRandomness,
    "use-ops-for-math": useOpsForMath,
    "keep-simulation-headless": keepSimulationHeadless,
    "no-infinity-in-simulation-data": noInfinityInSimulationData,
    "no-float-timers": noFloatTimers,
    "no-brand-cast": noBrandCast,
    "handle-runtime-result": handleRuntimeResult,
    "prefix-descriptor-and-system-names": prefixDescriptorAndSystemNames,
    "use-cell-value": useCellValue,
    "no-state-spread": noStateSpread
  }
})
