# Ding

A modern programming language that compiles to native binaries (via C) and JavaScript. Dreamt, spec'd and reviewed by me, written... not by hand.

```
import { log } from 'ding:std'

struct Player {
  name: string
  health: number

  const greet = (self) => {
    log(`I am ${self.name}, health: ${self.health}`)
  }
}

const player = Player { name: "Dallas", health: 100 }
player.greet()
```

## Performance

Ding compiles to C and produces native binaries via `gcc -O2`. On identical workloads it matches handwritten C and dramatically outperforms interpreted languages.

**Benchmark: 1B sum + 500^3 nested loops + fib(80)**

| Runtime | Time | vs Ding |
|---|---|---|
| **Ding** (native binary) | **0.001s** | -- |
| C (handwritten, gcc -O2) | 0.001s | 1x |
| Node.js v22 | 0.636s | ~636x slower |
| Python 3.12 | 49.3s | ~49,300x slower |

Ding also produces **correct 64-bit integer results** where JavaScript loses precision:

| | Sum to 1B | Fib(80) |
|---|---|---|
| Ding / C | 499999999500000000 | 23416728348467685 |
| Node.js | 499999999067109000 | 23416728348467684 |

> Reproduce: `ding build examples/benchmark.dg && time ./examples/benchmark`

## Getting Started

```sh
npm install
npm run build
npm link
```

Requires `gcc` for the C target:
```sh
# Ubuntu/Debian
sudo apt install gcc

# Mac
xcode-select --install
```

## Usage

```sh
# Compile and run (default: native binary via C)
ding run hello.dg

# Compile and run as JavaScript
ding run hello.dg --target js

# Build a native binary
ding build hello.dg

# Build to JS file
ding build hello.dg --target js

# Emit C source only
ding build hello.dg --target c
```

## Type System

Types are inferred by default. Add annotations when you want precision.

**Lazy path** — just works:
```
const x = 42              // int64
const pi = 3.14           // double
const name = "Dallas"     // string
```

**Precise path** — full control:
```
const r: uint8 = 255      // exactly 1 byte
const id: int32 = -1      // 32-bit signed
const big: uint64 = 0     // 64-bit unsigned
const y: float32 = 1.0    // single precision
const tag: cstring = "v1" // const char*, zero-copy
```

Full primitive type table:

| Integers | Floats | Strings | Other |
|---|---|---|---|
| `number` / `int` (int64) | `float` / `double` (f64) | `string` (arena) | `bool` |
| `int8` `int16` `int32` `int64` | `float32` (f32) | `cstring` (const) | `void` |
| `byte` / `uint8` `uint16` `uint32` `uint64` | `float64` (f64) | | |

## Language Features

- Arrow functions with optional type annotations
- Structs with fields and methods (`self`)
- For-range (`for i = 0..n`), for-in, while loops
- Arrays with `#length` operator
- Template literals with `${}` interpolation
- Try/catch, throw, error propagation (`?`)
- Null handling: `??`, `?.`, `!`
- Import system: `ding:std`, `ding:math`, external modules
- Arena memory model (256MB, fast, no GC)

## Development

```sh
npm test             # watch mode
npm run test:run     # run once (298 tests)
npm run build        # compile TypeScript
```

## Project Structure

```
src/
  lexer/         Tokenizer
  parser/        Recursive descent parser
  ast/           AST node types
  emitter/
    js/          JavaScript emitter
    c/           C emitter (runtime, arena, stdlib, types)
  std/           Standard library (ding:std, ding:math)
  errors/        DingError formatting
  cli/           CLI entry point
spec/            Language specification
examples/        Example .dg programs + benchmarks
tests/           Vitest test suite
```

## Language Spec

See [spec/SPEC.md](spec/SPEC.md) for the full language specification.

## License

MIT
