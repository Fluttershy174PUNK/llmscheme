#!/usr/bin/env node
// e2e runner entry: node e2e/run.mjs [suite ...]
// env: BASE (default http://127.0.0.1:8080), E2E_ADMIN (default admin), E2E_PASSWORD (required)
import { run } from "./harness.mjs";
await run(process.argv.slice(2));
