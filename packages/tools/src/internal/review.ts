/**
 * What every tool's review says the same way, for its `notes`: what a
 * status is, what an approval with nothing kept of what was seen means, and
 * how a review of something no longer found is reported. Pixel, sound, fx,
 * and music each keep their own review file; this is what their notes share.
 */

/** What the person said about a piece: nothing yet, it is right, or change it. Only the person sets it. */
export type Status = "new" | "approved" | "changes"
export const statuses: ReadonlyArray<Status> = ["new", "approved", "changes"]

/**
 * Whether an approval kept nothing of what the person saw or heard (a review
 * from before approvals kept it, or one edited by hand): there is nothing to
 * compare the piece with now, so it is not taken as approved.
 */
export const isUnrecorded = (status: Status, approved: unknown): boolean => status === "approved" && approved === undefined

/** The `next` for an approval with no record. */
export const UNRECORDED_NEXT = "Approved, with no record of what was seen: ask the person to look again; only they approve it."

/**
 * What `notes` adds to such an entry: `unrecorded: true` and its `next`. An
 * approval that kept only part of what was seen (`unkept` names the rest, as
 * "its anchor") is unrecorded too: what it did not keep may have changed
 * unseen, so it is not taken as approved, and its `next` names what is missing.
 */
export const unrecordedOf = (status: Status, approved: unknown, unkept: ReadonlyArray<string> = []): { readonly unrecorded?: true; readonly next?: string } =>
  isUnrecorded(status, approved)
    ? { unrecorded: true, next: UNRECORDED_NEXT }
    : status === "approved" && unkept.length > 0
      ? { unrecorded: true, next: `Approved, with no record of ${unkept.join(" or ")}: ask the person to look again; only they approve it.` }
      : {}

/** One review whose piece is no longer found (renamed or deleted), as every tool's `notes` lists it under `gone`. */
export interface Gone {
  readonly status: Status
  readonly note: string | undefined
  /** The comments still open, for a tool whose reviews have comments. */
  readonly comments?: number | undefined
  readonly next: string
}

/**
 * A gone review's entry: what was said, and what to do with it. `what`
 * names the piece ("file", "sound", "effect") and `where` the review file it
 * is in, under its old name; a review that is a file of its own beside its
 * piece (a song's) is `alone`, and goes with it.
 */
export const goneEntry = (said: { readonly status: Status; readonly note: string; readonly comments?: number | undefined }, what: string, where: string, alone = false): Gone => ({
  status: said.status,
  note: said.note === "" ? undefined : said.note,
  ...(said.comments === undefined ? {} : { comments: said.comments }),
  next: alone
    ? `Its ${what} is gone. If it was renamed, rename ${where} to match; if it was deleted, delete ${where}.`
    : `Its ${what} is gone. If it was renamed, move its review to the new name's key in ${where}; if it was deleted, remove it there.`
})

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`

/** What a summary says about approvals: how many are approved, how many of those changed since (`stale`), and, apart, how many have no record. */
export const approvedSaid = (entries: ReadonlyArray<{ readonly status: Status; readonly changedSinceApproved?: string | undefined; readonly unrecorded?: true | undefined }>, look: "look" | "listen", more: ReadonlyArray<string> = []): string => {
  const unrecorded = entries.filter((entry) => entry.unrecorded === true).length
  const approved = entries.filter((entry) => entry.status === "approved").length - unrecorded
  const stale = entries.filter((entry) => entry.changedSinceApproved !== undefined).length
  const about = [...(stale === 0 ? [] : [`${stale} changed since: ask the person to ${look} again`]), ...more]
  return `${approved} approved${about.length === 0 ? "" : ` (${about.join("; ")})`}${unrecorded === 0 ? "" : `, ${unrecorded} approved with no record of what was seen: ask the person to ${look} again`}`
}

/** What a summary says last about reviews whose piece is gone: nothing when there are none. */
export const goneSaid = (gone: number): string => (gone === 0 ? "" : ` ${plural(gone, "review")} of what is no longer found: see \`gone\`.`)
