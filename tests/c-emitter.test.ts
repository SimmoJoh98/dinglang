import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Lexer } from "../src/lexer/index.js";
import { Parser } from "../src/parser/index.js";
import { CEmitter } from "../src/emitter/index.js";
import { extractDirectives } from "../src/directives/index.js";

/** Matches the CLI's compileC pipeline: extract file-level directives
 *  first, then lex/parse/emit using the stripped source. This keeps
 *  every test honest about what users actually see end-to-end. */
function compileC(source: string): string {
  const { directives, source: stripped } = extractDirectives(source);
  const tokens = new Lexer(stripped).tokenize();
  const ast = new Parser(tokens, stripped).parse();
  return new CEmitter({ arenaSize: directives.arenaSize }).emit(ast);
}

// ── Basic types ───────────────────────────────────────────────────────

// Top-level bindings are lifted to C globals (with `ding_g_` prefix) and
// initialized inside `ding_init_globals()`. These tests verify both the
// static declaration and the initializer form.

describe("C Emitter: basic types", () => {
  it("should emit integer declaration", () => {
    const result = compileC("const x = 42");
    expect(result).toContain("static ding_int ding_g_x;");
    expect(result).toContain("ding_g_x = 42;");
  });

  it("should emit float declaration", () => {
    const result = compileC("const f = 3.14");
    expect(result).toContain("static ding_float ding_g_f;");
    expect(result).toContain("ding_g_f = 3.14;");
  });

  it("should emit string declaration", () => {
    const result = compileC('const s = "hello"');
    expect(result).toContain("static ding_string ding_g_s;");
    expect(result).toContain('ding_g_s = "hello";');
  });

  it("should emit bool declaration", () => {
    const result = compileC("const b = true");
    expect(result).toContain("static ding_bool ding_g_b;");
    expect(result).toContain("ding_g_b = true;");
  });

  it("should emit false boolean", () => {
    const result = compileC("const b = false");
    expect(result).toContain("ding_g_b = false;");
  });

  it("should emit null as DING_VALUE_NULL", () => {
    const result = compileC("const x = null");
    expect(result).toContain("static DingValue ding_g_x;");
    expect(result).toContain("ding_g_x = DING_VALUE_NULL;");
  });

  it("should emit let same as const (C has no let)", () => {
    const result = compileC("let x = 5");
    expect(result).toContain("static ding_int ding_g_x;");
    expect(result).toContain("ding_g_x = 5;");
  });
});

// ── Functions ─────────────────────────────────────────────────────────

describe("C Emitter: functions", () => {
  it("should emit arrow function as C function with DingValue params", () => {
    const result = compileC("const add = (a, b) => a + b");
    expect(result).toContain("ding_fn_add(DingValue a, DingValue b)");
  });

  it("should emit typed arrow function with typed params", () => {
    const result = compileC("const add = (a: number, b: number) => a + b");
    expect(result).toContain("ding_fn_add(ding_int a, ding_int b)");
  });

  it("should emit block-body function", () => {
    const result = compileC(`const greet = (name: string) => {
  return name
}`);
    expect(result).toContain("ding_fn_greet(ding_string name)");
    // typed param in DingValue-return function gets wrapped
    expect(result).toContain("return (DingValue){.type=DING_STRING, .as_string=name};");
  });

  it("should prefix function names with ding_fn_", () => {
    const result = compileC("const myFunc = (x) => x");
    expect(result).toContain("ding_fn_myFunc");
  });

  it("should call functions with ding_fn_ prefix", () => {
    const result = compileC("const f = (x) => x\nconst y = f(42)");
    // literal arg gets wrapped as DingValue for untyped param
    expect(result).toContain("ding_fn_f((DingValue){.type=DING_INT, .as_int=42})");
  });
});

// ── Structs ───────────────────────────────────────────────────────────

describe("C Emitter: structs", () => {
  it("should emit struct typedef and definition", () => {
    const result = compileC(`struct Point {
  x: number
  y: number
}`);
    expect(result).toContain("typedef struct Point Point;");
    expect(result).toContain("struct Point {");
    expect(result).toContain("ding_int x;");
    expect(result).toContain("ding_int y;");
  });

  it("should emit struct instantiation with ding_alloc", () => {
    const result = compileC(`struct Point {
  x: number
  y: number
}
const p = Point { x: 1, y: 2 }`);
    expect(result).toContain("ding_alloc(sizeof(Point))");
    expect(result).toContain("p->x = 1;");
    expect(result).toContain("p->y = 2;");
  });

  it("should emit method call as StructName_method(ptr)", () => {
    const result = compileC(`struct Dog {
  name: string
  const bark = (self) => {
    return self.name
  }
}
const d = Dog { name: "Rex" }
d.bark()`);
    // `d` is now a top-level global → ding_g_d
    expect(result).toContain("Dog_bark(ding_g_d)");
  });

  it("should emit struct method with self as pointer", () => {
    const result = compileC(`struct Cat {
  name: string
  const meow = (self) => {
    return self.name
  }
}`);
    expect(result).toContain("Cat_meow(Cat* self)");
  });
});

// ── Arrays ────────────────────────────────────────────────────────────

describe("C Emitter: arrays", () => {
  it("should emit array literal as ding_array_new + push calls", () => {
    const result = compileC("const arr = [1, 2, 3]");
    expect(result).toContain("ding_array_new()");
    expect(result).toContain("ding_array_push(ding_g_arr,");
  });

  it("should emit array access as ding_array_get", () => {
    const result = compileC("const arr = [1, 2, 3]\nconst x = arr[0]");
    expect(result).toContain("ding_array_get(ding_g_arr, 0)");
  });

  it("should emit #arr as arr->length", () => {
    const result = compileC("const arr = [1, 2, 3]\nconst len = #arr");
    expect(result).toContain("ding_g_arr->length");
  });
});

// ── Loops ─────────────────────────────────────────────────────────────

describe("C Emitter: loops", () => {
  it("should emit for range as C for loop with ding_int", () => {
    const result = compileC("for i = 0..10 { i }");
    expect(result).toContain("for (ding_int i = 0; i < 10; i++)");
  });

  it("should emit for in as C for loop over array items", () => {
    const result = compileC("const arr = [1, 2, 3]\nfor item in arr { item }");
    expect(result).toContain("for (ding_int __i = 0; __i < ding_g_arr->length; __i++)");
    expect(result).toContain("DingValue item = ding_g_arr->items[__i];");
  });

  it("should emit while as C while", () => {
    const result = compileC("while (true) { break }");
    expect(result).toContain("while (true)");
    expect(result).toContain("break;");
  });

  it("should emit break and continue", () => {
    const result = compileC("for i = 0..5 { break }");
    expect(result).toContain("break;");

    const result2 = compileC("for i = 0..5 { continue }");
    expect(result2).toContain("continue;");
  });
});

// ── Template literals ─────────────────────────────────────────────────

describe("C Emitter: template literals", () => {
  it("should emit simple template as ding_string_concat", () => {
    const result = compileC('const msg = `hello ${name}`');
    expect(result).toContain("ding_string_concat");
  });

  it("should wrap numbers in to_string calls", () => {
    const result = compileC("const msg = `count: ${42}`");
    expect(result).toContain("ding_int_to_string");
  });
});

// ── Binary expressions ────────────────────────────────────────────────

describe("C Emitter: binary expressions", () => {
  it("should emit arithmetic operators as-is", () => {
    const result = compileC("const x = 1 + 2");
    expect(result).toContain("1 + 2");
  });

  it("should emit string concat with ding_string_concat", () => {
    const result = compileC('const x = "a" + "b"');
    expect(result).toContain('ding_string_concat("a", "b")');
  });

  it("should emit comparison operators", () => {
    const result = compileC("const x = 1 < 2");
    expect(result).toContain("1 < 2");
  });
});

// ── Error handling ────────────────────────────────────────────────────

describe("C Emitter: error handling", () => {
  it("should emit try/catch as setjmp/longjmp", () => {
    const result = compileC('try { x } catch (e) { e }');
    expect(result).toContain("setjmp(__ding_jmp)");
    expect(result).toContain("DingValue e = __ding_err;");
  });

  it("should emit throw as longjmp", () => {
    const result = compileC('throw "error"');
    expect(result).toContain("longjmp(__ding_jmp, 1)");
    expect(result).toContain("__ding_err =");
  });
});

// ── Null handling ─────────────────────────────────────────────────────

describe("C Emitter: null handling", () => {
  it("should emit nullish coalescing", () => {
    const result = compileC("const x = a ?? b");
    expect(result).toContain("DING_NULL");
  });
});

// ── Runtime structure ─────────────────────────────────────────────────

describe("C Emitter: runtime structure", () => {
  it("should start with #include <stdio.h>", () => {
    const result = compileC("const x = 1");
    expect(result).toMatch(/^#include <stdio\.h>/);
  });

  it("should contain ding_arena_init in main", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("ding_arena_init()");
  });

  it("should contain ding_arena_free in main", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("ding_arena_free()");
  });

  it("should contain int main()", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("int main()");
  });

  it("should contain return 0 at end of main", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("return 0;");
  });

  it("should include DingValue type definition", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("struct DingValue");
    expect(result).toContain("DingType type;");
  });

  it("should include arena allocator", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("DING_ARENA_SIZE");
    expect(result).toContain("void* ding_alloc(size_t size)");
  });
});

// ── Stdlib imports ────────────────────────────────────────────────────

describe("C Emitter: stdlib imports", () => {
  it("should inject ding:std when imported", () => {
    const result = compileC("import { log } from 'ding:std'\nlog(42)");
    expect(result).toContain("void ding_log(DingValue val)");
    expect(result).toContain("ding_log(");
  });

  it("should inject ding:math when imported", () => {
    const result = compileC("import { floor } from 'ding:math'\nconst x = floor(3.14)");
    expect(result).toContain("ding_float ding_math_floor");
    expect(result).toContain("ding_math_floor(");
  });

  it("should not inject ding:std when not imported", () => {
    const result = compileC("const x = 1");
    expect(result).not.toContain("void ding_log");
  });
});

// ── If/else ───────────────────────────────────────────────────────────

describe("C Emitter: if/else", () => {
  it("should emit basic if", () => {
    const result = compileC("if (x > 0) { return x }");
    // x is unknown (DingValue), gets unwrapped for comparison
    expect(result).toContain("if (x.as_int > 0)");
  });

  it("should emit if/else", () => {
    const result = compileC("if (x > 0) { return x } else { return null }");
    expect(result).toContain("} else {");
  });
});

// ── Assignment ────────────────────────────────────────────────────────

describe("C Emitter: assignment", () => {
  it("should emit variable reassignment", () => {
    const result = compileC("x = 5");
    expect(result).toContain("x = 5;");
  });

  it("should emit member assignment with arrow notation", () => {
    const result = compileC("obj.x = 5");
    expect(result).toContain("obj->x = 5;");
  });
});

// ── Sized primitive types ─────────────────────────────────────────────

describe("C Emitter: sized integer types", () => {
  it("should emit int8 annotation", () => {
    const result = compileC("const x: int8 = 42");
    expect(result).toContain("static ding_int8 ding_g_x;");
    expect(result).toMatch(/ding_g_x = \(ding_int8\)\(42\);/);
  });

  it("should emit int16 annotation", () => {
    const result = compileC("const x: int16 = 1000");
    expect(result).toContain("static ding_int16 ding_g_x;");
    expect(result).toMatch(/ding_g_x = \(ding_int16\)\(1000\);/);
  });

  it("should emit int32 annotation", () => {
    const result = compileC("const x: int32 = 100000");
    expect(result).toContain("static ding_int32 ding_g_x;");
    expect(result).toMatch(/ding_g_x = \(ding_int32\)\(100000\);/);
  });

  it("should emit int64 annotation", () => {
    const result = compileC("const x: int64 = 42");
    expect(result).toContain("static ding_int64 ding_g_x;");
    // int64 is equivalent to ding_int — no cast needed
    expect(result).toContain("ding_g_x = 42;");
  });

  it("should emit uint8 annotation", () => {
    const result = compileC("const x: uint8 = 255");
    expect(result).toContain("static ding_uint8 ding_g_x;");
    expect(result).toMatch(/ding_g_x = \(ding_uint8\)\(255\);/);
  });

  it("should emit uint16 annotation", () => {
    const result = compileC("const x: uint16 = 65535");
    expect(result).toContain("static ding_uint16 ding_g_x;");
    expect(result).toMatch(/ding_g_x = \(ding_uint16\)\(65535\);/);
  });

  it("should emit uint32 annotation", () => {
    const result = compileC("const x: uint32 = 42");
    expect(result).toContain("static ding_uint32 ding_g_x;");
  });

  it("should emit uint64 annotation", () => {
    const result = compileC("const x: uint64 = 42");
    expect(result).toContain("static ding_uint64 ding_g_x;");
  });

  it("should emit byte as uint8", () => {
    const result = compileC("const x: byte = 0");
    expect(result).toContain("static ding_byte ding_g_x;");
  });

  it("should emit int as alias for ding_int", () => {
    const result = compileC("const x: int = 42");
    expect(result).toContain("static ding_int ding_g_x;");
  });
});

describe("C Emitter: sized float types", () => {
  it("should emit float32 annotation", () => {
    const result = compileC("const x: float32 = 1.5");
    expect(result).toContain("static ding_float32 ding_g_x;");
    // float32 is narrower than ding_float (double), so a cast appears
    expect(result).toMatch(/ding_g_x = \(ding_float32\)\(1\.5\);/);
  });

  it("should emit float64 annotation", () => {
    const result = compileC("const x: float64 = 3.14");
    expect(result).toContain("static ding_float64 ding_g_x;");
    // float64 is equivalent to ding_float — no cast needed
    expect(result).toContain("ding_g_x = 3.14;");
  });

  it("should emit double as alias for float64", () => {
    const result = compileC("const x: double = 2.71");
    expect(result).toContain("static ding_float64 ding_g_x;");
  });
});

describe("C Emitter: cstring type", () => {
  it("should emit cstring annotation", () => {
    const result = compileC('const tag: cstring = "v1.0"');
    expect(result).toContain("static ding_cstring ding_g_tag;");
    expect(result).toContain('ding_g_tag = "v1.0";');
  });
});

describe("C Emitter: typed function params", () => {
  it("should emit sized int param in function", () => {
    const result = compileC("const f = (x: int32) => x");
    expect(result).toContain("ding_fn_f(ding_int32 x)");
  });

  it("should emit byte param in function", () => {
    const result = compileC("const f = (b: byte) => b");
    expect(result).toContain("ding_fn_f(ding_byte b)");
  });
});

describe("C Emitter: sized types in struct fields", () => {
  it("should emit struct with sized integer fields", () => {
    const result = compileC(`struct Pixel {
  r: uint8
  g: uint8
  b: uint8
  a: uint8
}`);
    expect(result).toContain("ding_uint8 r;");
    expect(result).toContain("ding_uint8 g;");
    expect(result).toContain("ding_uint8 b;");
    expect(result).toContain("ding_uint8 a;");
  });

  it("should emit struct with float32 field", () => {
    const result = compileC(`struct Vertex {
  x: float32
  y: float32
}`);
    expect(result).toContain("ding_float32 x;");
    expect(result).toContain("ding_float32 y;");
  });
});

describe("C Emitter: runtime includes sized typedefs", () => {
  it("should include sized integer typedefs in runtime", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("typedef int8_t   ding_int8;");
    expect(result).toContain("typedef uint8_t  ding_byte;");
    expect(result).toContain("typedef uint64_t ding_uint64;");
  });

  it("should include sized float typedefs in runtime", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("typedef float    ding_float32;");
    expect(result).toContain("typedef double   ding_float64;");
  });

  it("should include cstring typedef in runtime", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("typedef const char* ding_cstring;");
  });
});

// ── Top-level globals (lifted bindings) ──────────────────────────────

describe("C Emitter: top-level globals", () => {
  it("should lift a top-level const into a static global with ding_g_ prefix", () => {
    const result = compileC('const name = "Dallas"');
    expect(result).toContain("static ding_string ding_g_name;");
    expect(result).toContain('ding_g_name = "Dallas";');
    // Initialization happens inline in main(), not in a separate init function
    expect(result).not.toContain("ding_init_globals()");
  });

  it("should initialize globals in source order interleaved with top-level statements", () => {
    // If globals were batch-initialized before main body, `item` would be
    // computed before the push and the #arr would be 0. We assert the
    // relative ordering of the emitted assignments in main().
    const source = `import { log } from 'ding:std'
const arr = [1]
log(arr[0])
const n = #arr`;
    const result = compileC(source);
    const arrInit = result.indexOf("ding_g_arr = ding_array_new()");
    const logCall = result.indexOf("ding_log(ding_array_get(ding_g_arr");
    const nInit = result.indexOf("ding_g_n =");
    expect(arrInit).toBeGreaterThan(-1);
    expect(logCall).toBeGreaterThan(arrInit);
    expect(nInit).toBeGreaterThan(logCall);
  });

  it("should reference a global from inside a top-level function via ding_g_", () => {
    const source = `const name = "Dallas"
const greet = () => name`;
    const result = compileC(source);
    expect(result).toContain("static ding_string ding_g_name;");
    // Inside ding_fn_greet, the reference to `name` is mangled
    expect(result).toMatch(/ding_fn_greet\([^)]*\)\s*{[^}]*ding_g_name/);
  });

  it("should allow a global let to be mutated from inside a function", () => {
    const source = `let counter = 0
const bump = () => { counter = counter + 1 }`;
    const result = compileC(source);
    expect(result).toContain("static ding_int ding_g_counter;");
    // Both the target and the RHS reference should be mangled
    expect(result).toMatch(/ding_g_counter\s*=\s*ding_g_counter\s*\+\s*1/);
  });

  it("should not mangle a local variable that shadows a global of the same name", () => {
    const source = `const name = "global"
const fn = (name: string) => {
  return name
}`;
    const result = compileC(source);
    // Global declaration exists
    expect(result).toContain("static ding_string ding_g_name;");
    // Inside ding_fn_fn, the parameter reference is the raw `name`, not ding_g_name.
    // We check that the return expression wraps the plain `name` identifier.
    expect(result).toContain("ding_string name");
    expect(result).toMatch(/return \(DingValue\){\.type=DING_STRING, \.as_string=name}/);
  });

  it("should emit a struct-instantiation global via multi-line init", () => {
    const source = `struct Point { x: number; y: number }
const p = Point { x: 1, y: 2 }`;
    const result = compileC(source);
    expect(result).toContain("static Point* ding_g_p;");
    expect(result).toContain("ding_g_p = (Point*)ding_alloc(sizeof(Point));");
    expect(result).toContain("ding_g_p->x = 1;");
    expect(result).toContain("ding_g_p->y = 2;");
  });

  it("should emit an array-literal global via ding_array_new + pushes", () => {
    const source = "const arr = [10, 20, 30]";
    const result = compileC(source);
    expect(result).toContain("static DingArray* ding_g_arr;");
    expect(result).toContain("ding_g_arr = ding_array_new();");
    expect(result).toContain("ding_array_push(ding_g_arr,");
  });
});

// ── Arena size directive ─────────────────────────────────────────────

describe("C Emitter: arena size directive", () => {
  it("uses the 256MB default when no directive is present", () => {
    const result = compileC("const x = 1");
    expect(result).toContain(`#define DING_ARENA_SIZE (${256 * 1024 * 1024}ULL)`);
  });

  it("honours a 1GB directive at the top of the file", () => {
    const source = `#[arena(size = 1GB)]
const x = 1`;
    const result = compileC(source);
    expect(result).toContain(`#define DING_ARENA_SIZE (${1024 * 1024 * 1024}ULL)`);
    // The directive itself never leaks into the emitted C.
    expect(result).not.toContain("#[arena");
  });

  it("honours a 64KB directive", () => {
    const source = `#[arena(size = 64KB)]
const x = 1`;
    const result = compileC(source);
    expect(result).toContain(`#define DING_ARENA_SIZE (${64 * 1024}ULL)`);
  });

  it("allows blank lines and comments before the directive", () => {
    const source = `
// Bigger arena for graphics workloads
#[arena(size = 2GB)]
import { log } from 'ding:std'
log(42)`;
    const result = compileC(source);
    expect(result).toContain(`#define DING_ARENA_SIZE (${2 * 1024 * 1024 * 1024}ULL)`);
  });

  it("still compiles the rest of the program correctly when a directive is present", () => {
    const source = `#[arena(size = 128MB)]
const name = "Dallas"
const greet = () => name`;
    const result = compileC(source);
    expect(result).toContain(`#define DING_ARENA_SIZE (${128 * 1024 * 1024}ULL)`);
    // Globals still get lifted; function still references the lifted binding.
    expect(result).toContain("static ding_string ding_g_name;");
    expect(result).toMatch(/ding_fn_greet\([^)]*\)\s*{[^}]*ding_g_name/);
  });
});

// ── Integration: example files ────────────────────────────────────────

describe("C Emitter: integration", () => {
  it("should compile hello.dg to C without errors", () => {
    const source = readFileSync(resolve(__dirname, "../examples/hello.dg"), "utf-8");
    expect(() => compileC(source)).not.toThrow();
    const result = compileC(source);
    expect(result).toContain("#include <stdio.h>");
    expect(result).toContain("int main()");
    expect(result).toContain("ding_arena_init()");
    expect(result).toContain("ding_arena_free()");
  });

  it("should compile features.dg to C without errors", () => {
    const source = readFileSync(resolve(__dirname, "../examples/features.dg"), "utf-8");
    expect(() => compileC(source)).not.toThrow();
    const result = compileC(source);
    expect(result).toContain("int main()");
    expect(result).toContain("struct Player");
  });

  it("should compile benchmark.dg to C without errors", () => {
    const source = readFileSync(resolve(__dirname, "../examples/benchmark.dg"), "utf-8");
    expect(() => compileC(source)).not.toThrow();
    const result = compileC(source);
    expect(result).toContain("ding_fn_countTo");
    expect(result).toContain("int main()");
  });

  it("should compile structs.dg to C without errors", () => {
    const source = readFileSync(resolve(__dirname, "../examples/structs.dg"), "utf-8");
    expect(() => compileC(source)).not.toThrow();
    const result = compileC(source);
    expect(result).toContain("struct Vec2");
    expect(result).toContain("Vec2_length");
    expect(result).toContain("Vec2_add");
  });
});

// ── Batch 3 features ─────────────────────────────────────────────────

describe("C Emitter: power operator", () => {
  it("should emit pow() for **", () => {
    const result = compileC("const x = 2 ** 3");
    expect(result).toContain("pow(");
  });

  it("should emit right-associative power", () => {
    const result = compileC("const x = 2 ** 3 ** 2");
    expect(result).toContain("pow(");
  });
});

describe("C Emitter: string repeat", () => {
  it("should emit ding_string_repeat for string * n", () => {
    const result = compileC('const x = "ha" * 3');
    expect(result).toContain("ding_string_repeat(");
  });

  it("should include the ding_string_repeat function", () => {
    const result = compileC('const x = "ha" * 3');
    expect(result).toContain("ding_string ding_string_repeat(");
  });
});

describe("C Emitter: pipe operator", () => {
  it("should desugar pipe into function call", () => {
    const result = compileC(`
      const double = (x) => x * 2
      const r = 5 |> double
    `);
    expect(result).toContain("ding_fn_double(");
  });
});

describe("C Emitter: spread operator", () => {
  it("should emit loop-based spread in array declaration", () => {
    const result = compileC(`
      const a: number[] = [1, 2]
      const b = [...a, 3]
    `);
    expect(result).toContain("ding_array_new()");
    expect(result).toContain("__spread_");
    expect(result).toContain("->length");
    expect(result).toContain("->items[");
  });
});

describe("C Emitter: destructuring", () => {
  it("should emit array destructuring", () => {
    const result = compileC(`
      const arr: number[] = [1, 2, 3]
      const [a, b, c] = arr
    `);
    expect(result).toContain("ding_array_get(");
    expect(result).toContain("DingValue a =");
    expect(result).toContain("DingValue b =");
    expect(result).toContain("DingValue c =");
  });

  it("should emit struct destructuring", () => {
    const result = compileC(`
      struct Point {
        x: number
        y: number
      }
      const p = Point { x: 10, y: 20 }
      const { x, y } = p
    `);
    expect(result).toContain("ding_int x =");
    expect(result).toContain("ding_int y =");
    expect(result).toContain("->x");
    expect(result).toContain("->y");
  });
});

describe("C Emitter: array methods", () => {
  it("should inline map as a loop", () => {
    const result = compileC(`
      const arr: number[] = [1, 2, 3]
      const doubled = arr.map((x) => x * 2)
    `);
    expect(result).toContain("ding_array_new()");
    expect(result).toContain("ding_array_push(");
    expect(result).toContain("->length");
  });

  it("should inline filter as a conditional loop", () => {
    const result = compileC(`
      const arr: number[] = [1, 2, 3]
      const pos = arr.filter((x) => x > 0)
    `);
    expect(result).toContain("ding_array_new()");
    expect(result).toContain("if (");
  });

  it("should inline includes with ding_value_equals", () => {
    const result = compileC(`
      const arr: number[] = [1, 2, 3]
      const has = arr.includes(2)
    `);
    expect(result).toContain("ding_value_equals(");
  });

  it("should inline reduce with accumulator", () => {
    const result = compileC(`
      const arr: number[] = [1, 2, 3]
      const sum = arr.reduce((acc, x) => acc + x, 0)
    `);
    expect(result).toContain("__acc_");
  });

  it("should inline find with break", () => {
    const result = compileC(`
      const arr: number[] = [1, 2, 3]
      const found = arr.find((x) => x > 1)
    `);
    expect(result).toContain("break;");
    expect(result).toContain("DING_VALUE_NULL");
  });

  it("should include ding_value_equals function", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("ding_bool ding_value_equals(");
  });
});

// ── Batch 4 features ─────────────────────────────────────────────────

describe("C Emitter: maps", () => {
  it("should emit map declaration with ding_map_new", () => {
    const result = compileC('const m = Map { "a": 1 }');
    expect(result).toContain("ding_map_new()");
    expect(result).toContain("ding_map_set(");
  });

  it("should emit map bracket access as ding_map_get", () => {
    const result = compileC(`
      const m = Map { "x": 42 }
      const v = m["x"]
    `);
    expect(result).toContain("ding_map_get(");
  });

  it("should emit map has() method", () => {
    const result = compileC(`
      const m = Map { "x": 1 }
      const h = m.has("x")
    `);
    expect(result).toContain("ding_map_has(");
  });

  it("should emit map keys() method", () => {
    const result = compileC(`
      const m = Map { "x": 1 }
      const k = m.keys()
    `);
    expect(result).toContain("ding_map_keys(");
  });

  it("should include DingMap runtime", () => {
    const result = compileC("const x = 1");
    expect(result).toContain("DingMap* ding_map_new()");
  });
});

describe("C Emitter: closures", () => {
  it("should emit closure env struct and function", () => {
    const result = compileC(`
      const makeAdder = (n) => {
        return (x) => x + n
      }
    `);
    expect(result).toContain("__closure_env_");
    expect(result).toContain("__closure_fn_");
    expect(result).toContain("DingClosure");
  });

  it("should emit closure call via ding_closure_call", () => {
    const result = compileC(`
      const makeAdder = (n) => {
        return (x) => x + n
      }
      const add5 = makeAdder(5)
      const r = add5(10)
    `);
    expect(result).toContain("ding_closure_call(");
  });

  it("should handle zero-capture closures", () => {
    const result = compileC(`
      const f = (x) => {
        const g = (y) => y * 2
        return g
      }
    `);
    expect(result).toContain("DingClosure");
    expect(result).toContain("__closure_fn_");
  });
});

describe("C Emitter: ding:io", () => {
  it("should emit IO stdlib when imported", () => {
    const result = compileC(`import { readFile } from 'ding:io'`);
    expect(result).toContain("ding_io_readFile");
    expect(result).toContain("int main(int argc, char** argv)");
  });

  it("should not emit IO stdlib when not imported", () => {
    const result = compileC("const x = 1");
    expect(result).not.toContain("ding_io_readFile");
    expect(result).toContain("int main()");
  });
});

describe("C Emitter: ding:json", () => {
  it("should emit JSON stdlib when imported", () => {
    const result = compileC(`import { parse, stringify } from 'ding:json'`);
    expect(result).toContain("ding_json_parse");
    expect(result).toContain("ding_json_stringify");
    expect(result).toContain("__json_parse_value");
  });

  it("should not emit JSON stdlib when not imported", () => {
    const result = compileC("const x = 1");
    expect(result).not.toContain("ding_json_parse");
  });
});
