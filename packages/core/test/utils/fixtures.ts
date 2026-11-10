import * as Runtime from "@typeonce/ritmo/Runtime"
import * as Schedule from "@typeonce/ritmo/Schedule"
import * as System from "@typeonce/ritmo/System"
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import type * as Entity from "@typeonce/ritmo/Entity"
import type { Schema } from "@typeonce/ritmo/Schema"

/**
 * Reads one resource value from a runtime through the public scheduling API.
 */
export const readResourceValue = <
  S extends Schema.Any,
  D extends Schema.ResourceDescriptor<S>
>(
  runtime: Runtime.Runtime<S, any, any, any, any>,
  schema: S,
  descriptor: D
): Descriptor.Value<D> => {
  let captured!: Descriptor.Value<D>

  const readSystem = System.System(
    `Test/ReadResource/${descriptor.name}`,
    {
      schema,
      resources: {
        value: System.readResource(descriptor)
      }
    },
    ({ resources }) =>
      {
        captured = resources.value.get() as Descriptor.Value<D>
      }
  )

  runtime.tick(Schedule.Schedule(readSystem) as never)

  return captured
}

/**
 * An id no runtime has given out, for tests of lookups and commands that name
 * an entity which never existed. Games cannot brand one: the constructor is
 * the runtime's own.
 */
export const unknownEntityId = <S extends Schema.Any, Root = unknown>(value: number): Entity.EntityId<S, Root> =>
  value as Entity.EntityId<S, Root>
