import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer/index.js";
import { TokenType } from "../src/lexer/token.js";

describe("Lexer", () => {
  it("should produce an EOF token for empty input", () => {
    const lexer = new Lexer("");
    const tokens = lexer.tokenize();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.EOF);
  });
});
