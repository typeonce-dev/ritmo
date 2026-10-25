import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Relation from "@typeonce/ritmo/Relation"
import type * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Name = Descriptor.Component<string>()("Dropped/Name")
const Idle = Descriptor.Tag("Dropped/Idle")
const { relation: Targeting } = Descriptor.Relation("Dropped/Targeting", "Dropped/TargetedBy")
const { relation: ChildOf } = Descriptor.Hierarchy("Dropped/ChildOf", "Dropped/Children")
const { relation: Elsewhere } = Descriptor.Relation("Dropped/Elsewhere", "Dropped/ElsewhereBy")

const Game = Schema.bind(Schema.fragment({
  components: { Name, Idle },
  relations: { Targeting, ChildOf }
}))
type S = typeof Game.schema

describe("Game.System.readDroppedRelations", () => {
  it("declares the access for one relation of the schema", () => {
    expect(Game.System.readDroppedRelations(Targeting)).type.toBe<System.DroppedRelationRead<typeof Targeting>>()
  })

  it("reads typed { relation, source, target } records and lagged()", () => {
    Game.System("Dropped/DropTargets", {
      droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) },
      commands: Game.System.commands(Game.System.inserts(Idle), Game.System.relates(Targeting))
    }, ({ droppedRelations, commands }) => {
      expect(droppedRelations.lost.all()).type.toBe<ReadonlyArray<Relation.Relation.Dropped<typeof Targeting, S, S>>>()
      expect(droppedRelations.lost.lagged()).type.toBe<boolean>()
      for (const { source, target } of droppedRelations.lost.all()) {
        // A system that writes the relation may read its dropped edges too.
        commands.insert(source, [Idle, {}])
        commands.relate(source, Targeting, target)
      }
    })
  })

  it("is readable from an inspector", () => {
    Game.Inspector("Dropped/Inspect", {
      droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) }
    }, ({ droppedRelations }) => droppedRelations.lost.all().length)
  })

  it("rejects a relation outside the schema and a non-relation", () => {
    // @ts-expect-error Argument of type 'RelationDefinition<"Dropped/Elsewhere"
    Game.System.readDroppedRelations(Elsewhere)
    // @ts-expect-error Type 'Descriptor<"component", "Dropped/Name", string>' is missing the following properties
    Game.System.readDroppedRelations(Name)
  })

  it("has no view for an undeclared slot", () => {
    Game.System("Dropped/Undeclared", {
      droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) }
    }, ({ droppedRelations }) => {
      // @ts-expect-error Property 'other' does not exist on type
      droppedRelations.other
    })
  })
})
