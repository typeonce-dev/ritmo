# Set up Ritmo in a project

Follow these steps once in a new project, and for any step an existing project is missing. Use the project's package manager.

1. Install the runtime and the checks every Ritmo game uses:
   ```sh
   pnpm add @typeonce/ritmo
   pnpm add -D @typeonce/ritmo-devtools @typeonce/oxlint-plugin-ritmo oxlint
   ```
2. Link the Ritmo skill from the installed package into the folder your agent reads skills from (`.agents/skills`, `.claude/skills`, ...), so it updates with every Ritmo upgrade:
   ```sh
   mkdir -p .agents/skills
   ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo
   ```
3. Set up `.oxlintrc.json` from the `@typeonce/oxlint-plugin-ritmo` README and a `ritmo-devtools lint` entry from the `@typeonce/ritmo-devtools` README. One check script runs the type check, `oxlint`, `ritmo-devtools lint`, and the tests.
   After every Ritmo upgrade, compare `.oxlintrc.json` with that README's config: a new rule is not on until the config lists it, so an existing project does not get it by upgrading.

Add-ons, installed only when the game needs them:
- `@typeonce/ritmo-math`: 2D helpers on plain data (vectors, angles, swept circle collision, a flow field).
- `@typeonce/ritmo-browser`: a browser host (animation-frame loop; keyboard, gamepad, pointer, and touch input, local multiplayer).
- `@typeonce/ritmo-render`: mirrors entities into any renderer's nodes.
- `@typeonce/ritmo-pixi`: the Pixi adapter for `@typeonce/ritmo-render`.
- `@typeonce/ritmo-netcode`: online multiplayer (rollback or lockstep sessions over WebSocket, WebRTC, or any transport).

Then use the skill for every change: it says where the docs are and how to structure the game.
