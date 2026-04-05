import { describe, it, expect } from "vitest";
import { validateDingDocument, getCompletionItems, getHoverForWord } from "../src/lsp/server.js";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";

describe("LSP validateDingDocument", () => {
  it("returns no diagnostics for valid code", () => {
    const src = `const x = 1\nconst y = 2\n`;
    expect(validateDingDocument(src)).toEqual([]);
  });

  it("returns no diagnostics for an empty file", () => {
    expect(validateDingDocument("")).toEqual([]);
  });

  it("returns no diagnostics for an import statement", () => {
    expect(validateDingDocument(`import { log } from 'ding:std'\n`)).toEqual([]);
  });

  it("returns no diagnostics for a struct declaration", () => {
    const src = `struct Vec2 {\n  x: number\n  y: number\n}\n`;
    expect(validateDingDocument(src)).toEqual([]);
  });

  it("returns no diagnostics for a template literal", () => {
    const src = "const name = \"Ada\"\nconst msg = `hello ${name}`\n";
    expect(validateDingDocument(src)).toEqual([]);
  });

  it("reports lexer errors with 0-indexed line/col", () => {
    // `@` is not a valid Ding token — will trip the lexer
    const src = `const x = 1\nconst y = @\n`;
    const diags = validateDingDocument(src);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe(DiagnosticSeverity.Error);
    expect(d.source).toBe("ding");
    // `@` is on line 2, col 11 (1-indexed) → line 1, col 10 (0-indexed)
    expect(d.range.start.line).toBe(1);
    expect(d.range.start.character).toBe(10);
    expect(d.range.end.character).toBe(d.range.start.character + 10);
  });

  it("reports parser errors with 0-indexed line/col", () => {
    // `const` with no initializer trips the parser, not the lexer
    const src = `const x =\n`;
    const diags = validateDingDocument(src);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const d = diags[0];
    expect(d.severity).toBe(DiagnosticSeverity.Error);
    expect(d.source).toBe("ding");
    expect(d.range.start.line).toBeGreaterThanOrEqual(0);
    expect(d.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it("returns only the first error when multiple would occur", () => {
    const src = `const x = @\nconst y = @\n`;
    const diags = validateDingDocument(src);
    expect(diags).toHaveLength(1);
    expect(diags[0].range.start.line).toBe(0);
  });

  it("does not crash on malformed input", () => {
    expect(() => validateDingDocument("((((")).not.toThrow();
    expect(() => validateDingDocument("\0\0\0")).not.toThrow();
  });
});

describe("LSP getCompletionItems", () => {
  it("includes core keywords", () => {
    const items = getCompletionItems();
    const labels = items.map((i) => i.label);
    for (const kw of ["const", "let", "for", "struct", "return", "if", "else"]) {
      expect(labels).toContain(kw);
    }
  });

  it("includes stdlib snippets", () => {
    const labels = getCompletionItems().map((i) => i.label);
    expect(labels).toContain("log");
    expect(labels).toContain("assert");
  });

  it("includes type keywords", () => {
    const labels = getCompletionItems().map((i) => i.label);
    expect(labels).toContain("int32");
    expect(labels).toContain("cstring");
  });

  it("includes named snippets like for-range and arrow", () => {
    const labels = getCompletionItems().map((i) => i.label);
    expect(labels).toContain("for-range");
    expect(labels).toContain("arrow");
    expect(labels).toContain("import-std");
  });
});

describe("LSP getHoverForWord", () => {
  it("returns hover docs for keywords", () => {
    const h = getHoverForWord("const");
    expect(h).not.toBeNull();
    expect(JSON.stringify(h)).toContain("immutable");
  });

  it("returns hover docs for type names", () => {
    const h = getHoverForWord("int32");
    expect(h).not.toBeNull();
    expect(JSON.stringify(h)).toContain("32-bit");
  });

  it("returns null for unknown identifiers", () => {
    expect(getHoverForWord("someRandomIdentifier")).toBeNull();
  });
});
