import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lexer/index.js";
import { Parser } from "../src/parser/index.js";
import { DingError } from "../src/errors/index.js";
import type {
  Program,
  VariableDeclaration,
  ImportDeclaration,
  ReturnStatement,
  IfStatement,
  ExpressionStatement,
  NumberLiteral,
  StringLiteral,
  BooleanLiteral,
  NullLiteral,
  Identifier,
  BinaryExpression,
  ArrowFunction,
  CallExpression,
  TemplateLiteral,
  ForRangeStatement,
  ForInStatement,
  WhileStatement,
  BreakStatement,
  ContinueStatement,
  StructDeclaration,
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
} from "../src/ast/index.js";

function parse(source: string): Program {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

// ── Variable declarations ────────────────────────────────────────────

describe("Parser", () => {
  describe("variable declarations", () => {
    it("should parse const with number", () => {
      const ast = parse("const x = 5");
      expect(ast.body).toHaveLength(1);
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.kind).toBe("const");
      expect(decl.name).toBe("x");
      expect(decl.init).toEqual({ type: "NumberLiteral", value: 5 });
    });

    it("should parse let with string", () => {
      const ast = parse('let name = "Dallas"');
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.kind).toBe("let");
      expect(decl.name).toBe("name");
      expect(decl.init).toEqual({ type: "StringLiteral", value: "Dallas" });
    });

    it("should parse const with type annotation", () => {
      const ast = parse("const health: number = 100");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.annotation).toEqual({ type: "TypeAnnotation", name: "number" });
      expect(decl.init).toEqual({ type: "NumberLiteral", value: 100 });
    });

    it("should parse const with boolean true", () => {
      const ast = parse("const alive = true");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.init).toEqual({ type: "BooleanLiteral", value: true });
    });

    it("should parse const with boolean false", () => {
      const ast = parse("const dead = false");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.init).toEqual({ type: "BooleanLiteral", value: false });
    });

    it("should parse const with null", () => {
      const ast = parse("const nothing = null");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.init).toEqual({ type: "NullLiteral" });
    });

    it("should handle optional semicolons", () => {
      const ast = parse("const a = 1; const b = 2");
      expect(ast.body).toHaveLength(2);
    });
  });

  // ── Literals ─────────────────────────────────────────────────────────

  describe("literals", () => {
    it("should parse number literals in expressions", () => {
      const ast = parse("const x = 3.14");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.init).toEqual({ type: "NumberLiteral", value: 3.14 });
    });

    it("should parse string literals", () => {
      const ast = parse('const s = "hello world"');
      const decl = ast.body[0] as VariableDeclaration;
      expect((decl.init as StringLiteral).value).toBe("hello world");
    });

    it("should parse template literals with interpolation", () => {
      const ast = parse("const msg = `hello ${name}`");
      const decl = ast.body[0] as VariableDeclaration;
      const tmpl = decl.init as TemplateLiteral;
      expect(tmpl.type).toBe("TemplateLiteral");
      expect(tmpl.parts).toHaveLength(3);
      expect(tmpl.parts[0]).toBe("hello ");
      expect(tmpl.parts[1]).toEqual({ type: "Identifier", name: "name" });
      expect(tmpl.parts[2]).toBe("");
    });

    it("should parse template literal with multiple interpolations", () => {
      const ast = parse("const msg = `${a} and ${b}`");
      const tmpl = (ast.body[0] as VariableDeclaration).init as TemplateLiteral;
      expect(tmpl.parts).toHaveLength(5);
      expect(tmpl.parts[0]).toBe("");
      expect((tmpl.parts[1] as Identifier).name).toBe("a");
      expect(tmpl.parts[2]).toBe(" and ");
      expect((tmpl.parts[3] as Identifier).name).toBe("b");
      expect(tmpl.parts[4]).toBe("");
    });
  });

  // ── Binary expressions ───────────────────────────────────────────────

  describe("binary expressions", () => {
    it("should parse addition", () => {
      const ast = parse("const r = x + y");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.type).toBe("BinaryExpression");
      expect(expr.operator).toBe("+");
      expect(expr.left).toEqual({ type: "Identifier", name: "x" });
      expect(expr.right).toEqual({ type: "Identifier", name: "y" });
    });

    it("should parse subtraction", () => {
      const ast = parse("const r = a - b");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe("-");
    });

    it("should respect multiplication precedence over addition", () => {
      // x + y * z  →  x + (y * z)
      const ast = parse("const r = x + y * z");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe("+");
      expect(expr.left).toEqual({ type: "Identifier", name: "x" });
      const right = expr.right as BinaryExpression;
      expect(right.operator).toBe("*");
      expect(right.left).toEqual({ type: "Identifier", name: "y" });
      expect(right.right).toEqual({ type: "Identifier", name: "z" });
    });

    it("should parse comparison operators", () => {
      const ast = parse("const r = x > 0");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe(">");
      expect(expr.right).toEqual({ type: "NumberLiteral", value: 0 });
    });

    it("should parse equality operators", () => {
      const ast = parse("const r = x == y");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe("==");
    });

    it("should parse inequality", () => {
      const ast = parse("const r = x != y");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe("!=");
    });

    it("should parse <= and >=", () => {
      const a = parse("const r = x <= y");
      expect(((a.body[0] as VariableDeclaration).init as BinaryExpression).operator).toBe("<=");
      const b = parse("const r = x >= y");
      expect(((b.body[0] as VariableDeclaration).init as BinaryExpression).operator).toBe(">=");
    });

    it("should left-associate same-precedence operators", () => {
      // a + b + c  →  (a + b) + c
      const ast = parse("const r = a + b + c");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe("+");
      expect((expr.left as BinaryExpression).operator).toBe("+");
      expect(expr.right).toEqual({ type: "Identifier", name: "c" });
    });

    it("should parse parenthesized expressions", () => {
      // (a + b) * c
      const ast = parse("const r = (a + b) * c");
      const expr = (ast.body[0] as VariableDeclaration).init as BinaryExpression;
      expect(expr.operator).toBe("*");
      expect((expr.left as BinaryExpression).operator).toBe("+");
    });
  });

  // ── Arrow functions ──────────────────────────────────────────────────

  describe("arrow functions", () => {
    it("should parse expression-body arrow function", () => {
      const ast = parse("const add = (x, y) => x + y");
      const decl = ast.body[0] as VariableDeclaration;
      const fn = decl.init as ArrowFunction;
      expect(fn.type).toBe("ArrowFunction");
      expect(fn.params).toEqual([{ name: "x" }, { name: "y" }]);
      expect((fn.body as BinaryExpression).operator).toBe("+");
    });

    it("should parse block-body arrow function", () => {
      const ast = parse("const fn = (x) => { return x * 2 }");
      const fn = (ast.body[0] as VariableDeclaration).init as ArrowFunction;
      expect(fn.params).toEqual([{ name: "x" }]);
      expect(Array.isArray(fn.body)).toBe(true);
      const body = fn.body as ReturnStatement[];
      expect(body).toHaveLength(1);
      expect(body[0].type).toBe("ReturnStatement");
    });

    it("should parse arrow function with typed parameters", () => {
      const ast = parse("const add = (a: number, b: number) => a + b");
      const fn = (ast.body[0] as VariableDeclaration).init as ArrowFunction;
      expect(fn.params).toEqual([
        { name: "a", annotation: { type: "TypeAnnotation", name: "number" } },
        { name: "b", annotation: { type: "TypeAnnotation", name: "number" } },
      ]);
    });

    it("should parse arrow function with no parameters", () => {
      const ast = parse("const noop = () => null");
      const fn = (ast.body[0] as VariableDeclaration).init as ArrowFunction;
      expect(fn.params).toEqual([]);
      expect(fn.body).toEqual({ type: "NullLiteral" });
    });
  });

  // ── If/else ──────────────────────────────────────────────────────────

  describe("if/else statements", () => {
    it("should parse if without else", () => {
      const ast = parse("if (x > 0) { return x }");
      const stmt = ast.body[0] as IfStatement;
      expect(stmt.type).toBe("IfStatement");
      expect((stmt.test as BinaryExpression).operator).toBe(">");
      expect(stmt.consequent).toHaveLength(1);
      expect(stmt.alternate).toBeNull();
    });

    it("should parse if/else", () => {
      const ast = parse('if (ok) { return "yes" } else { return "no" }');
      const stmt = ast.body[0] as IfStatement;
      expect(stmt.consequent).toHaveLength(1);
      expect(stmt.alternate).toHaveLength(1);
    });

    it("should parse else-if chains", () => {
      const ast = parse("if (a) { return 1 } else if (b) { return 2 } else { return 3 }");
      const stmt = ast.body[0] as IfStatement;
      expect(stmt.alternate).toHaveLength(1);
      const elseIf = stmt.alternate![0] as IfStatement;
      expect(elseIf.type).toBe("IfStatement");
      expect(elseIf.alternate).toHaveLength(1);
    });
  });

  // ── Return statements ────────────────────────────────────────────────

  describe("return statements", () => {
    it("should parse return with expression", () => {
      const ast = parse("const fn = () => { return 42 }");
      const fn = (ast.body[0] as VariableDeclaration).init as ArrowFunction;
      const ret = (fn.body as ReturnStatement[])[0];
      expect(ret.type).toBe("ReturnStatement");
      expect(ret.value).toEqual({ type: "NumberLiteral", value: 42 });
    });

    it("should parse return null", () => {
      const ast = parse("const fn = () => { return null }");
      const fn = (ast.body[0] as VariableDeclaration).init as ArrowFunction;
      const ret = (fn.body as ReturnStatement[])[0];
      expect(ret.value).toEqual({ type: "NullLiteral" });
    });
  });

  // ── Import declarations ──────────────────────────────────────────────

  describe("import declarations", () => {
    it("should parse named import", () => {
      const ast = parse("import { log } from 'ding:std'");
      const imp = ast.body[0] as ImportDeclaration;
      expect(imp.type).toBe("ImportDeclaration");
      expect(imp.named).toEqual(["log"]);
      expect(imp.source).toBe("ding:std");
    });

    it("should parse multiple named imports", () => {
      const ast = parse("import { parse, compile } from './compiler'");
      const imp = ast.body[0] as ImportDeclaration;
      expect(imp.named).toEqual(["parse", "compile"]);
      expect(imp.source).toBe("./compiler");
    });

    it("should parse default import", () => {
      const ast = parse("import log from 'ding:std'");
      const imp = ast.body[0] as ImportDeclaration;
      expect(imp.type).toBe("ImportDeclaration");
      expect(imp.default).toBe("log");
      expect(imp.named).toEqual([]);
      expect(imp.namespace).toBeUndefined();
      expect(imp.source).toBe("ding:std");
    });

    it("should parse namespace import", () => {
      const ast = parse("import * as std from 'ding:std'");
      const imp = ast.body[0] as ImportDeclaration;
      expect(imp.type).toBe("ImportDeclaration");
      expect(imp.namespace).toBe("std");
      expect(imp.named).toEqual([]);
      expect(imp.default).toBeUndefined();
      expect(imp.source).toBe("ding:std");
    });

    it("should parse mixed default + named import", () => {
      const ast = parse("import fs, { readFile, writeFile } from 'ding:fs'");
      const imp = ast.body[0] as ImportDeclaration;
      expect(imp.default).toBe("fs");
      expect(imp.named).toEqual(["readFile", "writeFile"]);
      expect(imp.source).toBe("ding:fs");
    });
  });

  // ── Call expressions ─────────────────────────────────────────────────

  describe("call expressions", () => {
    it("should parse function call with no args", () => {
      const ast = parse("const r = foo()");
      const call = (ast.body[0] as VariableDeclaration).init as CallExpression;
      expect(call.type).toBe("CallExpression");
      expect((call.callee as Identifier).name).toBe("foo");
      expect(call.arguments).toEqual([]);
    });

    it("should parse function call with arguments", () => {
      const ast = parse("const r = add(1, 2)");
      const call = (ast.body[0] as VariableDeclaration).init as CallExpression;
      expect(call.arguments).toHaveLength(2);
      expect(call.arguments[0]).toEqual({ type: "NumberLiteral", value: 1 });
      expect(call.arguments[1]).toEqual({ type: "NumberLiteral", value: 2 });
    });

    it("should parse nested calls", () => {
      const ast = parse("const r = a(b())");
      const outer = (ast.body[0] as VariableDeclaration).init as CallExpression;
      expect(outer.type).toBe("CallExpression");
      const inner = outer.arguments[0] as CallExpression;
      expect(inner.type).toBe("CallExpression");
    });
  });

  // ── Error handling ───────────────────────────────────────────────────

  describe("errors", () => {
    it("should throw on unexpected token", () => {
      expect(() => parse("const = 5")).toThrow("Expected Identifier");
    });

    it("should throw on missing initializer", () => {
      expect(() => parse("const x")).toThrow();
    });

    it("should include position in error", () => {
      try {
        parse("const = 5");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(DingError);
        expect((e as DingError).line).toBeDefined();
        expect((e as DingError).col).toBeDefined();
      }
    });
  });

  // ── Full sample program ──────────────────────────────────────────────

  describe("full sample program", () => {
    const source = `
import { log } from 'ding:std'

const name = "Dallas"
const health: number = 100

const getStatus = (h) => {
  if (h > 0) {
    return \`\${name} is alive with \${h} health\`
  }
  return null
}

const status = getStatus(health)
`;

    it("should parse the entire program into 5 top-level statements", () => {
      const ast = parse(source);
      expect(ast.type).toBe("Program");
      expect(ast.body).toHaveLength(5);
    });

    it("should parse the import declaration", () => {
      const ast = parse(source);
      const imp = ast.body[0] as ImportDeclaration;
      expect(imp.type).toBe("ImportDeclaration");
      expect(imp.named).toEqual(["log"]);
      expect(imp.source).toBe("ding:std");
    });

    it("should parse the name declaration", () => {
      const ast = parse(source);
      const decl = ast.body[1] as VariableDeclaration;
      expect(decl.kind).toBe("const");
      expect(decl.name).toBe("name");
      expect(decl.init).toEqual({ type: "StringLiteral", value: "Dallas" });
    });

    it("should parse the typed health declaration", () => {
      const ast = parse(source);
      const decl = ast.body[2] as VariableDeclaration;
      expect(decl.name).toBe("health");
      expect(decl.annotation).toEqual({ type: "TypeAnnotation", name: "number" });
      expect(decl.init).toEqual({ type: "NumberLiteral", value: 100 });
    });

    it("should parse getStatus as an arrow function with block body", () => {
      const ast = parse(source);
      const decl = ast.body[3] as VariableDeclaration;
      expect(decl.name).toBe("getStatus");
      const fn = decl.init as ArrowFunction;
      expect(fn.type).toBe("ArrowFunction");
      expect(fn.params).toEqual([{ name: "h" }]);
      expect(Array.isArray(fn.body)).toBe(true);
      expect((fn.body as any[]).length).toBe(2); // if + return null
    });

    it("should parse the if statement inside getStatus", () => {
      const ast = parse(source);
      const fn = (ast.body[3] as VariableDeclaration).init as ArrowFunction;
      const ifStmt = (fn.body as IfStatement[])[0] as IfStatement;
      expect(ifStmt.type).toBe("IfStatement");

      const test = ifStmt.test as BinaryExpression;
      expect(test.operator).toBe(">");
      expect((test.left as Identifier).name).toBe("h");
      expect((test.right as NumberLiteral).value).toBe(0);

      expect(ifStmt.consequent).toHaveLength(1);
      expect(ifStmt.alternate).toBeNull();
    });

    it("should parse the template literal return", () => {
      const ast = parse(source);
      const fn = (ast.body[3] as VariableDeclaration).init as ArrowFunction;
      const ifStmt = (fn.body as IfStatement[])[0] as IfStatement;
      const ret = ifStmt.consequent[0] as ReturnStatement;
      expect(ret.type).toBe("ReturnStatement");

      const tmpl = ret.value as TemplateLiteral;
      expect(tmpl.type).toBe("TemplateLiteral");
      expect(tmpl.parts).toHaveLength(5);
      expect(tmpl.parts[0]).toBe("");
      expect((tmpl.parts[1] as Identifier).name).toBe("name");
      expect(tmpl.parts[2]).toBe(" is alive with ");
      expect((tmpl.parts[3] as Identifier).name).toBe("h");
      expect(tmpl.parts[4]).toBe(" health");
    });

    it("should parse the fallback return null", () => {
      const ast = parse(source);
      const fn = (ast.body[3] as VariableDeclaration).init as ArrowFunction;
      const ret = (fn.body as ReturnStatement[])[1] as ReturnStatement;
      expect(ret.type).toBe("ReturnStatement");
      expect(ret.value).toEqual({ type: "NullLiteral" });
    });

    it("should parse the status = getStatus(health) call", () => {
      const ast = parse(source);
      const decl = ast.body[4] as VariableDeclaration;
      expect(decl.name).toBe("status");
      const call = decl.init as CallExpression;
      expect(call.type).toBe("CallExpression");
      expect((call.callee as Identifier).name).toBe("getStatus");
      expect(call.arguments).toHaveLength(1);
      expect((call.arguments[0] as Identifier).name).toBe("health");
    });
  });

  // ── For range loops ───────────────────────────────────────────────

  describe("for range loops", () => {
    it("should parse for range with numeric bounds", () => {
      const ast = parse("for i = 0..5 { i }");
      const stmt = ast.body[0] as ForRangeStatement;
      expect(stmt.type).toBe("ForRangeStatement");
      expect(stmt.identifier).toBe("i");
      expect(stmt.start).toEqual({ type: "NumberLiteral", value: 0 });
      expect(stmt.end).toEqual({ type: "NumberLiteral", value: 5 });
      expect(stmt.body).toHaveLength(1);
    });

    it("should parse for range with non-zero start", () => {
      const ast = parse("for i = 2..10 { i }");
      const stmt = ast.body[0] as ForRangeStatement;
      expect(stmt.start).toEqual({ type: "NumberLiteral", value: 2 });
      expect(stmt.end).toEqual({ type: "NumberLiteral", value: 10 });
    });

    it("should parse break inside for range", () => {
      const ast = parse("for i = 0..5 { break }");
      const stmt = ast.body[0] as ForRangeStatement;
      expect(stmt.body[0]).toEqual({ type: "BreakStatement" });
    });

    it("should parse continue inside for range", () => {
      const ast = parse("for i = 0..5 { continue }");
      const stmt = ast.body[0] as ForRangeStatement;
      expect(stmt.body[0]).toEqual({ type: "ContinueStatement" });
    });
  });

  // ── For in loops ──────────────────────────────────────────────────

  describe("for in loops", () => {
    it("should parse for in statement", () => {
      const ast = parse("for item in items { item }");
      const stmt = ast.body[0] as ForInStatement;
      expect(stmt.type).toBe("ForInStatement");
      expect(stmt.identifier).toBe("item");
      expect(stmt.iterable).toEqual({ type: "Identifier", name: "items" });
      expect(stmt.body).toHaveLength(1);
    });

    it("should parse nested for loops", () => {
      const ast = parse("for x in xs { for y in ys { x } }");
      const outer = ast.body[0] as ForInStatement;
      expect(outer.body).toHaveLength(1);
      const inner = outer.body[0] as ForInStatement;
      expect(inner.type).toBe("ForInStatement");
      expect(inner.identifier).toBe("y");
    });
  });

  // ── While loops ───────────────────────────────────────────────────

  describe("while loops", () => {
    it("should parse while with parens", () => {
      const ast = parse("while (x > 0) { x }");
      const stmt = ast.body[0] as WhileStatement;
      expect(stmt.type).toBe("WhileStatement");
      expect((stmt.condition as BinaryExpression).operator).toBe(">");
      expect(stmt.body).toHaveLength(1);
    });

    it("should parse while with break", () => {
      const ast = parse("while (true) { break }");
      const stmt = ast.body[0] as WhileStatement;
      expect(stmt.body[0]).toEqual({ type: "BreakStatement" });
    });
  });

  // ── Arrays ────────────────────────────────────────────────────────

  describe("arrays", () => {
    it("should parse array literal", () => {
      const ast = parse("const a = [1, 2, 3]");
      const decl = ast.body[0] as VariableDeclaration;
      const arr = decl.init as ArrayLiteral;
      expect(arr.type).toBe("ArrayLiteral");
      expect(arr.elements).toHaveLength(3);
      expect(arr.elements[0]).toEqual({ type: "NumberLiteral", value: 1 });
    });

    it("should parse empty array", () => {
      const ast = parse("const a = []");
      const arr = (ast.body[0] as VariableDeclaration).init as ArrayLiteral;
      expect(arr.elements).toHaveLength(0);
    });

    it("should parse array access", () => {
      const ast = parse("const x = arr[0]");
      const access = (ast.body[0] as VariableDeclaration).init as ArrayAccess;
      expect(access.type).toBe("ArrayAccess");
      expect((access.array as Identifier).name).toBe("arr");
      expect(access.index).toEqual({ type: "NumberLiteral", value: 0 });
    });

    it("should parse length expression", () => {
      const ast = parse("const x = #arr");
      const len = (ast.body[0] as VariableDeclaration).init as LengthExpression;
      expect(len.type).toBe("LengthExpression");
      expect((len.target as Identifier).name).toBe("arr");
    });

    it("should parse nested array", () => {
      const ast = parse("const a = [[1, 2], [3, 4]]");
      const arr = (ast.body[0] as VariableDeclaration).init as ArrayLiteral;
      expect(arr.elements).toHaveLength(2);
      expect((arr.elements[0] as ArrayLiteral).type).toBe("ArrayLiteral");
    });
  });

  // ── Member access ─────────────────────────────────────────────────

  describe("member access", () => {
    it("should parse dot access", () => {
      const ast = parse("const x = obj.name");
      const member = (ast.body[0] as VariableDeclaration).init as MemberExpression;
      expect(member.type).toBe("MemberExpression");
      expect((member.object as Identifier).name).toBe("obj");
      expect(member.property).toBe("name");
      expect(member.optional).toBe(false);
    });

    it("should parse optional chain", () => {
      const ast = parse("const x = obj?.name");
      const member = (ast.body[0] as VariableDeclaration).init as MemberExpression;
      expect(member.optional).toBe(true);
    });

    it("should parse chained member access", () => {
      const ast = parse("const x = a.b.c");
      const outer = (ast.body[0] as VariableDeclaration).init as MemberExpression;
      expect(outer.property).toBe("c");
      const inner = outer.object as MemberExpression;
      expect(inner.property).toBe("b");
      expect((inner.object as Identifier).name).toBe("a");
    });
  });

  // ── Structs ───────────────────────────────────────────────────────

  describe("structs", () => {
    it("should parse struct declaration with fields", () => {
      const ast = parse("struct Point { x: number\n y: number }");
      const s = ast.body[0] as StructDeclaration;
      expect(s.type).toBe("StructDeclaration");
      expect(s.name).toBe("Point");
      expect(s.fields).toHaveLength(2);
      expect(s.fields[0]).toEqual({ name: "x", fieldType: "number" });
      expect(s.fields[1]).toEqual({ name: "y", fieldType: "number" });
    });

    it("should parse struct with method", () => {
      const ast = parse(`struct Dog {
  name: string
  const bark = (self) => {
    return self.name
  }
}`);
      const s = ast.body[0] as StructDeclaration;
      expect(s.fields).toHaveLength(1);
      expect(s.methods).toHaveLength(1);
      expect(s.methods[0].name).toBe("bark");
      expect(s.methods[0].params).toHaveLength(1);
      expect(s.methods[0].params[0].name).toBe("self");
    });

    it("should parse struct instantiation", () => {
      const ast = parse("const p = Point { x: 1, y: 2 }");
      const decl = ast.body[0] as VariableDeclaration;
      const inst = decl.init as StructInstantiation;
      expect(inst.type).toBe("StructInstantiation");
      expect(inst.name).toBe("Point");
      expect(inst.fields).toHaveLength(2);
      expect(inst.fields[0].name).toBe("x");
      expect(inst.fields[0].value).toEqual({ type: "NumberLiteral", value: 1 });
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe("try/catch/throw", () => {
    it("should parse try/catch", () => {
      const ast = parse("try { x } catch (e) { e }");
      const stmt = ast.body[0] as TryCatchStatement;
      expect(stmt.type).toBe("TryCatchStatement");
      expect(stmt.body).toHaveLength(1);
      expect(stmt.param).toBe("e");
      expect(stmt.catch).toHaveLength(1);
      expect(stmt.finally).toBeUndefined();
    });

    it("should parse try/catch/finally", () => {
      const ast = parse("try { x } catch (e) { e } finally { y }");
      const stmt = ast.body[0] as TryCatchStatement;
      expect(stmt.finally).toHaveLength(1);
    });

    it("should parse throw statement", () => {
      const ast = parse('throw "error"');
      const stmt = ast.body[0] as ThrowStatement;
      expect(stmt.type).toBe("ThrowStatement");
      expect(stmt.value).toEqual({ type: "StringLiteral", value: "error" });
    });

    it("should parse error propagation", () => {
      const ast = parse("const x = getValue()?");
      const decl = ast.body[0] as VariableDeclaration;
      const prop = decl.init as ErrorPropagation;
      expect(prop.type).toBe("ErrorPropagation");
      expect((prop.expression as CallExpression).type).toBe("CallExpression");
    });
  });

  // ── Null handling ─────────────────────────────────────────────────

  describe("null handling", () => {
    it("should parse nullish coalescing", () => {
      const ast = parse("const x = a ?? b");
      const nc = (ast.body[0] as VariableDeclaration).init as NullishCoalescing;
      expect(nc.type).toBe("NullishCoalescing");
      expect((nc.left as Identifier).name).toBe("a");
      expect((nc.right as Identifier).name).toBe("b");
    });

    it("should parse null assertion", () => {
      const ast = parse("const x = a!");
      const na = (ast.body[0] as VariableDeclaration).init as NullAssertion;
      expect(na.type).toBe("NullAssertion");
      expect((na.expression as Identifier).name).toBe("a");
    });
  });

  // ── Assignment ────────────────────────────────────────────────────

  describe("assignment", () => {
    it("should parse variable reassignment", () => {
      const ast = parse("x = 5");
      const stmt = ast.body[0] as ExpressionStatement;
      const assign = stmt.expression as AssignmentExpression;
      expect(assign.type).toBe("AssignmentExpression");
      expect((assign.target as Identifier).name).toBe("x");
      expect(assign.value).toEqual({ type: "NumberLiteral", value: 5 });
    });

    it("should parse member assignment", () => {
      const ast = parse("obj.x = 5");
      const stmt = ast.body[0] as ExpressionStatement;
      const assign = stmt.expression as AssignmentExpression;
      expect(assign.type).toBe("AssignmentExpression");
      expect((assign.target as MemberExpression).property).toBe("x");
    });

    it("should parse array index assignment", () => {
      const ast = parse("arr[0] = 5");
      const stmt = ast.body[0] as ExpressionStatement;
      const assign = stmt.expression as AssignmentExpression;
      expect(assign.type).toBe("AssignmentExpression");
      expect((assign.target as ArrayAccess).type).toBe("ArrayAccess");
    });
  });

  // ── Batch 3 ─────────────────────────────────────────────────────────

  describe("power operator", () => {
    it("should parse 2 ** 3 as BinaryExpression", () => {
      const ast = parse("const x = 2 ** 3");
      const decl = ast.body[0] as VariableDeclaration;
      const bin = decl.init as BinaryExpression;
      expect(bin.type).toBe("BinaryExpression");
      expect(bin.operator).toBe("**");
      expect((bin.left as NumberLiteral).value).toBe(2);
      expect((bin.right as NumberLiteral).value).toBe(3);
    });

    it("should parse ** as right-associative", () => {
      const ast = parse("const x = 2 ** 3 ** 2");
      const decl = ast.body[0] as VariableDeclaration;
      const outer = decl.init as BinaryExpression;
      expect(outer.operator).toBe("**");
      expect((outer.left as NumberLiteral).value).toBe(2);
      const inner = outer.right as BinaryExpression;
      expect(inner.operator).toBe("**");
      expect((inner.left as NumberLiteral).value).toBe(3);
      expect((inner.right as NumberLiteral).value).toBe(2);
    });

    it("** should bind tighter than *", () => {
      const ast = parse("const x = 2 ** 3 * 4");
      const decl = ast.body[0] as VariableDeclaration;
      const mul = decl.init as BinaryExpression;
      expect(mul.operator).toBe("*");
      const pow = mul.left as BinaryExpression;
      expect(pow.operator).toBe("**");
    });
  });

  describe("pipe operator", () => {
    it("should desugar x |> f into f(x)", () => {
      const ast = parse("5 |> double");
      const stmt = ast.body[0] as ExpressionStatement;
      const call = stmt.expression as CallExpression;
      expect(call.type).toBe("CallExpression");
      expect((call.callee as Identifier).name).toBe("double");
      expect(call.arguments).toHaveLength(1);
      expect((call.arguments[0] as NumberLiteral).value).toBe(5);
    });

    it("should desugar x |> f(y) into f(x, y)", () => {
      const ast = parse("5 |> add(10)");
      const stmt = ast.body[0] as ExpressionStatement;
      const call = stmt.expression as CallExpression;
      expect((call.callee as Identifier).name).toBe("add");
      expect(call.arguments).toHaveLength(2);
      expect((call.arguments[0] as NumberLiteral).value).toBe(5);
      expect((call.arguments[1] as NumberLiteral).value).toBe(10);
    });

    it("should chain pipes left-to-right", () => {
      const ast = parse("5 |> double |> toString");
      const stmt = ast.body[0] as ExpressionStatement;
      const outer = stmt.expression as CallExpression;
      expect((outer.callee as Identifier).name).toBe("toString");
      const inner = outer.arguments[0] as CallExpression;
      expect((inner.callee as Identifier).name).toBe("double");
      expect((inner.arguments[0] as NumberLiteral).value).toBe(5);
    });
  });

  describe("spread operator", () => {
    it("should parse [...arr] as ArrayLiteral with SpreadElement", () => {
      const ast = parse("const x = [...arr]");
      const decl = ast.body[0] as VariableDeclaration;
      const arrLit = decl.init as ArrayLiteral;
      expect(arrLit.elements).toHaveLength(1);
      expect(arrLit.elements[0].type).toBe("SpreadElement");
      expect((arrLit.elements[0] as any).argument.name).toBe("arr");
    });

    it("should parse mixed spread and normal elements", () => {
      const ast = parse("const x = [...a, 1, ...b]");
      const decl = ast.body[0] as VariableDeclaration;
      const arrLit = decl.init as ArrayLiteral;
      expect(arrLit.elements).toHaveLength(3);
      expect(arrLit.elements[0].type).toBe("SpreadElement");
      expect(arrLit.elements[1].type).toBe("NumberLiteral");
      expect(arrLit.elements[2].type).toBe("SpreadElement");
    });
  });

  describe("destructuring", () => {
    it("should parse array destructuring", () => {
      const ast = parse("const [a, b, c] = arr");
      const decl = ast.body[0] as any;
      expect(decl.type).toBe("DestructuringDeclaration");
      expect(decl.kind).toBe("const");
      expect(decl.pattern.kind).toBe("array");
      expect(decl.pattern.elements).toEqual(["a", "b", "c"]);
    });

    it("should parse object destructuring", () => {
      const ast = parse("const { name, age } = person");
      const decl = ast.body[0] as any;
      expect(decl.type).toBe("DestructuringDeclaration");
      expect(decl.pattern.kind).toBe("object");
      expect(decl.pattern.properties).toEqual(["name", "age"]);
    });

    it("should parse let destructuring", () => {
      const ast = parse("let [x, y] = coords");
      const decl = ast.body[0] as any;
      expect(decl.type).toBe("DestructuringDeclaration");
      expect(decl.kind).toBe("let");
    });

    it("should parse array destructuring with skipped elements", () => {
      const ast = parse("const [a, , c] = arr");
      const decl = ast.body[0] as any;
      expect(decl.pattern.elements).toEqual(["a", null, "c"]);
    });
  });

  // ── Batch 4 ─────────────────────────────────────────────────────────

  describe("map literals", () => {
    it("should parse empty map", () => {
      const ast = parse("const m = Map {}");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.init.type).toBe("MapLiteral");
      expect((decl.init as any).entries).toHaveLength(0);
    });

    it("should parse map with string keys", () => {
      const ast = parse('const m = Map { "a": 1, "b": 2 }');
      const decl = ast.body[0] as VariableDeclaration;
      const map = decl.init as any;
      expect(map.type).toBe("MapLiteral");
      expect(map.entries).toHaveLength(2);
      expect(map.entries[0].key.type).toBe("StringLiteral");
      expect(map.entries[0].value.type).toBe("NumberLiteral");
    });

    it("should parse map with single-quoted keys", () => {
      const ast = parse("const m = Map { 'x': 1 }");
      const decl = ast.body[0] as VariableDeclaration;
      expect(decl.init.type).toBe("MapLiteral");
    });
  });
});
