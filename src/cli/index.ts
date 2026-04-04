#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
  console.log(`
ding - The Ding programming language

Usage:
  ding run <file.dg>    Run a Ding source file
  ding help             Show this help message
`);
}

async function run(filePath: string): Promise<void> {
  const resolved = resolve(filePath);

  if (!resolved.endsWith(".dg")) {
    console.error(`Error: expected a .dg file, got "${filePath}"`);
    process.exit(1);
  }

  let source: string;
  try {
    source = await readFile(resolved, "utf-8");
  } catch {
    console.error(`Error: could not read file "${filePath}"`);
    process.exit(1);
  }

  // TODO: lex → parse → emit → execute
  console.log(`[ding] loaded ${filePath} (${source.length} bytes)`);
  console.log("[ding] compiler pipeline not yet implemented");
}

switch (command) {
  case "run": {
    const file = args[1];
    if (!file) {
      console.error("Error: missing file argument\n");
      usage();
      process.exit(1);
    }
    await run(file);
    break;
  }
  case "help":
  case undefined:
    usage();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    usage();
    process.exit(1);
}
