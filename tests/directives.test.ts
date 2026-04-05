import { describe, it, expect } from "vitest";
import { extractDirectives } from "../src/directives/index.js";
import { DingError } from "../src/errors/index.js";

describe("directives: arena size", () => {
  it("extracts no directives from a clean source", () => {
    const result = extractDirectives("const x = 42");
    expect(result.directives.arenaSize).toBeUndefined();
    expect(result.source).toBe("const x = 42");
  });

  it("parses bytes with no unit", () => {
    const { directives } = extractDirectives("#[arena(size = 1048576)]\nconst x = 1");
    expect(directives.arenaSize).toBe(1048576);
  });

  it("parses KB unit (1024-based)", () => {
    const { directives } = extractDirectives("#[arena(size = 64KB)]\nconst x = 1");
    expect(directives.arenaSize).toBe(64 * 1024);
  });

  it("parses MB unit", () => {
    const { directives } = extractDirectives("#[arena(size = 512MB)]\nconst x = 1");
    expect(directives.arenaSize).toBe(512 * 1024 * 1024);
  });

  it("parses GB unit", () => {
    const { directives } = extractDirectives("#[arena(size = 2GB)]\nconst x = 1");
    expect(directives.arenaSize).toBe(2 * 1024 * 1024 * 1024);
  });

  it("is case-insensitive on units", () => {
    const { directives } = extractDirectives("#[arena(size = 128mb)]\nconst x = 1");
    expect(directives.arenaSize).toBe(128 * 1024 * 1024);
  });

  it("accepts decimal multipliers", () => {
    const { directives } = extractDirectives("#[arena(size = 1.5GB)]\nconst x = 1");
    expect(directives.arenaSize).toBe(Math.floor(1.5 * 1024 * 1024 * 1024));
  });

  it("tolerates extra whitespace inside the directive", () => {
    const { directives } = extractDirectives("#[ arena ( size = 1GB ) ]\nconst x = 1");
    expect(directives.arenaSize).toBe(1024 * 1024 * 1024);
  });

  it("allows blank lines and line comments before the directive", () => {
    const src = `
// Configure a bigger arena because we allocate a lot per request
#[arena(size = 512MB)]
import { log } from 'ding:std'
`;
    const { directives } = extractDirectives(src);
    expect(directives.arenaSize).toBe(512 * 1024 * 1024);
  });

  it("blanks out directive lines so later line numbers stay accurate", () => {
    const src = "#[arena(size = 1GB)]\nconst x = 1";
    const { source } = extractDirectives(src);
    const lines = source.split("\n");
    // Original line 1 (the directive) is now blank; line 2 unchanged.
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("const x = 1");
  });

  it("stops scanning directives once real code begins", () => {
    // The second directive is AFTER a statement and must be left alone
    // (so it would later be a parse error if the user tried that).
    const src = "const x = 1\n#[arena(size = 1GB)]";
    const { directives, source } = extractDirectives(src);
    expect(directives.arenaSize).toBeUndefined();
    expect(source).toBe(src);
  });

  it("rejects duplicate directives", () => {
    expect(() =>
      extractDirectives("#[arena(size = 1GB)]\n#[arena(size = 512MB)]\nconst x = 1"),
    ).toThrow(DingError);
  });

  it("rejects unknown directive names", () => {
    expect(() => extractDirectives("#[nope(x = 1)]")).toThrow(/Unknown directive/);
  });

  it("rejects malformed arena argument", () => {
    expect(() => extractDirectives("#[arena(foo)]")).toThrow(/Invalid #\[arena/);
  });

  it("rejects unknown size unit", () => {
    expect(() => extractDirectives("#[arena(size = 1TB)]")).toThrow(/Unknown arena size unit/);
  });

  it("rejects zero / negative sizes", () => {
    expect(() => extractDirectives("#[arena(size = 0)]")).toThrow(/positive number/);
  });
});
