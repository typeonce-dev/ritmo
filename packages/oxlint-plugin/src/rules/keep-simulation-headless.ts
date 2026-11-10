import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { docsUrl, globalRead, importsOnlyTypes, stringValue } from "../internal/ast.ts"

/** Globals that are the page: input and layout. */
const page = new Set([
  "window", "document", "navigator", "screen", "matchMedia", "getComputedStyle", "devicePixelRatio",
  "innerWidth", "innerHeight", "addEventListener", "removeEventListener", "alert", "confirm", "prompt"
])

/** Globals that do host I/O: storage, requests, navigation. */
const io = new Set([
  "localStorage", "sessionStorage", "indexedDB", "caches", "fetch", "XMLHttpRequest", "EventSource", "location", "history"
])

/** Globals that connect to other peers: what online play goes through a netcode session for. */
const network = new Set(["WebSocket", "RTCPeerConnection", "RTCDataChannel"])

/** Globals that play sound. */
const audio = new Set(["Audio", "AudioContext"])

/** The report a listed global gets. */
const kindOf = (name: string): "page" | "io" | "network" | "audio" | undefined =>
  page.has(name) ? "page" : io.has(name) ? "io" : network.has(name) ? "network" : audio.has(name) ? "audio" : undefined

/** Renderer and UI packages, by exact name. */
const renderers = new Set([
  "@typeonce/ritmo-render", "@typeonce/ritmo-pixi", "pixi.js", "three", "react", "react-dom", "preact",
  "vue", "svelte", "solid-js", "phaser", "konva", "p5", "babylonjs", "@babylonjs/core"
])

/** Renderer and UI packages, by scope or subpath. */
const rendererPrefixes = ["@typeonce/ritmo-render/", "@typeonce/ritmo-pixi/", "@pixi/", "@preact/", "@react-three/", "three/", "react-dom/", "preact/", "@babylonjs/", "solid-js/"]

interface Options {
  readonly packages?: ReadonlyArray<string>
}

/**
 * Simulation code runs headless (tests, bots, replays, servers): it never
 * touches the page, does host I/O, plays sound, or imports a renderer, not
 * even a type, so another renderer can replace the current one. The host
 * feeds it input and data, and render code draws it and plays its sound.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Keep simulation code headless: no page globals, host I/O, audio, or renderer imports.",
      url: docsUrl("keep-simulation-headless")
    },
    messages: {
      page:
        "`{{name}}` is the page, which tests, bots, and replays do not have. Capture input in the host with `Keyboard`, `Pointer`, or `Touch` from `@typeonce/ritmo-browser` and `InputCapture` into a resource, and read that resource in systems. Pass other page state (size, settings) in from host code with `runtime.send(...)` or a resource.",
      io:
        "`{{name}}` is host I/O, which tests, bots, and replays do not have and cannot reproduce. Do the I/O in host code and pass the result in with `runtime.send(...)` or a resource; save and load the world in host code with `runtime.snapshot()` and `runtime.restore(...)`.",
      network:
        "`{{name}}` is a connection to other peers, which tests, bots, and replays do not have. For other players' input, run the simulation under a session of `@typeonce/ritmo-netcode` (`Netcode.rollback` or `Netcode.lockstep`): host code opens the connection and wraps it in a link (`WebSocketNetworkLink`, `WebRtcNetworkLink`), and remote input reaches the simulation through `Netcode.seats`, never `runtime.send(...)`, which a rollback would read on the wrong tick.",
      audio:
        "`{{name}}` plays sound from the simulation, which tests, bots, and servers do not have, and a replay or a rollback that runs the system again plays it again. Publish what happened as an event (`Game.System.writeEvent(Hit)`), and play the sound from a render or host system that reads it (`Game.System.readEvent(Hit)`) and requests the game's audio as a service (`Game.System.service(Audio)`), so a headless test can provide one that records. Under a `@typeonce/ritmo-netcode` session, play it from `session.events(Hit)` instead, so a rolled-back tick does not play it twice.",
      renderer:
        "The simulation imports `{{source}}`, a renderer or UI package, so it no longer runs headless. Draw from a render schedule in render code: mirror entities into nodes with `RenderSync` and a `NodeRegistry` from `@typeonce/ritmo-render`, and declare its services (a node registry) there. Renderer nodes stay in the registry, never in components.",
      rendererType:
        "The simulation names a type from `{{source}}`, a renderer or UI package, so it is tied to that renderer and another one cannot replace it. Declare renderer services (a node registry) and their types in render code; services are not registered in the schema. Renderer nodes stay in the registry, never in components."
    },
    schema: [
      {
        type: "object",
        properties: {
          packages: {
            type: "array",
            items: { type: "string" },
            description: "More renderer or UI packages the simulation must not import (a name, or a prefix ending in `/`)."
          }
        },
        additionalProperties: false
      }
    ]
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options
    const extra = options.packages ?? []
    const isRenderer = (source: string): boolean =>
      renderers.has(source) ||
      rendererPrefixes.some((prefix) => source.startsWith(prefix)) ||
      extra.some((entry) => (entry.endsWith("/") ? source.startsWith(entry) : source === entry || source.startsWith(`${entry}/`)))
    const checkSource = (node: ESTree.Node, source: string | undefined, onlyTypes = false): void => {
      if (source !== undefined && isRenderer(source)) context.report({ node, messageId: onlyTypes ? "rendererType" : "renderer", data: { source } })
    }
    /**
     * Reports a listed global read here: by name (`localStorage`), as a member
     * of a global object (`globalThis.localStorage`, `self.innerWidth`), or
     * destructured (`const { innerWidth } = self`). A member of a listed
     * global (`window.innerWidth`) is left to the report on that global.
     */
    const check = (node: ESTree.Node): void => {
      const read = globalRead(context, node)
      const kind = read === undefined ? undefined : kindOf(read.path)
      if (read === undefined || kind === undefined) return
      if (read.from !== undefined && kindOf(read.from) !== undefined) return
      context.report({ node, messageId: kind, data: { name: read.path } })
    }
    return {
      ImportDeclaration(node) {
        checkSource(node, node.source.value, importsOnlyTypes(node))
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) checkSource(node, node.source.value, node.exportKind === "type")
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source.value, node.exportKind === "type")
      },
      ImportExpression(node) {
        checkSource(node, stringValue(node.source))
      },
      Identifier(node) {
        if (kindOf(node.name) !== undefined) check(node)
      },
      MemberExpression: check,
      Property: check

    }
  }
})
