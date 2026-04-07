import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer/index.js";
import { Parser } from "../src/parser/index.js";
import { Emitter } from "../src/emitter/index.js";

function compile(source: string): string {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parse();
  return new Emitter(ast).emit();
}

// ── Variable declarations ───────────────────────────────────────────

describe("Emitter", () => {
  describe("variable declarations", () => {
    it("should emit const with number", () => {
      expect(compile("const x = 5")).toBe("const x = 5;");
    });

    it("should emit let with string", () => {
      expect(compile('let name = "hello"')).toBe('let name = "hello";');
    });

    it("should drop type annotations", () => {
      expect(compile("const x: number = 5")).toBe("const x = 5;");
    });

    it("should emit boolean literals", () => {
      expect(compile("const a = true")).toBe("const a = true;");
      expect(compile("const b = false")).toBe("const b = false;");
    });

    it("should emit null literal", () => {
      expect(compile("const x = null")).toBe("const x = null;");
    });
  });

  // ── Binary expressions ──────────────────────────────────────────────

  describe("binary expressions", () => {
    it("should emit arithmetic operators", () => {
      expect(compile("const x = 1 + 2")).toBe("const x = 1 + 2;");
      expect(compile("const x = 10 - 3")).toBe("const x = 10 - 3;");
      expect(compile("const x = 4 * 5")).toBe("const x = 4 * 5;");
      expect(compile("const x = 8 / 2")).toBe("const x = 8 / 2;");
    });

    it("should emit comparison operators", () => {
      expect(compile("const x = 1 < 2")).toBe("const x = 1 < 2;");
      expect(compile("const x = 1 > 2")).toBe("const x = 1 > 2;");
      expect(compile("const x = 1 <= 2")).toBe("const x = 1 <= 2;");
      expect(compile("const x = 1 >= 2")).toBe("const x = 1 >= 2;");
    });

    it("should convert != to !==", () => {
      expect(compile("const x = 1 != 2")).toBe("const x = 1 !== 2;");
    });

    it("should convert == to ===", () => {
      expect(compile("const x = 1 == 2")).toBe("const x = 1 === 2;");
    });
  });

  // ── Import declarations ─────────────────────────────────────────────

  describe("import declarations", () => {
    it("should emit named import from external module", () => {
      expect(compile("import { a, b, c } from 'mod'")).toBe(
        'import { a, b, c } from "mod";'
      );
    });

    it("should emit default import from external module", () => {
      expect(compile("import log from 'mod'")).toBe(
        'import log from "mod";'
      );
    });

    it("should emit namespace import from external module", () => {
      expect(compile("import * as ns from 'mod'")).toBe(
        'import * as ns from "mod";'
      );
    });

    it("should emit mixed default + named import from external module", () => {
      expect(compile("import fs, { readFile, writeFile } from 'mod'")).toBe(
        'import fs, { readFile, writeFile } from "mod";'
      );
    });
  });

  // ── Arrow functions ─────────────────────────────────────────────────

  describe("arrow functions", () => {
    it("should emit expression-body arrow", () => {
      expect(compile("const f = (x) => x * 2")).toBe(
        "const f = (x) => x * 2;"
      );
    });

    it("should emit block-body arrow", () => {
      const source = `const f = (x) => {
  return x
}`;
      const result = compile(source);
      expect(result).toBe("const f = (x) => {\n  return x;\n};");
    });

    it("should emit multi-param arrow", () => {
      expect(compile("const add = (a, b) => a + b")).toBe(
        "const add = (a, b) => a + b;"
      );
    });

    it("should drop param type annotations", () => {
      expect(compile("const f = (x: number) => x")).toBe(
        "const f = (x) => x;"
      );
    });
  });

  // ── If/else ─────────────────────────────────────────────────────────

  describe("if/else statements", () => {
    it("should emit basic if", () => {
      const source = `if (x > 0) {
  return x
}`;
      const result = compile(source);
      expect(result).toBe("if (x > 0) {\n  return x;\n}");
    });

    it("should emit if/else", () => {
      const source = `if (x > 0) {
  return x
} else {
  return null
}`;
      const result = compile(source);
      expect(result).toBe(
        "if (x > 0) {\n  return x;\n} else {\n  return null;\n}"
      );
    });

    it("should emit else if chain", () => {
      const source = `if (x > 0) {
  return 1
} else if (x == 0) {
  return 0
} else {
  return null
}`;
      const result = compile(source);
      expect(result).toBe(
        "if (x > 0) {\n  return 1;\n} else if (x === 0) {\n  return 0;\n} else {\n  return null;\n}"
      );
    });
  });

  // ── Return statements ───────────────────────────────────────────────

  describe("return statements", () => {
    it("should emit return with value", () => {
      const source = `const f = () => {
  return 42
}`;
      expect(compile(source)).toBe("const f = () => {\n  return 42;\n};");
    });

    it("should emit bare return", () => {
      const source = `const f = () => {
  return
}`;
      expect(compile(source)).toBe("const f = () => {\n  return;\n};");
    });

    it("should emit return null", () => {
      const source = `const f = () => {
  return null
}`;
      expect(compile(source)).toBe("const f = () => {\n  return null;\n};");
    });
  });

  // ── Call expressions ────────────────────────────────────────────────

  describe("call expressions", () => {
    it("should emit simple call", () => {
      expect(compile("f(x)")).toBe("f(x);");
    });

    it("should emit multi-arg call", () => {
      expect(compile("f(x, y, z)")).toBe("f(x, y, z);");
    });

    it("should emit no-arg call", () => {
      expect(compile("f()")).toBe("f();");
    });
  });

  // ── Template literals ───────────────────────────────────────────────

  describe("template literals", () => {
    it("should emit template with interpolation", () => {
      const source = "const msg = `hello ${name}`";
      const result = compile(source);
      expect(result).toBe("const msg = `hello ${name}`;");
    });

    it("should emit template with expression", () => {
      const source = "const msg = `${a + b} total`";
      const result = compile(source);
      expect(result).toBe("const msg = `${a + b} total`;");
    });
  });

  // ── Full program (integration) ──────────────────────────────────────

  describe("full program", () => {
    it("should emit the hello.dg example with polyfills prepended", () => {
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

      // Verify structure line by line
      const lines = result.split("\n");
      expect(lines[0]).toBe("const log = (...args) => console.log(...args);");
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
    });

    it("should emit multiple statements separated by newlines", () => {
      const source = `const a = 1
const b = 2
const c = a + b`;
      const result = compile(source);
      expect(result).toBe("const a = 1;\nconst b = 2;\nconst c = a + b;");
    });
  });

  // ── For range loops ─────────────────────────────────────────────────

  describe("for range loops", () => {
    it("should emit for range as JS for loop", () => {
      expect(compile("for i = 0..5 { i }")).toBe(
        "for (let i = 0; i < 5; i++) {\n  i;\n}"
      );
    });

    it("should emit for range with non-zero start", () => {
      expect(compile("for i = 2..10 { i }")).toBe(
        "for (let i = 2; i < 10; i++) {\n  i;\n}"
      );
    });

    it("should emit break and continue inside for range", () => {
      expect(compile("for i = 0..5 { break }")).toBe(
        "for (let i = 0; i < 5; i++) {\n  break;\n}"
      );
      expect(compile("for i = 0..5 { continue }")).toBe(
        "for (let i = 0; i < 5; i++) {\n  continue;\n}"
      );
    });
  });

  // ── For in loops ───────────────────────────────────────────────────

  describe("for in loops", () => {
    it("should emit for in as JS for-of loop", () => {
      expect(compile("for item in items { item }")).toBe(
        "for (const item of items) {\n  item;\n}"
      );
    });

    it("should emit nested for loops", () => {
      const result = compile("for x in xs { for y in ys { x } }");
      expect(result).toContain("for (const x of xs)");
      expect(result).toContain("for (const y of ys)");
    });
  });

  // ── While loops ────────────────────────────────────────────────────

  describe("while loops", () => {
    it("should emit while loop", () => {
      expect(compile("while (x > 0) { x }")).toBe(
        "while (x > 0) {\n  x;\n}"
      );
    });

    it("should emit while with break", () => {
      expect(compile("while (true) { break }")).toBe(
        "while (true) {\n  break;\n}"
      );
    });

    it("should emit infinite loop with break", () => {
      const src = `while (true) {
  if (x == 0) {
    break
  }
}`;
      const result = compile(src);
      expect(result).toContain("while (true)");
      expect(result).toContain("break;");
    });
  });

  // ── Arrays ─────────────────────────────────────────────────────────

  describe("arrays", () => {
    it("should emit array literal", () => {
      expect(compile("const a = [1, 2, 3]")).toBe("const a = [1, 2, 3];");
    });

    it("should emit empty array", () => {
      expect(compile("const a = []")).toBe("const a = [];");
    });

    it("should emit array access", () => {
      expect(compile("const x = arr[0]")).toBe("const x = arr[0];");
    });

    it("should emit # as .length", () => {
      expect(compile("const x = #arr")).toBe("const x = arr.length;");
    });

    it("should emit .length via dot access", () => {
      expect(compile("const x = arr.length")).toBe("const x = arr.length;");
    });

    it("should emit nested arrays", () => {
      expect(compile("const a = [[1, 2], [3, 4]]")).toBe(
        "const a = [[1, 2], [3, 4]];"
      );
    });

    it("should emit array in struct field", () => {
      const src = `struct Bag {
  items: string[]
}`;
      const result = compile(src);
      expect(result).toContain("class Bag");
      expect(result).toContain("constructor(items)");
    });
  });

  // ── Structs ────────────────────────────────────────────────────────

  describe("structs", () => {
    it("should emit struct as class", () => {
      const src = `struct Point {
  x: number
  y: number
}`;
      const result = compile(src);
      expect(result).toContain("class Point {");
      expect(result).toContain("constructor(x, y)");
      expect(result).toContain("this.x = x;");
      expect(result).toContain("this.y = y;");
    });

    it("should emit struct instantiation with new", () => {
      expect(compile("const p = Point { x: 1, y: 2 }")).toBe(
        "const p = new Point(1, 2);"
      );
    });

    it("should emit field access via dot notation", () => {
      expect(compile("const x = p.x")).toBe("const x = p.x;");
    });

    it("should emit method with self mapped to this", () => {
      const src = `struct Dog {
  name: string
  const bark = (self) => {
    return self.name
  }
}`;
      const result = compile(src);
      expect(result).toContain("bark()");
      expect(result).toContain("return this.name;");
    });

    it("should emit struct with typed fields", () => {
      const src = `struct Config {
  host: string
  port: number
}`;
      const result = compile(src);
      expect(result).toContain("class Config");
      expect(result).toContain("constructor(host, port)");
    });

    it("should emit nested struct access", () => {
      expect(compile("const x = a.b.c")).toBe("const x = a.b.c;");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  describe("error handling (try/catch)", () => {
    it("should emit try/catch", () => {
      const result = compile('try { x } catch (e) { e }');
      expect(result).toContain("try {");
      expect(result).toContain("} catch (e) {");
    });

    it("should emit try/catch/finally", () => {
      const result = compile('try { x } catch (e) { e } finally { y }');
      expect(result).toContain("} finally {");
    });

    it("should emit throw", () => {
      expect(compile('throw "error"')).toBe('throw "error";');
    });

    it("should emit error propagation as try/catch wrapper", () => {
      const result = compile("const x = getValue()?");
      expect(result).toContain("try { return getValue();");
      expect(result).toContain("catch(__e)");
    });
  });

  // ── Null handling ──────────────────────────────────────────────────

  describe("null handling", () => {
    it("should emit optional chain", () => {
      expect(compile("const x = a?.b")).toBe("const x = a?.b;");
    });

    it("should emit nullish coalescing", () => {
      expect(compile("const x = a ?? b")).toBe("const x = (a ?? b);");
    });

    it("should emit null assertion with runtime check", () => {
      const result = compile("const x = a!");
      expect(result).toContain("if (__v == null) throw new Error");
      expect(result).toContain("null assertion failed");
    });

    it("should emit chained optional chain", () => {
      expect(compile("const x = a?.b?.c")).toBe("const x = a?.b?.c;");
    });
  });

  // ── Assignment ─────────────────────────────────────────────────────

  describe("assignment", () => {
    it("should emit variable reassignment", () => {
      expect(compile("x = 5")).toBe("x = 5;");
    });

    it("should emit member assignment", () => {
      expect(compile("obj.x = 5")).toBe("obj.x = 5;");
    });

    it("should emit array index assignment", () => {
      expect(compile("arr[0] = 5")).toBe("arr[0] = 5;");
    });
  });

  // ── Error handling (unknown types) ─────────────────────────────────

  describe("error handling", () => {
    it("should throw on unknown node types", () => {
      const tokens = new Lexer("const x = 1").tokenize();
      const ast = new Parser(tokens).parse();
      // Corrupt the AST to test error path
      (ast.body[0] as any).type = "FooStatement";
      const emitter = new Emitter(ast);
      expect(() => emitter.emit()).toThrow("Internal compiler error");
    });
  });

  // ── Batch 3 features ─────────────────────────────────────────────────

  describe("power operator", () => {
    it("should emit ** as native JS", () => {
      expect(compile("const x = 2 ** 3")).toBe("const x = 2 ** 3;");
    });

    it("should handle right-associative **", () => {
      expect(compile("const x = 2 ** 3 ** 2")).toBe("const x = 2 ** 3 ** 2;");
    });
  });

  describe("string repeat", () => {
    it("should emit string * n as .repeat()", () => {
      const out = compile('const x = "ha" * 3');
      expect(out).toBe('const x = "ha".repeat(3);');
    });

    it("should emit n * string as .repeat()", () => {
      const out = compile('const x = 3 * "ha"');
      expect(out).toBe('const x = "ha".repeat(3);');
    });
  });

  describe("pipe operator", () => {
    it("should desugar pipe into function call", () => {
      expect(compile("5 |> double")).toBe("double(5);");
    });

    it("should desugar pipe with args", () => {
      expect(compile("5 |> add(10)")).toBe("add(5, 10);");
    });

    it("should chain pipes", () => {
      expect(compile("5 |> double |> toString")).toBe("toString(double(5));");
    });
  });

  describe("spread operator", () => {
    it("should emit spread in array literal", () => {
      expect(compile("const x = [...arr, 1]")).toBe("const x = [...arr, 1];");
    });

    it("should emit multiple spreads", () => {
      expect(compile("const x = [...a, ...b]")).toBe("const x = [...a, ...b];");
    });
  });

  describe("destructuring", () => {
    it("should emit array destructuring", () => {
      expect(compile("const [a, b] = arr")).toBe("const [a, b] = arr;");
    });

    it("should emit object destructuring", () => {
      expect(compile("const { name, age } = person")).toBe("const { name, age } = person;");
    });

    it("should emit let destructuring", () => {
      expect(compile("let [x, y] = coords")).toBe("let [x, y] = coords;");
    });
  });

  describe("array methods", () => {
    it("should emit map natively", () => {
      expect(compile("arr.map((x) => x * 2)")).toBe("arr.map((x) => x * 2);");
    });

    it("should emit filter natively", () => {
      expect(compile("arr.filter((x) => x > 0)")).toBe("arr.filter((x) => x > 0);");
    });

    it("should emit forEach natively", () => {
      expect(compile("arr.forEach((x) => log(x))")).toContain("arr.forEach((x) => log(x))");
    });

    it("should emit reduce natively", () => {
      expect(compile("arr.reduce((a, b) => a + b, 0)")).toContain("arr.reduce((a, b) => a + b, 0)");
    });

    it("should emit includes natively", () => {
      expect(compile("arr.includes(5)")).toBe("arr.includes(5);");
    });
  });

  // ── Batch 4 features ─────────────────────────────────────────────────

  describe("map literals", () => {
    it("should emit map as new Map()", () => {
      const out = compile('const m = Map { "a": 1, "b": 2 }');
      expect(out).toContain("new Map(");
      expect(out).toContain('"a"');
    });

    it("should emit empty map", () => {
      expect(compile("const m = Map {}")).toContain("new Map([])");
    });

    it("should emit map bracket access as .get()", () => {
      const out = compile('const m = Map { "x": 1 }\nm["x"]');
      expect(out).toContain('.get("x")');
    });
  });

  describe("closures", () => {
    it("should emit arrow functions as JS closures natively", () => {
      const out = compile("const f = (x) => (y) => x + y");
      expect(out).toContain("(x) => (y) => x + y");
    });
  });
});
