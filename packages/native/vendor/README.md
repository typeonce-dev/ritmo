# Native dependencies

* QuickJS-ng **v0.12.0**, MIT, https://github.com/quickjs-ng/quickjs/tree/v0.12.0.
  Source is vendored in `quickjs/`, including upstream LICENSE. No runtime downloads.
* stb_image **v2.30**, commit `f0569113c93ad095470c54bf34a17b36646bbbb5`,
  public domain or MIT (licenses in the header), https://github.com/nothings/stb.
* SDL **3.2.28**, zlib, fetched by CMake from the official release archive.
  SHA256 `1330671214d146f8aeb1ed399fc3e081873cdb38b5189d1f8bb6ab15bbc04211`.
  CMake caches the sources; `FETCHCONTENT_SOURCE_DIR_SDL3` supports offline builds.

QuickJS's upstream source is unchanged. Only source/build inputs are distributed;
upstream test suites, workflows and documentation are omitted from the package.
