import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import type { MissingRuntimeRequirements, TickOrderViolation } from "@typeonce/ritmo/Runtime"
import type * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Gold = Descriptor.Resource<number>()("Failures/Gold")
const Stock = Descriptor.Resource<number>()("Failures/Stock")
const Root = Schema.defineRoot("Failures")
const Game = Schema.bind(Schema.fragment({ resources: { Gold, Stock } }), Root)
const spec = { resources: { gold: Game.System.readResource(Gold), stock: Game.System.readResource(Stock) } }

describe("a system body's failure type", () => {
  it("is the union of two failure types", () => {
    const Buy = Game.System("Failures/Buy", spec, ({ resources }) => {
      if (resources.gold.get() < 5) return Result.failure("NotEnoughGold" as const)
      if (resources.stock.get() === 0) return Result.failure({ _tag: "OutOfStock" as const })
    })
    expect<System.FailureOf<typeof Buy>>().type.toBe<System.SystemFailure<"Failures/Buy", "NotEnoughGold" | { _tag: "OutOfStock" }>>()
  })

  it("is the union of three failure types", () => {
    const Buy = Game.System("Failures/BuyThree", spec, ({ resources }) => {
      if (resources.gold.get() < 5) return Result.failure("NotEnoughGold" as const)
      if (resources.stock.get() === 0) return Result.failure({ _tag: "OutOfStock" as const, item: "sword" })
      if (resources.stock.get() > 99) return Result.failure(99)
    })
    expect<System.FailureOf<typeof Buy>>().type.toBe<
      System.SystemFailure<"Failures/BuyThree", "NotEnoughGold" | { _tag: "OutOfStock"; item: string } | number>
    >()
  })

  it("is the one failure when the other branch returns nothing", () => {
    const Buy = Game.System("Failures/BuyOne", spec, ({ resources }) => {
      if (resources.gold.get() < 5) return Result.failure("NotEnoughGold" as const)
      return
    })
    expect<System.FailureOf<typeof Buy>>().type.toBe<System.SystemFailure<"Failures/BuyOne", "NotEnoughGold">>()
  })

  it("keeps an object failure's _tag, so it narrows", () => {
    const Buy = Game.System("Failures/BuyTagged", spec, ({ resources }) => {
      if (resources.gold.get() < 5) return Result.failure({ _tag: "NotEnoughGold" as const, missing: 5 - resources.gold.get() })
      if (resources.stock.get() === 0) return Result.failure({ _tag: "OutOfStock" as const })
    })
    type Error = System.FailureOf<typeof Buy>["error"]
    expect<Error>().type.toBe<{ _tag: "NotEnoughGold"; missing: number } | { _tag: "OutOfStock" }>()
    expect<Extract<Error, { _tag: "NotEnoughGold" }>["missing"]>().type.toBe<number>()
  })

  it("is never for a body that cannot fail", () => {
    const Count = Game.System("Failures/Count", spec, () => {})
    expect<System.FailureOf<typeof Count>>().type.toBe<never>()
  })

  it("carries the union to runtime.tryTick's error", () => {
    const Buy = Game.System("Failures/BuyTry", spec, ({ resources }) => {
      if (resources.gold.get() < 5) return Result.failure("NotEnoughGold" as const)
      if (resources.stock.get() === 0) return Result.failure({ _tag: "OutOfStock" as const })
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Gold: 0, Stock: 0 } }).value
    expect(runtime.tryTick(Game.Schedule(Buy))).type.toBe<
      Result.Result<void, MissingRuntimeRequirements | TickOrderViolation | System.SystemFailure<"Failures/BuyTry", "NotEnoughGold" | { _tag: "OutOfStock" }>>
    >()
  })

  it("still rejects a body that returns a value, naming the fix", () => {
    // @ts-expect-error a system returns nothing or Result.failure(...), and runs synchronously
    Game.System("Failures/Value", spec, ({ resources }) => resources.gold.get())
    // @ts-expect-error a system returns nothing or Result.failure(...), and runs synchronously
    Game.System("Failures/Mixed", spec, ({ resources }) => {
      if (resources.gold.get() < 5) return Result.failure("NotEnoughGold" as const)
      return resources.stock.get()
    })
  })
})
