// ── Ding Standard Library ────────────────────────────────────────────
//
// Each module maps exported names to their inline JS polyfill.
// The emitter injects only the functions actually imported.

import { DingError } from "../errors/index.js";

export interface StdlibEntry {
  name: string;
  implementation: string;
}

export type StdlibModule = Map<string, StdlibEntry>;

// ── ding:std ─────────────────────────────────────────────────────────

const std: StdlibModule = new Map([
  ["log", {
    name: "log",
    implementation: "const log = (...args) => console.log(...args);",
  }],
  ["warn", {
    name: "warn",
    implementation: "const warn = (...args) => console.warn(...args);",
  }],
  ["error", {
    name: "error",
    implementation: "const error = (...args) => console.error(...args);",
  }],
  ["assert", {
    name: "assert",
    implementation: `const assert = (cond, msg) => { if (!cond) throw new Error(msg); };`,
  }],
  ["typeOf", {
    name: "typeOf",
    implementation: "const typeOf = (val) => typeof val;",
  }],
  ["toString", {
    name: "toString",
    implementation: "const toString = (val) => String(val);",
  }],
  ["toNumber", {
    name: "toNumber",
    implementation: "const toNumber = (val) => Number(val);",
  }],
  ["toBool", {
    name: "toBool",
    implementation: "const toBool = (val) => Boolean(val);",
  }],
]);

// ── ding:math ────────────────────────────────────────────────────────

const math: StdlibModule = new Map([
  ["floor", {
    name: "floor",
    implementation: "const floor = (n) => Math.floor(n);",
  }],
  ["ceil", {
    name: "ceil",
    implementation: "const ceil = (n) => Math.ceil(n);",
  }],
  ["round", {
    name: "round",
    implementation: "const round = (n) => Math.round(n);",
  }],
  ["abs", {
    name: "abs",
    implementation: "const abs = (n) => Math.abs(n);",
  }],
  ["min", {
    name: "min",
    implementation: "const min = (a, b) => Math.min(a, b);",
  }],
  ["max", {
    name: "max",
    implementation: "const max = (a, b) => Math.max(a, b);",
  }],
  ["random", {
    name: "random",
    implementation: "const random = () => Math.random();",
  }],
  ["pow", {
    name: "pow",
    implementation: "const pow = (a, b) => Math.pow(a, b);",
  }],
  ["sqrt", {
    name: "sqrt",
    implementation: "const sqrt = (n) => Math.sqrt(n);",
  }],
]);

// ── ding:io ─────────────────────────────────────────────────────────

const io: StdlibModule = new Map([
  ["readFile", {
    name: "readFile",
    implementation: "import { readFileSync as __readFileSync } from 'node:fs';\nconst readFile = (path) => __readFileSync(path, 'utf-8');",
  }],
  ["writeFile", {
    name: "writeFile",
    implementation: "import { writeFileSync as __writeFileSync } from 'node:fs';\nconst writeFile = (path, data) => __writeFileSync(path, data, 'utf-8');",
  }],
  ["appendFile", {
    name: "appendFile",
    implementation: "import { appendFileSync as __appendFileSync } from 'node:fs';\nconst appendFile = (path, data) => __appendFileSync(path, data, 'utf-8');",
  }],
  ["readLine", {
    name: "readLine",
    implementation: "import { readSync as __readSync } from 'node:fs';\nconst readLine = () => { const buf = Buffer.alloc(4096); const n = __readSync(0, buf, 0, buf.length); return buf.toString('utf-8', 0, n).replace(/\\n$/, ''); };",
  }],
  ["args", {
    name: "args",
    implementation: "const args = () => process.argv.slice(2);",
  }],
  ["exists", {
    name: "exists",
    implementation: "import { existsSync as __existsSync } from 'node:fs';\nconst exists = (path) => __existsSync(path);",
  }],
]);

// ── ding:json ───────────────────────────────────────────────────────

const json: StdlibModule = new Map([
  ["parse", {
    name: "parse",
    implementation: `const parse = (s) => JSON.parse(s);`,
  }],
  ["stringify", {
    name: "stringify",
    implementation: `const stringify = (v) => { const prep = (val) => { if (val instanceof Map) { const obj = {}; val.forEach((v, k) => obj[k] = prep(v)); return obj; } if (Array.isArray(val)) return val.map(prep); return val; }; return JSON.stringify(prep(v)); };`,
  }],
]);

// ── ding:http ───────────────────────────────────────────────────────

const http: StdlibModule = new Map([
  ["get", {
    name: "get",
    implementation: `import { execFileSync as __execFileSync } from 'node:child_process';\nconst get = (url) => __execFileSync('curl', ['-sS', url], { encoding: 'utf-8' });`,
  }],
  ["post", {
    name: "post",
    implementation: `import { execFileSync as __execFileSync2 } from 'node:child_process';\nconst post = (url, body) => __execFileSync2('curl', ['-sS', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', body, url], { encoding: 'utf-8' });`,
  }],
]);

// ── ding:concurrent ─────────────────────────────────────────────────

const concurrent: StdlibModule = new Map([
  ["Channel", {
    name: "Channel",
    implementation: `class __DingChannel { constructor() { this._queue = []; this._waiters = []; } send(val) { if (this._waiters.length > 0) { this._waiters.shift()(val); } else { this._queue.push(val); } } receive() { if (this._queue.length > 0) return this._queue.shift(); return new Promise(resolve => this._waiters.push(resolve)); } }\nconst Channel = () => new __DingChannel();`,
  }],
]);

// ── Module registry ──────────────────────────────────────────────────

const modules: Map<string, StdlibModule> = new Map([
  ["ding:std", std],
  ["ding:math", math],
  ["ding:io", io],
  ["ding:json", json],
  ["ding:http", http],
  ["ding:concurrent", concurrent],
]);

export function isDingModule(source: string): boolean {
  return source.startsWith("ding:");
}

export function getModule(source: string): StdlibModule {
  const mod = modules.get(source);
  if (!mod) {
    throw new DingError(
      "emitter",
      `Unknown Ding module: "${source}". Available modules: ${[...modules.keys()].join(", ")}`,
      { hint: `Available modules: ${[...modules.keys()].join(", ")}` },
    );
  }
  return mod;
}

export function getPolyfill(source: string, name: string): string {
  const mod = getModule(source);
  const entry = mod.get(name);
  if (!entry) {
    throw new DingError(
      "emitter",
      `"${name}" is not exported from "${source}". Available exports: ${[...mod.keys()].join(", ")}`,
      { hint: `Available exports: ${[...mod.keys()].join(", ")}` },
    );
  }
  return entry.implementation;
}
