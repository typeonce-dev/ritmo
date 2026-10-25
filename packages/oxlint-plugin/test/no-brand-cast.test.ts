import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["no-brand-cast"]!

tester.run("no-brand-cast", rule, {
  valid: [
    "const directions = [\"up\", \"down\"] as const",
    "const raw = JSON.parse(text) as unknown",
    "type Point = { x: number; y: number }\nconst p = value as Point",
    "interface Enemy { readonly hp: number }\nconst e = <Enemy>value",
    // An intersection without a brand.
    "type Named = { name: string } & { id: number }\nconst n = value as Named",
    "const s = { x: 1 } satisfies Point",
    // A schema without a brand.
    "import { z } from \"zod\"\nconst Score = z.number().int()\ntype Score = z.infer<typeof Score>\nconst s = raw as Score",
    // Ritmo types that carry no brand, and names from other packages.
    "import { Clock } from \"@typeonce/ritmo\"\nconst t = value as Clock.Time<60>",
    "import { Clock } from \"./clock.ts\"\nconst d = value as Clock.Deadline",
    "import { Vec2 } from \"@typeonce/ritmo-math\"\nconst v = value as Vec2.Vec2",
    // A symbol made at runtime is a real key, not a brand.
    "const metaKey: unique symbol = Symbol(\"meta\")\nconst meta = (value as { readonly [metaKey]?: Meta })[metaKey]",
    // Validated through the constructor or the schema.
    "import { Random } from \"@typeonce/ritmo\"\nconst state = Random.seed(42)",
    "import { z } from \"zod\"\nconst UserId = z.string().brand(\"UserId\")\nconst id = UserId.parse(raw)"
  ],
  invalid: [
    {
      code: "import { z } from \"zod\"\nconst UserId = z.string().uuid().brand(\"UserId\")\ntype UserId = z.infer<typeof UserId>\nconst id = raw as UserId",
      errors: [{ messageId: "cast", data: { type: "UserId" } }]
    },
    {
      code: "import { z } from \"zod\"\nconst ItemId = z.string().brand<\"ItemId\">()\nconst id = raw as z.infer<typeof ItemId>",
      errors: [{ messageId: "cast", data: { type: "z.infer<typeof ItemId>" } }]
    },
    {
      code: "const id = raw as string & z.BRAND<\"UserId\">",
      errors: [{ messageId: "cast", data: { type: "string & z.BRAND<\"UserId\">" } }]
    },
    {
      // Effect Schema.brand, read with typeof X.Type and Schema.Schema.Type.
      code: "import { Schema } from \"effect\"\nconst Gold = Schema.Number.pipe(Schema.int(), Schema.brand(\"Gold\"))\ntype Gold = typeof Gold.Type\nconst a = 10 as Gold\nconst b = 5 as Schema.Schema.Type<typeof Gold>",
      errors: [{ messageId: "cast", data: { type: "Gold" } }, { messageId: "cast", data: { type: "Schema.Schema.Type<typeof Gold>" } }]
    },
    {
      code: "import { Brand } from \"effect\"\ntype Lives = number & Brand.Brand<\"Lives\">\nconst lives = 3 as Lives",
      errors: [{ messageId: "cast", data: { type: "Lives" } }]
    },
    {
      code: "import type { Brand } from \"@typeonce/ritmo\"\ntype Meters = Brand.Branded<number, \"Meters\">\nconst m = <Meters>(distance * 2)",
      errors: [{ messageId: "cast", data: { type: "Meters" } }]
    },
    {
      code: "type Seed = number & { readonly __brand: \"Seed\" }\nconst seeds = values as ReadonlyArray<number> as Seed[]",
      errors: [{ messageId: "cast", data: { type: "Seed[]" } }]
    },
    {
      code: "declare const tileBrand: unique symbol\ninterface TileBrand { readonly [tileBrand]: true }\ntype Tile = number & TileBrand\nconst tile = (y * width + x) as Tile",
      errors: [{ messageId: "cast", data: { type: "Tile" } }]
    },
    {
      // Ritmo's own branded exports.
      code: "import { Random } from \"@typeonce/ritmo\"\nconst rng = Random.resource(\"Game/Rng\", 1 as Random.State)",
      errors: [{ messageId: "cast", data: { type: "Random.State" } }]
    },
    {
      code: "import { Clock, Entity } from \"@typeonce/ritmo\"\nconst ready = (step + 30) as Clock.Deadline<60> | null\nconst target = id as unknown as Entity.Handle<Root>",
      errors: [{ messageId: "cast", data: { type: "Clock.Deadline<60> | null" } }, { messageId: "cast", data: { type: "Entity.Handle<Root>" } }]
    },
    {
      code: "import type { Deadline } from \"@typeonce/ritmo/Clock\"\nimport * as Ritmo from \"@typeonce/ritmo\"\nconst d = n as Deadline\nconst s = raw as Ritmo.Random.State",
      errors: [{ messageId: "cast", data: { type: "Deadline" } }, { messageId: "cast", data: { type: "Ritmo.Random.State" } }]
    }
  ]
})
