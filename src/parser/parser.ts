import { Token, TokenType } from "../lexer/token.js";
import { Lexer } from "../lexer/index.js";
import { DingError } from "../errors/index.js";
import type {
  Program,
  Statement,
  Expression,
  VariableDeclaration,
  ImportDeclaration,
  ReturnStatement,
  IfStatement,
  ExpressionStatement,
  ArrowFunction,
  CallExpression,
  TemplateLiteral,
  Parameter,
  TypeAnnotation,
  ForRangeStatement,
  ForInStatement,
  WhileStatement,
  BreakStatement,
  ContinueStatement,
  StructDeclaration,
  StructField,
  StructMethod,
  StructInstantiation,
  TryCatchStatement,
  ThrowStatement,
  ArrayLiteral,
  ArrayAccess,
  LengthExpression,
  MemberExpression,
  ErrorPropagation,
  NullishCoalescing,
  NullAssertion,
  AssignmentExpression,
  UnaryExpression,
  EnumDeclaration,
  MatchExpression,
  MatchArm,
  MatchPattern,
  MatchStatement,
  SpreadElement,
  DestructuringDeclaration,
  MapLiteral,
  SpawnStatement,
  TypeAliasDeclaration,
} from "../ast/nodes.js";

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private sourceText?: string;

  constructor(tokens: Token[], sourceText?: string) {
    this.tokens = tokens;
    this.sourceText = sourceText;
  }

  private getSourceLine(line: number): string | undefined {
    if (!this.sourceText) return undefined;
    return this.sourceText.split("\n")[line - 1];
  }

  parse(): Program {
    const body: Statement[] = [];
    while (!this.isAtEnd()) {
      this.skipSemicolons();
      if (this.isAtEnd()) break;
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  // ── Token helpers ──────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new DingError("parser", `Expected ${type} but got ${token.type} ("${token.value}")`, {
        line: token.line,
        col: token.col,
        source: this.getSourceLine(token.line),
        hint: `Expected a ${type} token here`,
      });
    }
    return this.advance();
  }

  private match(type: TokenType): boolean {
    if (this.current().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private skipSemicolons(): void {
    while (!this.isAtEnd() && this.current().type === TokenType.Semicolon) {
      this.advance();
    }
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1];
    return this.tokens[idx];
  }

  // ── Statements ─────────────────────────────────────────────────────

  private parseStatement(): Statement {
    switch (this.current().type) {
      case TokenType.Const:
      case TokenType.Let:
        return this.parseVariableDeclaration();
      case TokenType.Import:
        return this.parseImportDeclaration();
      case TokenType.Return:
        return this.parseReturnStatement();
      case TokenType.If:
        return this.parseIfStatement();
      case TokenType.For:
        return this.parseForStatement();
      case TokenType.While:
        return this.parseWhileStatement();
      case TokenType.Break:
        return this.parseBreakStatement();
      case TokenType.Continue:
        return this.parseContinueStatement();
      case TokenType.Struct:
        return this.parseStructDeclaration();
      case TokenType.Try:
        return this.parseTryCatchStatement();
      case TokenType.Throw:
        return this.parseThrowStatement();
      case TokenType.Enum:
        return this.parseEnumDeclaration();
      case TokenType.Match:
        return this.parseMatchStatement();
      case TokenType.Spawn:
        return this.parseSpawnStatement();
      case TokenType.Type:
        return this.parseTypeAlias();
      default:
        return this.parseExpressionStatement();
    }
  }

  private parseVariableDeclaration(): VariableDeclaration | DestructuringDeclaration {
    const kind = this.advance().value as "const" | "let";

    // Array destructuring: const [a, b, c] = expr
    if (this.current().type === TokenType.LeftBracket) {
      return this.parseArrayDestructuring(kind);
    }

    // Object destructuring: const { x, y } = expr
    if (this.current().type === TokenType.LeftBrace) {
      return this.parseObjectDestructuring(kind);
    }

    const name = this.expect(TokenType.Identifier).value;

    let annotation: TypeAnnotation | undefined;
    if (this.match(TokenType.Colon)) {
      annotation = this.parseTypeAnnotation();
    }

    this.expect(TokenType.Equals);
    const init = this.parseExpression();
    this.skipSemicolons();

    return { type: "VariableDeclaration", kind, name, annotation, init };
  }

  private parseArrayDestructuring(kind: "const" | "let"): DestructuringDeclaration {
    this.expect(TokenType.LeftBracket);
    const elements: (string | null)[] = [];
    while (this.current().type !== TokenType.RightBracket) {
      if (this.current().type === TokenType.Comma) {
        elements.push(null); // skipped position
      } else {
        elements.push(this.expect(TokenType.Identifier).value);
      }
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBracket);
    this.expect(TokenType.Equals);
    const init = this.parseExpression();
    this.skipSemicolons();
    return {
      type: "DestructuringDeclaration",
      kind,
      pattern: { kind: "array", elements },
      init,
    };
  }

  private parseTypeAlias(): TypeAliasDeclaration {
    this.expect(TokenType.Type); // consume 'type'
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Equals);
    const alias = this.parseTypeAnnotation();
    this.skipSemicolons();
    return { type: "TypeAliasDeclaration", name, alias } as TypeAliasDeclaration;
  }

  private parseSpawnStatement(): SpawnStatement {
    this.expect(TokenType.Spawn); // consume 'spawn'
    const body = this.parseExpression();
    this.skipSemicolons();
    return { type: "SpawnStatement", body } as SpawnStatement;
  }

  private parseObjectDestructuring(kind: "const" | "let"): DestructuringDeclaration {
    this.expect(TokenType.LeftBrace);
    const properties: string[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      properties.push(this.expect(TokenType.Identifier).value);
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBrace);
    this.expect(TokenType.Equals);
    const init = this.parseExpression();
    this.skipSemicolons();
    return {
      type: "DestructuringDeclaration",
      kind,
      pattern: { kind: "object", properties },
      init,
    };
  }

  private parseImportDeclaration(): ImportDeclaration {
    this.expect(TokenType.Import);

    let defaultImport: string | undefined;
    let named: string[] = [];
    let namespace: string | undefined;

    if (this.current().type === TokenType.Star) {
      // import * as name from 'module'
      this.advance(); // consume *
      this.expect(TokenType.As);
      namespace = this.expect(TokenType.Identifier).value;
    } else if (this.current().type === TokenType.LeftBrace) {
      // import { a, b } from 'module'
      named = this.parseNamedImports();
    } else if (this.current().type === TokenType.Identifier) {
      // import name from 'module'  OR  import name, { a, b } from 'module'
      defaultImport = this.expect(TokenType.Identifier).value;
      if (this.match(TokenType.Comma)) {
        named = this.parseNamedImports();
      }
    } else {
      const token = this.current();
      throw new DingError("parser", `Import syntax error`, {
        line: token.line,
        col: token.col,
        source: this.getSourceLine(token.line),
        hint: `Valid forms:\n       import { name } from 'module'\n       import name from 'module'\n       import * as name from 'module'`,
      });
    }

    this.expect(TokenType.From);
    const source = this.expect(TokenType.String).value;
    this.skipSemicolons();

    return { type: "ImportDeclaration", default: defaultImport, named, namespace, source };
  }

  private parseNamedImports(): string[] {
    this.expect(TokenType.LeftBrace);
    const names: string[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      names.push(this.expect(TokenType.Identifier).value);
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBrace);
    return names;
  }

  private parseReturnStatement(): ReturnStatement {
    this.expect(TokenType.Return);

    const next = this.current().type;
    if (
      next === TokenType.RightBrace ||
      next === TokenType.EOF ||
      next === TokenType.Semicolon
    ) {
      this.skipSemicolons();
      return { type: "ReturnStatement", value: null };
    }

    const value = this.parseExpression();
    this.skipSemicolons();
    return { type: "ReturnStatement", value };
  }

  private parseIfStatement(): IfStatement {
    this.expect(TokenType.If);
    this.expect(TokenType.LeftParen);
    const test = this.parseExpression();
    this.expect(TokenType.RightParen);
    const consequent = this.parseBlock();

    let alternate: Statement[] | null = null;
    if (this.match(TokenType.Else)) {
      if (this.current().type === TokenType.If) {
        alternate = [this.parseIfStatement()];
      } else {
        alternate = this.parseBlock();
      }
    }

    return { type: "IfStatement", test, consequent, alternate };
  }

  private parseForStatement(): ForRangeStatement | ForInStatement {
    this.expect(TokenType.For);
    const identifier = this.expect(TokenType.Identifier).value;

    // for identifier '=' start '..' end block  →  ForRangeStatement
    if (this.current().type === TokenType.Equals) {
      this.advance();
      const start = this.parseExpression();
      this.expect(TokenType.DotDot);
      const end = this.parseExpression();
      const body = this.parseBlock();
      return { type: "ForRangeStatement", identifier, start, end, body };
    }

    // for identifier 'in' iterable block  →  ForInStatement
    this.expect(TokenType.In);
    const iterable = this.parseExpression();
    const body = this.parseBlock();
    return { type: "ForInStatement", identifier, iterable, body };
  }

  private parseWhileStatement(): WhileStatement {
    this.expect(TokenType.While);
    // while supports both `while (cond)` and `while cond`
    const hasParen = this.match(TokenType.LeftParen);
    const condition = this.parseExpression();
    if (hasParen) this.expect(TokenType.RightParen);
    const body = this.parseBlock();
    return { type: "WhileStatement", condition, body };
  }

  private parseBreakStatement(): BreakStatement {
    this.expect(TokenType.Break);
    this.skipSemicolons();
    return { type: "BreakStatement" };
  }

  private parseContinueStatement(): ContinueStatement {
    this.expect(TokenType.Continue);
    this.skipSemicolons();
    return { type: "ContinueStatement" };
  }

  private parseStructDeclaration(): StructDeclaration {
    this.expect(TokenType.Struct);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LeftBrace);

    const fields: StructField[] = [];
    const methods: StructMethod[] = [];

    while (this.current().type !== TokenType.RightBrace) {
      this.skipSemicolons();
      if (this.current().type === TokenType.RightBrace) break;

      if (this.current().type === TokenType.Const) {
        // method: const name = (params) => body
        this.advance(); // consume const
        const methodName = this.expect(TokenType.Identifier).value;
        this.expect(TokenType.Equals);
        this.expect(TokenType.LeftParen);

        const params: Parameter[] = [];
        while (this.current().type !== TokenType.RightParen) {
          const pName = this.current().type === TokenType.Self
            ? this.advance().value
            : this.expect(TokenType.Identifier).value;
          let annotation: TypeAnnotation | undefined;
          if (this.match(TokenType.Colon)) {
            annotation = this.parseTypeAnnotation();
          }
          let defaultValue: Expression | undefined;
          if (this.match(TokenType.Equals)) {
            defaultValue = this.parseExpression();
          }
          params.push({ name: pName, annotation, defaultValue });
          if (!this.match(TokenType.Comma)) break;
        }
        this.expect(TokenType.RightParen);
        this.expect(TokenType.Arrow);

        let body: Statement[] | Expression;
        if (this.current().type === TokenType.LeftBrace) {
          body = this.parseBlock();
        } else {
          body = this.parseExpression();
        }

        methods.push({ name: methodName, params, body });
      } else {
        // field: name ':' type
        const fieldName = this.expect(TokenType.Identifier).value;
        this.expect(TokenType.Colon);
        const fieldType = this.parseTypeAnnotation().name;
        fields.push({ name: fieldName, fieldType });
      }

      // consume optional trailing comma or semicolon
      if (this.current().type === TokenType.Comma) this.advance();
      this.skipSemicolons();
    }

    this.expect(TokenType.RightBrace);
    return { type: "StructDeclaration", name, fields, methods };
  }

  private parseTryCatchStatement(): TryCatchStatement {
    this.expect(TokenType.Try);
    const body = this.parseBlock();

    this.expect(TokenType.Catch);
    this.expect(TokenType.LeftParen);
    const param = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.RightParen);
    const catchBlock = this.parseBlock();

    let finallyBlock: Statement[] | undefined;
    if (this.match(TokenType.Finally)) {
      finallyBlock = this.parseBlock();
    }

    return {
      type: "TryCatchStatement",
      body,
      param,
      catch: catchBlock,
      finally: finallyBlock,
    };
  }

  private parseThrowStatement(): ThrowStatement {
    this.expect(TokenType.Throw);
    const value = this.parseExpression();
    this.skipSemicolons();
    return { type: "ThrowStatement", value };
  }

  private parseBlock(): Statement[] {
    this.expect(TokenType.LeftBrace);
    const statements: Statement[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      this.skipSemicolons();
      if (this.current().type === TokenType.RightBrace) break;
      statements.push(this.parseStatement());
    }
    this.expect(TokenType.RightBrace);
    return statements;
  }

  private parseExpressionStatement(): ExpressionStatement {
    const expression = this.parseExpression();
    this.skipSemicolons();
    return { type: "ExpressionStatement", expression };
  }

  // ── Type annotations ───────────────────────────────────────────────

  private parseTypeAnnotation(): TypeAnnotation {
    const name = this.expect(TokenType.Identifier).value;
    // Support array type syntax like string[]
    if (this.current().type === TokenType.LeftBracket && this.peek(1).type === TokenType.RightBracket) {
      this.advance(); // [
      this.advance(); // ]
      return { type: "TypeAnnotation", name: name + "[]" };
    }
    return { type: "TypeAnnotation", name };
  }

  // ── Expressions (precedence climbing) ──────────────────────────────
  //
  // Precedence (low → high):
  //  1. Assignment  (= += -= *= /= %=)
  //  2. Pipe        (|>)
  //  3. Logical OR  (||)
  //  4. Logical AND (&&)
  //  5. Nullish     (??)
  //  6. Equality    (== !=)
  //  7. Comparison  (< > <= >=)
  //  8. Bitwise OR  (|)
  //  9. Bitwise XOR (^)
  // 10. Bitwise AND (&)
  // 11. Shift       (<< >>)
  // 12. Additive    (+ -)
  // 13. Multiplicative (* / %)
  // 14. Exponentiation (**)  — right-associative
  // 15. Unary       (! - # ~)
  // 16. Postfix     (? !)
  // 17. Call/Member  (f() . ?. [])
  // 18. Primary     (literals, identifiers, parens, arrays, match)

  parseExpression(): Expression {
    return this.parseAssignment();
  }

  private parseAssignment(): Expression {
    const expr = this.parsePipe();

    // Compound assignment: desugar x += y into x = x + y
    const compoundOps: Record<string, string> = {
      [TokenType.PlusEquals]: "+",
      [TokenType.MinusEquals]: "-",
      [TokenType.StarEquals]: "*",
      [TokenType.SlashEquals]: "/",
      [TokenType.PercentEquals]: "%",
    };
    const compoundOp = compoundOps[this.current().type];
    if (compoundOp) {
      this.advance();
      const right = this.parseAssignment();
      const value = { type: "BinaryExpression", operator: compoundOp, left: expr, right } as Expression;
      return { type: "AssignmentExpression", target: expr, value } as AssignmentExpression;
    }

    if (this.current().type === TokenType.Equals) {
      // Make sure it's not == or =>
      if (this.peek(1).type !== TokenType.Equals && this.peek(0).value === "=") {
        this.advance(); // consume =
        const value = this.parseAssignment(); // right-associative
        return { type: "AssignmentExpression", target: expr, value } as AssignmentExpression;
      }
    }

    return expr;
  }

  private parsePipe(): Expression {
    let left = this.parseOr();
    while (this.current().type === TokenType.PipeGreater) {
      this.advance(); // consume |>
      const right = this.parseOr();
      // Desugar: a |> f(b) → f(a, b), a |> f → f(a)
      if (right.type === "CallExpression") {
        right.arguments.unshift(left);
        left = right;
      } else {
        left = { type: "CallExpression", callee: right, arguments: [left] } as CallExpression;
      }
    }
    return left;
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.current().type === TokenType.Or) {
      const operator = this.advance().value;
      const right = this.parseAnd();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNullish();
    while (this.current().type === TokenType.And) {
      const operator = this.advance().value;
      const right = this.parseNullish();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseNullish(): Expression {
    let left = this.parseEquality();
    while (this.current().type === TokenType.QuestionQuestion) {
      this.advance();
      const right = this.parseEquality();
      left = { type: "NullishCoalescing", left, right } as NullishCoalescing;
    }
    return left;
  }

  private parseEquality(): Expression {
    let left = this.parseComparison();
    while (
      this.current().type === TokenType.DoubleEquals ||
      this.current().type === TokenType.NotEquals
    ) {
      const operator = this.advance().value;
      const right = this.parseComparison();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseBitwiseOr();
    while (
      this.current().type === TokenType.LessThan ||
      this.current().type === TokenType.LessThanEquals ||
      this.current().type === TokenType.GreaterThan ||
      this.current().type === TokenType.GreaterThanEquals
    ) {
      const operator = this.advance().value;
      const right = this.parseBitwiseOr();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseBitwiseOr(): Expression {
    let left = this.parseBitwiseXor();
    while (this.current().type === TokenType.Pipe) {
      const operator = this.advance().value;
      const right = this.parseBitwiseXor();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseBitwiseXor(): Expression {
    let left = this.parseBitwiseAnd();
    while (this.current().type === TokenType.Caret) {
      const operator = this.advance().value;
      const right = this.parseBitwiseAnd();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseBitwiseAnd(): Expression {
    let left = this.parseShift();
    while (this.current().type === TokenType.Ampersand) {
      const operator = this.advance().value;
      const right = this.parseShift();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseShift(): Expression {
    let left = this.parseAdditive();
    while (
      this.current().type === TokenType.LeftShift ||
      this.current().type === TokenType.RightShift
    ) {
      const operator = this.advance().value;
      const right = this.parseAdditive();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();
    while (
      this.current().type === TokenType.Plus ||
      this.current().type === TokenType.Minus
    ) {
      const operator = this.advance().value;
      const right = this.parseMultiplicative();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseExponentiation();
    while (
      this.current().type === TokenType.Star ||
      this.current().type === TokenType.Slash ||
      this.current().type === TokenType.Percent
    ) {
      const operator = this.advance().value;
      const right = this.parseExponentiation();
      left = { type: "BinaryExpression", operator, left, right };
    }
    return left;
  }

  private parseExponentiation(): Expression {
    const left = this.parseUnary();
    if (this.current().type === TokenType.StarStar) {
      this.advance();
      const right = this.parseExponentiation(); // right-associative
      return { type: "BinaryExpression", operator: "**", left, right };
    }
    return left;
  }

  private parseUnary(): Expression {
    // # prefix (length)
    if (this.current().type === TokenType.Hash) {
      this.advance();
      const target = this.parsePostfix();
      return { type: "LengthExpression", target } as LengthExpression;
    }
    // ~ prefix (bitwise NOT)
    if (this.current().type === TokenType.Tilde) {
      const operator = this.advance().value;
      const operand = this.parseUnary();
      return { type: "UnaryExpression", operator, operand } as UnaryExpression;
    }
    // Unary minus
    if (this.current().type === TokenType.Minus) {
      const operator = this.advance().value;
      const operand = this.parseUnary();
      return { type: "UnaryExpression", operator, operand } as UnaryExpression;
    }
    // Logical NOT
    if (this.current().type === TokenType.Bang) {
      // Only treat as unary NOT if not followed by = (which is !=, already handled)
      const operator = this.advance().value;
      const operand = this.parseUnary();
      return { type: "UnaryExpression", operator, operand } as UnaryExpression;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parseCallMember();

    // Postfix ? (error propagation) — only if not followed by . or ?
    if (this.current().type === TokenType.QuestionMark) {
      this.advance();
      expr = { type: "ErrorPropagation", expression: expr } as ErrorPropagation;
    }

    // Postfix ! (null assertion)
    if (this.current().type === TokenType.Bang) {
      this.advance();
      expr = { type: "NullAssertion", expression: expr } as NullAssertion;
    }

    return expr;
  }

  private parseCallMember(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.current().type === TokenType.LeftParen) {
        // Function call
        this.advance();
        const args: Expression[] = [];
        while (this.current().type !== TokenType.RightParen) {
          args.push(this.parseExpression());
          if (!this.match(TokenType.Comma)) break;
        }
        this.expect(TokenType.RightParen);
        expr = { type: "CallExpression", callee: expr, arguments: args } as CallExpression;
      } else if (this.current().type === TokenType.Dot) {
        // Member access: expr.property
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = { type: "MemberExpression", object: expr, property, optional: false } as MemberExpression;
      } else if (this.current().type === TokenType.QuestionDot) {
        // Optional chain: expr?.property
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = { type: "MemberExpression", object: expr, property, optional: true } as MemberExpression;
      } else if (this.current().type === TokenType.LeftBracket) {
        // Array access: expr[index]
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RightBracket);
        expr = { type: "ArrayAccess", array: expr, index } as ArrayAccess;
      } else {
        break;
      }
    }

    return expr;
  }

  // ── Primary expressions ────────────────────────────────────────────

  private parsePrimary(): Expression {
    const token = this.current();

    switch (token.type) {
      case TokenType.Number:
        this.advance();
        return { type: "NumberLiteral", value: Number(token.value) };

      case TokenType.String:
        this.advance();
        if (token.value.includes("${")) {
          return this.parseTemplateParts(token.value);
        }
        return { type: "StringLiteral", value: token.value };

      case TokenType.True:
        this.advance();
        return { type: "BooleanLiteral", value: true };

      case TokenType.False:
        this.advance();
        return { type: "BooleanLiteral", value: false };

      case TokenType.Null:
        this.advance();
        return { type: "NullLiteral" };

      case TokenType.Identifier: {
        // Map literal: Map { "key": value, ... }
        if (token.value === "Map" && this.peek(1).type === TokenType.LeftBrace) {
          // Distinguish from struct named Map: if next-next is } or string literal, it's a map
          const afterBrace = this.peek(2);
          if (
            afterBrace.type === TokenType.RightBrace ||
            afterBrace.type === TokenType.String
          ) {
            return this.parseMapLiteral();
          }
        }
        // Check if this is a struct instantiation: Identifier '{' ...
        // Heuristic: uppercase first letter + followed by {
        if (
          token.value[0] >= "A" && token.value[0] <= "Z" &&
          this.peek(1).type === TokenType.LeftBrace
        ) {
          return this.parseStructInstantiation();
        }
        this.advance();
        return { type: "Identifier", name: token.value };
      }

      case TokenType.Self:
        this.advance();
        return { type: "Identifier", name: "self" };

      case TokenType.LeftParen:
        return this.parseParenOrArrow();

      case TokenType.LeftBracket:
        return this.parseArrayLiteral();

      case TokenType.Match:
        return this.parseMatchExpression();

      default:
        throw new DingError("parser", `Unexpected token ${token.type} ("${token.value}")`, {
          line: token.line,
          col: token.col,
          source: this.getSourceLine(token.line),
          hint: "Expected an expression (literal, identifier, or parenthesized expression)",
        });
    }
  }

  // ── Array literal ──────────────────────────────────────────────────

  private parseArrayLiteral(): ArrayLiteral {
    this.expect(TokenType.LeftBracket);
    const elements: (Expression | SpreadElement)[] = [];
    while (this.current().type !== TokenType.RightBracket) {
      if (this.current().type === TokenType.DotDotDot) {
        this.advance(); // consume ...
        const argument = this.parseExpression();
        elements.push({ type: "SpreadElement", argument } as SpreadElement);
      } else {
        elements.push(this.parseExpression());
      }
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBracket);
    return { type: "ArrayLiteral", elements };
  }

  // ── Map literal ────────────────────────────────────────────────────

  private parseMapLiteral(): MapLiteral {
    this.expect(TokenType.Identifier); // consume "Map"
    this.expect(TokenType.LeftBrace);
    const entries: { key: Expression; value: Expression }[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      const key = this.parseExpression();
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      entries.push({ key, value });
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBrace);
    return { type: "MapLiteral", entries };
  }

  // ── Struct instantiation ───────────────────────────────────────────

  private parseStructInstantiation(): StructInstantiation {
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LeftBrace);

    const fields: { name: string; value: Expression }[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      const fieldName = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      fields.push({ name: fieldName, value });
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBrace);

    return { type: "StructInstantiation", name, fields };
  }

  // ── Arrow functions / parenthesized expressions ────────────────────

  private parseParenOrArrow(): Expression {
    if (this.isArrowFunction()) {
      return this.parseArrowFunction();
    }

    this.advance(); // skip (
    const expr = this.parseExpression();
    this.expect(TokenType.RightParen);
    return expr;
  }

  private isArrowFunction(): boolean {
    let depth = 0;
    let i = this.pos;
    while (i < this.tokens.length) {
      const t = this.tokens[i];
      if (t.type === TokenType.LeftParen) depth++;
      else if (t.type === TokenType.RightParen) {
        depth--;
        if (depth === 0) {
          return (
            i + 1 < this.tokens.length &&
            this.tokens[i + 1].type === TokenType.Arrow
          );
        }
      }
      i++;
    }
    return false;
  }

  private parseArrowFunction(): ArrowFunction {
    this.expect(TokenType.LeftParen);
    const params: Parameter[] = [];

    while (this.current().type !== TokenType.RightParen) {
      const pName = this.current().type === TokenType.Self
        ? this.advance().value
        : this.expect(TokenType.Identifier).value;
      let annotation: TypeAnnotation | undefined;
      if (this.match(TokenType.Colon)) {
        annotation = this.parseTypeAnnotation();
      }
      let defaultValue: Expression | undefined;
      if (this.match(TokenType.Equals)) {
        defaultValue = this.parseExpression();
      }
      params.push({ name: pName, annotation, defaultValue });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightParen);
    this.expect(TokenType.Arrow);

    let body: Statement[] | Expression;
    if (this.current().type === TokenType.LeftBrace) {
      body = this.parseBlock();
    } else {
      body = this.parseExpression();
    }

    return { type: "ArrowFunction", params, body };
  }

  // ── Enum declaration ────────────────────────────────────────────────

  private parseEnumDeclaration(): EnumDeclaration {
    this.expect(TokenType.Enum);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LeftBrace);

    const members: { name: string; value?: Expression }[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      this.skipSemicolons();
      if (this.current().type === TokenType.RightBrace) break;
      const memberName = this.expect(TokenType.Identifier).value;
      let value: Expression | undefined;
      if (this.match(TokenType.Equals)) {
        value = this.parseExpression();
      }
      members.push({ name: memberName, value });
      if (this.current().type === TokenType.Comma) this.advance();
      this.skipSemicolons();
    }

    this.expect(TokenType.RightBrace);
    return { type: "EnumDeclaration", name, members };
  }

  // ── Match statement / expression ──────────────────────────────────

  private parseMatchStatement(): MatchStatement {
    const { subject, arms } = this.parseMatchCommon();
    return { type: "MatchStatement", subject, arms };
  }

  private parseMatchExpression(): MatchExpression {
    const { subject, arms } = this.parseMatchCommon();
    return { type: "MatchExpression", subject, arms };
  }

  private parseMatchCommon(): { subject: Expression; arms: MatchArm[] } {
    this.expect(TokenType.Match);
    this.expect(TokenType.LeftParen);
    const subject = this.parseExpression();
    this.expect(TokenType.RightParen);
    this.expect(TokenType.LeftBrace);

    const arms: MatchArm[] = [];
    while (this.current().type !== TokenType.RightBrace) {
      this.skipSemicolons();
      if (this.current().type === TokenType.RightBrace) break;

      // Parse pattern
      let pattern: MatchPattern;
      if (this.current().type === TokenType.Identifier && this.current().value === "_") {
        this.advance();
        pattern = { kind: "wildcard" };
      } else {
        const value = this.parseExpression();
        // Check for range pattern: expr..expr
        if (this.current().type === TokenType.DotDot) {
          this.advance();
          const end = this.parseExpression();
          pattern = { kind: "range", start: value, end };
        } else {
          pattern = { kind: "literal", value };
        }
      }

      this.expect(TokenType.Arrow);

      // Parse body: block or single expression
      let body: Statement[] | Expression;
      if (this.current().type === TokenType.LeftBrace) {
        body = this.parseBlock();
      } else {
        body = this.parseExpression();
      }

      arms.push({ pattern, body });

      if (this.current().type === TokenType.Comma) this.advance();
      this.skipSemicolons();
    }

    this.expect(TokenType.RightBrace);
    return { subject, arms };
  }

  // ── Template literal re-parsing ────────────────────────────────────

  private parseTemplateParts(raw: string): TemplateLiteral {
    const parts: (string | Expression)[] = [];
    let i = 0;
    let text = "";

    while (i < raw.length) {
      if (raw[i] === "$" && i + 1 < raw.length && raw[i + 1] === "{") {
        parts.push(text);
        text = "";
        i += 2;

        let exprStr = "";
        let depth = 1;
        while (i < raw.length && depth > 0) {
          if (raw[i] === "{") depth++;
          else if (raw[i] === "}") {
            depth--;
            if (depth === 0) break;
          }
          exprStr += raw[i];
          i++;
        }
        i++; // skip closing }

        const exprTokens = new Lexer(exprStr).tokenize();
        const subParser = new Parser(exprTokens);
        parts.push(subParser.parseExpression());
      } else {
        text += raw[i];
        i++;
      }
    }

    parts.push(text);

    return { type: "TemplateLiteral", parts };
  }
}
