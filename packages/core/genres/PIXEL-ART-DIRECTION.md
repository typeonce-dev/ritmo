# Art direction for a pixel-art game: the layers, the world, the cast

This file is for the maintainers and the agents working on this repo. It is research, not a skill: it is not published (`package.json` `files` leaves `genres/` out), and the website does not read it.

The [`ritmo-pixel-art`](../skills/ritmo-pixel-art/SKILL.md) skill already holds the craft of one asset and the rules that make a game read as one game: one grid and one pixel size, whole-pixel scaling and parallax, the read order, signals in levels, silhouettes, one palette, tiles that hide the grid, one light, motion, and how to judge a capture ([`PIXEL-ART.md`](../PIXEL-ART.md) has its sources). This file does not repeat any of that. It covers what sits above a single asset: how a screen is built from planes (sky, backdrop, play layer, foreground), what makes each plane do its job, how parallax and depth are made, how a place gets its identity and its decoration, and how characters and NPCs sit in the world.

Effects drawn on top of the art (lighting, shaders, post-processing, bloom, blur) are another research thread's subject. They come up here only where they touch the layers.

Every principle below traces back to one of two things, as in the skill's research files:

- **Practice:** advice from pixel artists, art directors, and level artists, quoted below with a link.
- **Ritmo:** how the library or the `ritmo-pixel-art` skill already works, or a direction from the maintainer. These are conventions, not craft claims, and are marked as such.

A principle that is neither does not go in. Counts that sources give (layers, scroll speeds, adjustment percentages) are quoted as examples of one artist's choice and never become a rule, for the reason the skill gives: a fixed number makes every game look the same.

Quotes were read on the linked page on 2026-11-01 through a fetch tool (this environment's network refuses direct downloads). The key quotes from Dead Cells, Frozenbyte, and Schlitter's Pixelblogs 32 and 62 were checked a second time, sentence by sentence. A quote marked "via" was read on a secondary page, not in the original. One source is a 3D studio's guide (Frozenbyte, the *Trine* games, which are played on a 2D plane): it is quoted for what each plane of a 2D-played scene must do, never for pixel craft.

## Where we chose against a source

- **Far planes are less saturated, not more.** The maintainer's own 2023 platformer guide says "Backgrounds far from the player should have more saturated colors" ([link][smg]); its author has since archived it as no longer his approach. Schlitter ("saturation reduces with each receding plane", [Pixelblog 62][s62]) and Frozenbyte ("the closer a thing is, the more contrast it has", [Color and Lighting][fb-color]) agree on the opposite, and Schlitter's own fix for sprites that did not pop was to turn the background's saturation down ([Pixelblog 63][s63]). We follow them. A saturated sky (a sunset, a neon city) is still possible as a written decision, with the play layer kept above it in value contrast.
- **No layer count.** Shovel Knight averages "5-6 layers of backgrounds" ([Yacht Club][yacht]); Schlitter says parallax "really comes alive with 3" ([Pixelblog 32][s32]) and builds 6 and 9 in other lessons ([63][s63], [46][s46]). The principle is the job each plane does, not how many there are.
- **Saturation as a reserved signal, not a style ban.** Dead Cells is a deliberately saturated game ("highly saturated color spectrums", via [GoNintendo][dc-gn]), while Frozenbyte warns "If everything is very saturated it can become visually overwhelming quickly" ([Color and Lighting][fb-color]). They agree once you look at what Dead Cells does with it: the backdrop's colors "fade into each other" and the strongest saturation goes to enemies and their shots ([Dead Cells][dc]). The principle keeps that: a saturated game is fine, as long as the top of the read order is still the most saturated thing on screen (the skill's own rule).
- **Opaque foreground is allowed.** Schlitter avoids it "but don't rule it out" ([Pixelblog 32][s32]); Frozenbyte allows foreground that fades out of the way only for secrets ([Gameplay Issues][fb-issues]). The principle is about what the foreground must never hide, not about its opacity.

## The stack

### Every plane has one job, and the player can always tell the play layer from the rest

- Frozenbyte, "Level Art: Color and Lighting" ([link][fb-color]): the colors "separate the different layers of depth: foreground (can be several layers), game area and background" … "Irrelevant/background objects/areas should blend in" … "Important objects/areas that need to be highlighted have to pop out".
- Frozenbyte, "Level Art: Level Art Related Gameplay Issues" ([link][fb-issues]): "At all times, the player should be able to differentiate the gameplay area from background and foreground areas." … "Make sure that the game play area has a clear contrast and that the player's intended path is prioritized visually."
- Schlitter, "Pixelblog 28: Side View Tiles", 2020 ([link][s28]): "the goal with the background is to create depth without compromising the readability of the foreground." He builds the scene from "several simple background layers" and "support tiles" that "look like they are in the immediate background".
- Schlitter, "Pixelblog 62: Landscape Backgrounds", 2026 ([link][s62]): "Backgrounds should service the scene without distracting from the gameplay."
- Maglione, "Pixel art Platformer level design", 2023, archived by its author ([link][smg]): on the play layer, "Every element in this layer should be something that the player can interact with"; a close background "is more detailed compared to a normal background", has no parallax, and carries no outlines and less contrast so it is not mistaken for ground.
- **Ritmo:** the jobs, read from the sources together: the far backdrop says where you are and sets the mood; the near backdrop gives the place its detail and story; the play layer holds everything the player can stand on, touch, or be hurt by; the foreground frames the view and adds depth. This is the skill's read order ("What supports or blocks the player reads clearly against what is only backdrop") applied plane by plane.

### What the player can touch contrasts most with what they cannot; what they cannot reach does not look reachable

- Massé (Motion Twin), "Art Design Deep Dive: Giving back colors to cryptic worlds in Dead Cells", Game Developer, 2018 ([link][dc]): "the background of the levels and the collisions have to contrast as much as possible, while the colors used to design the background have to fade into each other, creating no discernible rupture." Interactive elements (ladders, platforms): "These have a degree of contrast somewhere between the backgrounds and the obstacles." "The enemies, their projectiles and any spells they may eventually cast are treated with high levels of saturation".
- Frozenbyte, "Gameplay Issues" ([link][fb-issues]): "If the player can't go to a particular area, that area shouldn't look accessible." … "it's best to leave decorative assets, like paintings, outside the gameplay area completely." The page lists the traps by name under "False Promise of Gameplay Function" and "Misleading Level Art": fake ledges, poles, breakable-looking walls, decorations that look like collectables, permanently closed doors in the play area.
- Schlitter, "Pixelblog 28" ([link][s28]): "I would definitely avoid color bleed on sprites and things you interact with" … "it is acceptable with passive background elements so long as the object remains readable." … "for static platforms I usually go out of my way to visualize a logical support structure for platforms."
- **Ritmo:** Dead Cells's three steps (backdrop, then interactive, then threats, each with more contrast) is the skill's read order turned into a contrast ladder; the skill states the order, this is how a scene builds it.

### Depth is made by color first: each plane back has less contrast, less saturation, and moves toward the haze

- Schlitter, "Pixelblog 62" ([link][s62]): "This step is critical, as the illusion of depth is primarily conveyed by color choice." … "As it goes, the closest plane is the most saturated with strongest contrast between light and shadow." … "Therefore, saturation reduces with each receding plane, while lightness increases when under the circumstances of daylight, and atmospheric haze." … "Also, the hue shifts more to the color of the sky with each receding plane." … "The subsequent planes no longer depict single blades of vegetation at such a great distance." … "The shadow color for the distant mountains is again, reused from the sky."
- Schlitter, "Pixelblog 11: Landscape Pixeling", 2018 ([link][s11]): "The further the object, the more it takes on the color of atmospheric haze." … "far objects become less saturated and contain less colors." … "The closer an object is to the vertical position of the horizon, the more distant it appears."
- Schlitter, "Pixelblog 46: Anti-Gravity Racers", 2023 ([link][s46]): two objects on one plane, one pushed back: "the darkest color and pink highlights are omitted from the tower to appear more distant."
- Frozenbyte, "Color and Lighting" ([link][fb-color]): "the closer a thing is, the more contrast it has" … "the further away it is the less contrast it has".
- Schlitter, "Pixelblog 23: Parallax Scrolling", 2019 ([link][s23]): "Parallax will enhance the sense of depth but it may not be convincing if your scene doesn't already convey depth when static."
- **Ritmo:** "toward the haze", not "lighter": Schlitter's lightness rule is for daylight (his own qualifier), so at night or underground the planes sink into the dark instead. Taking the far planes' colors from the sky's ramp is how a scene stays inside the skill's "one palette, few colors" while still having many planes; Schlitter's landscapes do it in 15 colors.

### The backdrop is muted until the sprites pop over every part of it

- Schlitter, "Pixelblog 62" ([link][s62]): "Therefore, backgrounds in these types of games may need to be muted, or simplified to ensure sprites are clearly contrasted on them, even if it comes at the cost of some visual disconnect."
- Schlitter, "Pixelblog 63: Horizontal Shmup", 2026 ([link][s63]): "After putting everything together the sprites didn't quite pop off the background as well as I'd like." … "I kept the nearby grass layer the same, but for all other layers I turned down the saturation and contrast while slightly bumping up the brightness." … "I think it actually improves the atmospheric depth, and greatly improves readability." (His numbers, S −20, C −15, B +15 in Aseprite, are one scene's fix, not a rule.)
- Yacht Club Games, "Breaking the NES", 2014 ([link][yacht]): on Shovel Knight's added parallax layers, "More importantly, adding the effect made the gameplay layer more readable."
- **Ritmo:** the skill already says the backdrop recedes and to judge in captures; this adds the order of the fix that both Schlitter lessons use: when the play layer does not pop, the backdrop moves, not the sprites, because the sprites set the rules.

### Parallax speed follows depth; the farthest plane may not move; a loop hides its seam

- Schlitter, "Pixelblog 46" ([link][s46]): "the parallax scrolling effect is created by making objects that appear closer to the viewer move faster, while the distant objects move slower."
- Schlitter, "Pixelblog 63" ([link][s63]): six planes from grass at 4 pixels per frame down to "Sky - 0 ppf". "The mountains are the most dominant, and distinguishing feature, so I made them first, then built the other layers out from there."
- Yacht Club Games ([link][yacht]): "the mountains far away don't appear to move at all, while the posts whiz by very quickly."
- Schlitter, "Pixelblog 23" ([link][s23]): "Balanced layers without dominant points of interest help hide the loop." … "The drawback is some layers can look monotonous when repeated many times in the loop."
- Schlitter, "Pixelblog 64: Ninja Platformer", 2026 ([link][s64]): platforms "implied to be connected to the large buildings immediately behind" could "scroll slightly faster for a subtle 3D effect while still feeling attached to the buildings."
- Schlitter, "Pixelblog 32: Shmup Design Part 2", 2021 ([link][s32]): "When creating multiple background layers you should consider scale, and how color is used to capture atmospheric perspective."
- **Ritmo:** whole-pixel offsets, each layer rounded on its own, and a smooth parallax as a written exception are already the skill's rules (`PIXEL-ART.md`, "Keep fractions in the simulation"). What is new here: the plane's speed and its color say the same distance, a plane the play layer stands on moves with it (or nearly), and a repeating plane carries no landmark that would show the repeat.

### The foreground frames and adds depth; it never hides what the player needs, and it reads as above the play

- Schlitter, "Pixelblog 32" ([link][s32]): "Generally, I avoid having fully opaque foreground objects, but don't rule it out." … "if you do incorporate a foreground layer, make sure it doesn't dramatically impede your vision of the play area, or appear like it will collide with you." … "The trick is designing the foreground objects so they obviously appear above you and not on the same layer as you."
- Frozenbyte, "Gameplay Issues" ([link][fb-issues]): "The Player character should always be visible, so be mindful of your foreground art." The page extends this to puzzle elements and ledges, to every player in multiplayer, and keeps foreground that fades away for secrets only.
- Frozenbyte, "Level Art: Composition" ([link][fb-composition]): it lists as a common problem "Leaving the foreground empty or not paying the same amount of attention to the scene as a whole", and says "The the most visual impact within level art is in the background and foreground forms" (sic).
- Maglione ([link][smg]): "Foreground decorations must never hide the main character," so they go at the screen's margins, where the player cannot reach.
- **Ritmo:** "what the player needs" is the top of the skill's read order (threats, what can be acted on, what the player controls), not only the hero.

### Top-down: one projection; what is higher on screen is drawn behind; shadows set things on the ground

- Schlitter, "Pixelblog 21: Top Down Objects", 2019 ([link][s21]): "Due to the precise geometry of man made objects the consistency of the sense of perspective is especially apparent." … "Make sure all your objects adhere to the same projection rules." … "Cast shadows help make objects feel like they actually connect with the ground."
- Schlitter, "Pixelblog 43: Top Down Tiles Part 2", 2023 ([link][s43]): "Drop shadows add essential depth, but they must be conservative in design to limit conflict with sprites and other tiles." … "No matter how tall the rock wall all shadows are the same length."
- Schlitter, "Pixelblog 35: Top Down Interiors", 2021 ([link][s35]): "The railing tiles will need to go on a separate layer above the stair tiles."
- Schlitter, "Pixelblog 28" ([link][s28]), for side views: "Creating tilted edges like this is critical to achieving depth."
- KidsCanCode, "Using Y-Sort", Godot Recipes ([link][ysort]): "objects that are "farther" away need to be rendered behind "nearer" objects" … "the object's `position` is aligned with the *bottom* of the sprite".
- **Ritmo:** in top-down the planes are ground, ground overlays, objects sorted by where they touch the ground, and what hangs over the player (roofs, canopies, railings). Sorting belongs to the draw (render code reads the simulation's positions), as the `ritmo` skill's `ui-and-render` playbook keeps render-only state out of the simulation.

## The world

### Each area is recognisable from a glance at its backdrop, and the change between areas is designed

- Schlitter, "Pixelblog 32" ([link][s32]): "Just a glance at the background should always help orient the player as to where exactly they are in the level."
- Massé, Dead Cells ([link][dc]): "Complementary palettes (composed of opposing colors) are great for giving a confined feeling to a space" (the interiors), while "we put the emphasis on analogous colors for the outdoor levels, as it allows for more nuances and depth in the landscape." On transitions: "It allows us to link the biomes in an immersive and believable way" … "we added a mandatory elevator before you access the ramparts". On the pipeline: "First we draw the textures of the parallax in the background with grayscale colors before applying a gradient map."
- Frozenbyte, "Color and Lighting" ([link][fb-color]): "Any color can be chosen to communicate any mood, as long as the colors chosen for the specific moods stay consistent throughout the game".
- Schlitter, "Pixelblog 36: 8-Bit Adventure", 2022 ([link][s36]): "Mesh the enemies and mechanics with the environment, so each area stands out".
- Schlitter, "Pixelblog 37: Classic Castlevania Study", 2022 ([link][s37]): "Arguably the most significant and memorable character in the entire Castlevania series is the castle setting." … "even the 8-bit versions encapsulated all this gothic glory with simple variations of tiles."
- **Ritmo:** an area's identity lives inside the game's one palette (the skill's rule): a different selection of its ramps and a different mood, not a new palette per area. A second style per area is the skill's "lives in its own area and never leaks", which this principle does not loosen.

### A scene has places of detail and places of rest; a pattern stops before it is noticed

- Frozenbyte, "Composition" ([link][fb-composition]): "And make sure there are areas with lots of details, and areas of almost no details." … "Empty areas are as important as detailed areas in the big picture!" … "Areas that continue in a similar pattern for too long feel unnatural, monotonous and boring." … "The composition should of course look nice but also guide the player to the right direction and support the gameplay".
- Frozenbyte, "Color and Lighting" ([link][fb-color]): "have darker areas on the edges where the player is not supposed to go".
- Schlitter, "Pixelblog 21" ([link][s21]): "A more unique, asymmetrically shaped tree looks good when used sparingly to create a point of interest".
- **Ritmo:** the skill's tile rules ("rare is not none", variants drawn, details clustered) work at the scale of tiles; this is the same rule at the scale of a screen, where the detail also points the way.

### Decoration has a reason to be where it is, tells who lives there, and never looks like a gameplay object

- Frozenbyte, "Level Art: Environmental Storytelling" ([link][fb-story]): "Every asset in a scene has a purpose" … "every piece of background art has a history." The page asks for "designing NPC looks and locations to reflect their personalities, occupations and residence."
- Massé, Dead Cells ([link][dc]): "Each element of decoration has a specific set of rules applied to it: for instance, torches have to be located near an alcove or a door." … "We really like the contrast created when a peaceful, warm environment" meets threat, so "We always make sure to add some unsettling background elements, which might suddenly appear to the player paying attention to the background."
- Twin Sails, "Behind Bloomtown's Pixels: A Focus on Art", dev diary ([link][bloomtown]): "I always try to make each place feel lively, filled with various little things and details".
- Moran (Pixpil), via Couture, "Road to the IGF: Pixpil's Eastward", Game Developer, 2020 ([link][eastward]): "The aesthetic of the game is a 'decayed' world, but we wanted to make it look lively".
- Preston (Heart Machine), via Unwinnable, 2015 ([link][hld]), on telling a story without text, as Ico did: "it built a lot of its world and stories by you just observing and the situations they put you in".
- Frozenbyte, "Gameplay Issues" ([link][fb-issues]): decorations that look like collectables, ledges, or doors are listed as misleading level art (see the second principle).
- **Ritmo:** "by a fixed function of the tile's position" is how the skill already places variants; Dead Cells shows the step after it: the rule that places a decoration names what it belongs next to.

### Some of the world moves on its own, and that motion never speaks the language of threats

- Hein, "The art of Sea of Stars", Mega Visions ([link][sos]), a critic's description: "Many of the locations you visit have animated sprites and objects, including lights, fauna, and mechanisms."
- Schlitter, "Pixelblog 23" ([link][s23]): "After I've animated my parallax background I can go back and add details, like an interesting subject that moves with the camera."
- **Ritmo:** the sources here are thin (a critic and one tutorial line), so the principle is kept small. Its second half is the skill's "gameplay signals speak one language": a flicker, a fast motion, or a red pulse in the backdrop borrows the threat's look and lies to the player.

## The cast

### The characters set the world's scale: tiles, doors, stairs, and buildings are believable against them

- Schlitter, "Pixelblog 22: Top Down Character Sprites", 2019 ([link][s22]): "Generally, tile size is the best gauge for determining sprite size." … "relative sprite size usually conforms to a tile unit, or multiples of the tile unit." … "I like my buildings to at least have a believable scale in relation to the character sprites." … "When working with limited size the head usually takes up a third to half of the total sprite."
- Schlitter, "Pixelblog 35" ([link][s35]): "For my stairs I take a fairly realistic approach, creating stairways in proportion to the character sprites and wall height."
- Schlitter, "Pixelblog 36" ([link][s36]): "I chose this size to mesh well with environments made out of 16x16px tiles".
- **Ritmo:** the skill makes the characters set the style ("The characters set the rules"); this makes them set the scale too. Big heads on small bodies mean the world's furniture is scaled to the body's read, not to real proportions.

### The hero pops in every area; enemies belong to their area but read as threats; NPCs show who they are

- Schlitter, "Pixelblog 64" ([link][s64]): "The bright red ninja suit might go against the stealthy ethos of the ninja way, but it gives the perfect pop for a game protagonist."
- Schlitter, "Pixelblog 36" ([link][s36]): "The first thing I consider when designing a creature is that it fits the environment, which in this case is a sandy beach." … "The color is mostly a cosmetic choice that contrasts nicely on the sand background".
- Massé, Dead Cells ([link][dc]): the enemies and their shots carry "high levels of saturation", so the immediate danger is found at once.
- Frozenbyte, "Environmental Storytelling" ([link][fb-story]): NPC looks "reflect their personalities, occupations and residence."
- Moran (Pixpil), via Game Developer ([link][eastward]): "There are more than 200 different characters in the game, and we try our best to make each of them convincing and unique."
- Schlitter, "Pixelblog 22" ([link][s22]): "I created various heights to distinguish between male, female, young, and elderly."
- **Ritmo:** "fits the environment" and "reads as a threat" pull in opposite directions; the skill's read order settles it: an enemy takes its shape and theme from its area and its contrast and saturation from the threat's level. No source we found says how an NPC is told from an enemy at a glance; the skill's silhouette rule and signal language are the answer we have (an NPC never carries the threat's accent).

### A big character gets a quiet backdrop

- Yacht Club Games, "Breaking the NES" ([link][yacht]): on the NES, large bosses were drawn as background, "The boss is the background", so "whenever you fight a large enemy on the NES, they are usually on a black screen with no background art." Shovel Knight kept the look without the limit: "We simply used our animated sprite code, were careful with the designs, and made sure the sprite was on a black (or very dark) background."
- **Ritmo:** the skill's "No large flat shape or busy texture competes with the top of the order", seen from the other side: when the threat is the large shape, the backdrop steps back.

## Outlines by plane

### Whatever the outline rule is, the play layer and the backdrop do not share it

- skeddles, "Pixel Art Outlines Tutorial", Lospec, 2016 ([link][lospec-1]): "Outlines help separate objects from the background, as well as other objects." … "It's especially important in pixel art because of the small palettes."
- skeddles, "Pixel Art Outlines Part 2: Using Color", Lospec, 2016 ([link][lospec-2]): "an outline should always be darker than both the object AND the background behind it." … "This means that an outline should always increase contrast, and never decrease it."
- Schlitter, "Pixelblog 28" ([link][s28]): "Overlap and the use of subtle outlines allow me to get a lot out of my 16 color limit." "Pixelblog 63" ([link][s63]): "I was already utilizing outlines, and bright colors for the bullets".
- Maglione ([link][smg]): solid outlines and high contrast on the play layer; the close background without outlines, so it is not mistaken for solid ground.
- **Ritmo:** the skill leaves the outline to the characters ("Outlines are not legislated"); this adds that the backdrop's edges are drawn differently (softer, lighter, or none) so that an outline means "this is in play".

## Where effects meet the layers

Lighting, shaders, and post-processing are another thread's research. Two points touch the stack:

- Haze is part of the plane's color, drawn in the palette: Frozenbyte's planes "create "fog" that makes things blend together more and more the further they are" ([Color and Lighting][fb-color]), and Schlitter adds "a band of haze along the bottom" of a mountain plane ([Pixelblog 62][s62]). An effect that tints a plane does the same job and must keep the same order (the play layer stays the most contrasted).
- Under engine lighting the skill already says gameplay signals stay at full brightness; Frozenbyte's "have darker areas on the edges where the player is not supposed to go" is the same tool used for the path.

## What this could add to `ritmo-pixel-art`

Not changed by this file. If the maintainer wants it, these are the lines a skill change would draw from, each with its section above:

- A short "Layers" group under Readability: each plane's job, the contrast ladder (backdrop, interactive, threat), depth by color with parallax speed matching it, the backdrop as what moves when sprites do not pop, and a foreground that never hides the top of the read order.
- Under One style: an area's identity is a selection from the one palette; decoration is placed by what it belongs next to and never mimics a gameplay object; the characters set the world's scale as well as its style.
- Under Judging: check a capture of each area with the play layer's sprites over its busiest backdrop, and with the foreground at its densest.

[s11]: https://www.slynyrd.com/blog/2018/11/16/pixelblog-11-landscape-pixeling
[s21]: https://www.slynyrd.com/blog/2019/9/18/pixelblog-21-top-down-objects
[s22]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
[s23]: https://www.slynyrd.com/blog/2019/11/12/pixelblog-23-parallax-scrolling
[s28]: https://slynyrd.com/blog/2020/5/21/pixelblog-28-side-view-tiles
[s32]: https://www.slynyrd.com/blog/2021/2/15/pixelblog-32-shmup-design-part-2
[s35]: https://www.slynyrd.com/blog/2021/11/30/pixelblog-35-top-down-interiors
[s36]: https://www.slynyrd.com/blog/2022/1/25/pixelblog-36-8-bit-adventure
[s37]: https://www.slynyrd.com/blog/2022/3/19/pixelblog-37-classic-castlevania-study
[s43]: https://slynyrd.com/blog/2023/3/26/pixelblog-43-top-down-tiles-part-2
[s46]: https://www.slynyrd.com/blog/2023/9/25/pixelblog-46-anti-gravity-racing-scene
[s62]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
[s63]: https://www.slynyrd.com/blog/2026/7/26/pixelblog-63-horizontal-shmup
[s64]: https://www.slynyrd.com/blog/2026/9/25/pixelblog-64-ninja-platformer
[dc]: https://www.gamedeveloper.com/production/art-design-deep-dive-giving-back-colors-to-cryptic-worlds-in-i-dead-cells-i-
[dc-gn]: https://gonintendo.com/archives/280488-dead-cells-dev-blog-art-design-deep-dive-giving-back-colors-to-cryptic-worlds
[fb-issues]: https://wiki.frozenbyte.com/index.php/Level_Art:_Level_Art_Related_Gameplay_Issues
[fb-composition]: https://wiki.frozenbyte.com/index.php/Level_Art:_Composition
[fb-color]: https://wiki.frozenbyte.com/index.php/Level_Art:_Color_and_Lighting
[fb-story]: https://wiki.frozenbyte.com/index.php/Level_Art:_Environmental_Storytelling
[yacht]: https://www.yachtclubgames.com/blog/breaking-the-nes
[lospec-1]: https://lospec.com/articles/pixel-art-outlines
[lospec-2]: https://lospec.com/articles/pixel-art-outlines-part-2-using-color
[ysort]: https://kidscancode.org/godot_recipes/4.x/2d/using_ysort/index.html
[smg]: https://www.sandromaglione.com/articles/pixel-art-platformer-level-design-full-guide
[bloomtown]: https://twin-sails.com/?p=1899
[eastward]: https://www.gamedeveloper.com/disciplines/road-to-the-igf-pixpil-s-i-eastward-i-
[hld]: https://unwinnable.com/2015/12/02/interview-with-alex-preston-the-creator-of-hyper-light-drifter/
[sos]: https://megavisions.net/the-art-of-sea-of-stars-a-sea-of-pixels
