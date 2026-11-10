---
"@typeonce/ritmo-devtools": minor
---

`ritmo-devtools lint` fails on Ritmo packages installed at different versions. Every package depends on `@typeonce/ritmo` at its own minor, so a game with core 0.23 and browser 0.22 got a second, hidden copy of core 0.22 inside browser, and then type errors between the two copies that named neither. From the working directory, the lint now finds every `@typeonce` package the game resolves and every copy those resolve in turn (npm and yarn trees, nested or hoisted, and pnpm's store), and when they are not one version prints one warning naming each copy and the fix, and exits with 1:

```
warning mismatched-versions @typeonce packages: @typeonce/ritmo-browser 0.22.0 is installed with @typeonce/ritmo 0.23.0 (and a second @typeonce/ritmo 0.22.0 under @typeonce/ritmo-browser): ...
  fix: install the same version of every @typeonce package
```
