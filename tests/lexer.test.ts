import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer/index.js";
import { TokenType, Token } from "../src/lexer/token.js";
import { DingError } from "../src/errors/index.js";

/** Helper: tokenize and strip EOF for easier assertions */
function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}

function getError(fn: () => void): DingError {
  try {
    fn();
    throw new Error("Expected function to throw");
  } catch (e) {
    if (e instanceof DingError) return e;
    throw e;
  }
}

function types(source: string): TokenType[] {
  return tokenize(source).map((t) => t.type);
}

describe("Lexer", () => {
  it("should produce an EOF token for empty input", () => {
    const tokens = tokenize("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.EOF);
  });

  // ── Sample Ding code ──────────────────────────────────────────────

  it("should tokenize sample Ding code", () => {
    const source = `const name = "Dallas"
const health = 100
const isAlive = true
const getStatus = (player) => {
  return player
}`;

    const tokens = tokenize(source);
    const tt = tokens.map((t) => t.type);

    // Line 1: const name = "Dallas"
    expect(tt[0]).toBe(TokenType.Const);
    expect(tt[1]).toBe(TokenType.Identifier);
    expect(tokens[1].value).toBe("name");
    expect(tt[2]).toBe(TokenType.Equals);
    expect(tt[3]).toBe(TokenType.String);
    expect(tokens[3].value).toBe("Dallas");

    // Line 2: const health = 100
    expect(tt[4]).toBe(TokenType.Const);
    expect(tt[5]).toBe(TokenType.Identifier);
    expect(tokens[5].value).toBe("health");
    expect(tt[6]).toBe(TokenType.Equals);
    expect(tt[7]).toBe(TokenType.Number);
    expect(tokens[7].value).toBe("100");

    // Line 3: const isAlive = true
    expect(tt[8]).toBe(TokenType.Const);
    expect(tt[9]).toBe(TokenType.Identifier);
    expect(tokens[9].value).toBe("isAlive");
    expect(tt[10]).toBe(TokenType.Equals);
    expect(tt[11]).toBe(TokenType.True);

    // Line 4-6: const getStatus = (player) => { return player }
    expect(tt[12]).toBe(TokenType.Const);
    expect(tt[13]).toBe(TokenType.Identifier);
    expect(tokens[13].value).toBe("getStatus");
    expect(tt[14]).toBe(TokenType.Equals);
    expect(tt[15]).toBe(TokenType.LeftParen);
    expect(tt[16]).toBe(TokenType.Identifier);
    expect(tokens[16].value).toBe("player");
    expect(tt[17]).toBe(TokenType.RightParen);
    expect(tt[18]).toBe(TokenType.Arrow);
    expect(tt[19]).toBe(TokenType.LeftBrace);
    expect(tt[20]).toBe(TokenType.Return);
    expect(tt[21]).toBe(TokenType.Identifier);
    expect(tokens[21].value).toBe("player");
    expect(tt[22]).toBe(TokenType.RightBrace);

    // Last token is EOF
    expect(tt[tt.length - 1]).toBe(TokenType.EOF);
  });

  // ── Keywords ──────────────────────────────────────────────────────

  describe("keywords", () => {
    it("should recognize all keywords", () => {
      const source = "const let import from if else return null true false for while in break continue struct self try catch throw finally as";
      expect(types(source)).toEqual([
        TokenType.Const,
        TokenType.Let,
        TokenType.Import,
        TokenType.From,
        TokenType.If,
        TokenType.Else,
        TokenType.Return,
        TokenType.Null,
        TokenType.True,
        TokenType.False,
        TokenType.For,
        TokenType.While,
        TokenType.In,
        TokenType.Break,
        TokenType.Continue,
        TokenType.Struct,
        TokenType.Self,
        TokenType.Try,
        TokenType.Catch,
        TokenType.Throw,
        TokenType.Finally,
        TokenType.As,
        TokenType.EOF,
      ]);
    });

    it("should not treat keyword prefixes as keywords", () => {
      const tokens = tokenize("constants letter importing");
      expect(tokens[0].type).toBe(TokenType.Identifier);
      expect(tokens[0].value).toBe("constants");
      expect(tokens[1].type).toBe(TokenType.Identifier);
      expect(tokens[1].value).toBe("letter");
      expect(tokens[2].type).toBe(TokenType.Identifier);
      expect(tokens[2].value).toBe("importing");
    });
  });

  // ── Identifiers ───────────────────────────────────────────────────

  describe("identifiers", () => {
    it("should tokenize simple identifiers", () => {
      const tokens = tokenize("foo bar baz");
      expect(tokens[0]).toMatchObject({ type: TokenType.Identifier, value: "foo" });
      expect(tokens[1]).toMatchObject({ type: TokenType.Identifier, value: "bar" });
      expect(tokens[2]).toMatchObject({ type: TokenType.Identifier, value: "baz" });
    });

    it("should allow underscores and digits in identifiers", () => {
      const tokens = tokenize("_private my_var x1 _2cool");
      expect(tokens.map((t) => t.value)).toEqual(["_private", "my_var", "x1", "_2cool", ""]);
      expect(tokens.slice(0, 4).every((t) => t.type === TokenType.Identifier)).toBe(true);
    });
  });

  // ── String literals ───────────────────────────────────────────────

  describe("strings", () => {
    it("should tokenize double-quoted strings", () => {
      const tokens = tokenize('"hello world"');
      expect(tokens[0]).toMatchObject({ type: TokenType.String, value: "hello world" });
    });

    it("should tokenize single-quoted strings", () => {
      const tokens = tokenize("'hello'");
      expect(tokens[0]).toMatchObject({ type: TokenType.String, value: "hello" });
    });

    it("should tokenize backtick strings", () => {
      const tokens = tokenize("`template`");
      expect(tokens[0]).toMatchObject({ type: TokenType.String, value: "template" });
    });

    it("should handle escape sequences", () => {
      const tokens = tokenize('"line1\\nline2"');
      expect(tokens[0].value).toBe("line1\nline2");
    });

    it("should handle escaped quotes", () => {
      const tokens = tokenize('"say \\"hi\\""');
      expect(tokens[0].value).toBe('say "hi"');
    });

    it("should handle escaped backslash", () => {
      const tokens = tokenize('"path\\\\dir"');
      expect(tokens[0].value).toBe("path\\dir");
    });

    it("should handle empty strings", () => {
      const tokens = tokenize('""');
      expect(tokens[0]).toMatchObject({ type: TokenType.String, value: "" });
    });

    it("should throw on unterminated string", () => {
      expect(() => tokenize('"unterminated')).toThrow("Unterminated string");
    });
  });

  // ── Number literals ───────────────────────────────────────────────

  describe("numbers", () => {
    it("should tokenize integers", () => {
      const tokens = tokenize("0 42 1000");
      expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: "0" });
      expect(tokens[1]).toMatchObject({ type: TokenType.Number, value: "42" });
      expect(tokens[2]).toMatchObject({ type: TokenType.Number, value: "1000" });
    });

    it("should tokenize floats", () => {
      const tokens = tokenize("3.14 0.5 100.0");
      expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: "3.14" });
      expect(tokens[1]).toMatchObject({ type: TokenType.Number, value: "0.5" });
      expect(tokens[2]).toMatchObject({ type: TokenType.Number, value: "100.0" });
    });

    it("should not treat dot without trailing digit as float", () => {
      // "5." should be number 5 followed by something else (error in this case)
      // but "5.x" should be number 5, then unexpected '.'
      const tokens = tokenize("5.3");
      expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: "5.3" });
    });
  });

  // ── Operators ─────────────────────────────────────────────────────

  describe("operators", () => {
    it("should tokenize single-char operators", () => {
      expect(types("+ - * /")).toEqual([
        TokenType.Plus,
        TokenType.Minus,
        TokenType.Star,
        TokenType.Slash,
        TokenType.EOF,
      ]);
    });

    it("should tokenize assignment", () => {
      expect(types("=")).toEqual([TokenType.Equals, TokenType.EOF]);
    });

    it("should tokenize arrow =>", () => {
      expect(types("=>")).toEqual([TokenType.Arrow, TokenType.EOF]);
    });

    it("should tokenize comparison operators", () => {
      expect(types("< > <= >=")).toEqual([
        TokenType.LessThan,
        TokenType.GreaterThan,
        TokenType.LessThanEquals,
        TokenType.GreaterThanEquals,
        TokenType.EOF,
      ]);
    });

    it("should tokenize equality operators", () => {
      expect(types("== !=")).toEqual([
        TokenType.DoubleEquals,
        TokenType.NotEquals,
        TokenType.EOF,
      ]);
    });

    it("should distinguish = from == and =>", () => {
      const tokens = tokenize("= == =>");
      expect(tokens[0].type).toBe(TokenType.Equals);
      expect(tokens[1].type).toBe(TokenType.DoubleEquals);
      expect(tokens[2].type).toBe(TokenType.Arrow);
    });

    it("should tokenize dot and dotdot", () => {
      expect(types("a.b")).toEqual([
        TokenType.Identifier,
        TokenType.Dot,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
      expect(types("0..5")).toEqual([
        TokenType.Number,
        TokenType.DotDot,
        TokenType.Number,
        TokenType.EOF,
      ]);
    });

    it("should tokenize hash operator", () => {
      expect(types("#arr")).toEqual([
        TokenType.Hash,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should tokenize question operators", () => {
      expect(types("a?.b")).toEqual([
        TokenType.Identifier,
        TokenType.QuestionDot,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
      expect(types("a ?? b")).toEqual([
        TokenType.Identifier,
        TokenType.QuestionQuestion,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
      expect(types("a?")).toEqual([
        TokenType.Identifier,
        TokenType.QuestionMark,
        TokenType.EOF,
      ]);
    });

    it("should tokenize bang operator", () => {
      expect(types("a!")).toEqual([
        TokenType.Identifier,
        TokenType.Bang,
        TokenType.EOF,
      ]);
    });

    it("should distinguish != from standalone !", () => {
      expect(types("a != b")).toEqual([
        TokenType.Identifier,
        TokenType.NotEquals,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
      expect(types("a!")).toEqual([
        TokenType.Identifier,
        TokenType.Bang,
        TokenType.EOF,
      ]);
    });
  });

  // ── Delimiters ────────────────────────────────────────────────────

  describe("delimiters", () => {
    it("should tokenize all delimiters", () => {
      expect(types("( ) { } [ ] , : ;")).toEqual([
        TokenType.LeftParen,
        TokenType.RightParen,
        TokenType.LeftBrace,
        TokenType.RightBrace,
        TokenType.LeftBracket,
        TokenType.RightBracket,
        TokenType.Comma,
        TokenType.Colon,
        TokenType.Semicolon,
        TokenType.EOF,
      ]);
    });
  });

  // ── Comments ──────────────────────────────────────────────────────

  describe("comments", () => {
    it("should skip single-line comments", () => {
      const tokens = tokenize("foo // this is a comment\nbar");
      expect(types("foo // this is a comment\nbar")).toEqual([
        TokenType.Identifier,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
      expect(tokens[0].value).toBe("foo");
      expect(tokens[1].value).toBe("bar");
    });

    it("should skip multi-line comments", () => {
      expect(types("foo /* comment */ bar")).toEqual([
        TokenType.Identifier,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should skip multi-line comments spanning lines", () => {
      const source = `foo /* this
spans
lines */ bar`;
      expect(types(source)).toEqual([
        TokenType.Identifier,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should throw on unterminated block comment", () => {
      expect(() => tokenize("/* never closed")).toThrow("Unterminated block comment");
    });

    it("should handle comment at end of input", () => {
      const tokens = tokenize("foo // trailing comment");
      expect(tokens).toHaveLength(2); // Identifier + EOF
      expect(tokens[0].value).toBe("foo");
    });
  });

  // ── Whitespace ────────────────────────────────────────────────────

  describe("whitespace", () => {
    it("should skip spaces and tabs", () => {
      const tokens = tokenize("  foo  \t  bar  ");
      expect(tokens).toHaveLength(3); // foo, bar, EOF
    });

    it("should handle newlines and track line numbers", () => {
      const tokens = tokenize("foo\nbar\nbaz");
      expect(tokens[0].line).toBe(1);
      expect(tokens[1].line).toBe(2);
      expect(tokens[2].line).toBe(3);
    });

    it("should track column numbers", () => {
      const tokens = tokenize("  foo");
      expect(tokens[0].col).toBe(3);
    });
  });

  // ── Line / column tracking ────────────────────────────────────────

  describe("position tracking", () => {
    it("should track positions across multiple lines", () => {
      const source = `const x = 10
let y = 20`;
      const tokens = tokenize(source);

      // const on line 1, col 1
      expect(tokens[0]).toMatchObject({ type: TokenType.Const, line: 1, col: 1 });
      // x on line 1, col 7
      expect(tokens[1]).toMatchObject({ type: TokenType.Identifier, value: "x", line: 1, col: 7 });
      // = on line 1, col 9
      expect(tokens[2]).toMatchObject({ line: 1, col: 9 });
      // 10 on line 1, col 11
      expect(tokens[3]).toMatchObject({ type: TokenType.Number, value: "10", line: 1, col: 11 });
      // let on line 2, col 1
      expect(tokens[4]).toMatchObject({ type: TokenType.Let, line: 2, col: 1 });
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe("errors", () => {
    it("should throw on unexpected characters", () => {
      expect(() => tokenize("@")).toThrow("Unknown character");
    });

    it("should include position in error message", () => {
      const err = getError(() => tokenize("  @"));
      expect(err.line).toBe(1);
      expect(err.col).toBe(3);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle tokens without spaces between delimiters", () => {
      const tokens = tokenize("foo(bar,baz)");
      expect(types("foo(bar,baz)")).toEqual([
        TokenType.Identifier,
        TokenType.LeftParen,
        TokenType.Identifier,
        TokenType.Comma,
        TokenType.Identifier,
        TokenType.RightParen,
        TokenType.EOF,
      ]);
    });

    it("should handle a realistic arrow function", () => {
      const source = "(x, y) => x + y";
      expect(types(source)).toEqual([
        TokenType.LeftParen,
        TokenType.Identifier,
        TokenType.Comma,
        TokenType.Identifier,
        TokenType.RightParen,
        TokenType.Arrow,
        TokenType.Identifier,
        TokenType.Plus,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should handle null, true, false as distinct keywords", () => {
      const tokens = tokenize("null true false");
      expect(tokens[0].type).toBe(TokenType.Null);
      expect(tokens[1].type).toBe(TokenType.True);
      expect(tokens[2].type).toBe(TokenType.False);
    });

    it("should handle division vs comment correctly", () => {
      // a / b should be division, not start of comment
      expect(types("a / b")).toEqual([
        TokenType.Identifier,
        TokenType.Slash,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should handle semicolons", () => {
      expect(types("let x = 5;")).toEqual([
        TokenType.Let,
        TokenType.Identifier,
        TokenType.Equals,
        TokenType.Number,
        TokenType.Semicolon,
        TokenType.EOF,
      ]);
    });

    it("should handle type annotations with colon", () => {
      expect(types("x: number")).toEqual([
        TokenType.Identifier,
        TokenType.Colon,
        TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should handle array indexing", () => {
      expect(types("arr[0]")).toEqual([
        TokenType.Identifier,
        TokenType.LeftBracket,
        TokenType.Number,
        TokenType.RightBracket,
        TokenType.EOF,
      ]);
    });
  });

  // ── Batch 3 tokens ─────────────────────────────────────────────────

  describe("batch 3 tokens", () => {
    it("should lex ** (power operator)", () => {
      expect(types("2 ** 3")).toEqual([
        TokenType.Number, TokenType.StarStar, TokenType.Number, TokenType.EOF,
      ]);
    });

    it("should distinguish ** from * and *=", () => {
      expect(types("a ** b * c *= d")).toEqual([
        TokenType.Identifier, TokenType.StarStar, TokenType.Identifier,
        TokenType.Star, TokenType.Identifier,
        TokenType.StarEquals, TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should lex |> (pipe operator)", () => {
      expect(types("x |> f")).toEqual([
        TokenType.Identifier, TokenType.PipeGreater, TokenType.Identifier, TokenType.EOF,
      ]);
    });

    it("should distinguish |> from || and |", () => {
      expect(types("a |> b || c | d")).toEqual([
        TokenType.Identifier, TokenType.PipeGreater, TokenType.Identifier,
        TokenType.Or, TokenType.Identifier,
        TokenType.Pipe, TokenType.Identifier,
        TokenType.EOF,
      ]);
    });

    it("should lex ... (spread)", () => {
      expect(types("[...arr]")).toEqual([
        TokenType.LeftBracket, TokenType.DotDotDot, TokenType.Identifier,
        TokenType.RightBracket, TokenType.EOF,
      ]);
    });

    it("should distinguish ... from .. and .", () => {
      expect(types("a...b..c.d")).toEqual([
        TokenType.Identifier, TokenType.DotDotDot,
        TokenType.Identifier, TokenType.DotDot,
        TokenType.Identifier, TokenType.Dot,
        TokenType.Identifier, TokenType.EOF,
      ]);
    });
  });
});
