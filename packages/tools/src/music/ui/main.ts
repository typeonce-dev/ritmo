/** The review page as `ritmo-tools music review <song>` serves it: the song, its review, and the hum are the files the agent reads. */
import { start } from "./lab.ts"
import { serverStore } from "./store.ts"

start(serverStore)
