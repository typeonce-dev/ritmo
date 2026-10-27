#!/usr/bin/env node
// Runs the CLI from its TypeScript source, from any working directory.
import { register } from "tsx/esm/api"

register()
await import("../src/cli/main.ts")
