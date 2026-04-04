#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { Lexer } from "../lexer/index.js";
import { Parser } from "../parser/index.js";
import { Emitter } from "../emitter/index.js";
import { DingError, formatError } from "../errors/index.js";

const VERSION = "0.2.1";

const args = process.argv.slice(2);
const command = args[0];

function help(): void {
  console.log(`Ding programming language v${VERSION}

Usage:
  ding run <file>      compile and execute a .dg file
  ding build <file>    compile .dg to .js
  ding version         print version
  ding help            show this message

Examples:
  ding run main.dg
  ding build main.dg`);
}

function error(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function compile(source: string): string {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens, source).parse();
  return new Emitter(ast).emit();
}

async function run(filePath: string): Promise<void> {
  const resolved = resolve(filePath);
  const source = await readSource(filePath, resolved);

  let js: string;
  try {
    js = compile(source);
  } catch (err) {
    handleError(err);
  }

  execFileSync("node", ["--input-type=module", "--eval", js], {
    stdio: "inherit",
  });
}

async function build(filePath: string): Promise<void> {
  const resolved = resolve(filePath);
  const source = await readSource(filePath, resolved);

  let js: string;
  try {
    js = compile(source);
  } catch (err) {
    handleError(err);
  }

  const outPath = resolved.replace(/\.dg$/, ".js");
  await writeFile(outPath, js + "\n", "utf-8");
  console.log(`[ding] compiled ${basename(filePath)} → ${basename(outPath)}`);
}

function handleError(err: unknown): never {
  if (err instanceof DingError) {
    process.stderr.write(formatError(err) + "\n");
    process.exit(1);
  }
  // Genuine bug — show internal error info
  process.stderr.write(`Internal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.stderr.write("This is a bug in the Ding compiler.\n");
  process.stderr.write("Please report it at github.com/user/dinglang\n");
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
}

async function readSource(filePath: string, resolved: string): Promise<string> {
  if (!existsSync(resolved)) {
    error(`File not found: ${filePath}`);
  }
  try {
    return await readFile(resolved, "utf-8");
  } catch {
    error(`File not found: ${filePath}`);
  }
}

function requireFile(file: string | undefined, cmd: string): string {
  if (!file) {
    error(`Missing file argument\nUsage: ding ${cmd} <file.dg>`);
  }
  return file;
}

switch (command) {
  case "run": {
    const file = requireFile(args[1], "run");
    await run(file);
    break;
  }
  case "build": {
    const file = requireFile(args[1], "build");
    await build(file);
    break;
  }
  case "version":
    console.log(`Ding v${VERSION}`);
    break;
  case "help":
  case undefined:
    help();
    break;
  default:
    error(`Unknown command: ${command}\nRun 'ding help' for usage`);
}
