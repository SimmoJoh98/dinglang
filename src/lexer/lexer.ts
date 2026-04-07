import { Token, TokenType } from "./token.js";
import { DingError } from "../errors/index.js";

const KEYWORDS: Record<string, TokenType> = {
  const: TokenType.Const,
  let: TokenType.Let,
  import: TokenType.Import,
  from: TokenType.From,
  if: TokenType.If,
  else: TokenType.Else,
  return: TokenType.Return,
  null: TokenType.Null,
  true: TokenType.True,
  false: TokenType.False,
  for: TokenType.For,
  while: TokenType.While,
  in: TokenType.In,
  break: TokenType.Break,
  continue: TokenType.Continue,
  struct: TokenType.Struct,
  self: TokenType.Self,
  try: TokenType.Try,
  catch: TokenType.Catch,
  throw: TokenType.Throw,
  finally: TokenType.Finally,
  as: TokenType.As,
  enum: TokenType.Enum,
  match: TokenType.Match,
  spawn: TokenType.Spawn,
  type: TokenType.Type,
};

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }

      // Comments
      if (ch === "/" && this.pos + 1 < this.source.length) {
        if (this.source[this.pos + 1] === "/") {
          this.skipLineComment();
          continue;
        }
        if (this.source[this.pos + 1] === "*") {
          this.skipBlockComment();
          continue;
        }
      }

      // String literals
      if (ch === '"' || ch === "'" || ch === "`") {
        tokens.push(this.readString(ch));
        continue;
      }

      // Number literals
      if (this.isDigit(ch)) {
        tokens.push(this.readNumber());
        continue;
      }

      // Identifiers and keywords
      if (this.isAlpha(ch)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      // Operators and delimiters
      const token = this.readOperatorOrDelimiter();
      if (token) {
        tokens.push(token);
        continue;
      }

      throw new DingError("lexer", `Unknown character '${ch}'`, {
        line: this.line,
        col: this.col,
        source: this.getSourceLine(this.line),
        hint: "Remove or replace this character",
      });
    }

    tokens.push({ type: TokenType.EOF, value: "", line: this.line, col: this.col });
    return tokens;
  }

  private advance(): string {
    const ch = this.source[this.pos];
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    this.pos++;
    return ch;
  }

  private peek(): string | undefined {
    return this.source[this.pos];
  }

  private peekNext(): string | undefined {
    return this.source[this.pos + 1];
  }

  private skipLineComment(): void {
    // Skip the //
    this.advance();
    this.advance();
    while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    const startLine = this.line;
    const startCol = this.col;
    // Skip the /*
    this.advance();
    this.advance();
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === "*" && this.peekNext() === "/") {
        this.advance(); // *
        this.advance(); // /
        return;
      }
      this.advance();
    }
    throw new DingError("lexer", "Unterminated block comment", {
      line: startLine,
      col: startCol,
      source: this.getSourceLine(startLine),
      hint: "Close the block comment with */",
    });
  }

  private readString(quote: string): Token {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip opening quote
    let value = "";

    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      if (this.source[this.pos] === "\\" && this.pos + 1 < this.source.length) {
        this.advance(); // skip backslash
        const escaped = this.advance();
        switch (escaped) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case quote: value += quote; break;
          default: value += "\\" + escaped; break;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.pos >= this.source.length) {
      throw new DingError("lexer", "Unterminated string", {
        line: startLine,
        col: startCol,
        source: this.getSourceLine(startLine),
        hint: "Close the string with a matching quote",
      });
    }

    this.advance(); // skip closing quote
    return { type: TokenType.String, value, line: startLine, col: startCol };
  }

  private readNumber(): Token {
    const startLine = this.line;
    const startCol = this.col;
    let value = "";

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.advance();
    }

    // Float
    if (this.pos < this.source.length && this.source[this.pos] === "." && this.isDigit(this.source[this.pos + 1])) {
      value += this.advance(); // .
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        value += this.advance();
      }
    }

    return { type: TokenType.Number, value, line: startLine, col: startCol };
  }

  private readIdentifier(): Token {
    const startLine = this.line;
    const startCol = this.col;
    let value = "";

    while (this.pos < this.source.length && this.isAlphaNumeric(this.source[this.pos])) {
      value += this.advance();
    }

    const type = Object.hasOwn(KEYWORDS, value) ? KEYWORDS[value] : TokenType.Identifier;
    return { type, value, line: startLine, col: startCol };
  }

  private readOperatorOrDelimiter(): Token | null {
    const startLine = this.line;
    const startCol = this.col;
    const ch = this.source[this.pos];
    const next = this.peekNext();

    // Two-character operators
    switch (ch) {
      case "=":
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.DoubleEquals, value: "==", line: startLine, col: startCol };
        }
        if (next === ">") {
          this.advance(); this.advance();
          return { type: TokenType.Arrow, value: "=>", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Equals, value: "=", line: startLine, col: startCol };
      case "!":
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.NotEquals, value: "!=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Bang, value: "!", line: startLine, col: startCol };
      case "?":
        if (next === ".") {
          this.advance(); this.advance();
          return { type: TokenType.QuestionDot, value: "?.", line: startLine, col: startCol };
        }
        if (next === "?") {
          this.advance(); this.advance();
          return { type: TokenType.QuestionQuestion, value: "??", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.QuestionMark, value: "?", line: startLine, col: startCol };
      case ".":
        if (next === ".") {
          if (this.pos + 2 < this.source.length && this.source[this.pos + 2] === ".") {
            this.advance(); this.advance(); this.advance();
            return { type: TokenType.DotDotDot, value: "...", line: startLine, col: startCol };
          }
          this.advance(); this.advance();
          return { type: TokenType.DotDot, value: "..", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Dot, value: ".", line: startLine, col: startCol };
      case "#":
        this.advance();
        return { type: TokenType.Hash, value: "#", line: startLine, col: startCol };
      case "<":
        if (next === "<") {
          this.advance(); this.advance();
          return { type: TokenType.LeftShift, value: "<<", line: startLine, col: startCol };
        }
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.LessThanEquals, value: "<=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.LessThan, value: "<", line: startLine, col: startCol };
      case ">":
        if (next === ">") {
          this.advance(); this.advance();
          return { type: TokenType.RightShift, value: ">>", line: startLine, col: startCol };
        }
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.GreaterThanEquals, value: ">=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.GreaterThan, value: ">", line: startLine, col: startCol };
      case "&":
        if (next === "&") {
          this.advance(); this.advance();
          return { type: TokenType.And, value: "&&", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Ampersand, value: "&", line: startLine, col: startCol };
      case "|":
        if (next === "|") {
          this.advance(); this.advance();
          return { type: TokenType.Or, value: "||", line: startLine, col: startCol };
        }
        if (next === ">") {
          this.advance(); this.advance();
          return { type: TokenType.PipeGreater, value: "|>", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Pipe, value: "|", line: startLine, col: startCol };
      case "^":
        this.advance();
        return { type: TokenType.Caret, value: "^", line: startLine, col: startCol };
      case "~":
        this.advance();
        return { type: TokenType.Tilde, value: "~", line: startLine, col: startCol };
      case "+":
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.PlusEquals, value: "+=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Plus, value: "+", line: startLine, col: startCol };
      case "-":
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.MinusEquals, value: "-=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Minus, value: "-", line: startLine, col: startCol };
      case "*":
        if (next === "*") {
          this.advance(); this.advance();
          return { type: TokenType.StarStar, value: "**", line: startLine, col: startCol };
        }
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.StarEquals, value: "*=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Star, value: "*", line: startLine, col: startCol };
      case "/":
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.SlashEquals, value: "/=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Slash, value: "/", line: startLine, col: startCol };
      case "%":
        if (next === "=") {
          this.advance(); this.advance();
          return { type: TokenType.PercentEquals, value: "%=", line: startLine, col: startCol };
        }
        this.advance();
        return { type: TokenType.Percent, value: "%", line: startLine, col: startCol };
    }

    // Single-character operators and delimiters
    const singleCharTokens: Record<string, TokenType> = {
      "(": TokenType.LeftParen,
      ")": TokenType.RightParen,
      "{": TokenType.LeftBrace,
      "}": TokenType.RightBrace,
      "[": TokenType.LeftBracket,
      "]": TokenType.RightBracket,
      ",": TokenType.Comma,
      ":": TokenType.Colon,
      ";": TokenType.Semicolon,
    };

    const type = singleCharTokens[ch];
    if (type) {
      this.advance();
      return { type, value: ch, line: startLine, col: startCol };
    }

    return null;
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  private getSourceLine(line: number): string {
    return this.source.split("\n")[line - 1] ?? "";
  }
}
