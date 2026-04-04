# Ding

A modern programming language that compiles to JavaScript.

```
const greet = (name: string) => {
  console.log(`hello, ${name}`)
}

greet("world")
```

## Getting Started

```sh
pnpm install
pnpm build
```

## Usage

```sh
ding run hello.dg
```

## Development

```sh
pnpm dev          # watch mode
pnpm test         # run tests
pnpm test:run     # run tests once
```

## Language Spec

See [spec/SPEC.md](spec/SPEC.md) for the full language specification.

## License

MIT
