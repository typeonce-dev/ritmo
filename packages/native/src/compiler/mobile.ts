import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { bundle } from "./bundle.ts"
import { bundleGame, packageRoot, run } from "./build.ts"
import type { Config } from "./config.ts"

const exists = async (path: string) => { try { await access(path); return true } catch { return false } }
const once = async (path: string, content: string) => { if (!await exists(path)) { await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, content) } }
const cmakeQuote = (path: string) => `"${path.replaceAll("\\", "/").replaceAll('"', '\\"')}"`
const hostQjsc = async (cache: string): Promise<string> => {
  const build = join(cache, "quickjs-host"), cmake = process.env.CMAKE ?? "cmake"
  run(cmake, ["-S", join(packageRoot, "vendor/quickjs"), "-B", build, "-DCMAKE_BUILD_TYPE=Release"])
  run(cmake, ["--build", build, "--target", "qjsc", "--config", "Release", "-j", "4"])
  const executable = process.platform === "win32" ? "qjsc.exe" : "qjsc"
  return await exists(join(build, executable)) ? join(build, executable) : join(build, "Release", executable)
}
const sdlSources = async (cache: string): Promise<string> => {
  if (process.env.FETCHCONTENT_SOURCE_DIR_SDL3) return resolve(process.env.FETCHCONTENT_SOURCE_DIR_SDL3)
  const source = join(cache, "SDL3-3.2.28")
  if (await exists(join(source, "CMakeLists.txt"))) return source
  const script = join(cache, "sdl.cmake"), archive = join(cache, "sdl.tar.gz")
  await writeFile(script, `file(DOWNLOAD "https://www.libsdl.org/release/SDL3-3.2.28.tar.gz" ${cmakeQuote(archive)} EXPECTED_HASH SHA256=1330671214d146f8aeb1ed399fc3e081873cdb38b5189d1f8bb6ab15bbc04211 TLS_VERIFY ON)\nfile(ARCHIVE_EXTRACT INPUT ${cmakeQuote(archive)} DESTINATION ${cmakeQuote(cache)})\n`)
  run(process.env.CMAKE ?? "cmake", ["-P", script]); return source
}
export const mobileProject = async (config: Config, target: "android" | "ios", root: string, generateOnly: boolean): Promise<string> => {
  const cache = join(root, ".ritmo-native/cache"), output = join(root, ".ritmo-native", target)
  await mkdir(cache, { recursive: true })
  const generated = join(output, "generated"), game = await bundleGame(config, generated)
  await bundle(join(generated, "entry.ts"), join(generated, "reference.js"))
  const qjsc = await hostQjsc(cache); run(qjsc, ["-C", "-N", "rn_bundle", "-o", join(generated, "bundle.c"), game])
  const sdl = await sdlSources(cache), project = join(root, "native", target)
  const sources = target === "android" ? join(project, "app/jni/ritmo") : join(project, "ritmo")
  await mkdir(sources, { recursive: true })
  for (const path of ["runtime", "vendor", "CMakeLists.txt"]) await cp(join(packageRoot, path), join(sources, path), { recursive: true, force: true })
  const gameSources = target === "android" ? join(project, "app/jni/generated") : join(project, "generated")
  await mkdir(gameSources, { recursive: true }); for (const file of ["bundle.c", "kernels.c", "game.js"]) await cp(join(generated, file), join(gameSources, file), { force: true })
  const assets = target === "android" ? join(project, "app/src/main/assets/assets") : join(project, "assets")
  await mkdir(assets, { recursive: true }); if (config.assets) await cp(config.assets, assets, { recursive: true, force: true })
  const definitions = `set(RN_BUNDLE "\u0024{CMAKE_CURRENT_LIST_DIR}/bundle.c")\nset(RN_KERNELS "\u0024{CMAKE_CURRENT_LIST_DIR}/kernels.c")\nset(RN_APP_NAME "${config.app.name}")\nset(RN_APP_ID "${config.app.id}")\nset(RN_APP_VERSION "${config.app.version}")\nset(RN_WIDTH ${config.window.width})\nset(RN_HEIGHT ${config.window.height})\n`
  await writeFile(join(gameSources, "config.cmake"), definitions)
  if (target === "android") {
    for (const path of ["gradlew", "gradlew.bat", "gradle", "build.gradle", "settings.gradle", "gradle.properties"]) {
      if (await exists(join(sdl, "android-project", path)) && !await exists(join(project, path))) await cp(join(sdl, "android-project", path), join(project, path), { recursive: true })
    }
    await cp(join(sdl, "android-project/app/src/main/java/org"), join(project, "app/src/main/java/org"), { recursive: true })
    await once(join(project, "app/build.gradle"), `plugins { id 'com.android.application' }\nandroid {\n namespace '${config.app.id}'\n compileSdk 35\n ndkVersion '27.2.12479018'\n defaultConfig {\n applicationId '${config.app.id}'\n minSdk 23\n targetSdk 35\n versionCode 1\n versionName '${config.app.version}'\n externalNativeBuild { cmake { arguments '-DANDROID_STL=c++_static'; abiFilters 'arm64-v8a', 'x86_64' } }\n }\n externalNativeBuild { cmake { path 'jni/CMakeLists.txt'; version '3.31.6' } }\n}\n`)
    const orientation = config.orientation === "portrait" ? "portrait" : config.orientation === "landscape" ? "landscape" : "fullSensor"
    await once(join(project, "app/src/main/AndroidManifest.xml"), `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-feature android:glEsVersion="0x00020000" android:required="true"/><application android:label="${config.app.name}" android:hasCode="true" android:theme="@android:style/Theme.NoTitleBar.Fullscreen"><activity android:name="${config.app.id}.GameActivity" android:exported="true" android:screenOrientation="${orientation}" android:configChanges="orientation|keyboardHidden|screenSize|screenLayout|uiMode"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>\n`)
    const java = join(project, "app/src/main/java", ...config.app.id.split("."), "GameActivity.java")
    await once(java, `package ${config.app.id};\npublic final class GameActivity extends org.libsdl.app.SDLActivity {\n @Override protected String[] getArguments() {\n  if (!getIntent().getBooleanExtra("headless", false)) return new String[0];\n  java.util.ArrayList<String> args = new java.util.ArrayList<>(); java.util.Collections.addAll(args,"--headless","--frames",String.valueOf(getIntent().getIntExtra("frames",600)),"--snapshots",getFilesDir().getAbsolutePath()+"/native.jsonl"); if(getIntent().getBooleanExtra("input",false)) java.util.Collections.addAll(args,"--input",getFilesDir().getAbsolutePath()+"/input.json"); return args.toArray(new String[0]);\n }\n}\n`)
    await once(join(project, "app/jni/CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)\nproject(ritmo_android C)\ninclude(generated/config.cmake)\nadd_subdirectory(ritmo)\n`)
    // The template is user-owned after generation; generated sources are refreshed on each build.
    if (!generateOnly) {
      if (!process.env.ANDROID_HOME) throw new Error(`Android project written to ${project}. Set ANDROID_HOME to an Android SDK with platform 35 and NDK installed, then build again`)
      if (process.platform === "win32") run("cmd", ["/c", "gradlew.bat", ":app:assembleDebug"], project)
      else run("sh", ["gradlew", ":app:assembleDebug"], project)
    }
  } else {
    await once(join(project, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.24)\nproject(ritmo_ios C)\ninclude(generated/config.cmake)\nset(RN_ASSETS "\u0024{CMAKE_CURRENT_SOURCE_DIR}/assets")\nadd_subdirectory(ritmo)\n`)
    const orientation = config.orientation === "portrait" ? ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown"] : config.orientation === "landscape" ? ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"] : ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]
    await once(join(project, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${config.app.id}</string><key>CFBundleExecutable</key><string>ritmo_app</string><key>CFBundleName</key><string>${config.app.name}</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>${config.app.version}</string><key>CFBundlePackageType</key><string>APPL</string><key>UILaunchScreen</key><dict/><key>UISupportedInterfaceOrientations</key><array>${orientation.map((o) => `<string>${o}</string>`).join("")}</array></dict></plist>\n`)
    if (!generateOnly) {
      if (process.platform !== "darwin") throw new Error(`iOS project written to ${project}. Build on a Mac with Xcode, or use --generate-only to generate without building`)
      const build = join(project, "build"), cmake = process.env.CMAKE ?? "cmake"
      run(cmake, ["-S", project, "-B", build, "-G", "Xcode", "-DCMAKE_SYSTEM_NAME=iOS", "-DCMAKE_XCODE_GENERATE_SCHEME=ON", "-DCMAKE_OSX_SYSROOT=iphonesimulator", "-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0", "-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO", `-DRN_IOS_PLIST=${join(project, "Info.plist")}`])
      run("xcodebuild", ["-project", join(build, "ritmo_ios.xcodeproj"), "-scheme", "ritmo_app", "-configuration", "Debug", "-sdk", "iphonesimulator", "CODE_SIGNING_ALLOWED=NO", "build"])
    }
  }
  console.log(`${target} project: ${project}${generateOnly ? " (generated; not built)" : ""}`)
  return project
}
