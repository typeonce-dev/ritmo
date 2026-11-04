/** The inspector's review and comments, the same for a song and a plain audio file. */
import { button, callout, group, hint, section, segmented } from "../../pixel/ui/kit.ts"
import { h } from "../../pixel/ui/dom.ts"
import type { Status } from "../core/review.ts"

type Child = Node | string | null | undefined | false

export const statusLabel: Record<Status, string> = { new: "To review", approved: "Approved", changes: "Changes asked" }

const statusOptions: ReadonlyArray<{ readonly id: Status; readonly label: string; readonly icon: "sparkle" | "check" | "alert"; readonly title: string }> = [
  { id: "new", label: "To review", icon: "sparkle", title: "Not reviewed yet" },
  { id: "approved", label: "Approved", icon: "check", title: "It sounds right" },
  { id: "changes", label: "Changes", icon: "alert", title: "Ask the agent for changes: say what in the note and the comments" }
]

export const reviewSection = (options: {
  readonly help: string
  readonly status: Status
  readonly note: string
  readonly placeholder: string
  /** What changed since the person approved it, when something has. */
  readonly changed: string | undefined
  readonly onStatus: (status: Status) => void
  readonly onNote: (note: string) => void
  readonly onApproveAgain: () => void
  readonly onToggle: () => void
  readonly children?: Child
}): HTMLElement =>
  section(
    { id: "music-review", title: "Review", help: options.help, onToggle: options.onToggle },
    segmented(options.status, statusOptions, options.onStatus, { label: "Status", class: "fill" }),
    options.changed !== undefined &&
      callout("warn", `Changed since you approved it: ${options.changed}.`, h("div", { class: "approve-again" }, button("Approve it as it is now", options.onApproveAgain))),
    h(
      "label",
      { class: "input note" },
      h("textarea", {
        props: { value: options.note, rows: 3 },
        attrs: { placeholder: options.placeholder, "aria-label": "Note" },
        on: {
          input: (event) => {
            const target = event.currentTarget
            if (target instanceof HTMLTextAreaElement) options.onNote(target.value)
          }
        }
      })
    ),
    options.children
  )

export interface CommentRow {
  readonly where: string
  readonly text: string
  readonly onPick: () => void
  readonly onRemove: () => void
}

export const commentsSection = (options: {
  readonly help: string
  /** Where a new comment goes, when a span is picked. */
  readonly where: string | undefined
  /** What to do to pick a span. */
  readonly pick: string
  readonly clear: string
  /** More to choose about a new comment. */
  readonly extra?: Child
  readonly draft: string
  readonly onDraft: (text: string) => void
  readonly onAdd: () => void
  readonly onClear: () => void
  readonly rows: ReadonlyArray<CommentRow>
  readonly onToggle: () => void
}): HTMLElement =>
  section(
    { id: "music-comments", title: "Comments", help: options.help, onToggle: options.onToggle, action: h("span", { class: "meta" }, String(options.rows.length)) },
    options.where === undefined
      ? hint(options.pick)
      : group(
          `On ${options.where}`,
          options.extra,
          h(
            "label",
            { class: "input note" },
            h("textarea", {
              props: { value: options.draft, rows: 2 },
              attrs: { placeholder: "What should change here?", "aria-label": "Comment" },
              on: {
                input: (event) => {
                  const target = event.currentTarget
                  if (target instanceof HTMLTextAreaElement) options.onDraft(target.value)
                },
                keydown: (event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) options.onAdd()
                }
              }
            })
          ),
          h(
            "div",
            { class: "button-row" },
            button("Add comment", options.onAdd, { small: true, variant: "primary", icon: "comment" }),
            button(options.clear, options.onClear, { small: true, variant: "ghost" })
          )
        ),
    options.rows.length > 0 &&
      h(
        "ul",
        { class: "comments" },
        options.rows.map((row) =>
          h(
            "li",
            { on: { click: row.onPick } },
            h("span", { class: "comment-where" }, row.where),
            h("span", { class: "comment-text" }, row.text),
            button(
              "Remove",
              (event) => {
                event.stopPropagation()
                row.onRemove()
              },
              { variant: "ghost", icon: "trash", iconOnly: true, small: true }
            )
          )
        )
      )
  )
