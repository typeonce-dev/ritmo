#!/usr/bin/env node
// Runs the CLI from its TypeScript source inside the repository; the published
// package runs the built `dist/cli.js` instead.
import { register } from "tsx/esm/api"

register()
await import("../src/cli.ts")
