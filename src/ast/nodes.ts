export interface Program {
  type: "Program";
  body: Statement[];
}

export type Statement =
  | VariableDeclaration
  | ExpressionStatement
  | ImportDeclaration
  | ReturnStatement
  | IfStatement
  | ForRangeStatement
  | ForInStatement
  | WhileStatement
  | BreakStatement
  | ContinueStatement
  | StructDeclaration
  | TryCatchStatement
  | ThrowStatement
  | EnumDeclaration
  | MatchStatement
  | DestructuringDeclaration
  | SpawnStatement
  | TypeAliasDeclaration;

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | Identifier
  | BinaryExpression
  | UnaryExpression
  | ArrowFunction
  | CallExpression
  | TemplateLiteral
  | ArrayLiteral
  | ArrayAccess
  | LengthExpression
  | MemberExpression
  | StructInstantiation
  | ErrorPropagation
  | NullishCoalescing
  | NullAssertion
  | AssignmentExpression
  | MatchExpression
  | MapLiteral;

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
  default?: string;
  named: string[];
  namespace?: string;
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

export interface BooleanLiteral {
  type: "BooleanLiteral";
  value: boolean;
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
  defaultValue?: Expression;
}

export interface UnaryExpression {
  type: "UnaryExpression";
  operator: string;
  operand: Expression;
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

export interface IfStatement {
  type: "IfStatement";
  test: Expression;
  consequent: Statement[];
  alternate: Statement[] | null;
}

export interface TypeAnnotation {
  type: "TypeAnnotation";
  name: string;
}

// ── Loops ──────────────────────────────────────────────────────────

export interface ForRangeStatement {
  type: "ForRangeStatement";
  identifier: string;
  start: Expression;
  end: Expression;
  body: Statement[];
}

export interface ForInStatement {
  type: "ForInStatement";
  identifier: string;
  iterable: Expression;
  body: Statement[];
}

export interface WhileStatement {
  type: "WhileStatement";
  condition: Expression;
  body: Statement[];
}

export interface BreakStatement {
  type: "BreakStatement";
}

export interface ContinueStatement {
  type: "ContinueStatement";
}

// ── Arrays ─────────────────────────────────────────────────────────

export interface SpreadElement {
  type: "SpreadElement";
  argument: Expression;
}

export interface ArrayLiteral {
  type: "ArrayLiteral";
  elements: (Expression | SpreadElement)[];
}

export interface ArrayAccess {
  type: "ArrayAccess";
  array: Expression;
  index: Expression;
}

export interface LengthExpression {
  type: "LengthExpression";
  target: Expression;
}

// ── Member access ──────────────────────────────────────────────────

export interface MemberExpression {
  type: "MemberExpression";
  object: Expression;
  property: string;
  optional: boolean;
}

// ── Structs ────────────────────────────────────────────────────────

export interface StructDeclaration {
  type: "StructDeclaration";
  name: string;
  fields: StructField[];
  methods: StructMethod[];
}

export interface StructField {
  name: string;
  fieldType: string;
}

export interface StructMethod {
  name: string;
  params: Parameter[];
  body: Statement[] | Expression;
}

export interface StructInstantiation {
  type: "StructInstantiation";
  name: string;
  fields: { name: string; value: Expression }[];
}

// ── Error handling ─────────────────────────────────────────────────

export interface TryCatchStatement {
  type: "TryCatchStatement";
  body: Statement[];
  param: string;
  catch: Statement[];
  finally?: Statement[];
}

export interface ThrowStatement {
  type: "ThrowStatement";
  value: Expression;
}

export interface ErrorPropagation {
  type: "ErrorPropagation";
  expression: Expression;
}

// ── Null handling ──────────────────────────────────────────────────

export interface NullishCoalescing {
  type: "NullishCoalescing";
  left: Expression;
  right: Expression;
}

export interface NullAssertion {
  type: "NullAssertion";
  expression: Expression;
}

// ── Assignment ─────────────────────────────────────────────────────

export interface AssignmentExpression {
  type: "AssignmentExpression";
  target: Expression;
  value: Expression;
}

// ── Enums ─────────────────────────────────────────────────────────

export interface EnumDeclaration {
  type: "EnumDeclaration";
  name: string;
  members: EnumMember[];
}

export interface EnumMember {
  name: string;
  value?: Expression;
}

// ── Match ─────────────────────────────────────────────────────────

export type MatchPattern =
  | { kind: "literal"; value: Expression }
  | { kind: "range"; start: Expression; end: Expression }
  | { kind: "wildcard" };

export interface MatchArm {
  pattern: MatchPattern;
  body: Statement[] | Expression;
}

export interface MatchExpression {
  type: "MatchExpression";
  subject: Expression;
  arms: MatchArm[];
}

export interface MatchStatement {
  type: "MatchStatement";
  subject: Expression;
  arms: MatchArm[];
}

// ── Destructuring ─────────────────────────────────────────────────

export interface ArrayDestructurePattern {
  kind: "array";
  elements: (string | null)[];
}

export interface ObjectDestructurePattern {
  kind: "object";
  properties: string[];
}

export interface DestructuringDeclaration {
  type: "DestructuringDeclaration";
  kind: "const" | "let";
  pattern: ArrayDestructurePattern | ObjectDestructurePattern;
  init: Expression;
}

// ── Type aliases ──────────────────────────────────────────────────

export interface TypeAliasDeclaration {
  type: "TypeAliasDeclaration";
  name: string;
  alias: TypeAnnotation;
}

// ── Concurrency ───────────────────────────────────────────────────

export interface SpawnStatement {
  type: "SpawnStatement";
  body: Expression; // ArrowFunction or CallExpression
}

// ── Maps ──────────────────────────────────────────────────────────

export interface MapLiteral {
  type: "MapLiteral";
  entries: { key: Expression; value: Expression }[];
}
