export default {
  entry: "./movement.ts", app: { name: "Native Stress", id: "dev.typeonce.stress", version: "0.1.0" },
  window: { width: 64, height: 64 }, targets: ["linux", "macos", "windows"], requireCompiled: ["Stress/Move"]
}
