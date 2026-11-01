// Idle: a heavy dwarf breathing at guard, axe held two-handed across the body.
// References: Gimli at rest between fights (LOTR); a Dark Souls greataxe idle.
// Key poses: guard (frame 0, the top of the breath: chest up, axe up);
// exhale (mid-loop): the weight sinks into the knees, the chest folds forward a little,
// the axe head dips; the head and the axe trail the hips by a frame or two.
const wave = (t, lag) => (1 - Math.cos(2 * Math.PI * (t - lag))) / 2

export default {
  label: "breathing at guard",
  frames: 24,
  fps: 12,
  loop: true,
  stance: "guard",
  params: { breath: { min: 0, max: 10, value: 5 } },
  trail: "axe",
  pose(rig, t, p) {
    // Each layer is 0 on frame 0 (wave(0, 0) = 0), so the loop starts on the stance;
    // the lagged layers are rebased so they are 0 there too.
    const at = (lag) => wave(t, lag) - wave(0, lag)
    const b = p.breath
    return rig.add(rig.stances.guard, {
      bones: {
        hips: { x: -0.3 * b * at(0), y: -b * at(0) },
        torso: -0.5 * b * at(1 / 24),
        head: -0.6 * b * at(2 / 24),
        axe: { x: -2.6 * b * at(2 / 24), y: 1 * b * at(2 / 24) }
      },
      aim: { axe: -0.8 * b * at(3 / 24) }
    })
  }
}
