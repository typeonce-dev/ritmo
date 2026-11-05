---
"@typeonce/ritmo-tools": patch
---

`pixel review` and `pixel notes` fixes, from trying them on real games:

- The page keeps saving after the agent renames or replaces art it holds a review of (`pixel fix` does, putting `X.fixed.png` in place of `X.png`). Saves used to fail until a reload, which lost what was unsaved. The old review stays in `pixel.review.json` under its old name, and `pixel notes` lists it under `gone`.
- A page that has not heard an asset came back can no longer write over that asset's review.
- A comment being typed survives a click on a status or a reply from the agent, and is added when the person moves to another asset, animation, or view. Cancel or Esc drops it.
- `pixel notes` no longer says "Leave it as it is" about an approved asset with open comments. An asset with a note or comments but no status comes ahead of untouched ones, and the summary counts it apart.
- The server answers while it reads a large folder, and the page says how far it is. Past 500 assets, `pixel review` and `pixel notes` warn to name narrower folders. The page gets a picture's file as it is, rather than a copy written for it up front, so a large folder takes about a third less time and far less memory.
- Holding an arrow key down in Safari no longer stops the page moving through assets.
