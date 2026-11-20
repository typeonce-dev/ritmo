---
"@typeonce/oxlint-plugin-ritmo": minor
---

New simulation rule `ritmo/no-locale-in-simulation`: it reports simulation code that asks how a language orders, cases, or writes a value. The answer comes from the machine's language settings and from the language data its engine ships, so it differs between machines and a replay or an online session diverges: `names.sort((a, b) => a.localeCompare(b))` gives "Ärla, Zara" on an English machine and "Zara, Ärla" on a Swedish one, `"FIRE".toLocaleLowerCase()` is "fıre" on a Turkish one, and `coins.toLocaleString()` is "1,234.5" or "1.234,5".

It reports every member of `Intl` (found like the other globals: through `globalThis`, an alias, or destructuring), and `localeCompare`, `toLocaleLowerCase`, `toLocaleUpperCase`, `toLocaleString`, `toLocaleDateString`, and `toLocaleTimeString` on any value, also when the call names its language. `toLowerCase()`, `toUpperCase()`, `sort()` with no comparator, and `<` between strings are the same everywhere and are not reported. Each report names the fix: order by a number the world holds or by the strings themselves, use `toLowerCase()` / `toUpperCase()`, and keep the value in the world for view code to write.

The rule is off until the game lists it. Add it to the simulation override in `.oxlintrc.json`; view, UI, and host files are not in that override and keep using `Intl`:

```diff
       "rules": {
         "ritmo/no-float-timers": "error",
-        "ritmo/no-brand-cast": "error"
+        "ritmo/no-brand-cast": "error",
+        "ritmo/no-locale-in-simulation": "error"
       }
```
