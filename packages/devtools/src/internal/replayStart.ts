/**
 * Why a replay's checksums cannot be compared with its recording's, or
 * `undefined` when they can.
 *
 * Tick 0 is the world when the recorder started: the replay starts where the
 * recorded run did. A later start is a save the rolling window moved to, and
 * a save does not hold what the live game still had in flight there (events
 * published and not yet read, each reader's position in `added()`,
 * `changed()`, and the other streams, transient values), so an ordinary game
 * replays to a different checksum from it. Comparing would report a
 * nondeterminism that is not there.
 */
export const savedStart = (file: { readonly start: { readonly tick: number } }): string | undefined =>
  file.start.tick === 0
    ? undefined
    : `starts from a save at tick ${file.start.tick}: checksums are not compared (a save does not hold events in flight or what each reader had already seen); check determinism with Determinism.check, or with a replay recorded from the recorder's first tick`
