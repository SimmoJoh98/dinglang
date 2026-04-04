# Ding Language Specification

> Version 0.3.0 — Draft

## Overview

Ding is a modern, compiled programming language that prioritizes clarity, developer ergonomics, and zero-surprise semantics. It compiles to both JavaScript and native binaries via C.

## File Extension

`.dg`

## Variables

Variables are declared with `const` (immutable) or `let` (mutable).

```
const name = "Ding"
let count = 0
```

Variables declared with `let` can be reassigned:

```
let x = 1
x = 2
```

## Type System

Types are **inferred by default**. Optional type annotations use `:` syntax.

```
const name = "Ding"           // inferred as string
const age: number = 1         // explicit annotation
let items: string[] = []      // annotated array
```

### Primitive Types

Ding provides two levels of type precision: a **lazy path** using simple names that cover the common case, and a **precise path** with explicit widths and signedness for when you need full control.

#### Integers

| Ding type | C type | Size | Notes |
|---|---|---|---|
| `number` | `int64_t` | 64-bit signed | Default for all integers |
| `int` | `int64_t` | 64-bit signed | Alias for `number` |
| `int8` | `int8_t` | 8-bit signed | -128 to 127 |
| `int16` | `int16_t` | 16-bit signed | -32,768 to 32,767 |
| `int32` | `int32_t` | 32-bit signed | -2B to 2B |
| `int64` | `int64_t` | 64-bit signed | Explicit 64-bit |
| `byte` | `uint8_t` | 8-bit unsigned | 0 to 255 |
| `uint8` | `uint8_t` | 8-bit unsigned | Alias for `byte` |
| `uint16` | `uint16_t` | 16-bit unsigned | 0 to 65,535 |
| `uint32` | `uint32_t` | 32-bit unsigned | 0 to 4B |
| `uint64` | `uint64_t` | 64-bit unsigned | 0 to 18 quintillion |

```
const score: number = 42       // lazy — 64-bit signed, just works
const r: uint8 = 255           // precise — exactly one byte
const pixel: int32 = -1        // precise — 32-bit signed
```

#### Floats

| Ding type | C type | Size | Notes |
|---|---|---|---|
| `float` | `double` | 64-bit | Default for all floats |
| `double` | `double` | 64-bit | Alias for `float` |
| `float32` | `float` | 32-bit | Single precision |
| `float64` | `double` | 64-bit | Explicit double precision |

```
const pi: float = 3.14159      // lazy — 64-bit double
const y: float32 = 1.0         // precies — 32-bit single precision
```

#### Strings

| Ding type | C type | Notes |
|---|---|---|
| `string` | `char*` | Default. Arena-allocated, mutable. |
| `cstring` | `const char*` | Zero-copy. For literals and C interop. |

```
const name: string = "Dallas"  // lazy — arena-allocated
const tag: cstring = "v1.0"    // precise — zero-copy const pointer
```

#### Other

| Ding type | C type | Notes |
|---|---|---|
| `bool` | `bool` | `true` / `false` |
| `void` | `void` | No return value |

When no annotation is provided, types are inferred: integer literals infer as `number` (int64), float literals as `float` (double), string literals as `string`. The JS target ignores all annotations — they only affect the C backend.

## Functions

Functions use arrow syntax `=>`.

```
const add = (a: number, b: number) => {
  return a + b
}

// Single-expression shorthand
const double = (x: number) => x * 2
```

## Strings and Template Literals

Strings use double quotes. Template literals use backticks with `${}` interpolation.

```
const greeting = "hello"
const message = `${greeting}, world`
```

## Modules

Ding supports ES-style imports in four forms:

### Named imports

```
import { readFile, writeFile } from 'fs'
```

### Default import

```
import log from 'ding:std'
```

### Namespace import

```
import * as std from 'ding:std'
```

### Mixed (default + named)

```
import fs, { readFile, writeFile } from 'fs'
```

## Equality and Comparison

- `==` — equality (compiles to `===`)
- `!=` — inequality (compiles to `!==`)
- `<`, `>`, `<=`, `>=` — comparison

## Null

The absence of a value is represented by `null` (**not** `nil`).

```
let result: string | null = null
```

## Block Syntax

Blocks are delimited by **curly braces** `{}`. Indentation is not significant.

```
if (x > 0) {
  console.log("positive")
} else {
  console.log("non-positive")
}
```

## Semicolons

Semicolons are **optional**. The parser handles automatic semicolon insertion.

```
const a = 1
const b = 2;   // also valid
```

## Indexing

**0-based indexing**. Arrays start at index 0.

```
const items = [10, 20, 30]
const first = items[0]    // 10
```

## Arrays

Arrays use square bracket syntax.

```
const nums = [1, 2, 3]
const empty = []
const first = nums[0]      // 1
nums[0] = 10               // index assignment
```

### Length Operator

The `#` prefix operator returns the length of an array.

```
const len = #nums           // 3
```

Alternatively, `.length` works via member access:

```
const len = nums.length     // 3
```

## Loops

### For Range

Iterate over a numeric range (exclusive end):

```
for i = 0..5 {
  log(i)    // 0, 1, 2, 3, 4
}
```

### For In

Iterate over elements of an array:

```
for item in items {
  log(item)
}
```

### While

```
while (x > 0) {
  x = x - 1
}
```

### Break and Continue

`break` exits the innermost loop. `continue` skips to the next iteration.

```
for i = 0..10 {
  if (i == 5) { break }
  if (i == 3) { continue }
  log(i)
}
```

## Structs

Structs define data types with fields and methods. They compile to JavaScript classes.

### Declaration

```
struct Player {
  name: string
  health: number
  inventory: string[]

  const greet = (self) => {
    log(`I am ${self.name}`)
  }

  const heal = (self, amount: number) => {
    self.health = self.health + amount
  }
}
```

- Fields are listed with `name: type` syntax.
- Methods use `const name = (params) => body` syntax.
- The `self` parameter in methods maps to `this` in the compiled JavaScript.

### Instantiation

Struct names must start with an uppercase letter. Instantiation uses `Name { field: value }` syntax:

```
const player = Player {
  name: "Dallas",
  health: 100,
  inventory: []
}
```

### Member Access

```
const name = player.name
player.greet()
```

## Member Access and Optional Chaining

Access properties with `.`:

```
const x = obj.name
```

Use `?.` for optional chaining (safe access on potentially null values):

```
const x = obj?.name       // undefined if obj is null/undefined
const y = a?.b?.c         // chained optional access
```

## Null Handling

### Nullish Coalescing

The `??` operator returns the right-hand side if the left is `null` or `undefined`:

```
const name = user?.name ?? "Anonymous"
```

### Null Assertion

The `!` postfix operator asserts a value is not null, throwing at runtime if it is:

```
const name = user.name!   // throws if null
```

## Error Handling

### Try / Catch / Finally

```
try {
  const data = riskyOperation()
} catch (e) {
  log(e)
} finally {
  cleanup()
}
```

### Throw

```
throw "something went wrong"
```

### Error Propagation

The `?` postfix operator wraps an expression in a try/catch and re-throws:

```
const result = riskyCall()?
```

## Assignment

Reassignment works with `=` on `let` variables, member access, and array indices:

```
let x = 1
x = 2

obj.field = "new value"
arr[0] = 42
```

## Compilation Targets

Ding supports multiple compilation targets:

| Command                       | Description                        |
|-------------------------------|------------------------------------|
| `ding run <file>`             | Compile to C and execute (default) |
| `ding run <file> --target js` | Compile to JS and execute          |
| `ding build <file>`           | Compile to native binary via gcc   |
| `ding build <file> --target js` | Compile to JS file               |
| `ding build <file> --target c`  | Compile to C source file         |

The default target is C (native binary). The C target requires `gcc` to be installed.

## Memory Model

The C target uses an arena allocator by default. All allocations come from a single contiguous block of memory that is freed when the program exits.

| Strategy | Description | Status |
|---|---|---|
| Arena (default) | 256MB arena, fast allocation, no individual frees | Implemented |
| `@memory: gc` | Boehm GC | Future |
| `@memory: arc` | Automatic reference counting | Future |
| `@memory: manual` | Raw malloc/free | Future |

The arena strategy is ideal for short-lived programs, benchmarks, and batch processing. It provides near-zero allocation overhead at the cost of not reclaiming memory until program exit.

## C Interop (Future)

Planned support for calling C functions directly:

```
extern fn malloc(size: number): any
@c_header("mylib.h")
```

## Comments

```
// single-line comment

/*
  multi-line comment
*/
```

## Reserved Keywords

```
const let import from export as
if else return null
true false
for while in break continue
struct self
try catch throw finally
```

## Standard Library

Ding provides built-in modules accessed via the `ding:` import prefix. Imports from `ding:` modules are resolved at compile time — the emitter strips the import statement and injects inline polyfill implementations for each imported name.

### `ding:std`

Core utilities for I/O, type conversion, and assertions.

```
import { log, assert, typeOf } from 'ding:std'
```

| Function | Signature | Description |
|---|---|---|
| `log` | `(...args) => void` | Print to stdout (`console.log`) |
| `warn` | `(...args) => void` | Print warning (`console.warn`) |
| `error` | `(...args) => void` | Print error (`console.error`) |
| `assert` | `(cond, msg) => void` | Throw `Error(msg)` if `cond` is falsy |
| `typeOf` | `(val) => string` | Return `typeof val` |
| `toString` | `(val) => string` | Convert to string via `String(val)` |
| `toNumber` | `(val) => number` | Convert to number via `Number(val)` |
| `toBool` | `(val) => boolean` | Convert to boolean via `Boolean(val)` |

### `ding:math`

Mathematical utilities wrapping `Math` built-ins.

```
import { floor, max, sqrt } from 'ding:math'
```

| Function | Signature | Description |
|---|---|---|
| `floor` | `(n) => number` | Round down |
| `ceil` | `(n) => number` | Round up |
| `round` | `(n) => number` | Round to nearest integer |
| `abs` | `(n) => number` | Absolute value |
| `min` | `(a, b) => number` | Smaller of two values |
| `max` | `(a, b) => number` | Larger of two values |
| `random` | `() => number` | Random float in [0, 1) |
| `pow` | `(a, b) => number` | `a` raised to power `b` |
| `sqrt` | `(n) => number` | Square root |

### Unknown modules

Importing from an unrecognized `ding:` module (e.g., `ding:foo`) produces a compile-time error listing the available modules.

## Operator Precedence

From lowest to highest:

| Precedence | Operators | Description |
|---|---|---|
| 1 | `=` | Assignment |
| 2 | `??` | Nullish coalescing |
| 3 | `==` `!=` | Equality |
| 4 | `<` `>` `<=` `>=` | Comparison |
| 5 | `+` `-` | Additive |
| 6 | `*` `/` | Multiplicative |
| 7 | `!` `-` `#` | Unary (prefix) |
| 8 | `?` `!` | Postfix |
| 9 | `()` `.` `?.` `[]` | Call / member access |
| 10 | | Primary (literals, identifiers, parens) |

## Error Messages

Ding errors are human first. Always show context, always suggest a fix, never expose internals.

### Philosophy

- **Always show the source line** — the user should see exactly what the compiler is looking at
- **Always point at the problem** — a `^^^` caret marks the error column
- **Always suggest a fix** — a `Hint:` line offers actionable guidance when possible
- **Never expose internals** — no stack traces, no parser state, no raw AST dumps
- **Phase label at the top** — errors clearly indicate whether they come from the Lexer, Parser, or Emitter

### Error format

```
── Ding Parser Error ──────────────────

Import error at line 1, col 8

1 | import log from 'ding:std'
           ^^^
Hint: Use named imports: import { log } from 'ding:std'

───────────────────────────────────────
```

### Internal errors

Unknown AST node types or other unexpected conditions are treated as compiler bugs:

```
Internal compiler error — unknown node 'FooStatement'
Please report this at github.com/user/dinglang
```

## Design Principles

1. **Explicit over implicit** — no magic behavior
2. **Familiar syntax** — C-family heritage, curly braces, zero-indexed
3. **Minimal ceremony** — type inference, optional semicolons, concise arrow functions
4. **Predictable** — no significant whitespace, no surprising coercions
