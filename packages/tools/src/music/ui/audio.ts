/**
 * The review page for a plain audio file: music not written as a song, so
 * there are no notes to edit, only the file to hear as the game plays it. The
 * person plays it, hears where it loops, and approves it or says what should
 * change, on a stretch of time they drag across the wave.
 */
import { button, callout, hint, prop, section } from "../../pixel/ui/kit.ts"
import { h, replace } from "../../pixel/ui/dom.ts"
import { drawWave } from "../../sound/ui/wave.ts"
import { loudnessOf, peakOf, type Stereo } from "../core/render.ts"
import { audioChangedOf, decodeAudioReview, emptyAudioReview, encodeAudioReview, type AudioReview } from "../core/review.ts"
import type { Status } from "../../internal/review.ts"
import { commentsSection, reviewSection, statusLabel } from "./panels.ts"
import type { Player } from "./player.ts"
import { monoOf } from "./record.ts"
import type { AudioSession, Store } from "./store.ts"

/** How far before the end "Hear the loop point" starts, in seconds. */
const LEAD_IN = 2

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

/** A time for a comment: to the tenth of a second, the way a person points at a moment. */
const moment = (seconds: number): string => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`

interface Heard {
  readonly stereo: Stereo
  readonly mono: { readonly samples: Float32Array<ArrayBuffer>; readonly sampleRate: number }
  readonly seconds: number
  readonly peak: number
  readonly loudness: number
}

export interface AudioViewOptions {
  readonly store: () => Store
  readonly player: Player
  /** The review changed by the person: save it, and record it for undo. */
  readonly onReview: () => void
  /** Something the panels or the transport show changed. */
  readonly onChange: () => void
}

export interface AudioView {
  /** The element the stage shows. */
  readonly element: HTMLElement
  /** Opens a file: shows it now, and its sound once it is decoded. */
  readonly open: (session: AudioSession) => void
  /** Takes a newer session of the file already open (the agent wrote it, or its review). */
  readonly follow: (session: AudioSession) => void
  readonly close: () => void
  /** What the page saves. */
  readonly reviewText: () => string
  /** Puts back what `reviewText` gave: undo and redo. */
  readonly restore: (text: string) => void
  readonly status: () => Status
  readonly changed: () => string | undefined
  readonly head: () => Array<HTMLElement | false>
  readonly panels: () => Array<HTMLElement>
  readonly transport: () => Array<HTMLElement | false>
  /** What the transport shows, so it redraws only when this changes. */
  readonly transportKey: () => string
  readonly toggle: () => void
  readonly stop: () => void
  readonly clear: () => void
  /** Redraws the wave's marks; the wave itself only when its size changed. */
  readonly draw: () => void
}

export const makeAudioView = (options: AudioViewOptions): AudioView => {
  const { player } = options
  const wave = h("canvas", { class: "wave audio-wave" })
  const marks = h("canvas", { class: "wave audio-marks" })
  const message = h("div", {})
  const box = h("div", { class: "wave-card audio-card" }, h("div", { class: "audio-box" }, wave, marks))
  const element = h("div", { class: "audio-view" }, message, box)

  let session: AudioSession | undefined
  let review: AudioReview = emptyAudioReview
  let heard: Heard | undefined
  let failed: string | undefined
  let opening = 0
  let selection: { from: number; to: number } | undefined
  let cue: number | undefined
  let draft = ""
  let loop = true
  let drawn = ""

  const decode = async (current: AudioSession): Promise<void> => {
    const ticket = ++opening
    heard = undefined
    failed = undefined
    drawn = ""
    render()
    const bytes = await options.store().readFile(current.id)
    if (ticket !== opening) return
    if (bytes === undefined) failed = "The file cannot be read."
    else {
      try {
        const buffer = await player.decode(bytes)
        if (ticket !== opening) return
        const left = buffer.getChannelData(0)
        const stereo: Stereo = { sampleRate: buffer.sampleRate, left, right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left }
        heard = { stereo, mono: { samples: monoOf(buffer), sampleRate: buffer.sampleRate }, seconds: buffer.duration, peak: peakOf(stereo), loudness: loudnessOf(stereo) }
      } catch {
        failed = "This browser cannot play the file."
      }
    }
    render()
    options.onChange()
  }

  const adopt = (current: AudioSession): void => {
    session = current
    const decoded = decodeAudioReview(current.reviewText)
    review = decoded.ok ? decoded.value : emptyAudioReview
  }

  const play = (at?: number): void => {
    if (heard !== undefined) player.play(heard.stereo, { loop, at })
    options.onChange()
  }

  const toggle = (): void => {
    const position = player.position()
    if (position !== undefined) {
      cue = position
      player.stop()
    } else {
      play(cue ?? selection?.from ?? 0)
      cue = undefined
    }
    draw()
    options.onChange()
  }

  const stop = (): void => {
    cue = undefined
    player.stop()
    draw()
    options.onChange()
  }

  const clear = (): void => {
    selection = undefined
    cue = undefined
    draw()
    options.onChange()
  }

  const changed = (): string | undefined => (session === undefined ? undefined : audioChangedOf(review, session.hash))

  const setReview = (next: AudioReview): void => {
    review = next
    options.onReview()
    options.onChange()
  }

  /** The wave is drawn once for its size: a long track has millions of samples, and the marks over it move every frame. */
  const draw = (): void => {
    const current = heard
    if (current === undefined) return
    const key = `${session?.id}:${wave.clientWidth}x${wave.clientHeight}`
    if (key !== drawn) {
      drawn = key
      drawWave(wave, current.mono, { seconds: current.seconds, color: "#bdbab3", ruler: { line: "rgba(243, 241, 236, 0.07)", text: "rgba(243, 241, 236, 0.4)" } })
    }
    drawWave(marks, undefined, { seconds: current.seconds, color: "", playhead: player.position() ?? cue })
    const context = marks.getContext("2d")
    if (context === null) return
    const scale = marks.width / current.seconds
    context.fillStyle = "rgba(240, 168, 67, 0.22)"
    for (const comment of review.comments) context.fillRect(comment.from * scale, 0, Math.max(2, (comment.to - comment.from) * scale), marks.height)
    if (selection !== undefined) {
      context.fillStyle = "rgba(243, 241, 236, 0.18)"
      context.fillRect(selection.from * scale, 0, Math.max(2, (selection.to - selection.from) * scale), marks.height)
    }
  }

  // A drag across the wave picks a stretch to comment on; a click puts the start marker there (while playing, jumps there).
  let dragFrom: number | undefined
  const secondsAt = (event: PointerEvent): number => {
    const rect = marks.getBoundingClientRect()
    return (Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))) * (heard?.seconds ?? 0)
  }
  marks.addEventListener("pointerdown", (event) => {
    if (heard === undefined) return
    marks.setPointerCapture(event.pointerId)
    dragFrom = secondsAt(event)
  })
  marks.addEventListener("pointermove", (event) => {
    if (dragFrom === undefined) return
    const at = secondsAt(event)
    selection = { from: Math.min(dragFrom, at), to: Math.max(dragFrom, at) }
    draw()
  })
  marks.addEventListener("pointerup", (event) => {
    if (dragFrom === undefined) return
    const at = secondsAt(event)
    const from = dragFrom
    dragFrom = undefined
    // Under a fifth of a second is a click, not a stretch.
    if (Math.abs(at - from) < 0.2 * Math.max(1, (heard?.seconds ?? 0) / 60)) {
      selection = undefined
      if (player.position() !== undefined) play(at)
      else cue = at
    } else {
      selection = { from: Math.min(from, at), to: Math.max(from, at) }
      cue = undefined
    }
    draw()
    options.onChange()
  })

  const render = (): void => {
    box.hidden = heard === undefined
    if (heard !== undefined) requestAnimationFrame(draw)
    replace(message, heard === undefined && h("div", { class: "empty-card lab-empty" }, h("h2", {}, failed ?? "Opening the file…")))
  }

  return {
    element,
    open: (current) => {
      adopt(current)
      selection = undefined
      cue = undefined
      draft = ""
      void decode(current)
    },
    follow: (current) => {
      const again = current.hash !== session?.hash
      adopt(current)
      if (again) {
        player.stop()
        void decode(current)
      }
    },
    close: () => {
      opening += 1
      session = undefined
      heard = undefined
      review = emptyAudioReview
    },
    reviewText: () => encodeAudioReview(review),
    restore: (text) => {
      const decoded = decodeAudioReview(text)
      if (decoded.ok) review = decoded.value
    },
    status: () => review.status,
    changed,
    head: () => {
      const now = changed()
      const extension = session?.name.split(".").pop()?.toUpperCase() ?? ""
      return [
        h(
          "div",
          { class: "sound-title" },
          h("h1", {}, session?.name ?? ""),
          h("span", { class: `stage-pill ${review.status}` }, statusLabel[review.status]),
          now !== undefined && h("span", { class: "stage-pill changes", title: now }, "Changed since"),
          h("span", { class: "stage-pill" }, extension),
          heard !== undefined && h("span", { class: "stage-pill" }, clock(heard.seconds))
        ),
        h("p", { class: "sound-about" }, "An audio file, heard as the game plays it. Drag across the wave to comment on a stretch of it.")
      ]
    },
    panels: () => {
      const add = (): void => {
        if (selection === undefined || draft.trim() === "") return
        const comment = { id: `c${Date.now().toString(36)}`, from: selection.from, to: selection.to, text: draft.trim() }
        draft = ""
        setReview({ ...review, comments: [...review.comments, comment] })
      }
      const approval = (): string | undefined => session?.hash
      return [
        reviewSection({
          help: 'Approve the file, or ask for changes in your own words ("the loop jumps", "too busy for a menu"). The agent reads it all with `ritmo-tools music notes`.',
          status: review.status,
          note: review.note,
          placeholder: "A note on the whole file (optional)",
          changed: changed(),
          onStatus: (status) => {
            const { approved: _approved, ...rest } = review
            setReview({ ...rest, status, ...(status === "approved" ? { approved: approval() } : {}) })
          },
          onNote: (note) => {
            review = { ...review, note }
            options.onReview()
          },
          onApproveAgain: () => setReview({ ...review, approved: approval() }),
          onToggle: options.onChange
        }),
        commentsSection({
          help: "Drag across the wave to pick a stretch of the file, then say what should change there.",
          where: selection === undefined ? undefined : `${moment(selection.from)} to ${moment(selection.to)}`,
          pick: "Drag across the wave to pick a stretch to comment on.",
          clear: "Clear",
          draft,
          onDraft: (text) => {
            draft = text
          },
          onAdd: add,
          onClear: clear,
          rows: [...review.comments]
            .sort((a, b) => a.from - b.from)
            .map((comment) => ({
              where: `${moment(comment.from)} to ${moment(comment.to)}`,
              text: comment.text,
              onPick: () => {
                selection = { from: comment.from, to: comment.to }
                cue = undefined
                draw()
                options.onChange()
              },
              onRemove: () => setReview({ ...review, comments: review.comments.filter((entry) => entry.id !== comment.id) })
            })),
          onToggle: options.onChange
        }),
        section(
          { id: "music-check", title: "Check", help: "What can be measured without listening.", onToggle: options.onChange },
          heard === undefined
            ? hint("Measuring…")
            : [
                prop("Length", h("span", { class: "value" }, clock(heard.seconds))),
                prop("Loudness", h("span", { class: "value" }, `${heard.loudness} dBFS`), "Over the whole file: about -18 to -24 sits well under sound effects"),
                prop("Peak", h("span", { class: "value" }, `${heard.peak} dBFS`), "The loudest sample: above 0 clips"),
                heard.peak > 0 && callout("warn", "It clips: its loudest samples go past full scale.")
              ]
        )
      ]
    },
    transport: () => {
      const position = player.position()
      const playing = position !== undefined
      const stopped = !playing && cue === undefined
      return [
        button(playing ? "Pause" : "Play", toggle, { variant: "ghost", icon: playing ? "pause" : "play", iconOnly: true, disabled: heard === undefined, title: playing ? "Pause (Space)" : "Play (Space)" }),
        button("Stop", stop, { variant: "ghost", icon: "stop", iconOnly: true, disabled: stopped, title: "Stop and go back to the start" }),
        h("span", { class: "frame-counter", title: "Where it is / how long it is" }, `${clock(position ?? cue ?? selection?.from ?? 0)} / ${clock(heard?.seconds ?? 0)}`),
        h("span", { class: "divider" }),
        button(
          "Loop",
          () => {
            loop = !loop
            if (playing) play()
            options.onChange()
          },
          { variant: "ghost", icon: "repeat", iconOnly: true, pressed: loop, class: loop ? "on" : "", title: loop ? "Plays around, as looping game music does" : "Plays once, as a sting does" }
        ),
        button(
          "Hear the loop point",
          () => {
            loop = true
            if (heard !== undefined) play(Math.max(0, heard.seconds - LEAD_IN))
          },
          { small: true, variant: "ghost", disabled: heard === undefined, title: "Plays the end of the file into its start: a seam shows here" }
        )
      ]
    },
    transportKey: () => {
      const position = player.position()
      return `${clock(position ?? cue ?? selection?.from ?? 0)}:${position !== undefined}:${cue === undefined}:${loop}:${heard?.seconds ?? 0}`
    },
    toggle,
    stop,
    clear,
    draw
  }
}
