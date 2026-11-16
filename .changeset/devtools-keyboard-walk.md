---
"@typeonce/ritmo-devtools": minor
---

`ritmo-devtools keyboard [--url <url>] [--route <file>] [--json]` plays the game's page by keyboard in Chromium and fails on what breaks keyboard play: a menu open with focus outside it, Tab leaving an open menu, a control with no accessible name, Enter or Space not pressing the focused control, a press that drops focus to `<body>`, and a visible control the keyboard cannot reach. Each failure names the check, the screen, the control (role, name, selector), what was seen, and the fix; a check it cannot decide is printed as not checked, never as passed. Without `--url` it serves the working directory with the game's own Vite config. A route file lists the screens to visit and how to reach them; without one, the start page is the only screen. It presses controls for real to check focus, so a route marks what must not be pressed. It uses the optional `playwright` and `vite` peers `verify` already uses, at the same versions.
