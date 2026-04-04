import type { Program } from "../ast/nodes.js";

export class Emitter {
  private ast: Program;

  constructor(ast: Program) {
    this.ast = ast;
  }

  emit(): string {
    // TODO: implement code emission (target: JavaScript)
    return `// compiled from Ding\n`;
  }
}
