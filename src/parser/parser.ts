import type { Token } from "../lexer/token.js";
import type { Program } from "../ast/nodes.js";

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Program {
    // TODO: implement parsing
    return { type: "Program", body: [] };
  }
}
