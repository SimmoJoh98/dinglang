import { describe, it, expect } from "vitest";
import { DingError, formatError } from "../src/errors/index.js";
import { Lexer } from "../src/lexer/index.js";
import { Parser } from "../src/parser/index.js";
import { Emitter } from "../src/emitter/index.js";

// ── DingError construction ──────────────────────────────────────────

describe("DingError", () => {
  it("should store phase, line, col, source, and hint", () => {
    const err = new DingError("parser", "test message", {
      line: 5,
      col: 10,
      source: 'import log from "mod"',
      hint: "Try this instead",
    });
    expect(err.phase).toBe("parser");
    expect(err.message).toBe("test message");
    expect(err.line).toBe(5);
    expect(err.col).toBe(10);
    expect(err.source).toBe('import log from "mod"');
    expect(err.hint).toBe("Try this instead");
    expect(err.name).toBe("DingError");
  });

  it("should be instanceof Error", () => {
    const err = new DingError("lexer", "bad");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DingError);
  });
});

// ── formatError ─────────────────────────────────────────────────────

describe("formatError", () => {
  it("should include the phase label in the header", () => {
    const err = new DingError("parser", "test", { line: 1, col: 1 });
    const output = formatError(err);
    expect(output).toContain("Ding Parser Error");
  });

  it("should include the lexer phase label", () => {
    const err = new DingError("lexer", "bad char", { line: 1, col: 1 });
    expect(formatError(err)).toContain("Ding Lexer Error");
  });

  it("should include line and col in the output", () => {
    const err = new DingError("parser", "Unexpected token", {
      line: 3,
      col: 7,
    });
    const output = formatError(err);
    expect(output).toContain("line 3, col 7");
  });

  it("should show source line with line number prefix", () => {
    const err = new DingError("parser", "bad", {
      line: 1,
      col: 8,
      source: "import log from 'ding:std'",
    });
    const output = formatError(err);
    expect(output).toContain("1 | import log from 'ding:std'");
  });

  it("should show caret pointing at the correct column", () => {
    const err = new DingError("parser", "bad", {
      line: 1,
      col: 3,
      source: "ab@cd",
    });
    const output = formatError(err);
    const lines = output.split("\n");
    const caretLine = lines.find((l) => l.includes("^^^"));
    expect(caretLine).toBeDefined();
    // "1 | " is 4 chars prefix, col 3 means 2 spaces before caret
    const prefixLen = "1 | ".length;
    const idx = caretLine!.indexOf("^^^");
    expect(idx).toBe(prefixLen + 2);
  });

  it("should show hint when present", () => {
    const err = new DingError("lexer", "problem", {
      line: 1,
      col: 1,
      hint: "Close the string",
    });
    const output = formatError(err);
    expect(output).toContain("Hint: Close the string");
  });

  it("should not show hint when absent", () => {
    const err = new DingError("lexer", "problem", { line: 1, col: 1 });
    const output = formatError(err);
    expect(output).not.toContain("Hint:");
  });

  it("should not expose internal parser state", () => {
    const err = new DingError("parser", "Unexpected token", {
      line: 1,
      col: 5,
      source: "const = 5",
    });
    const output = formatError(err);
    // Should not contain stack traces or internal state
    expect(output).not.toContain("at Parser");
    expect(output).not.toContain("this.pos");
  });

  it("should include box drawing borders", () => {
    const err = new DingError("parser", "test", { line: 1, col: 1 });
    const output = formatError(err);
    expect(output).toContain("──");
    expect(output).toContain("───────────────────────────────────────");
  });
});

// ── Integration: lexer errors produce DingError ─────────────────────

describe("Lexer DingError integration", () => {
  it("should throw DingError on unterminated string", () => {
    try {
      new Lexer('"hello').tokenize();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DingError);
      const err = e as DingError;
      expect(err.phase).toBe("lexer");
      expect(err.message).toContain("Unterminated string");
      expect(err.hint).toContain("quote");
    }
  });

  it("should throw DingError on unknown character", () => {
    try {
      new Lexer("@").tokenize();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DingError);
      const err = e as DingError;
      expect(err.phase).toBe("lexer");
      expect(err.message).toContain("Unknown character");
      expect(err.line).toBe(1);
      expect(err.col).toBe(1);
      expect(err.source).toBe("@");
    }
  });
});

// ── Integration: parser errors produce DingError ────────────────────

describe("Parser DingError integration", () => {
  it("should throw DingError on unexpected token", () => {
    try {
      const tokens = new Lexer("const = 5").tokenize();
      new Parser(tokens, "const = 5").parse();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DingError);
      const err = e as DingError;
      expect(err.phase).toBe("parser");
      expect(err.line).toBeDefined();
      expect(err.col).toBeDefined();
      expect(err.source).toBe("const = 5");
    }
  });

  it("should throw DingError on import syntax error", () => {
    try {
      const tokens = new Lexer("import 123 from 'mod'").tokenize();
      new Parser(tokens, "import 123 from 'mod'").parse();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DingError);
      const err = e as DingError;
      expect(err.phase).toBe("parser");
      expect(err.message).toContain("Import syntax error");
    }
  });
});

// ── Integration: emitter errors produce DingError ───────────────────

describe("Emitter DingError integration", () => {
  it("should throw DingError on unknown AST node", () => {
    const tokens = new Lexer("const x = 1").tokenize();
    const ast = new Parser(tokens).parse();
    (ast.body[0] as any).type = "WeirdNode";
    try {
      new Emitter(ast).emit();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DingError);
      const err = e as DingError;
      expect(err.phase).toBe("emitter");
      expect(err.message).toContain("Internal compiler error");
      expect(err.hint).toContain("report");
    }
  });
});
