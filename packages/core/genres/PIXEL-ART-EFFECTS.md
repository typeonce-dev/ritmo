# Effects on top of pixel art: what keeps them in the style

This file is research for the maintainers and the agents working on this repo. It is not published (`package.json` `files` leaves `genres/` out), it is not a skill, and the website does not read it. It collects the principles, each with its sources, that a future rule in the `ritmo-pixel-art`, `ritmo-fx`, or `ritmo-polish` skill would trace back to, in the format of `PROTOTYPE.md` and `PIXEL-ART.md`.

Its subject is everything a pixel-art game draws or computes at run time on top of its assets, and that is not itself pixel art: lights, shadows and normal maps, shaders on sprites (sway, water, dissolve, hit flash), particles made at run time, camera effects (shake, kick, zoom), and passes on the whole frame (color grading, bloom, vignette, CRT, depth of field). The questions are which of these fit the pixel look, and what keeps them coherent with it.

It builds on what the repo already says and does not repeat it:

- `skills/ritmo-pixel-art` (sources in `PIXEL-ART.md`) owns the assets: one grid, whole-number scaling, rounding at the draw, one palette, one light direction, "under engine lighting, assets carry even shades and no strong baked light", signals at full brightness under the light map.
- `skills/ritmo-fx` (sources in `FX.md`) owns effects drawn as sprite sheets: palette colors only, no blending against a background, fades along one ramp.
- `skills/ritmo-polish` (sources in `POLISH.md`) owns how much feedback a moment gets: hit stop, shake as trauma, the flash budget, toggles for shake, flash and vibration.
- Art direction and layer composition (backgrounds, parallax, foreground) are a sibling study, not this one.

Every principle below traces back to one of two things, as in the files above:

- **Practice:** developers, artists, and engine documentation, quoted with a link.
- **Ritmo:** how the library draws, or a direction from the maintainer. These are conventions, not craft claims, and are marked as such.

Quotes were checked against the text of the linked page on 2026-11-01. A quote marked "via" was checked on that secondary page, not in the original. Engine documentation (Godot, Unity) is quoted for what a renderer does and costs, not as a style authority. A shipped game is evidence that a choice can work, not that it is the only one: the sources disagree on how far effects may go (from Blasphemous, "nothing that is not pixel art", to Octopath Traveler's lit 3D world), so most principles below are about making the choice once and on purpose, not about one right answer.

## Summary

1. Every effect is either **inside the grid** (drawn into the game's low-resolution frame, at the game's pixel size) or **above it** (a pass over the finished, upscaled frame). Both are used by good games; an effect in the world at a third pixel size is what breaks the look. Decide per effect kind, once.
2. **No effects is a style too.** A purist game is a decision, not a missing feature.
3. **Light serves the read and the mood, never realism.** It interacts with the world (walls block it), and what the player must notice stays readable under it.
4. **Darkness is a base tint, and lights add back.** It is the cheapest model, and the one most engines give a 2D game.
5. **Light comes in steps that land on the palette**, or in a dither fixed to the world, not in a smooth gradient over chunky pixels.
6. **Normal maps only where the art earns them.** They are a second drawing of every frame; generated ones are weak on pixel art; painted shading is still the cheap default.
7. **A shader moves and recolors whole art pixels.** Sway, ripple, and dissolve displace by whole art pixels; a hit flash or a recolor swaps palette colors; flashing or dithering replaces transparency.
8. **Particles made at run time are art pixels.** Whole-pixel sizes, palette colors, positions rounded at the draw, fades down a ramp, not through alpha.
9. **The camera shakes in whole art pixels, by translation.** Rotation and sub-pixel shake belong above the grid, if anywhere.
10. **Passes on the whole frame are seasoning, chosen as a style, and the player can turn them down.** CRT, bloom, chromatic aberration, and depth of field are tuned in motion on the target screen, never from a screenshot.
11. **A color grade may leave the palette, but the first read must survive every grade.**
12. **Effects have a budget, and phones set it.** Working inside a small frame is what makes many of them cheap.
13. **Judge effects in the game, in motion, at display size, and with each one off.**
14. **Effects are render-only (Ritmo).** They never feed the simulation.

## Where we chose against a source

- **Rotational shake.** Eiserloh's slides: "Rotational feels okay, but kinda lame" … "Translational + Rotational = Awesome" ([slides][eiserloh]). Rotating the frame breaks the grid (Unity's pixel-perfect target is "unaliased and unrotated pixels", [Pixel Perfect][unity]), so the principle here keeps shake translational inside the grid and leaves rotation to a pass above it, as an exception written down (the `ritmo-pixel-art` rule "An exception is a decision, written down").
- **Post-processing that ignores the palette.** Medeiros does it on *Scars*: "I add post-processing that ignores the palette to the screen canvas" ([Style Consistency][saint-consistency]), against the skill's "one palette". Both hold, because his pass is on the whole screen after the sprites are placed ("you usually can get away with breaking your consistency after placing sprites in the canvas"). So the line drawn here is not palette or no palette, but inside the grid or above it.
- **Effects outside the pixel-perfect layer.** The notkey tutorial puts "particles, visual effects, or post-processing" on top of the pixel-art rendering ([tutorial][notkey]); Dead Cells renders its art "in low resolution, without any anti-aliasing" ([Vasseur][deadcells]). Neither is the rule. The principle keeps world effects inside by default (they touch objects drawn at the game's pixel size) and allows the other choice when the person makes it.
- **"Every game benefits from shake" and "you can't have too many particles"** were already ruled against in `POLISH.md`; nothing here reopens them.

## Where effects live

### Every effect is inside the grid or above it; a third pixel size is the mistake; decide per kind, once

- Medeiros, "My Thoughts on Style Consistency", 2023 ([link][saint-consistency]): "I add post-processing that ignores the palette to the screen canvas." … "you usually can get away with breaking your consistency after placing sprites in the canvas." … "Never use any smoothing algorithms for scaling pixel art, unless you know exactly what you are doing."
- Medeiros, "Scaling Pixel Art", 2024 ([link][saint-scaling]): "Instead of mixing pixel art resolutions, consider mixing pixel art with high resolution." … "If you know how to use shaders and aren't afraid of them, this is by far the best approach."
- notkey, "Godot: Pixel-Perfect Low-Resolution Rendering and Smooth Camera", 2026 ([link][notkey]): "The solution is to simulate and render the game in low resolution, pixel-perfect, in a *SubViewport*." … and, as a use of the layer above it: "Adding non-pixel-perfect elements on top of the pixel art rendering, such as particles, visual effects, or post-processing."
- Vasseur (Motion Twin), "Using a 3D pipeline for 2D animation in Dead Cells", 2018 ([link][deadcells]): the team used cel shading "on our models rendered in low resolution, without any anti-aliasing."
- Holland, "3D Pixel Art Rendering", 2024 ([link][holland]): "A lot of the work in 3D pixel art is getting 3D effects to look 2D (surprise)."
- Godot docs, "2D lights and shadows" ([rst source][godot-lights]), on the shadow filter: "The default None is the fastest to render, and is well suited for games with a pixel art aesthetic".
- The two layers are the two engine designs `PIXEL-ART.md` already sources ("the whole frame drawn at the game's size and scaled up once" or "every sprite drawn at final size and snapped"): an effect drawn into the low-resolution frame gets the game's pixel size for free, and one drawn after the upscale has the screen's. The "third size" (a soft glow with sub-pixel edges beside hard one-pixel outlines, a particle at 1.5 art pixels) is Medeiros's rule against mixing resolutions applied to effects. "Decide per kind, once" is the `ritmo-pixel-art` rule that an exception is a decision for the whole game, never one asset's accident (**Ritmo**).

### No effects is a style too

- Colinet (The Game Kitchen), on *Blasphemous*, via The Hollywood Reporter ([link][blasphemous]): "From the very beginning we wanted to be very 'purist' about the pixel art style." … "we were trying not to use any fancy shaders or helping ourself with some 3D elements to make something easier." … "There is nothing that is not pixel art [in Blasphemous]."
- Yacht Club Games, "Breaking the NES", 2014 ([link][yacht]): "Instead of emulating the NES exactly, we would create a rose-tinted view of an 8-bit game." Shovel Knight kept most limits and broke a few on purpose, each with a reason.
- Preston, on *Hyper Light Drifter*, GamingBolt, 2015 ([link][hld]): "Yeah, it's low resolution, and very intentionally so." … "we're taking that limited canvas and doing things that were simply not possible before."
- The point for an agent is the default: adding a light, a bloom, or a CRT pass because the engine offers it is the "side effect of one asset" the `ritmo-pixel-art` skill rules out; each is the person's choice (**Ritmo**).

## Light

### Light serves the read and the mood; it interacts with the world; what must be noticed stays readable

- Berry, "Remaking Celeste's Lighting", 2017 ([link][berry]): "We decided early on the lighting had to interact with the environment." … "the lights needed to actually hit walls."
- Acquire, on *Octopath Traveler II*, Unreal Engine interview ([link][octopath2]): "we sometimes had to play tricks with the lighting to make the characters and the background look well together" … "The new day/night cycle is not just a cosmetic change".
- Hein, "The art of Sea of Stars", Mega Visions ([link][seaofstars]): "You can see the dynamic lighting on display, with colored highlights for characters and brighter parts of the scenery."
- Cherkasov (Lazy Bear Games), "Graveyard Keeper: how the graphics effects are made", 2018, republished 2024 ([link][graveyard]): on placing sprites against a light, "the one in the back is illuminated while the one in the front is not."
- **Ritmo:** "what must be noticed stays readable under it" is the `ritmo-pixel-art` rules already sourced in `PIXEL-ART.md` (the first read; "gameplay signals stay at full brightness under it"; Still Time's "Threat decals and shots stay at full brightness"). Octopath's "tricks" are the evidence that a light that looks right for the room may still need cheating for the characters.

### Darkness is a base tint; lights add back

- Godot docs, "2D lights and shadows" ([rst source][godot-lights]): "CanvasModulate is used to darken the scene by specifying a color that will act as the base" … "The default Add is suited for most use cases." … "Subtract can be used for negative lights, which are not physically accurate but can be used for special effects."
- Godot docs, same page: "Additive sprites are much faster to render, since they don't need to go through a separate rendering pipeline."
- Cherkasov, Graveyard Keeper ([link][graveyard]): "Nothing groundbreaking here: it's darker at night and lighter during the day." … "We use standard light sources, the default ones provided by Unity."
- Berry ([link][berry]): Celeste draws each light to a texture and then has walls erase their projected shadows: "The result, after the light has been drawn and walls have erased their projected shadows".

### Light comes in steps that land on the palette, or in a dither fixed to the world

- NullTale, LutLight2D (Unity), README ([link][lutlight]): a "Stylized pixel art lighting shader for Unity2D using a color replacement technique." The light's brightness picks the replacement color from ramps, so a lit sprite stays on the palette.
- Godot docs ([rst source][godot-lights]), on soft shadows: "Higher values result in a softer shadow, but may cause banding artifacts to be visible".
- Holland ([link][holland]): the direct lighting is "toon lighting", "trying to be clean, flat, and minimal". Vasseur ([link][deadcells]): each frame exported "along with its normal map, allowing us to render the volume using a basic toon shader."
- Zucconi, "Shader Showcase Saturday #11: Return of the Obra Dinn", 2018 ([link][zucconi]): "This lack of **temporal correlation** causes the dither pattern to move erratically." … "A significant amount of work was put into making sure that the dithering effect had temporal consistency between frames." … "This was achieved by remapping the dithering effect on a sphere." Pope's own tweet, quoted there: "Reducing 1-bit dot flicker via sphere-mapped dither pattern."
- **Ritmo:** "land on the palette" is the `ritmo-pixel-art` rule "One palette … ramps that shift hue" carried into lighting: a ramp lookup is the same ramp `fx` effects fade through (`ritmo-fx`: "Fade along one ramp per material"). A dither pattern tied to the screen swims when the camera moves, which the `ritmo-fx` skill's flicker check already calls boiling.

### Normal maps only where the art earns them

- Moreira, Coutinho and Chaimowicz, "Analysis and Compilation of Normal Map Generation Techniques for Pixel Art", SBGames 2022 ([link][normals]): "applying them for pixel art may not yield correct results due to the style specificities." … "both volume and texture are encoded together in pixel art." … "no technique could produce maps as good as the one an artist can manually paint" … "Deep generative model is fully automated but it might produce weak internal geometry on pixel art."
- Godot docs ([rst source][godot-lights]): "normal maps can help make lighting look less flat by varying its intensity depending on the direction of the surface" … "Normal maps are typically created from hand-painted height maps, but they can also be automatically generated".
- Snake Hill Games, Sprite Lamp ([link][spritelamp]): "Sprite Lamp preserves the art styles that are possible with hand drawn images"; its lighting profiles are "painted in greyscale (as though the subject was made of white plaster)".
- Vasseur ([link][deadcells]): Dead Cells got its normal maps for free from a 3D pipeline, "designing a lightning system with that in mind" [sic].
- Pixel Beef, "4 things we did to add light and depth to our Pixel Art Game", itch.io devlog ([link][pixelbeef]): "the most efficient way to light a 2D game still is to paint the shadows directly onto your sprites".
- **Ritmo:** an agent that makes art with `ritmo-tools pixel` or an image generator would have to make a second, matching image for every frame; the research says generated ones fall short on pixel art. So the default is painted shading under a tint-and-add light, and normal maps are the person's choice for a game whose look depends on them.

## Shaders on sprites

### A shader moves and recolors whole art pixels; flashing or dithering replaces transparency

- Cherkasov, Graveyard Keeper ([link][graveyard]), on wind sway: "The vertex shader modifies the x-coordinates based on the y-coordinate." … "The highest points are shaken most intensely, while the roots remain stationary." Without it, "the scene looking static and lifeless".
- Yacht Club Games ([link][yacht]): "We used flashing sprites in some situations to replace alpha transparency" … and on damage: "cycling damage made it obvious you were hurting an enemy as the effect was consistent across all objects".
- Wikipedia, "Color cycling" ([link][cycling]): colors "are changed in order to give the impression of animation", used to "simulate moving water, lava and similar effects"; Ferrari: "color cycling creates the illusion of animated movement in pretty much the same way light bulbs on a theater marquee do."
- **Ritmo:** "whole art pixels" is the `ritmo-pixel-art` rule "round only when drawing" applied inside a shader: a displacement or a sample offset rounded to the art grid moves pixels, an unrounded one smears them. "Recolors" is the `ritmo-fx` rule "No in-between colors against a background" carried from sheets to run time: alpha blending makes colors that are in no palette, which a flash, a palette swap, or a dither avoids.

## Particles

### Particles made at run time are art pixels

- Swink, "Game Feel: The Secret Ingredient", 2007 ([link][swink]): "A little screen shake or spray of particles can make all the difference in the world to a game's feel." … "Any effect that enhances the impression that the game world has its own self consistent physics is fair game."
- Pichlmair and Johansen, "Designing Game Feel. A Survey", 2020 ([pdf][pichlmair]): particles "are a staple of juicy game design" … "Particle systems that amplify the result of player interaction extend the time that result is visible on screen"; against excess, "when the whole screen is filled with wobbling particle effects".
- Holland ([link][holland]): his 3D pixel scenes still add 2D particle textures (rain, splashes) to sell the pixel look.
- **Ritmo:** whole-pixel sizes, palette colors, rounding at the draw, and fades down a ramp are the `ritmo-pixel-art` and `ritmo-fx` rules, applied to particles a system spawns rather than to a drawn sheet. How many particles a moment gets is `ritmo-polish`'s ("The biggest answer goes to the rarest, most important moment").

## Camera

### The camera shakes in whole art pixels, by translation; rotation and sub-pixel shake are above the grid

- Eiserloh, "Juicing Your Cameras With Math", GDC 2016 ([slides][eiserloh]): "Translational feels nice" … "Rotational feels okay, but kinda lame" … "Use Perlin noise instead!" (see "Where we chose against a source").
- Yacht Club Games ([link][yacht]): "On the NES, camera shakes only occurred on a single axis." … "And this is something we broke, because we didn't find a compelling reason to keep it."
- Holland ([link][holland]): "Snap the camera to a view-aligned, texel-sized grid. This removes pixel creep, but movement is no longer smooth." He then shifts the finished image by the snap error to get the smoothness back, which is a pass above the grid.
- Unity docs, "2D Pixel Perfect" ([link][unity]): the upscaled render texture gives "unaliased and unrotated pixels".
- **Ritmo:** the shake offset is a camera offset, so the `ritmo-pixel-art` rule "every offset, the camera included" rounds it; `POLISH.md` sources how much shake, its decay, and its toggle, and the `ui-and-render` playbook draws its randomness from the render's own stream.

## The whole frame

### Passes on the whole frame are seasoning, chosen as a style, tuned in motion, and the player can turn them down

- Riffle, "Opinion: CRT Emulation for Pixel Art", Game Developer, 2011 ([link][riffle]): "Cranking all these techniques to the max gives you a delightfully bad video signal" … "which is also no fun to look at for more than 10 seconds." … "Tuning all this can be a touchy process." … "it looks far worse in screen shots than it does on a running game."
- Datagubbe, "The Effect of CRTs on Pixel Art" (via the [gwern.net mirror][crt-myth]): "It wasn't CRT technology itself that made pixel art look better." … "I always disable CRT filters." … "I've never seen a filter that can properly convey the peculiarities of a real world CRT."
- Wikipedia, "HD-2D" ([link][hd2d]): the style adds "tilt-shift, depth of field, bloom, volumetric lighting and fog, and particle effects", "which together produce a diorama-like appearance"; the same page cites press titles such as "It's Beginning To Wear Thin" (TheGamer).
- Xbox Accessibility Guideline 117 ([link][xag-117]): "Avoid or allow disabling camera shake, camera bobbing, motion blur, and mouse blur."
- **Ritmo:** HD-2D is the source's example of a whole-frame style chosen once for a whole game (`PIXEL-ART.md` quotes Takahashi on why). A CRT pass is a taste the sources split on, so it is off or subtle by default and the player's choice, like the `ritmo-polish` toggles; it is judged moving, because Riffle notes a screenshot misleads.

### A color grade may leave the palette; the first read survives every grade

- Cherkasov, Graveyard Keeper ([link][graveyard]): "A LUT is essentially a table for color transformation." … "Easy to create. Easy to use. Lightning-fast performance."
- Medeiros ([link][saint-consistency]): the post-processing on *Scars* "ignores the palette", on the screen canvas.
- Acquire ([link][octopath2]): "we sometimes had to play tricks with the lighting to make the characters and the background look well together".
- **Ritmo:** the first read is the `ritmo-pixel-art` rule "What the player must notice is read first"; a night grade that sinks a threat's contrast breaks it as surely as a dark sprite would. The Still Time reviewer's "Judge your art under it. Append `?nolight` to the URL to compare against the unlit scene" (`PIXEL-ART.md`) is the same check for every grade.

## Budget and judging

### Effects have a budget and phones set it; a small frame makes many effects cheap

- Godot docs ([rst source][godot-lights]): "Larger lights have a higher performance cost as they affect more pixels on screen" … "PCF13 should only be used for a few lights at once due to its high rendering cost."
- Berry ([link][berry]): "I'd like the lights to have little to no impact on the performance of the game." … "The lights are now some of the fastest code in the game"; the screen is "tiny (320x180)".
- Cherkasov ([link][graveyard]): on sway, "This approach isn't the fastest, considering the amount of math involved."
- Arithmetic, not a source: a 320×180 frame has 57,600 pixels, one thirty-sixth of a 1920×1080 screen's 2,073,600, so a full-screen pass inside the grid touches 36 times fewer pixels than the same pass above it.
- **Ritmo:** Spirit Call keeps budgets for effects, sounds, and shaders and measures them with `pnpm perf` at 4× and 6× CPU slowdown (its `docs/models.md`, "Budgets"): a game's measure of record, not a craft rule.

### Judge effects in the game, in motion, at display size, and with each one off

- Riffle ([link][riffle]): "it looks far worse in screen shots than it does on a running game."
- Pichlmair and Johansen ([pdf][pichlmair]), citing Doucet: "Juice-rich interaction makes it hard to learn what aspects of interactivity have mechanical importance".
- Lin, Duan, Wen and Cai, "What Features Influence Impact Feel?", 2022 ([pdf][lin]), citing Kao (2020): "none and extreme amounts of juiciness significantly decrease player experience."
- **Ritmo:** "with each one off" is the gamestack check `POLISH.md` already quotes ("Mute sound + disable particles + strip screen effects: does the core still feel right?"); display size, the target screen, and the person's verdict are the `ritmo-pixel-art` Judging rules.

### Effects are render-only

- **Ritmo:** the `ritmo` skill's `ui-and-render` playbook, step 4: "Render-only state (animation timers, effects, camera easing) stays in render code" … "Cosmetic randomness (shake, particles) draws from its own `Random.make` stream, never the world's random resource". A light, a grade, or a particle never decides what the simulation does, so turning any of them off (a toggle, a phone without the GPU for it) changes no replay.

## Checked and not found

- Berry's Celeste article states no resolution for the light buffer and says nothing on soft or hard light edges or gradients; only the screen size (320×180) and the occlusion method.
- Godot's rendered "2D lights and shadows" page did not return its body; the quotes come from the same page's reStructuredText source (linked).
- Lucas Pope's TIGSource post on Obra Dinn's dithering could not be fetched; it is quoted via Zucconi.
- The Unreal Engine Octopath Traveler (I) spotlight was blocked at fetch time; Wikipedia's "HD-2D" and the Octopath Traveler II interview are quoted instead. The latter does not mention bloom or depth of field.
- Hyper Light Drifter interviews (GamingBolt, Vice) and Eastward's Road to the IGF interview contain no quotes on lighting, shaders, or post-processing.
- Unity's URP "2D pixel perfect" page says nothing on lights, post-processing, or effects that break pixel perfection.
- The Lin et al. study does not name screen shake, color flashing, or particles among the main drivers of impact feel (hit stop, sound, and camera control are); its "more is not better" lines are citations of Kao and Doucet.
- Nijman's "The Art of Screenshake" still has no transcript (as `POLISH.md` notes); nothing pixel-specific from it is quoted.

[saint-consistency]: https://saint11.art/blog/consistency/
[saint-scaling]: https://saint11.art/blog/scaling/
[notkey]: https://notkey.studio/en/tutorials/godot-low-res-pixel-perfect-rendering-and-smooth-camera/
[deadcells]: https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-
[holland]: https://www.davidhol.land/articles/3d-pixel-art-rendering/
[godot-lights]: https://docs.godotengine.org/it/4.5/_sources/tutorials/2d/2d_lights_and_shadows.rst.txt
[blasphemous]: https://www.hollywoodreporter.com/heat-vision/blasphemous-designer-purist-approach-games-pixel-art-style-1238370
[yacht]: https://www.yachtclubgames.com/blog/breaking-the-nes
[hld]: https://gamingbolt.com/hyper-light-drifter-interview-everything-you-need-to-know-about-heart-machines-2d-action-rpg
[berry]: https://noelberry.ca/posts/celeste_lighting
[octopath2]: https://www.unrealengine.com/developer-interviews/octopath-traveler-ii-builds-a-bigger-bolder-world-in-its-stunning-hd-2d-style
[seaofstars]: https://megavisions.net/the-art-of-sea-of-stars-a-sea-of-pixels
[graveyard]: https://slava.lazybeargames.com/graveyard-keeper-how-the-graphics-effects-are-made
[lutlight]: https://github.com/unitycoder/LutLight2D
[zucconi]: https://www.alanzucconi.com/?p=10365
[normals]: https://ar5iv.labs.arxiv.org/html/2212.09692
[spritelamp]: https://www.snakehillgames.com/spritelamp/
[pixelbeef]: https://pixel-beef.itch.io/xdasher/devlog/192949/4-things-we-did-to-add-light-and-depth-to-our-pixel-art-game
[cycling]: https://en.wikipedia.org/wiki/Color_cycling
[swink]: https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient
[pichlmair]: https://arxiv.org/pdf/2011.09201
[lin]: https://arxiv.org/pdf/2208.06155
[eiserloh]: http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf
[unity]: https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@5.0/manual/index.html
[riffle]: https://www.gamedeveloper.com/art/opinion-crt-emulation-for-pixel-art
[crt-myth]: https://gwern.net/doc/www/www.datagubbe.se/92d7cf5b4cd6b3c436aa53c4f77ed8f9ca132c07.html
[hd2d]: https://en.wikipedia.org/wiki/HD-2D
[xag-117]: https://devdocs.xbox.com/gaming/accessibility/xbox-accessibility-guidelines/117
