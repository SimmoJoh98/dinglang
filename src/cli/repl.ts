import * as readline from "node:readline";
import * as vm from "node:vm";
import { Lexer } from "../lexer/index.js";
import { Parser } from "../parser/index.js";
import { Emitter } from "../emitter/index.js";
import { DingError, formatError } from "../errors/index.js";
import { getModule } from "../std/index.js";

const VERSION = "0.5.0";

export function startRepl(): void {
  console.log(`Ding REPL v${VERSION} — type expressions to evaluate, Ctrl+D to exit`);

  // Create a persistent VM context with stdlib pre-loaded
  const context = vm.createContext({ console, process, Buffer });

  // Pre-seed ding:std and ding:math polyfills
  for (const modName of ["ding:std", "ding:math"]) {
    try {
      const mod = getModule(modName);
      for (const [, entry] of mod) {
        vm.runInContext(entry.implementation, context);
      }
    } catch { /* ignore */ }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "ding> ",
  });

  let buffer = "";
  let depth = 0;

  rl.prompt();

  rl.on("line", (line: string) => {
    buffer += (buffer ? "\n" : "") + line;

    // Track brace depth for multi-line input
    for (const ch of line) {
      if (ch === "{" || ch === "[" || ch === "(") depth++;
      if (ch === "}" || ch === "]" || ch === ")") depth--;
    }

    if (depth > 0) {
      process.stdout.write("  ... ");
      return;
    }

    depth = 0;
    const input = buffer.trim();
    buffer = "";

    if (!input) {
      rl.prompt();
      return;
    }

    try {
      const tokens = new Lexer(input).tokenize();
      const ast = new Parser(tokens, input).parse();
      const js = new Emitter(ast).emit();

      const result = vm.runInContext(js, context, { filename: "repl" });
      if (result !== undefined) {
        console.log(result);
      }
    } catch (err) {
      if (err instanceof DingError) {
        process.stderr.write(formatError(err) + "\n");
      } else if (err instanceof Error) {
        console.error(err.message);
      }
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nBye!");
    process.exit(0);
  });
}
