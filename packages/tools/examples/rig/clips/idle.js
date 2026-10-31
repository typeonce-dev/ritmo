/** Idle: the ready stance, breathing. The body sinks and rises a pixel, the arms and the sword tip follow a beat late. */
export default {
  label: "ready, breathing",
  frames: 24,
  fps: 12,
  loop: true,
  stance: "ready",
  params: { breath: { min: 0, max: 3, value: 1.2 } },
  trail: "sword",
  pose(rig, t, p) {
    // Each layer is 0 on frame 0, so the clip starts on the stance: a lag is a later start of the same wave, less its value there.
    const wave = (lag) => Math.sin(2 * Math.PI * (t - lag)) - Math.sin(-2 * Math.PI * lag)
    return rig.add(rig.stances.ready, {
      bones: {
        hips: { y: (-p.breath * (1 - Math.cos(2 * Math.PI * t))) / 2 },
        torso: 1.2 * wave(0.05),
        head: -1 * wave(0.1),
        upperArmNear: -2 * wave(0.12),
        forearmNear: 2.5 * wave(0.18),
        upperArmFar: 2 * wave(0.12),
        forearmFar: -2 * wave(0.2)
      },
      // The blade sways in the world a beat after the arm: an aim laid on the stance's turns it.
      aim: { sword: 3 * wave(0.25) }
    })
  }
}
