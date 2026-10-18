import { expect, it } from "vitest"
import { validateConfig } from "@typeonce/ritmo-native/compiler/config.ts"
import { firstDifference } from "@typeonce/ritmo-native/compiler/oracle.ts"
const valid = { entry: "native.ts", app: { name: "Game", id: "dev.test.game", version: "0.1.0" } }
it("validates configuration with actionable field names", () => {
  expect(validateConfig(valid, "/game").entry).toBe("/game/native.ts")
  expect(() => validateConfig({ ...valid, window: { width: NaN } }, "/")).toThrow("window.width")
  expect(() => validateConfig({ ...valid, targets: ["web"] }, "/")).toThrow("targets")
  expect(() => validateConfig({ ...valid, requireCompiled: [3] }, "/")).toThrow("requireCompiled")
  expect(() => validateConfig({ ...valid, app: { ...valid.app, id: "bad" } }, "/")).toThrow("app.id")
})
it("reports the first differing entity/component/field", () => {
  expect(firstDifference({ entities: [{ Position: { x: 1 } }] }, { entities: [{ Position: { x: 2 } }] })).toContain("world.entities.0.Position.x")
  expect(firstDifference({ x: [1, 2] }, { x: [1, 2] })).toBeUndefined()
})
