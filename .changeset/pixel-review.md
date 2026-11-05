---
"@typeonce/ritmo-tools": minor
"@typeonce/ritmo": patch
---

`ritmo-tools pixel`: review all of a game's pixel art with a person on one page, and read back what they said.

- **`pixel review <paths...>`** serves a local page (port 5193) with every PNG and text sprite under the folders named, by folder, each with its status. A person looks at each asset at whole-number zooms, opening as large as fits with 1× a key away, over a dark, light, checkerboard, or custom backdrop, plays sheets by animation with their durations, sees a tile repeated, lines the whole set up at one scale on a grid by size (picking several to compare or approve at once), approves or asks for changes, and drags over the art to pin a comment to an area of pixels on one frame. Each asset's lint against its nearest `pixel.config.json` shows beside it. What the tools write beside the art (previews, project PNGs, onion pictures, scaled copies, frame folders) is left out, and a fix shows as one row with what it was made from.
- **`pixel notes <paths...>`** prints a `summary` of what is left, then each asset's status, note, open comments (numbered, with their area and frame), how many are resolved, its lint, and `next`, changes asked first. **`pixel resolve <asset> <numbers...> --reply "..."`** marks comments done; the open page shows them with the reply.
- **Approval keeps the pixels the person saw**: a hash of each frame as decoded, and its duration. A re-export that looks the same is no change, and neither is a color hidden under a transparent pixel. When an approved asset later looks different or plays at other timings, `pixel notes` and the page say which frames under `changedSinceApproved`, and the page offers **Approve it as it is now**.
- The review lives in one `pixel.review.json` beside the game's `package.json`, keyed by path, out of the folder that ships.
- `review`, `notes`, and `resolve` exit 0 or 2 only.
- `pixel lint` no longer runs out of memory on a picture of thousands of colors (a smooth app icon took gigabytes comparing every pair): past 512 colors it says the picture is not pixel art yet instead. On the review page and in `pixel notes`, a sheet frame with nothing drawn in it is an `empty-frame` error.

The `ritmo-pixel-art` skill says when to open the review and how to act on it, and that approving on the page does not replace looking at the art in the game at display size.
