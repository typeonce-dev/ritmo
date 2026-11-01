/** The review page as `ritmo-tools rig review <bank>` serves it: the bank and its review are the files the agent reads, and the CLI bakes the drafts. */
import { start } from "./lab.ts"
import { serverStore } from "./store.ts"

start(serverStore)
