# Why the `ritmo-pixel-art` skill says what it says

This file is for the maintainers and the agents working on this repo. It is not published: `package.json` `files` leaves it out (`pnpm pack:check` fails if it ships), and the website does not read it.

Every principle in [`skills/ritmo-pixel-art`](skills/ritmo-pixel-art/SKILL.md) traces back to one of two things:

- **Practice:** advice from pixel artists, art directors, and engine documentation, quoted below with a link.
- **Ritmo:** how `ritmo-tools pixel` works, how the library draws, or a direction from the maintainer. These are conventions, not craft claims, and are marked as such. Most maintainer directions come from the *Still Time* art pass (2026-10-30): seven review rounds between a reviewing agent acting for the maintainer and an image-making agent, on a 24×24 top-down game, judged on phone captures.

A rule that is neither does not go in the skill. The skill states principles and leaves the procedure to the agent: a tile count, a shade count, a frame count, or a step-by-step recipe does not go in, even with a source, because it makes every game look the same. The skill also says nothing the tool already says: `pixel lint` checks size, palette, color count, half-transparent pixels, lone pixels, and near-duplicate colors, and `fx check` the craft of effects (jaggies, doubles, holes, flicker, contrast), so the skill covers only what still needs judgement. When you change the skill, change this file in the same commit.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. Engine documentation (Godot, Unity, MDN) is quoted for what a renderer must do, not as a style authority. Pedro Medeiros's picture tutorials (clusters, outlines, silhouettes, tiles) and Michael Azzi's *Pixel Logic* are the field's references on sprite craft, but they are images and a paid book, so they are not quoted; his written articles are.

## Where we chose against a source

- **One pixel size, whole multiples included.** Medeiros allows two sizes and whole multiples: "Do not mix more than two resolutions." … "Use integer multiples, like elements at 100% and others at 200%" ([Scaling][saint-scaling]). The skill says one, because the second size in a game is a style (Octopath Traveler's HD-2D, Shovel Knight's 4.5× pixel) that its makers chose and explained, never a second asset's accident, and a 2× sprite among 1× ones is the mistake most often seen in generated art. The skill keeps the choice open under "An exception is a decision, written down."
- **Tiles hide the grid, unless the grid is the game.** Tsugumo and Schlitter (below) hide the grid without exception; in a tactics or puzzle game the grid is what the player reads, so it belongs to the first read (Gage: "things in the first read are never purely decorative"). The skill makes it even and quiet there instead.
- **Outlines are not legislated.** Medeiros calls outlines "one of the first things to throw away" at very low resolution ([Low resolution][saint-lowres]); Schlitter writes that for projectiles "outlines are almost certainly necessary" ([Pixelblog 31][slynyrd-31]). Both are right for their case, so the skill makes the outline the characters' rule, whatever it is, and has everything else follow it.
- **Whole-pixel parallax is the default, not the law.** Schlitter: "you can't move a half pixel" ([Pixelblog 23][slynyrd-23]); Godot documents the cost of snapping, "less smooth movement" ([Project settings][godot-settings]). The skill says layers scroll whole pixels and lists a smooth parallax among the exceptions a person may choose.
- **Still Time's read order was not kept.** The game's order (what can hurt, what you can act on, characters, props, floor) came from a top-down room where the floor is backdrop. In a platformer the ground is what the player stands on, so the skill ranks by what the player needs to play and separates "what supports or blocks" from "what is only backdrop" instead of naming the floor.
- **Sources left out.** The bugnet.io articles that search engines return for every query in this area (resolution, jitter, readability) carry rotating bylines and templated slugs across thousands of posts, and two cited pages vanished during the check; nothing is quoted from them. Other agents' pixel-art skills are not quoted either: they show what others have built, not established practice.

## The intro: one game, judged by eye; the lint is not a verdict

- Conway, "Best Tools & Tricks for Pixel Art", 80 Level, 2015 ([link][conway]): "Game art in general lives and dies based on readability." … "The assets on screen should not be fighting for your attention."
- Yu, "Pixel Art Tutorial: Basics" ([link][yu]): "In game development, a single static sprite is just one small piece of a very complex arrangement of pieces" … "it's important not to lose sight of the bigger picture, so to speak."
- **Ritmo:** what `pixel lint` checks is listed above; the skill's old line, "whether it reads well is yours to judge", is now the rule for every asset. "A clean lint … never settles a look" is the `ritmo-fx` rule (only the person's `approved` says it looks right), applied to sprites and tiles. The three terms the intro defines (art pixel, screen pixel, display size) are there because test agents read "1×" as the sprite at its own pixel count, not as the game's scale on the player's screen.

## One grid

### Pick the game's size in art pixels first, from the smallest detail that must read; smaller when in doubt

- Medeiros, "My Thoughts on Style Consistency", 2023 ([link][saint-consistency]): "The primary strategy for developing a pixel art game is to choose a resolution and stick to it."
- Pixel Parmesan, "Choosing the right resolution for your pixel art", 2021 ([link][parmesan]): "What is the smallest necessary detail?" … "For characters, the smallest necessary detail will typically be facial features, especially the eyes." … "However, bigger is usually not better." … "if in doubt, go smaller."
- Medeiros, "My Thoughts on Very Low Resolution", 2020 ([link][saint-lowres]): "Having few pixels to work with means that each and every one of them is very valuable".
- Godot docs, "Multiple resolutions" ([link][godot-res]): "Most pixel art games use viewport sizes between 256×224 and 640×480." … "Set the base window size to the viewport size you intend to use."
- Berry, "Remaking Celeste's Lighting", 2017 ([link][berry]): "we're making a pixel art game. Our screen resolution is tiny (320x180)".
- Schlitter, "Pixelblog 22: Top Down Character Sprites", 2019 ([link][slynyrd-22]): "Generally, tile size is the best gauge for determining sprite size."
- "Changing it later means redrawing everything" is what the sources imply and what Still Time showed (**Ritmo**): a 32×32 overhaul in review 6 was rejected ("We still want the same sizing and atmosphere as before") and reverted, with the HUD offsets it had moved.

### One pixel size across the game, whole multiples included; a second size is a style chosen once

- Medeiros, "Style Consistency" ([link][saint-consistency]): "The "sacred rule" of pixel art dictates that you shouldn't mix resolutions, and for a good reason: combining sprites of different resolutions can result in an amateurish and confusing appearance." … "Never use any smoothing algorithms for scaling pixel art, unless you know exactly what you are doing."
- Medeiros, "Scaling Pixel Art", 2024 ([link][saint-scaling]): "Use integer multiples, like elements at 100% and others at 200%, but never at 150%."
- Godot docs, "Multiple resolutions" ([link][godot-res]): "Set the stretch scale mode to `integer`. This prevents uneven pixel scaling from occurring, which makes pixel art not display as intended."
- MDN, "Crisp pixel art look with image-rendering" ([link][mdn]): "you have to ensure that the image pixels are always drawn at integer multiples of canvas pixels."
- Mixing as a decision: Takahashi (Octopath Traveler producer), Unreal Engine spotlight, 2019 ([link][octopath]): "we concluded that the game will look new and fresh if we combine this 3D art with 2D pixels." Yacht Club Games, "Breaking the NES", 2014 ([link][yacht]): "each Shovel Knight pixel is really 4.5×4.5 pixels at 1080p, giving a virtual resolution of 400×240."
- **Ritmo:** in Still Time the maintainer's note "Some decorations look too complex and off-pixel compared to the characters" became review 4's first direction, "One pixel density across everything." Whole multiples are ruled out too (see "Where we chose against a source").

### Fit the screen by a whole number; the whole frame scaled once, or every sprite snapped at final size; zoom in whole steps

- Godot docs, "Multiple resolutions" ([link][godot-res]): "When set to `integer`, the value is rounded down to the nearest integer." … "This is useful to prevent distortion when displaying pixel art." … "Set the stretch aspect to `keep` to enforce a single aspect ratio (with black bars)." … "The `viewport` stretch mode provides low-resolution rendering that is then stretched to the final window size."
- Unity docs, "2D Pixel Perfect" ([link][unity]): Upscale Render Texture has "the Scene rendered to a temporary texture set as close as possible to the Reference Resolution" … "This temporary texture is then upscaled to fit the entire screen. The result is unaliased and unrotated pixels"; Crop Frame "Crops the viewport with black bars to match the Reference Resolution along the checked axis."
- MDN ([link][mdn]): "if you draw a 128x128 pixel image into a 100x100 pixel area on the canvas, each image pixel will be drawn as 0.78x0.78 canvas pixels, which can lead to blurriness."
- "On each screen" because the whole number differs per device (a test agent asked whether one scale serves all). The two strategies are the two engine designs above: a base-size frame scaled once (Godot's `viewport`, Unity's upscaled texture, where rotation keeps the game's pixel size) or sprites at final size with snapping (Godot's `canvas_items` with pixel snap, Unity's Pixel Snapping). "Zoom moves in whole steps" follows from integer scaling applied to the camera.
- **Ritmo:** "counting the screen's real pixels, not its CSS pixels" is a browser detail (a phone's CSS pixel is several device pixels), so a canvas sized in CSS pixels is scaled by a fraction underneath; a host convention, not a craft claim. Test agents on a reviewing pass named screen fitting on phones and TVs as the gap most likely to break a web pixel-art game.

### Keep fractions in the simulation, round only when drawing; every offset, each layer on its own; rotation and smooth scrolling as exceptions

- Godot docs, project setting `snap_2d_transforms_to_pixel` ([link][godot-settings]): "Their position can still be sub-pixel, but the decimals will not have effect as the position is rounded." … "This can lead to a crisper appearance at the cost of less smooth movement".
- Unity docs, "2D Pixel Perfect" ([link][unity]): "Pixel Snapping prevents subpixel movement and make Sprites appear to move in pixel-by-pixel increments" … "This does not affect any GameObjects' Transform positions."
- The camera too: markdibarry, Godot forum, 2024 ([link][godot-forum]): "Your character's sprite rendering snaps to the nearest rounded position, but the character still has the float position, so your camera has that float position too."
- Schlitter, "Pixelblog 23: Parallax Scrolling", 2019 ([link][slynyrd-23]): "For movement to be smooth and steady the scroll rate should be the same amount of pixels each frame." … "you can't move a half pixel." The skill says "each layer's offset is rounded on its own" rather than "a steady rate": a camera that follows the player has no steady rate, and a test agent read the first wording as forbidding parallax factors.
- Rotation: Unity docs ([link][unity]) describe the pixel-perfect target as "unaliased and unrotated pixels"; Wikipedia, "Pixel-art scaling algorithms" ([link][rotsprite]): RotSprite "produces far fewer artifacts than nearest-neighbor rotation algorithms."
- **Ritmo:** the `ritmo` skill's `ui-and-render` playbook keeps camera easing and other render-only state in render code and the simulation in plain numbers, so rounding belongs to the draw and never changes a replay.

### Text on the grid or on one separate layer; never a mix; legible on the smallest target screen

- Godot docs, "Using Fonts" ([link][godot-fonts]): "The font size must also be an integer multiple of the design size (which varies on a per-font basis), and the Control node using the font must be scaled by an integer multiple as well. Otherwise, the font may look blurry." … "Fonts that have a pixel art appearance should have their subpixel positioning mode set to Disabled. Otherwise, the font may appear to have uneven pixel sizes."
- "Never a mix" follows from Medeiros's rule on mixing resolutions; a test agent asked whether a hi-res system font counts as the separate layer, so the skill now says it does, for all text and UI at once. "Legible on the smallest screen the game targets" is Gage's first read applied to text (**Ritmo**): in Still Time the HUD was judged on the same phone captures as the art.

## Readability

### What the player must notice is read first; brightness before saturation; the backdrop recedes; no large flat or busy shape competes

- Gage, "Building Games That Can Be Understood at a Glance", GDC 2018, talk text ([link][gage]): "The first read pulls you in, and that's the core of your game" … "things in the first read are never purely decorative." … on the pieces of a board game: "They're the most important thing on the board, but they're also very small, and very detailed, and can end up being overwhelmed by large simple shapes, like the menus."
- Riot Games, "Clarity in League", 2021 ([link][riot-clarity]): "the most important thing at any given moment (like a major ultimate or CC) should draw the most attention."
- Valve, "Stylization With a Purpose: The Illustrative World of Team Fortress 2", GDC 2008, slides ([pdf][tf2-slides]): "Read Hierarchy" … "Highest contrast at chest level, where weapon is held".
- Lundeen (Valve), via Game Developer, 2008 ([link][valve-art]): "we still wanted health packs, blood, exit points to pop. We did that with a saturation threshold. Anything below that moves towards gray."
- Schlitter, "Pixelblog 31: Shmup Design", 2020 ([link][slynyrd-31]): "the projectiles should always be readable across all backgrounds." … "Use bright saturated colors to set them apart from the background."
- Schlitter, "Pixelblog 20: Top Down Tiles", 2019 ([link][slynyrd-20]): "Negative space is your friend." "Pixelblog 43" ([link][slynyrd-43]): "Drop shadows add essential depth, but they must be conservative in design to limit conflict with sprites and other tiles."
- Value before hue: Medeiros, "Very Low Resolution" ([link][saint-lowres]): "Solid shapes with contrasting colours are the way to go in extremely low resolution." Cure, "The Pixel Art Tutorial", PixelJoint, 2010 ([link][cure]): "A common problem newer artists exhibit is not having enough contrast."
- **Ritmo:** the order (what can hurt or block, what you can act on, what you control, props, decoration) generalizes the maintainer's from Still Time review 1: "the floor gets most of the attention and the threats get the least" … "After the characters, the threats should be the highest-contrast thing on screen" (see "Where we chose against a source" for why the floor is not named). "No large flat shape … competes" is Gage's "large simple shapes"; in Still Time review 4 it was the flat color outside the room ("Extend the dungeon there instead.").

### Gameplay signals speak one language, in levels

- Stout, "Enemy Attacks and Telegraphing", Game Developer, 2015 ([link][stout]): "If the player needs to dodge, block, or otherwise avoid damage – the player must first know the damage is coming."
- Kubodera, "Designing for Difficulty: Readability in ARPGs", Game Developer, 2022 ([link][kubodera]): "Expectations are about establishing a visual language that matches the expected outcome and remains consistent." … "Don't compromise readability as a means to increase difficulty."
- Beardilocks (Riot VFX), "Anatomy of a League of Legends Missile, Part 2", 2020 ([link][riot-missile]): "if everything is important, nothing is important." … "spells that do more damage should be bigger, brighter, and more threatening".
- **Ritmo:** the two levels are from Still Time review 2: a chase arc "as red and as thick as a bullet path, but "could reach you" is less urgent than "is coming at you now"". The skill says "gameplay signals", not "threats", so that hints, ranges, selections, and timers in games without combat are covered by the same rule.

### Every kind of character or piece is its silhouette; what the player controls is confused with nothing else

- Mitchell, Francke, Eng, "Illustrative Rendering in Team Fortress 2", NPAR 2007 ([pdf][tf2-paper]): "Even when viewed only in silhouette with no internal shading at all, the characters are readily identifiable to players." … "The body proportions, weapons and silhouette lines as determined by footwear, hats and clothing folds were explicitly designed to give each character a unique silhouette."
- Riot Games, "Clarity in League" ([link][riot-clarity]): "Silhouettes are the single most important thing for champion recognition in League."
- Petras (Overwatch art director), via Cook and Becker, 2022 ([link][petras]): "Was their silhouette too similar to an existing character?"
- Yu ([link][yu]): "A well-defined character has details that do not obscure the basic forms".
- **Ritmo:** "the one character with a time motif … Keep the teal/ivory identity that no enemy uses" and "Each one should be identifiable from its silhouette alone" are Still Time directions (reviews 1, 4, and 6); the player's accent color reserved for the player is the maintainer's rule, written as "what the player controls" so that strategy and puzzle games, which have no single hero, are covered. "Every kind" allows the tiers of one enemy as recolors of one shape.

## One style

### The characters (or the pieces) set the rules, generated assets included; a second style lives in its own area

- Medeiros, "Style Consistency" ([link][saint-consistency]): "Maintaining color count consistency is crucial in pixel art and is often underestimated." … "You can get away with mixing styles if each area of your game is kept separated and internally consistent." … "The trick here is the quarantine; styles never leak from one world to another."
- Schlitter, "Pixelblog 43" ([link][slynyrd-43]): "Even visual balance, and consistency in cluster work are some of the top design keys." "Pixelblog 31" ([link][slynyrd-31]): units with "overall visual consistency to imply they are all part of the same faction".
- Battle for Wesnoth wiki, "Creating Unit Art" ([link][wesnoth]): "Compare the size of your unit to the size of similar existing core units."
- **Ritmo:** "every generated or fixed asset" is there because each image-generator picture brings its own outline, light, and pixel size, and `pixel fix` corrects only the grid and palette. "Or the pieces in a game without them" covers puzzle and strategy games, where a test agent found no asset to take the numbers from. That the characters, not the tiles, set the rules is the maintainer's direction (Still Time review 4: "The characters set the rules: a 24×24 body, a 1 px dark outline, 3–4 shades per material, chunky clusters of pixels, no single stray pixels, no hairlines. Every environment piece follows the same rules. A crack is a 2–3 px cluster with a highlight pixel, not a 1 px diagonal line."), because the characters are read first.

### One palette, few colors, hue-shifted ramps; a material is one ramp in values; start from an existing palette

- Schlitter, "Pixelblog 1: Color Palettes", 2018 ([link][slynyrd-1]): "I like to create large palettes with lots of ramps, which I can then pull smaller palettes from per assignment." … "A good color ramp should also apply hue-shifting, which is a transition in hue across the color ramp." … "A little color goes a long way with pixel art, as you can see I never use a lot of colors for any one image."
- Cure ([link][cure]): "Hue-shifting is used because straight ramps are usually boring and don't reflect the variety of hues we see in reality," … "Control- The smaller the palette, the easier it is to manage." … "If you can't make a good sprite in 4 colors, using 40 colors isn't going to help."
- Medeiros, "Basic Color Theory" ([link][saint-color]): "My main objective when it comes to colors is to do as much as I can with as little as possible." … "try using large low saturation areas with small high saturation details."
- Yu ([link][yu]): "put any theorizing about palettes aside and just pick an existing one". Lospec's palette list ([link][lospec]) is the usual place, and `pixel palettes` lists the tool's presets (**Ritmo**).
- **Ritmo:** `pixel.config.json` holds the game's palette and every `pixel` and `fx` command reads it, so "each asset pulls its colors from it" is how the tool already works. "A material is one ramp in different values" is from Still Time review 3: "Three stone families clash … Each block reads as two materials glued together: a beige top on blue bricks. Pick one stone family … and use different values of it".

### Tiles hide the grid (unless the grid is the game); variants drawn, details rare and clustered, decoration a layer; rare is not none

- Tsugumo, "So You Want To Be A Pixel Artist?", ch. 2 ([link][tsugumo-2]): "The greatest thing you can do when making a grid of tiles, is to make it look like it doesn't exist." Ch. 1 ([link][tsugumo-1]): "using the same tile and just changing the shades looks horrible".
- Schlitter, "Pixelblog 20" ([link][slynyrd-20]): "Although part of the charming aesthetic can be attributed to repetition, you don't want the tiles to be too obvious." … "Ultimately, a grass texture made up of only one tile becomes monotonous, no matter how awesome the tile is." … "The trick is in trying to hide the patterns within consistent non-distracting textures." … "A busy texture next to another busy texture may exhaust the eyes with too much noise."
- Schlitter, "Pixelblog 43" ([link][slynyrd-43]): "Step one with any tileset is the base repeating texture, which must loop well on all four sides."
- Cure ([link][cure]): "Noise is any sort of information that does not contribute to the piece".
- **Ritmo:** "clustered where wear happens" and "placed by hash" are Still Time directions (review 1: "Make cracks and moss rare (about one tile in eight) and cluster them near walls and cover, not spread evenly"; review 5: braziers "copy-pasted", "Vary it by hash"). "Rare is not none" is review 2: "The room is now a grey void … I asked for *rare*, not *none*." The skill keeps the principle and drops the one-in-eight; "by hand or by a fixed function of the tile's position" replaces "by hash", which a hand-placed tilemap never uses.

### Lines and shades follow the pixel craft; `pixel lint` does not check them

- Yu ([link][yu]): "With curved lines, jaggies crop up when the length of the line segments don't grow or shrink in a consistent manner." … "clean up the outline by removing stray pixels and reducing every line to a single pixel in thickness." … "By shading, you're not just adding color - you're sculpting out a form."
- Cure ([link][cure]): "Jaggies occur when a pixel or group of pixels are out of place, interrupting the flow of a line." … "Pillow-shading is bad because it pays no attention to the light source,".
- **Ritmo:** `fx check` measures jaggies, doubles, and holes on effects and the `ritmo-fx` skill's Craft explains them with their sources (`FX.md`); `pixel lint` checks none of them on sprites and tiles, so the skill names the rules once and points there.

### One light; under engine lighting, assets carry even shades and no strong baked light

- Schlitter, "Pixelblog 6: Light and Shadow", 2018 ([link][slynyrd-6]): "A light source should be established at the very start of any illustration."
- Medeiros, "Basic Shading" ([link][saint-shading]): "choosing a good light source is a skill as important as rendering the scene correctly." Cure ([link][cure]): "Pillow-shading is bad because it pays no attention to the light source,".
- Snake Hill Games, Sprite Lamp ([link][spritelamp]): with lighting drawn into 2D art, "often the artist will have to redraw certain things when lighting situations change."
- Vasseur (Motion Twin), "Using a 3D pipeline for 2D animation in Dead Cells", Game Developer, 2018 ([link][deadcells]): on an earlier project, "I had to draw all the shadows by hand on all the frames, a costly process we avoided by designing a lightning system with that in mind." Dead Cells exports each frame "along with its normal map".
- Berry, "Remaking Celeste's Lighting" ([link][berry]): "We decided early on the lighting had to interact with the environment."
- **Ritmo:** the rule under engine lighting is the reviewer's note in Still Time review 4: "Don't bake strong lighting or gradients into tiles. Keep sprites evenly lit with their own 3–4 shades." The skill keeps "strong": form shading stays (Celeste shades its sprites under its light map). Gameplay signals at full brightness under the light map ("Threat decals and shots stay at full brightness") is the same note, and the first read's rule carried into lighting.

## Motion

### Key poses first, few frames; one frame of wind-up; the area stays

- Schlitter, "Pixelblog 8: Intro to Animation", 2018 ([link][slynyrd-8]): "Good animation all starts with strong keyframes" … "Even with the in-between frames removed the gist of the animation should be readable from the keyframes alone." … "more frames creates smoother animation but not necessarily more energy." … "too many in-between frames can make your motion look sluggish."
- Schlitter, "Pixelblog 9: Melee Attacks", 2018 ([link][slynyrd-9]): "Anticipation and recovery frames add realism but can make sluggish gameplay." … "Most pixelart games keep it snappy and can get away with even fewer frames than my examples."
- Cartwright (Skullgirls), GDC 2014, via 80 Level ([link][cartwright]): "Having even a frame of anticipation will make your move much better in terms of readability."
- Medeiros, "A Basic Aseprite Animation" ([link][saint-anim]): "Keeping the volume is very important so your object doesn't look like it got smaller or bigger." The skill says "area" with the squash example, because a test agent read "volume" as forbidding squash and stretch.
- **Ritmo:** timing and effects are the `ritmo-fx` skill's Craft (`FX.md` has its sources), so the skill points there instead of repeating it.

## Judging

### In the game, at display size, on the smallest target screen, under the lighting if any, still and moving; squint

- Cure ([link][cure]): "Notice how the line appears thinner toward the center at 1x."
- Schlitter, "Pixelblog 20" ([link][slynyrd-20]): "it's very helpful to have a preview window open that displays the scene from a zoomed out view,". "Pixelblog 22" ([link][slynyrd-22]): "Ultimately, screen size is something you should mock up and test for yourself before deciding on."
- Tsugumo, ch. 2 ([link][tsugumo-2]): "You have to look at how your tile will look when it's on a map."
- Wesnoth wiki ([link][wesnoth]): "Test your unit early in the game."
- Yu ([link][yu]): "if you squint, a few large clusters of light and dark should still emerge."
- **Ritmo:** every Still Time review was written from phone captures of real rooms, and after lighting shipped the reviewer wrote "Judge your art under it. Append `?nolight` to the URL to compare against the unlit scene." In the `ritmo-prototype` skill one screenshot is the whole check in a round about looks; this skill asks for the same captures before art goes in. "When the target screen is out of reach, say so" is the `ritmo-prototype` rule of reporting what the check did not run.

### A reference is a set of named qualities; change what was asked and nothing else; options at display size and 4× beside it

- George, "Crafting the perfect game art brief", Game Developer, 2023 ([link][george]): "provide explanations for each image included in your mood board." … "highlight the areas that you want to emulate." … "Show what you don't want – this can be more helpful than showing what you do want."
- Gimate-Welsh, "From References to Concept Art", Game Developer, 2022 ([link][gimate]): "When the art team has clear and concrete references to draw from, much time in corrections is saved."
- Wesnoth wiki ([link][wesnoth]): "Compare the size of your unit to the size of similar existing core units."
- **Ritmo:** from Still Time reviews 6 and 7. A chibi reference handed over as "match it" became a 32×32 overhaul of the whole cast ("Bro, don't. That's too bad. We still want the same sizing and atmosphere as before. Don't overhaul all of it"), then a player that was "too anime", then an assassin: three rounds that naming what stays (size, palette, atmosphere) and which one asset changes would have saved. "Make 2–3 options at 1× and 4× on one sheet, and put them beside the reference" is the reviewer's process in those rounds; the skill keeps "two or three" as the shape of a choice, not a count to hit. "What was asked for and nothing else" replaces "the one asset asked for": a test agent asked what the one asset is when the request is "the forest".

### An exception is a decision, written down; a clean lint or two agents agreeing never settles a look

- Yacht Club Games, "Breaking the NES" ([link][yacht]): "Instead of emulating the NES exactly, we would create a rose-tinted view of an 8-bit game." … on the NES's one-axis screen shake, which they dropped: "And this is something we broke, because we didn't find a compelling reason to keep it."
- Godot docs ([link][godot-settings]) and Schlitter ([link][slynyrd-23]) each name the cost of the pixel-perfect default (less smooth movement; "you can't move a half pixel"), which is what makes smoothing a choice with a reason rather than a mistake.
- **Ritmo:** "the game's design notes" is where the `ritmo-prototype` skill's graduation keeps what is worth keeping, so a game already has the place. The same shape as the repo's lint (`// oxlint-disable-next-line ritmo/<rule> -- <reason>`) and `fx`'s `accept` with a reason: a judged exception is written with why. "Two agents agreeing never settles a look" is the maintainer's lesson from Still Time, where a briefing two models agreed on was rejected by the first playtest; the person who plays decides, as in `ritmo-prototype` ("Never say it is fun").

[saint-consistency]: https://saint11.art/blog/consistency/
[saint-scaling]: https://saint11.art/blog/scaling/
[saint-lowres]: https://saint11.art/blog/thoughts_on_low_resolution/
[saint-color]: https://saint11.art/pixel_art_articles/article6/
[saint-shading]: https://saint11.art/pixel_art_articles/article4/
[saint-anim]: https://saint11.art/pixel_art_articles/article3/
[cure]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
[yu]: https://www.derekyu.com/makegames/pixelart.html
[slynyrd-1]: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
[slynyrd-6]: https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow
[slynyrd-8]: https://www.slynyrd.com/blog/2018/8/19/pixelblog-8-intro-to-animation
[slynyrd-9]: https://www.slynyrd.com/blog/2018/9/8/pixelblog-9-melee-attacks
[slynyrd-20]: https://www.slynyrd.com/blog/2019/8/27/pixelblog-20-top-down-tiles
[slynyrd-22]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
[slynyrd-23]: https://www.slynyrd.com/blog/2019/11/12/pixelblog-23-parallax-scrolling
[slynyrd-31]: https://www.slynyrd.com/blog/2020/12/14/pixelblog-31-shmup-sprite-design
[slynyrd-43]: https://slynyrd.com/blog/2023/3/26/pixelblog-43-top-down-tiles-part-2
[tsugumo-1]: https://web.cs.wpi.edu/~claypool/courses/frontiers-06/samples/pixel-artist/chapter1.htm
[tsugumo-2]: https://web.cs.wpi.edu/~claypool/courses/frontiers-06/samples/pixel-artist/chapter2.htm
[lospec]: https://lospec.com/palette-list
[parmesan]: https://pixelparmesan.com/choosing-the-right-resolution-for-your-pixel-art/
[conway]: https://80.lv/articles/best-tools-tricks-for-pixel-art/
[godot-res]: https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html
[godot-settings]: https://docs.godotengine.org/en/stable/classes/class_projectsettings.html
[godot-fonts]: https://docs.godotengine.org/en/stable/tutorials/ui/gui_using_fonts.html
[godot-forum]: https://forum.godotengine.org/t/pixel-art-jittering/75305
[unity]: https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@5.0/manual/index.html
[mdn]: https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look
[rotsprite]: https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms
[berry]: https://noelberry.ca/posts/celeste_lighting
[octopath]: https://web.archive.org/web/20231202140802/https://www.unrealengine.com/en-US/spotlights/octopath-traveler-s-hd-2d-art-style-and-story-make-for-a-jrpg-dream-come-true
[yacht]: https://www.yachtclubgames.com/blog/breaking-the-nes
[deadcells]: https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-
[spritelamp]: https://www.snakehillgames.com/spritelamp/
[gage]: https://stfj.net/DesigningForSubwayLegibility/
[riot-clarity]: https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/
[riot-missile]: https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-2-what-are-we-communicating-with-our-vfx/13062
[tf2-paper]: https://www.cs.princeton.edu/courses/archive/fall07/cos597B/papers/mitchell-team-fortress.pdf
[tf2-slides]: https://cdn.steamstatic.com/apps/valve/2008/GDC2008_StylizationWithAPurpose_TF2.pdf
[valve-art]: https://www.gamedeveloper.com/art/in-depth-how-valve-makes-art-to-enhance-gameplay
[petras]: https://www.cookandbecker.com/en/article/378/designing-overwatch.html
[stout]: https://gamedeveloper.com/design/enemy-attacks-and-telegraphing
[kubodera]: https://www.gamedeveloper.com/game-platforms/designing-for-difficulty-readability-in-arpgs
[cartwright]: https://80.lv/articles/tips-on-making-fluid-and-powerful-animations
[wesnoth]: https://wiki.wesnoth.org/Creating_Unit_Art
[george]: https://www.gamedeveloper.com/design/crafting-the-perfect-game-art-brief
[gimate]: https://www.gamedeveloper.com/blogs/from-references-to-concept-art
