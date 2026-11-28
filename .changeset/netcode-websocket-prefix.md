---
"@typeonce/ritmo-netcode": minor
---

**`WebSocketNetworkLink.make(socket, { prefix })` shares one socket with the game's own messages.** A page usually keeps one WebSocket to its room for both the lobby and the match, and the link took every text message on the socket, so a game had to write its own `NetworkLink` to tell them apart. With `prefix`, the link writes it before each message it sends, reads only the text messages that start with it (handed on without it), and leaves every other message to the game's own listener:

```ts
const link = WebSocketNetworkLink.make(socket, { prefix: "n" })
socket.addEventListener("message", (event) => {
  if (typeof event.data !== "string" || event.data.startsWith("n")) return // the session's
  lobby.receive(JSON.parse(event.data))
})
```

The game's own messages must never start with the prefix; an empty prefix does not compile (and throws). Without `prefix`, the link reads every text message, as before. A game with its own prefixing link can replace it with this one.
