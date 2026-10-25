export interface Page {
  readonly href: string
  readonly title: string
}

/** The guide's pages, in reading order: the sidebar and the next-page links. */
export const sections = [
  {
    title: "Start",
    pages: [
      { href: "/docs/", title: "Getting started" },
      { href: "/docs/with-an-agent/", title: "With a coding agent" }
    ]
  },
  {
    title: "Learn",
    pages: [
      { href: "/docs/concepts/", title: "Concepts" },
      { href: "/docs/type-safety/", title: "Type safety" },
      { href: "/docs/browser/", title: "Loop, input, rendering" },
      { href: "/docs/devtools/", title: "Headless debugging" },
      { href: "/docs/comparison/", title: "Other ECS libraries" }
    ]
  },
  {
    title: "Features",
    pages: [
      { href: "/features/devices/", title: "Every device, one player" },
      { href: "/features/rebinding/", title: "Rebinding" },
      { href: "/features/multiplayer/", title: "Local multiplayer" },
      { href: "/features/bugs/", title: "Bugs found before players" },
      { href: "/features/replays/", title: "Replays that become tests" },
      { href: "/features/determinism/", title: "Same game everywhere" },
      { href: "/features/rollback/", title: "Online multiplayer" },
      { href: "/features/states/", title: "States that can't go wrong" },
      { href: "/features/composition/", title: "Entities that change shape" }
    ]
  },
  {
    title: "More",
    pages: [
      { href: "/examples/", title: "Examples" },
      { href: "/roadmap/", title: "Roadmap" },
      { href: "/brand/", title: "Brand" }
    ]
  }
] satisfies ReadonlyArray<{ readonly title: string; readonly pages: ReadonlyArray<Page> }>

export const pages: ReadonlyArray<Page> = sections.flatMap((section) => section.pages)

export const repository = "https://github.com/typeonce-dev/ritmo"
