#!/usr/bin/env node

import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { Lexer } from "../lexer/index.js";
import { Parser } from "../parser/index.js";
import { Emitter, CEmitter } from "../emitter/index.js";
import { DingError, formatError } from "../errors/index.js";

const VERSION = "0.3.0";

const args = process.argv.slice(2);
const command = args[0];

type Target = "c" | "js";

function parseTarget(args: string[]): Target {
  const idx = args.indexOf("--target");
  if (idx !== -1 && idx + 1 < args.length) {
    const t = args[idx + 1];
    if (t === "js" || t === "c") return t;
    error(`Unknown target: ${t}\nAvailable targets: js, c`);
  }
  return "c"; // default target
}

function stripFlags(args: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--target") {
      i += 2; // skip --target and its value
    } else {
      result.push(args[i]);
      i++;
    }
  }
  return result;
}

function help(): void {
  console.log(`Ding programming language v${VERSION}

Usage:
  ding run <file>               compile to C and execute (default)
  ding run <file> --target js   compile to JS and execute
  ding build <file>             compile to native binary via gcc
  ding build <file> --target js compile to JS file
  ding build <file> --target c  compile to C source file
  ding version                  print version
  ding help                     show this message

Examples:
  ding run main.dg
  ding build main.dg
  ding build main.dg --target js`);
}

function error(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function compileJS(source: string): string {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens, source).parse();
  return new Emitter(ast).emit();
}

function compileC(source: string): string {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens, source).parse();
  return new CEmitter().emit(ast);
}

function checkGcc(): void {
  try {
    execFileSync("gcc", ["--version"], { stdio: "ignore" });
  } catch {
    throw new DingError("emitter", "Ding C target requires gcc", {
      hint: "Install gcc:\n  Ubuntu: sudo apt install gcc\n  Mac: xcode-select --install",
    });
  }
}

async function run(filePath: string, target: Target): Promise<void> {
  const resolved = resolve(filePath);
  const source = await readSource(filePath, resolved);

  if (target === "js") {
    let js: string;
    try {
      js = compileJS(source);
    } catch (err) {
      handleError(err);
    }
    execFileSync("node", ["--input-type=module", "--eval", js], {
      stdio: "inherit",
    });
    return;
  }

  // C target (default)
  let c: string;
  try {
    c = compileC(source);
  } catch (err) {
    handleError(err);
  }

  checkGcc();

  const tmpC = "/tmp/ding_out.c";
  const tmpBin = "/tmp/ding_out";
  await writeFile(tmpC, c, "utf-8");

  try {
    execFileSync("gcc", ["-O2", "-o", tmpBin, tmpC, "-lm"], {
      stdio: "inherit",
    });
    execFileSync(tmpBin, [], { stdio: "inherit" });
  } finally {
    // Clean up temp files
    try { await unlink(tmpC); } catch {}
    try { await unlink(tmpBin); } catch {}
  }
}

async function build(filePath: string, target: Target): Promise<void> {
  const resolved = resolve(filePath);
  const source = await readSource(filePath, resolved);

  if (target === "js") {
    let js: string;
    try {
      js = compileJS(source);
    } catch (err) {
      handleError(err);
    }
    const outPath = resolved.replace(/\.dg$/, ".js");
    await writeFile(outPath, js + "\n", "utf-8");
    console.log(`[ding] compiled ${basename(filePath)} → ${basename(outPath)}`);
    return;
  }

  // C target
  let c: string;
  try {
    c = compileC(source);
  } catch (err) {
    handleError(err);
  }

  // --target c: emit C source only
  const targetIdx = args.indexOf("--target");
  if (targetIdx !== -1 && args[targetIdx + 1] === "c") {
    const outPath = resolved.replace(/\.dg$/, ".c");
    await writeFile(outPath, c + "\n", "utf-8");
    console.log(`[ding] compiled ${basename(filePath)} → ${basename(outPath)}`);
    return;
  }

  // Default: compile to native binary via gcc
  checkGcc();
  const tmpC = resolved.replace(/\.dg$/, ".c");
  const outBin = resolved.replace(/\.dg$/, "");
  await writeFile(tmpC, c, "utf-8");

  try {
    execFileSync("gcc", ["-O2", "-o", outBin, tmpC, "-lm"], {
      stdio: "inherit",
    });
    console.log(`[ding] compiled ${basename(filePath)} → ${basename(outBin)}`);
  } finally {
    try { await unlink(tmpC); } catch {}
  }
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

const target = parseTarget(args);
const cleanArgs = stripFlags(args);

switch (command) {
  case "run": {
    const file = requireFile(cleanArgs[1], "run");
    await run(file, target);
    break;
  }
  case "build": {
    const file = requireFile(cleanArgs[1], "build");
    await build(file, target);
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
