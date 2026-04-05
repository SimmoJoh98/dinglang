// ── File-level directives ───────────────────────────────────────────
//
// Directives let a Ding file opt into compile-time configuration of the
// runtime without polluting the expression syntax. They live at the top
// of the file, before any real code, and are extracted by a pre-lex pass
// so the lexer and parser never see them. This sidesteps the ambiguity
// with `#expr` (length-of) and keeps the language grammar clean.
//
// Supported today:
//
//   #[arena(size = 1GB)]          // arena size; units B|KB|MB|GB
//   #[arena(size = 128MB)]
//   #[arena(size = 1048576)]      // bare number = bytes
//
// A directive is recognized only if every preceding line is blank,
// another directive, or a // line comment. The first real token ends
// the directive scan, which means you can't sneak a directive in after
// an import.

import { DingError } from "../errors/index.js";

export interface Directives {
  /** Arena size in bytes. Undefined means "use the emitter default". */
  arenaSize?: number;
}

export interface DirectivesResult {
  directives: Directives;
  /** Source with directive lines replaced by blank lines so downstream
   *  line/column numbers in parser/emitter errors remain accurate. */
  source: string;
}

// One directive occupies exactly one line. Leading whitespace allowed.
// Trailing whitespace and trailing `//` comments are also allowed.
const DIRECTIVE_LINE =
  /^\s*#\[\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*)\)\s*\]\s*(?:\/\/.*)?$/;

// `size = <number>[unit]` — unit is optional (bytes when omitted).
const ARENA_SIZE_ARG =
  /^\s*size\s*=\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s*$/;

/** Multipliers for size units. Binary (1024-based) because that's how
 *  allocators and OS memory actually behave at this layer. */
const UNIT_MULTIPLIERS: Record<string, number> = {
  B:  1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

export function extractDirectives(source: string): DirectivesResult {
  const lines = source.split(/\r?\n/);
  const directives: Directives = {};
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank lines and line comments before any real code are tolerated.
    if (trimmed === "" || trimmed.startsWith("//")) continue;

    const match = line.match(DIRECTIVE_LINE);
    if (!match) break; // first real statement ends the directive region

    const [, name, argText] = match;

    if (seen.has(name)) {
      throw new DingError(
        "parser",
        `Duplicate directive #[${name}(...)] on line ${i + 1}`,
        { hint: "Each directive may appear at most once per file" },
      );
    }
    seen.add(name);

    applyDirective(name, argText, directives, i + 1);

    // Replace directive line with an empty line so later error messages
    // still point at the correct physical line in the original source.
    lines[i] = "";
  }

  return { directives, source: lines.join("\n") };
}

function applyDirective(
  name: string,
  argText: string,
  dst: Directives,
  lineNum: number,
): void {
  if (name === "arena") {
    const m = argText.match(ARENA_SIZE_ARG);
    if (!m) {
      throw new DingError(
        "parser",
        `Invalid #[arena(...)] directive on line ${lineNum}`,
        { hint: "Expected: #[arena(size = <number>[KB|MB|GB])]" },
      );
    }
    const [, num, unit] = m;
    dst.arenaSize = parseSize(num, unit, lineNum);
    return;
  }

  throw new DingError(
    "parser",
    `Unknown directive #[${name}(...)] on line ${lineNum}`,
    { hint: "Supported directives: #[arena(size = ...)]" },
  );
}

function parseSize(num: string, unit: string | undefined, lineNum: number): number {
  const value = parseFloat(num);
  if (!Number.isFinite(value) || value <= 0) {
    throw new DingError(
      "parser",
      `Arena size must be a positive number (line ${lineNum})`,
    );
  }
  const u = (unit ?? "B").toUpperCase();
  const factor = UNIT_MULTIPLIERS[u];
  if (factor === undefined) {
    throw new DingError(
      "parser",
      `Unknown arena size unit '${unit}' (line ${lineNum})`,
      { hint: "Use B, KB, MB, or GB" },
    );
  }
  // Arena size is a byte count — round to an integer and require at
  // least one byte so downstream C sees a sensible constant.
  const bytes = Math.floor(value * factor);
  if (bytes < 1) {
    throw new DingError(
      "parser",
      `Arena size rounds to zero bytes (line ${lineNum})`,
    );
  }
  return bytes;
}
