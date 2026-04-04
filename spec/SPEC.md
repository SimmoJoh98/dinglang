# Ding Language Specification

> Version 0.2.1 — Draft

## Overview

Ding is a modern, compiled programming language that prioritizes clarity, developer ergonomics, and zero-surprise semantics. It compiles to JavaScript.

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

## Memory Management

Ding supports multiple memory management strategies via the `@memory` build flag:

| Flag              | Strategy                    |
|-------------------|-----------------------------|
| `@memory: gc`     | Garbage collection (default)|
| `@memory: arc`    | Automatic reference counting|
| `@memory: manual` | Manual memory management    |

The memory strategy is set at build time:

```
ding build --memory arc main.dg
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
