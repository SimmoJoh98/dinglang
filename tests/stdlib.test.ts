import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer/index.js";
import { Parser } from "../src/parser/index.js";
import { Emitter } from "../src/emitter/index.js";

function compile(source: string): string {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parse();
  return new Emitter(ast).emit();
}

// ── ding:std ─────────────────────────────────────────────────────────

describe("stdlib: ding:std", () => {
  it("should strip import and inject log polyfill", () => {
    const result = compile("import { log } from 'ding:std'\nlog(42)");
    expect(result).toBe(
      "const log = (...args) => console.log(...args);\nlog(42);"
    );
  });

  it("should inject warn polyfill", () => {
    const result = compile("import { warn } from 'ding:std'\nwarn(42)");
    expect(result).toBe(
      "const warn = (...args) => console.warn(...args);\nwarn(42);"
    );
  });

  it("should inject error polyfill", () => {
    const result = compile("import { error } from 'ding:std'\nerror(42)");
    expect(result).toBe(
      "const error = (...args) => console.error(...args);\nerror(42);"
    );
  });

  it("should inject assert polyfill", () => {
    const result = compile(
      `import { assert } from 'ding:std'\nassert(true, "ok")`
    );
    expect(result).toContain(
      "const assert = (cond, msg) => { if (!cond) throw new Error(msg); };"
    );
    expect(result).toContain('assert(true, "ok");');
  });

  it("should inject typeOf polyfill", () => {
    const result = compile("import { typeOf } from 'ding:std'\ntypeOf(42)");
    expect(result).toContain("const typeOf = (val) => typeof val;");
  });

  it("should inject conversion polyfills", () => {
    const result = compile(
      "import { toString, toNumber, toBool } from 'ding:std'\ntoString(42)"
    );
    expect(result).toContain("const toString = (val) => String(val);");
    expect(result).toContain("const toNumber = (val) => Number(val);");
    expect(result).toContain("const toBool = (val) => Boolean(val);");
  });

  it("should resolve default import from ding:std", () => {
    const result = compile("import log from 'ding:std'\nlog(42)");
    expect(result).toBe(
      "const log = (...args) => console.log(...args);\nlog(42);"
    );
  });

  it("should handle multiple imports from ding:std", () => {
    const result = compile(
      "import { log, warn, error } from 'ding:std'\nlog(1)"
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("const log = (...args) => console.log(...args);");
    expect(lines[1]).toBe("const warn = (...args) => console.warn(...args);");
    expect(lines[2]).toBe(
      "const error = (...args) => console.error(...args);"
    );
    expect(lines[3]).toBe("log(1);");
  });

  it("should resolve namespace import from ding:std", () => {
    const result = compile("import * as std from 'ding:std'\nstd.log(42)");
    expect(result).toContain("const std = {");
    expect(result).toContain("std.log(42);");
  });

  it("should resolve mixed default + named import from ding:std", () => {
    const result = compile("import log, { warn } from 'ding:std'\nlog(1)\nwarn(2)");
    expect(result).toContain("const log = (...args) => console.log(...args);");
    expect(result).toContain("const warn = (...args) => console.warn(...args);");
    expect(result).toContain("log(1);");
    expect(result).toContain("warn(2);");
  });
});

// ── ding:math ────────────────────────────────────────────────────────

describe("stdlib: ding:math", () => {
  it("should strip import and inject floor polyfill", () => {
    const result = compile("import { floor } from 'ding:math'\nfloor(3)");
    expect(result).toBe(
      "const floor = (n) => Math.floor(n);\nfloor(3);"
    );
  });

  it("should inject ceil polyfill", () => {
    const result = compile("import { ceil } from 'ding:math'\nceil(3)");
    expect(result).toContain("const ceil = (n) => Math.ceil(n);");
  });

  it("should inject round polyfill", () => {
    const result = compile("import { round } from 'ding:math'\nround(3)");
    expect(result).toContain("const round = (n) => Math.round(n);");
  });

  it("should inject abs polyfill", () => {
    const result = compile("import { abs } from 'ding:math'\nabs(3)");
    expect(result).toContain("const abs = (n) => Math.abs(n);");
  });

  it("should inject min/max polyfills", () => {
    const result = compile(
      "import { min, max } from 'ding:math'\nmin(1, 2)"
    );
    expect(result).toContain("const min = (a, b) => Math.min(a, b);");
    expect(result).toContain("const max = (a, b) => Math.max(a, b);");
  });

  it("should inject random polyfill", () => {
    const result = compile("import { random } from 'ding:math'\nrandom()");
    expect(result).toContain("const random = () => Math.random();");
  });

  it("should inject pow polyfill", () => {
    const result = compile("import { pow } from 'ding:math'\npow(2, 3)");
    expect(result).toContain("const pow = (a, b) => Math.pow(a, b);");
  });

  it("should inject sqrt polyfill", () => {
    const result = compile("import { sqrt } from 'ding:math'\nsqrt(9)");
    expect(result).toContain("const sqrt = (n) => Math.sqrt(n);");
  });

  it("should handle multiple math imports", () => {
    const result = compile(
      "import { floor, ceil, abs } from 'ding:math'\nfloor(1)"
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("const floor = (n) => Math.floor(n);");
    expect(lines[1]).toBe("const ceil = (n) => Math.ceil(n);");
    expect(lines[2]).toBe("const abs = (n) => Math.abs(n);");
    expect(lines[3]).toBe("floor(1);");
  });
});

// ── Cross-module imports ─────────────────────────────────────────────

describe("stdlib: cross-module", () => {
  it("should handle imports from both ding:std and ding:math", () => {
    const source = `import { log } from 'ding:std'
import { floor } from 'ding:math'
log(floor(3))`;
    const result = compile(source);
    const lines = result.split("\n");
    expect(lines[0]).toBe("const log = (...args) => console.log(...args);");
    expect(lines[1]).toBe("const floor = (n) => Math.floor(n);");
    expect(lines[2]).toBe("log(floor(3));");
  });

  it("should preserve non-ding imports alongside ding imports", () => {
    const source = `import { log } from 'ding:std'
import { readFile } from 'fs'
log(1)`;
    const result = compile(source);
    const lines = result.split("\n");
    expect(lines[0]).toBe("const log = (...args) => console.log(...args);");
    expect(lines[1]).toBe('import { readFile } from "fs";');
    expect(lines[2]).toBe("log(1);");
  });
});

// ── Error handling ───────────────────────────────────────────────────

describe("stdlib: errors", () => {
  it("should throw on unknown ding: module", () => {
    expect(() => compile("import { foo } from 'ding:foo'")).toThrow(
      'Unknown Ding module: "ding:foo". Available modules: ding:std, ding:math'
    );
  });

  it("should throw on unknown export from ding:std", () => {
    expect(() => compile("import { banana } from 'ding:std'")).toThrow(
      '"banana" is not exported from "ding:std"'
    );
  });

  it("should throw on unknown export from ding:math", () => {
    expect(() => compile("import { banana } from 'ding:math'")).toThrow(
      '"banana" is not exported from "ding:math"'
    );
  });
});

// ── hello.dg integration ─────────────────────────────────────────────

describe("stdlib: hello.dg integration", () => {
  it("should emit correct JS with polyfills prepended", () => {
    const source = `import { log } from 'ding:std'

const name = "Dallas"
const health: number = 100

const getStatus = (h) => {
  if (h > 0) {
    return \`\${name} is alive with \${h} health\`
  }
  return null
}

const status = getStatus(health)
log(status)`;

    const result = compile(source);
    const lines = result.split("\n");

    // Polyfill is first
    expect(lines[0]).toBe("const log = (...args) => console.log(...args);");
    // Then the program body (no import statement)
    expect(lines[1]).toBe('const name = "Dallas";');
    expect(lines[2]).toBe("const health = 100;");
    expect(lines[3]).toBe("const getStatus = (h) => {");
    expect(lines[4]).toBe("  if (h > 0) {");
    expect(lines[5]).toBe("    return `${name} is alive with ${h} health`;");
    expect(lines[6]).toBe("  }");
    expect(lines[7]).toBe("  return null;");
    expect(lines[8]).toBe("};");
    expect(lines[9]).toBe("const status = getStatus(health);");
    expect(lines[10]).toBe("log(status);");

    // No raw import statement should remain
    expect(result).not.toContain('import { log } from "ding:std"');
  });
});
