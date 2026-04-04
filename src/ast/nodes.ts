export interface Program {
  type: "Program";
  body: Statement[];
}

export type Statement =
  | VariableDeclaration
  | ExpressionStatement
  | ImportDeclaration
  | ReturnStatement;

export type Expression =
  | NumberLiteral
  | StringLiteral
  | NullLiteral
  | Identifier
  | BinaryExpression
  | ArrowFunction
  | CallExpression
  | TemplateLiteral;

export type ASTNode = Statement | Expression;

export interface VariableDeclaration {
  type: "VariableDeclaration";
  kind: "const" | "let";
  name: string;
  annotation?: TypeAnnotation;
  init: Expression;
}

export interface ExpressionStatement {
  type: "ExpressionStatement";
  expression: Expression;
}

export interface ImportDeclaration {
  type: "ImportDeclaration";
  specifiers: string[];
  source: string;
}

export interface ReturnStatement {
  type: "ReturnStatement";
  value: Expression | null;
}

export interface NumberLiteral {
  type: "NumberLiteral";
  value: number;
}

export interface StringLiteral {
  type: "StringLiteral";
  value: string;
}

export interface NullLiteral {
  type: "NullLiteral";
}

export interface Identifier {
  type: "Identifier";
  name: string;
}

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
}

export interface ArrowFunction {
  type: "ArrowFunction";
  params: Parameter[];
  returnType?: TypeAnnotation;
  body: Statement[] | Expression;
}

export interface Parameter {
  name: string;
  annotation?: TypeAnnotation;
}

export interface CallExpression {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
}

export interface TemplateLiteral {
  type: "TemplateLiteral";
  parts: (string | Expression)[];
}

export interface TypeAnnotation {
  type: "TypeAnnotation";
  name: string;
}
