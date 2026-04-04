import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Lexer } from "../src/lexer/index.js";
import { Parser } from "../src/parser/index.js";
import { CEmitter } from "../src/emitter/index.js";

function compileC(source: string): string {
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens, source).parse();
  return new CEmitter().emit(ast);
}

// ── Basic types ───────────────────────────────────────────────────────

describe("C Emitter: basic types", () => {
  it("should emit integer declaration", () => {
    const result = compileC("const x = 42");
    expect(result).toContain("ding_int x = 42;");
  });

  it("should emit float declaration", () => {
    const result = compileC("const f = 3.14");
    expect(result).toContain("ding_float f = 3.14;");
  });

  it("should emit string declaration", () => {
    const result = compileC('const s = "hello"');
    expect(result).toContain('ding_string s = "hello";');
  });

  it("should emit bool declaration", () => {
    const result = compileC("const b = true");
    expect(result).toContain("ding_bool b = true;");
  });

  it("should emit false boolean", () => {
    const result = compileC("const b = false");
    expect(result).toContain("ding_bool b = false;");
  });

  it("should emit null as DING_VALUE_NULL", () => {
    const result = compileC("const x = null");
    expect(result).toContain("DingValue x = DING_VALUE_NULL;");
  });

  it("should emit let same as const (C has no let)", () => {
    const result = compileC("let x = 5");
    expect(result).toContain("ding_int x = 5;");
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
    expect(result).toContain("Dog_bark(d)");
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
    expect(result).toContain("ding_array_push(arr,");
  });

  it("should emit array access as ding_array_get", () => {
    const result = compileC("const arr = [1, 2, 3]\nconst x = arr[0]");
    expect(result).toContain("ding_array_get(arr, 0)");
  });

  it("should emit #arr as arr->length", () => {
    const result = compileC("const arr = [1, 2, 3]\nconst len = #arr");
    expect(result).toContain("arr->length");
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
    expect(result).toContain("for (ding_int __i = 0; __i < arr->length; __i++)");
    expect(result).toContain("DingValue item = arr->items[__i];");
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
    expect(result).toContain("ding_int8 x = 42;");
  });

  it("should emit int16 annotation", () => {
    const result = compileC("const x: int16 = 1000");
    expect(result).toContain("ding_int16 x = 1000;");
  });

  it("should emit int32 annotation", () => {
    const result = compileC("const x: int32 = 100000");
    expect(result).toContain("ding_int32 x = 100000;");
  });

  it("should emit int64 annotation", () => {
    const result = compileC("const x: int64 = 42");
    expect(result).toContain("ding_int64 x = 42;");
  });

  it("should emit uint8 annotation", () => {
    const result = compileC("const x: uint8 = 255");
    expect(result).toContain("ding_uint8 x = 255;");
  });

  it("should emit uint16 annotation", () => {
    const result = compileC("const x: uint16 = 65535");
    expect(result).toContain("ding_uint16 x = 65535;");
  });

  it("should emit uint32 annotation", () => {
    const result = compileC("const x: uint32 = 42");
    expect(result).toContain("ding_uint32 x = 42;");
  });

  it("should emit uint64 annotation", () => {
    const result = compileC("const x: uint64 = 42");
    expect(result).toContain("ding_uint64 x = 42;");
  });

  it("should emit byte as uint8", () => {
    const result = compileC("const x: byte = 0");
    expect(result).toContain("ding_byte x = 0;");
  });

  it("should emit int as alias for ding_int", () => {
    const result = compileC("const x: int = 42");
    expect(result).toContain("ding_int x = 42;");
  });
});

describe("C Emitter: sized float types", () => {
  it("should emit float32 annotation", () => {
    const result = compileC("const x: float32 = 1.5");
    expect(result).toContain("ding_float32 x = 1.5;");
  });

  it("should emit float64 annotation", () => {
    const result = compileC("const x: float64 = 3.14");
    expect(result).toContain("ding_float64 x = 3.14;");
  });

  it("should emit double as alias for float64", () => {
    const result = compileC("const x: double = 2.71");
    expect(result).toContain("ding_float64 x = 2.71;");
  });
});

describe("C Emitter: cstring type", () => {
  it("should emit cstring annotation", () => {
    const result = compileC('const tag: cstring = "v1.0"');
    expect(result).toContain('ding_cstring tag = "v1.0";');
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
