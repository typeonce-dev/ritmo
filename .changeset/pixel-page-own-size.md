---
"@typeonce/ritmo-tools": patch
---

The pixel fixer's page opens pixel art that is already at its own size (a small sprite, even with an image generator's noisy colors) one pixel per cell, as `ritmo-tools pixel check` does, instead of applying an unsure grid its own shapes suggest (a 24×24 sprite came out about 8×8).

Animation sheets: frames are found on sheets made of blocks side by side whose rows do not line up (walking on the left, throwing on the right), instead of boxing frames from two rows together, and a last frame of a few pixels (the end of an explosion) is kept instead of dropped. Such a sheet opens as an animation: most frames alike is enough, so a few faint frames (sparks, smoke) no longer make the page open it as a single picture.
