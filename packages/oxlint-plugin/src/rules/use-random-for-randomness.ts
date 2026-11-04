import { defineRule } from "@oxlint/plugins"

import { docsUrl, globalMember } from "../internal/ast.ts"

/**
 * Simulation code draws randomness from the world's Random resource, which is
 * seeded and saved, so a run replays exactly.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Draw randomness from the Random resource in simulation code, not Math.random or crypto.",
      url: docsUrl("use-random-for-randomness")
    },
    messages: {
      random:
        "{{call}} cannot be seeded or saved, so the run cannot replay. Draw from the world's Random resource: `const random = Random.draw(resources.rng)` (declare `rng: Game.System.writeResource(Rng)`), then `random.next()`, `random.range(min, max)`, `random.integer(min, max)`, `random.pick(items)`, or `random.shuffle(items)`.",
      uuid:
        "crypto.randomUUID() cannot replay. For an id within the world, use the entity's id (`entity.id`, kept as `Game.Entity.handle(...)`) or a counter in a resource. For an id unique across devices or runs (an account item, a save slot), make it in host code and pass it in with `runtime.send(...)`, so the replay records it."
    },
    schema: []
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (globalMember(context, node, "Math") === "random") {
          context.report({ node, messageId: "random", data: { call: "Math.random()" } })
          return
        }
        const crypto = globalMember(context, node, "crypto")
        if (crypto === "getRandomValues") context.report({ node, messageId: "random", data: { call: "crypto.getRandomValues()" } })
        if (crypto === "randomUUID") context.report({ node, messageId: "uuid" })
      }
    }
  }
})
