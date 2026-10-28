# @typeonce/ritmo-tools

## 0.18.0

### Minor Changes

- 8322cd7: New package `@typeonce/ritmo-tools`: the `ritmo-tools` command, asset tools for agents. `ritmo-tools pixel` is the pixel fixer: it checks, fixes, and makes pixel art, and fixes animation sheets from image generators (`ritmo-tools pixel sheet`) onto one grid and palette, lined up, as a sprite sheet with its JSON (Pixi, Phaser, Aseprite) and a GIF. Run it with `npx @typeonce/ritmo-tools pixel <command>`, or add it as a dev dependency.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-pixel-art`, telling agents which `ritmo-tools pixel` command to run for each case. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-pixel-art .agents/skills/ritmo-pixel-art
  ```
