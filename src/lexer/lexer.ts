import { Token, TokenType } from "./token.js";

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
    // TODO: implement tokenization
    tokens.push({ type: TokenType.EOF, value: "", line: this.line, col: this.col });
    return tokens;
  }
}
