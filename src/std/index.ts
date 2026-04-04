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

// ── Module registry ──────────────────────────────────────────────────

const modules: Map<string, StdlibModule> = new Map([
  ["ding:std", std],
  ["ding:math", math],
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
