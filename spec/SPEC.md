# Ding Language Specification

> Version 0.1.0 — Draft

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

ES module syntax with named imports/exports.

```
import { readFile } from 'fs'
import { parse, compile } from './compiler'
```

## Equality and Comparison

- `==` — equality
- `!=` — inequality (**not** `~=`)
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
const let import from export
if else return null
true false
```

## Design Principles

1. **Explicit over implicit** — no magic behavior
2. **Familiar syntax** — C-family heritage, curly braces, zero-indexed
3. **Minimal ceremony** — type inference, optional semicolons, concise arrow functions
4. **Predictable** — no significant whitespace, no surprising coercions
