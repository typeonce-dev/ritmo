/** The review page as `ritmo-tools pixel review <paths>` serves it: the art and `pixel.review.json` are the files the agent reads. */
import { start } from "./lab.ts"
import { serverStore } from "./store.ts"

start(serverStore)
