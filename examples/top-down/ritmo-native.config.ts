export default {
  entry: "./native.ts",
  app: { name: "Top Down", id: "dev.typeonce.topdown", version: "0.1.0" },
  window: { width: 1280, height: 720, resizable: true },
  assets: "../../assets",
  orientation: "landscape",
  targets: ["linux", "macos", "windows", "android", "ios"],
  requireCompiled: []
}
