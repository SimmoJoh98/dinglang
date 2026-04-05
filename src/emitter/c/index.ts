import { DingError } from "../../errors/index.js";
import type {
  Program,
  Statement,
  Expression,
  VariableDeclaration,
  ExpressionStatement,
  ReturnStatement,
  IfStatement,
  BinaryExpression,
  ArrowFunction,
  CallExpression,
  TemplateLiteral,
  ForRangeStatement,
  ForInStatement,
  WhileStatement,
  StructDeclaration,
  TryCatchStatement,
  ThrowStatement,
  ArrayLiteral,
  ArrayAccess,
  LengthExpression,
  MemberExpression,
  StructInstantiation,
  ErrorPropagation,
  NullishCoalescing,
  NullAssertion,
  AssignmentExpression,
} from "../../ast/nodes.js";
import { C_RUNTIME } from "./runtime.js";
import { cArena, DEFAULT_ARENA_SIZE } from "./arena.js";
import { C_STDLIB_STD, C_STDLIB_MATH } from "./stdlib.js";
import {
  inferCType,
  mapAnnotationToCType,
  wrapAsDingValue,
  isIntegerType,
  isFloatType,
  isNumericType,
  isStringType,
  type CType,
} from "./types.js";
import { Resolver } from "./resolver.js";

/** Prefix for lifted top-level bindings in emitted C. Avoids collisions
 *  with C keywords and makes the emitted file greppable. */
const GLOBAL_PREFIX = "ding_g_";

export interface CEmitterOptions {
  /** Arena capacity in bytes. When omitted, the emitter uses
   *  DEFAULT_ARENA_SIZE. File-level `#[arena(size=...)]` directives
   *  are extracted by `extractDirectives` before the emitter runs
   *  and flow in through this option. */
  arenaSize?: number;
}

export class CEmitter {
  private indent: number = 0;
  private output: string[] = [];
  private tempCounter: number = 0;
  private currentReturnType: CType | null = null;
  private resolver: Resolver = new Resolver();
  private arenaSize: number;

  constructor(options: CEmitterOptions = {}) {
    this.arenaSize = options.arenaSize ?? DEFAULT_ARENA_SIZE;
  }

  /** Accessors: resolver is the single source of truth for these. */
  private get structs() { return this.resolver.structs; }
  private get functions() { return this.resolver.functions; }
  private get stdRenames() { return this.resolver.stdRenames; }
  private get mathRenames() { return this.resolver.mathRenames; }

  emit(program: Program): string {
    // Type-resolution pass: owns all type/call-target/struct/import queries.
    // The emitter only keeps variableTypes for its own incremental scope
    // bookkeeping during emission.
    this.resolver = new Resolver();
    this.resolver.resolve(program);

    const sections: string[] = [];

    // Runtime header
    sections.push(C_RUNTIME);

    // Arena allocator (capacity baked in from the CEmitter options;
    // a `#[arena(size=...)]` directive flows through here)
    sections.push(cArena(this.arenaSize));

    // Stdlib sections
    if (this.resolver.importedStd) {
      sections.push(C_STDLIB_STD);
    }
    if (this.resolver.importedMath) {
      sections.push(C_STDLIB_MATH);
    }

    // Forward declarations for structs
    for (const [name] of this.structs) {
      sections.push(`typedef struct ${name} ${name};`);
    }

    // Struct definitions
    for (const [, decl] of this.structs) {
      sections.push(this.emitStructDefinition(decl));
    }

    // Struct methods
    for (const [, decl] of this.structs) {
      for (const method of decl.methods) {
        sections.push(this.emitStructMethod(decl.name, method));
      }
    }

    // Static declarations for top-level globals. Must come before any
    // top-level function that references them. The *initialization* of
    // each global happens inline in main() at the point where the user
    // wrote the declaration — that way top-level statements and
    // declarations stay interleaved in source order, which is the only
    // way things like `const item = safeGet(player.inventory, 0)` can
    // see the effects of earlier top-level `player.addItem(...)` calls.
    for (const name of this.resolver.globalOrder) {
      const cType = this.resolver.globals.get(name)!;
      sections.push(`static ${cType} ${GLOBAL_PREFIX}${name};`);
    }

    // Top-level function declarations + main body
    const mainStatements: string[] = [];

    for (const stmt of program.body) {
      if (stmt.type === "StructDeclaration") continue;
      if (stmt.type === "ImportDeclaration") continue;

      if (stmt.type === "VariableDeclaration" && stmt.init.type === "ArrowFunction") {
        sections.push(this.emitTopLevelFunction(stmt.name, stmt.init));
        continue;
      }

      // Top-level non-function VariableDeclaration → emit its initializer
      // inline into main() as an assignment to the lifted global.
      if (stmt.type === "VariableDeclaration") {
        this.indent++;
        mainStatements.push(this.emitGlobalInit(stmt));
        this.indent--;
        continue;
      }

      const result = this.emitStatement(stmt);
      if (result !== null) {
        mainStatements.push(result);
      }
    }

    // main() function
    sections.push("int main() {");
    sections.push("  ding_arena_init();");
    for (const s of mainStatements) {
      sections.push(s);
    }
    sections.push("  ding_arena_free();");
    sections.push("  return 0;");
    sections.push("}");

    return sections.join("\n");
  }

  /** Emit the initializer for a top-level (global) VariableDeclaration as
   *  one or more C statements that assign into the lifted ding_g_<name>. */
  private emitGlobalInit(decl: VariableDeclaration): string {
    const name = decl.name;
    const gName = `${GLOBAL_PREFIX}${name}`;
    const init = decl.init;

    // Array literal: allocate + push each element.
    if (init.type === "ArrayLiteral") {
      const lines: string[] = [];
      lines.push(`${this.pad()}${gName} = ding_array_new();`);
      for (const elem of init.elements) {
        const elemExpr = this.emitExpression(elem);
        const elemType = this.resolveType(elem);
        const wrapped = wrapAsDingValue(elemExpr, elemType);
        lines.push(`${this.pad()}ding_array_push(${gName}, ${wrapped});`);
      }
      return lines.join("\n");
    }

    // Struct instantiation: allocate + set each field.
    if (init.type === "StructInstantiation") {
      const lines: string[] = [];
      lines.push(`${this.pad()}${gName} = (${init.name}*)ding_alloc(sizeof(${init.name}));`);
      for (const field of init.fields) {
        const val = this.emitExpression(field.value);
        lines.push(`${this.pad()}${gName}->${field.name} = ${val};`);
      }
      return lines.join("\n");
    }

    // Simple scalar / expression initializer — coerce to the global's type.
    const cType = this.resolver.globals.get(name)!;
    const value = this.emitAs(init, cType);
    return `${this.pad()}${gName} = ${value};`;
  }

  // ── Statements ──────────────────────────────────────────────────────

  private emitStatement(node: Statement): string | null {
    switch (node.type) {
      case "VariableDeclaration":
        return this.emitVariableDeclaration(node);
      case "ExpressionStatement":
        return this.emitExpressionStatement(node);
      case "ImportDeclaration":
        return null;
      case "ReturnStatement":
        return this.emitReturnStatement(node);
      case "IfStatement":
        return this.emitIfStatement(node);
      case "ForRangeStatement":
        return this.emitForRangeStatement(node);
      case "ForInStatement":
        return this.emitForInStatement(node);
      case "WhileStatement":
        return this.emitWhileStatement(node);
      case "BreakStatement":
        return `${this.pad()}break;`;
      case "ContinueStatement":
        return `${this.pad()}continue;`;
      case "StructDeclaration":
        return null; // handled in pre-pass
      case "TryCatchStatement":
        return this.emitTryCatchStatement(node);
      case "ThrowStatement":
        return this.emitThrowStatement(node);
      default:
        throw new DingError(
          "emitter",
          `C emitter: unsupported statement type '${(node as any).type}'`,
          { hint: "This AST node is not yet supported by the C backend" },
        );
    }
  }

  private emitVariableDeclaration(node: VariableDeclaration): string {
    // Array literal needs multi-statement expansion
    if (node.init.type === "ArrayLiteral") {
      return this.emitArrayDeclaration(node.name, node.init);
    }

    // Struct instantiation needs multi-statement expansion
    if (node.init.type === "StructInstantiation") {
      return this.emitStructInstantiationDecl(node.name, node.init);
    }

    let cType: CType;
    if (node.annotation) {
      cType = mapAnnotationToCType(node.annotation);
    } else {
      cType = this.resolveType(node.init);
    }

    const init = this.emitExpression(node.init);
    return `${this.pad()}${cType} ${node.name} = ${init};`;
  }

  private emitArrayDeclaration(name: string, node: ArrayLiteral): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}DingArray* ${name} = ding_array_new();`);
    for (const elem of node.elements) {
      const elemExpr = this.emitExpression(elem);
      const elemType = inferCType(elem);
      const wrapped = wrapAsDingValue(elemExpr, elemType);
      lines.push(`${this.pad()}ding_array_push(${name}, ${wrapped});`);
    }
    return lines.join("\n");
  }

  private emitStructInstantiationDecl(name: string, node: StructInstantiation): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}${node.name}* ${name} = (${node.name}*)ding_alloc(sizeof(${node.name}));`);
    for (const field of node.fields) {
      const val = this.emitExpression(field.value);
      lines.push(`${this.pad()}${name}->${field.name} = ${val};`);
    }
    return lines.join("\n");
  }

  private emitExpressionStatement(node: ExpressionStatement): string {
    // Handle assignment expressions
    if (node.expression.type === "AssignmentExpression") {
      const target = this.emitExpression(node.expression.target);
      const value = this.emitExpression(node.expression.value);
      return `${this.pad()}${target} = ${value};`;
    }
    return `${this.pad()}${this.emitExpression(node.expression)};`;
  }

  private emitReturnStatement(node: ReturnStatement): string {
    if (node.value === null) {
      return `${this.pad()}return;`;
    }
    // Struct instantiation in return context needs special handling
    if (node.value.type === "StructInstantiation") {
      const tmp = `__tmp${this.tempCounter++}`;
      const lines: string[] = [];
      const inst = node.value;
      lines.push(`${this.pad()}${inst.name}* ${tmp} = (${inst.name}*)ding_alloc(sizeof(${inst.name}));`);
      for (const field of inst.fields) {
        const val = this.emitExpression(field.value);
        lines.push(`${this.pad()}${tmp}->${field.name} = ${val};`);
      }
      lines.push(`${this.pad()}return ${tmp};`);
      return lines.join("\n");
    }
    // If current function returns DingValue, wrap the return value
    if (this.currentReturnType === "DingValue") {
      const val = this.emitAs(node.value, "DingValue");
      return `${this.pad()}return ${val};`;
    }
    return `${this.pad()}return ${this.emitExpression(node.value)};`;
  }

  private emitIfStatement(node: IfStatement): string {
    const test = this.emitExpression(node.test);
    const consequent = this.emitBlock(node.consequent);

    let out = `${this.pad()}if (${test}) {\n${consequent}\n${this.pad()}}`;

    if (node.alternate) {
      if (node.alternate.length === 1 && node.alternate[0].type === "IfStatement") {
        const elseIf = this.emitIfStatement(node.alternate[0]).trimStart();
        out += ` else ${elseIf}`;
      } else {
        const alt = this.emitBlock(node.alternate);
        out += ` else {\n${alt}\n${this.pad()}}`;
      }
    }

    return out;
  }

  private emitForRangeStatement(node: ForRangeStatement): string {
    const id = node.identifier;
    const start = this.emitAs(node.start, "ding_int");
    const end = this.emitAs(node.end, "ding_int");
    const body = this.emitBlock(node.body);
    return `${this.pad()}for (ding_int ${id} = ${start}; ${id} < ${end}; ${id}++) {\n${body}\n${this.pad()}}`;
  }

  private emitForInStatement(node: ForInStatement): string {
    const id = node.identifier;
    const iterable = this.emitExpression(node.iterable);
    const lines: string[] = [];
    lines.push(`${this.pad()}for (ding_int __i = 0; __i < ${iterable}->length; __i++) {`);
    this.indent++;
    lines.push(`${this.pad()}DingValue ${id} = ${iterable}->items[__i];`);
    for (const stmt of node.body) {
      const result = this.emitStatement(stmt);
      if (result !== null) lines.push(result);
    }
    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join("\n");
  }

  private emitWhileStatement(node: WhileStatement): string {
    const condition = this.emitExpression(node.condition);
    const body = this.emitBlock(node.body);
    return `${this.pad()}while (${condition}) {\n${body}\n${this.pad()}}`;
  }

  private emitTryCatchStatement(node: TryCatchStatement): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}if (setjmp(__ding_jmp) == 0) {`);
    this.indent++;
    for (const stmt of node.body) {
      const result = this.emitStatement(stmt);
      if (result !== null) lines.push(result);
    }
    this.indent--;
    lines.push(`${this.pad()}} else {`);
    this.indent++;
    lines.push(`${this.pad()}DingValue ${node.param} = __ding_err;`);
    for (const stmt of node.catch) {
      const result = this.emitStatement(stmt);
      if (result !== null) lines.push(result);
    }
    this.indent--;
    lines.push(`${this.pad()}}`);

    if (node.finally) {
      for (const stmt of node.finally) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
    }

    return lines.join("\n");
  }

  private emitThrowStatement(node: ThrowStatement): string {
    const val = this.emitExpression(node.value);
    const valType = inferCType(node.value);
    const wrapped = wrapAsDingValue(val, valType);
    return `${this.pad()}__ding_err = ${wrapped};\n${this.pad()}longjmp(__ding_jmp, 1);`;
  }

  // ── Struct helpers ──────────────────────────────────────────────────

  private emitStructDefinition(decl: StructDeclaration): string {
    const lines: string[] = [];
    lines.push(`struct ${decl.name} {`);
    for (const field of decl.fields) {
      const cType = this.fieldTypeToCType(field.fieldType);
      lines.push(`  ${cType} ${field.name};`);
    }
    lines.push("};");
    return lines.join("\n");
  }

  private emitStructMethod(
    structName: string,
    method: StructDeclaration["methods"][0],
  ): string {
    const paramTypes: [string, string][] = method.params.map((p) => {
      if (p.name === "self") return [p.name, `${structName}*`] as [string, string];
      const cType = p.annotation ? mapAnnotationToCType(p.annotation) : "DingValue";
      return [p.name, cType] as [string, string];
    });

    const params = paramTypes
      .map(([pName, cType]) => `${cType} ${pName}`)
      .join(", ");

    const savedReturnType = this.currentReturnType;

    const lines: string[] = [];

    if (Array.isArray(method.body) && method.body.length > 0) {
      const hasReturn = this.blockHasReturn(method.body);
      const retType: CType = hasReturn ? "DingValue" : "void";
      this.currentReturnType = retType;
      lines.push(`${retType} ${structName}_${method.name}(${params}) {`);
      this.indent++;
      for (const stmt of method.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
      lines.push("}");
    } else if (!Array.isArray(method.body)) {
      this.currentReturnType = "DingValue";
      lines.push(`DingValue ${structName}_${method.name}(${params}) {`);
      this.indent++;
      lines.push(`${this.pad()}return ${this.emitAs(method.body, "DingValue")};`);
      this.indent--;
      lines.push("}");
    } else {
      this.currentReturnType = "void";
      lines.push(`void ${structName}_${method.name}(${params}) {`);
      lines.push("}");
    }

    this.currentReturnType = savedReturnType;
    return lines.join("\n");
  }

  private blockHasReturn(stmts: Statement[]): boolean {
    for (const stmt of stmts) {
      if (stmt.type === "ReturnStatement" && stmt.value !== null) return true;
      if (stmt.type === "IfStatement") {
        if (this.blockHasReturn(stmt.consequent)) return true;
        if (stmt.alternate && this.blockHasReturn(stmt.alternate)) return true;
      }
      if (stmt.type === "TryCatchStatement") {
        if (this.blockHasReturn(stmt.body)) return true;
        if (this.blockHasReturn(stmt.catch)) return true;
        if (stmt.finally && this.blockHasReturn(stmt.finally)) return true;
      }
      if (stmt.type === "ForRangeStatement" || stmt.type === "ForInStatement" || stmt.type === "WhileStatement") {
        if (this.blockHasReturn(stmt.body)) return true;
      }
    }
    return false;
  }

  private fieldTypeToCType(fieldType: string): string {
    // Reuse the annotation mapper for struct fields
    const mapped = mapAnnotationToCType({ type: "TypeAnnotation", name: fieldType });
    return mapped;
  }

  // ── Top-level functions ─────────────────────────────────────────────

  private emitTopLevelFunction(name: string, fn: ArrowFunction): string {
    const retAnnotation = fn.returnType ? mapAnnotationToCType(fn.returnType) : undefined;

    const paramTypes: [string, CType][] = fn.params.map((p) => {
      const cType = p.annotation ? mapAnnotationToCType(p.annotation) : "DingValue" as CType;
      return [p.name, cType];
    });

    const params = paramTypes
      .map(([pName, cType]) => `${cType} ${pName}`)
      .join(", ");

    let retType: CType;
    if (retAnnotation) {
      retType = retAnnotation;
    } else if (Array.isArray(fn.body)) {
      retType = this.blockHasReturn(fn.body) ? "DingValue" : "void";
    } else {
      retType = "DingValue";
    }

    const savedReturnType = this.currentReturnType;
    this.currentReturnType = retType;

    const lines: string[] = [];
    lines.push(`${retType} ding_fn_${name}(${params}) {`);

    if (Array.isArray(fn.body)) {
      this.indent++;
      for (const stmt of fn.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
    } else {
      this.indent++;
      if (retType === "DingValue") {
        lines.push(`${this.pad()}return ${this.emitAs(fn.body, "DingValue")};`);
      } else {
        lines.push(`${this.pad()}return ${this.emitExpression(fn.body)};`);
      }
      this.indent--;
    }

    lines.push("}");

    this.currentReturnType = savedReturnType;
    return lines.join("\n");
  }

  // ── Expressions ─────────────────────────────────────────────────────

  private emitExpression(node: Expression): string {
    switch (node.type) {
      case "NumberLiteral":
        return String(node.value);
      case "StringLiteral":
        return `"${this.escapeString(node.value)}"`;
      case "BooleanLiteral":
        return node.value ? "true" : "false";
      case "NullLiteral":
        return "DING_VALUE_NULL";
      case "Identifier":
        return this.emitIdentifier(node);
      case "BinaryExpression":
        return this.emitBinaryExpression(node);
      case "ArrowFunction":
        throw new DingError("emitter", "C emitter: anonymous functions not supported as expressions", {
          hint: "Assign the function to a named const at the top level",
        });
      case "CallExpression":
        return this.emitCallExpression(node);
      case "TemplateLiteral":
        return this.emitTemplateLiteral(node);
      case "ArrayLiteral":
        // Inline array literal in expression context — emit as ding_array_new()
        // This is limited; full array literals should use declaration form
        return "ding_array_new()";
      case "ArrayAccess":
        return this.emitArrayAccess(node);
      case "LengthExpression":
        return this.emitLengthExpression(node);
      case "MemberExpression":
        return this.emitMemberExpression(node);
      case "StructInstantiation":
        // In expression context, just emit the struct name as a placeholder
        // Real struct instantiation is handled at statement level (decl or return)
        return this.emitStructInstantiationExpr(node);
      case "ErrorPropagation":
        return this.emitErrorPropagation(node);
      case "NullishCoalescing":
        return this.emitNullishCoalescing(node);
      case "NullAssertion":
        return this.emitNullAssertion(node);
      case "AssignmentExpression":
        return `${this.emitExpression(node.target)} = ${this.emitExpression(node.value)}`;
      default:
        throw new DingError(
          "emitter",
          `C emitter: unsupported expression type '${(node as any).type}'`,
          { hint: "This AST node is not yet supported by the C backend" },
        );
    }
  }

  private emitIdentifier(node: { name: string; type: "Identifier" }): string {
    const name = node.name;
    // Check stdlib renames
    if (this.stdRenames.has(name)) return this.stdRenames.get(name)!;
    if (this.mathRenames.has(name)) return this.mathRenames.get(name)!;
    // Check if it's a known top-level function
    if (this.functions.has(name)) return `ding_fn_${name}`;
    // Global reference? The resolver recorded this specifically when it
    // walked this exact node with no local of the same name in scope.
    // A local variable that happens to share a name with a global will
    // NOT appear in globalRefs, so shadowing is handled correctly.
    if (this.resolver.globalRefs.has(node)) return `${GLOBAL_PREFIX}${name}`;
    return name;
  }

  private emitBinaryExpression(node: BinaryExpression): string {
    // Null comparison: lower to tag-field check on DingValue, or NULL pointer check otherwise.
    if (node.operator === "==" || node.operator === "!=") {
      const leftIsNull = node.left.type === "NullLiteral";
      const rightIsNull = node.right.type === "NullLiteral";
      if (leftIsNull || rightIsNull) {
        const other = leftIsNull ? node.right : node.left;
        const otherType = this.resolveType(other);
        const otherExpr = this.emitExpression(other);
        const op = node.operator === "==" ? "==" : "!=";
        if (otherType === "DingValue") {
          return `${otherExpr}.type ${op} DING_NULL`;
        }
        // Pointer-ish types: DingArray*, struct pointers, strings
        return `${otherExpr} ${op} NULL`;
      }
    }

    const leftType = this.resolveType(node.left);
    const rightType = this.resolveType(node.right);

    // String concatenation
    if (node.operator === "+" && (leftType === "ding_string" || rightType === "ding_string")) {
      const left = leftType === "ding_string" ? this.emitExpression(node.left) : this.coerceToString(this.emitExpression(node.left), leftType);
      const right = rightType === "ding_string" ? this.emitExpression(node.right) : this.coerceToString(this.emitExpression(node.right), rightType);
      return `ding_string_concat(${left}, ${right})`;
    }

    // For arithmetic/comparison: unwrap DingValue operands to int
    const isArith = ["+", "-", "*", "/"].includes(node.operator);
    const isComp = ["<", ">", "<=", ">=", "==", "!="].includes(node.operator);
    if ((isArith || isComp) && (leftType === "DingValue" || rightType === "DingValue")) {
      const left = this.emitAs(node.left, "ding_int");
      const right = this.emitAs(node.right, "ding_int");
      return `${left} ${node.operator} ${right}`;
    }

    const left = this.emitExpression(node.left);
    const right = this.emitExpression(node.right);
    return `${left} ${node.operator} ${right}`;
  }

  private coerceToString(expr: string, cType: CType): string {
    if (isIntegerType(cType)) return `ding_int_to_string((ding_int)(${expr}))`;
    if (isFloatType(cType)) return `ding_float_to_string((ding_float)(${expr}))`;
    switch (cType) {
      case "ding_bool": return `ding_bool_to_string(${expr})`;
      case "ding_cstring": return `(ding_string)(${expr})`;
      case "DingValue": return `ding_value_to_string(${expr})`;
      default: return expr;
    }
  }

  private emitCallExpression(node: CallExpression): string {
    // Method call: obj.method(args)
    if (node.callee.type === "MemberExpression") {
      const method = node.callee.property;
      const receiverType = this.resolveType(node.callee.object);
      const obj = this.emitExpression(node.callee.object);

      // Array methods — lower to ding_array_* runtime calls.
      // Unwrap the receiver if it's a DingValue.
      if (receiverType === "DingArray*" || receiverType === "DingValue") {
        const arrExpr = receiverType === "DingValue" ? `${obj}.as_array` : obj;
        if (method === "push") {
          if (node.arguments.length !== 1) {
            throw new DingError("emitter", `array.push expects 1 argument, got ${node.arguments.length}`);
          }
          const argExpr = this.emitExpression(node.arguments[0]);
          const argType = this.resolveType(node.arguments[0]);
          const wrapped = wrapAsDingValue(argExpr, argType);
          return `ding_array_push(${arrExpr}, ${wrapped})`;
        }
      }

      // Struct method: look up by the receiver's struct type when known.
      // receiverType may be "Player*" for a struct pointer variable.
      let ownerStruct: string | null = null;
      if (typeof receiverType === "string" && receiverType.endsWith("*")) {
        const base = receiverType.slice(0, -1);
        if (this.structs.has(base)) ownerStruct = base;
      }
      if (!ownerStruct) {
        // Fallback: search any struct that defines this method name.
        for (const [structName, decl] of this.structs) {
          if (decl.methods.some((m) => m.name === method)) {
            ownerStruct = structName;
            break;
          }
        }
      }
      if (ownerStruct) {
        const args = node.arguments.map((a) => this.emitExpression(a));
        return `${ownerStruct}_${method}(${[obj, ...args].join(", ")})`;
      }

      // Fallback: generic method call
      const args = node.arguments.map((a) => this.emitExpression(a));
      return `${obj}_${method}(${args.join(", ")})`;
    }

    // Data-driven lowering via the resolver's precomputed call target.
    // The resolver already knows what we're calling and its parameter
    // types; we just emit the arguments and coerce each to the expected
    // C type. This replaces the old hard-coded `isStdLogFunction` check
    // and guarantees every callee goes through the same path.
    const target = this.resolver.callTargetOf(node);
    if (target && target.kind !== "array-builtin") {
      const args = node.arguments.map((a, i) => {
        const expected = target.paramTypes[i] ?? "DingValue";
        return this.emitAs(a, expected);
      });
      return `${target.cName}(${args.join(", ")})`;
    }

    // Fallback for calls the resolver couldn't identify (e.g. calls on
    // a value that isn't a known identifier — rare).
    const callee = this.emitExpression(node.callee);
    const args = node.arguments.map((a) => this.emitExpression(a));
    return `${callee}(${args.join(", ")})`;
  }

  private emitTemplateLiteral(node: TemplateLiteral): string {
    // Build up nested ding_string_concat calls
    const parts: string[] = [];
    for (const part of node.parts) {
      if (typeof part === "string") {
        if (part.length > 0) {
          parts.push(`"${this.escapeString(part)}"`);
        }
      } else {
        const expr = this.emitExpression(part);
        const cType = this.resolveType(part);
        if (cType === "ding_string") {
          parts.push(expr);
        } else if (cType === "ding_int") {
          parts.push(`ding_int_to_string(${expr})`);
        } else if (cType === "ding_float") {
          parts.push(`ding_float_to_string(${expr})`);
        } else if (cType === "ding_bool") {
          parts.push(`ding_bool_to_string(${expr})`);
        } else {
          parts.push(`ding_value_to_string(${expr})`);
        }
      }
    }

    if (parts.length === 0) return `""`;
    if (parts.length === 1) return parts[0];

    // Nest ding_string_concat calls left-to-right
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      result = `ding_string_concat(${result}, ${parts[i]})`;
    }
    return result;
  }

  private emitArrayAccess(node: ArrayAccess): string {
    const arrType = this.resolveType(node.array);
    const arrExpr = this.emitExpression(node.array);
    const arr = arrType === "DingValue" ? `${arrExpr}.as_array` : arrExpr;
    const idx = this.emitAs(node.index, "ding_int");
    return `ding_array_get(${arr}, ${idx})`;
  }

  private emitLengthExpression(node: LengthExpression): string {
    const target = this.emitExpression(node.target);
    return `${target}->length`;
  }

  private emitMemberExpression(node: MemberExpression): string {
    const object = this.emitExpression(node.object);
    // Struct pointer access: obj->field
    if (node.optional) {
      return `(${object} != NULL ? ${object}->${node.property} : DING_VALUE_NULL)`;
    }
    return `${object}->${node.property}`;
  }

  private emitStructInstantiationExpr(node: StructInstantiation): string {
    // Use GCC compound statement expression for inline struct allocation
    const tmp = `__tmp${this.tempCounter++}`;
    const lines: string[] = [];
    lines.push(`({`);
    lines.push(`    ${node.name}* ${tmp} = (${node.name}*)ding_alloc(sizeof(${node.name}));`);
    for (const field of node.fields) {
      const val = this.emitExpression(field.value);
      lines.push(`    ${tmp}->${field.name} = ${val};`);
    }
    lines.push(`    ${tmp};`);
    lines.push(`  })`);
    return lines.join("\n");
  }

  private emitErrorPropagation(node: ErrorPropagation): string {
    const expr = this.emitExpression(node.expression);
    // Simplified: just call the expression, rely on setjmp/longjmp
    return expr;
  }

  private emitNullishCoalescing(node: NullishCoalescing): string {
    const leftType = this.resolveType(node.left);
    const left = this.emitExpression(node.left);
    if (leftType === "DingValue") {
      const right = this.emitAs(node.right, "DingValue");
      return `(${left}.type != DING_NULL ? ${left} : ${right})`;
    }
    const right = this.emitExpression(node.right);
    return `(${left} != NULL ? ${left} : ${right})`;
  }

  private emitNullAssertion(node: NullAssertion): string {
    const expr = this.emitExpression(node.expression);
    return expr;
  }

  // ── Block / helpers ─────────────────────────────────────────────────

  private emitBlock(statements: Statement[]): string {
    this.indent++;
    const body = statements
      .map((s) => this.emitStatement(s))
      .filter((s): s is string => s !== null)
      .join("\n");
    this.indent--;
    return body;
  }

  private pad(): string {
    return "  ".repeat(this.indent);
  }

  private escapeString(s: string): string {
    return s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/\r/g, "\\r");
  }

  // ── Type resolution ─────────────────────────────────────────────────

  /** Resolve the C type of an expression using the resolver, with a small fallback. */
  private resolveType(node: Expression): CType {
    // Resolver is authoritative for any node it walked during the pre-pass.
    const fromResolver = this.resolver.exprTypes.get(node);
    if (fromResolver) return fromResolver;
    if (node.type === "CallExpression" && node.callee.type === "Identifier") {
      const fn = this.functions.get(node.callee.name);
      if (fn?.returnType) return fn.returnType;
    }
    // Recursively resolve binary expressions using scope
    if (node.type === "BinaryExpression") {
      const leftType = this.resolveType(node.left);
      const rightType = this.resolveType(node.right);
      if (node.operator === "+" && (isStringType(leftType) || isStringType(rightType))) {
        return "ding_string";
      }
      if (isFloatType(leftType) || isFloatType(rightType)) {
        return "ding_float";
      }
      if (isIntegerType(leftType) && isIntegerType(rightType)) {
        return "ding_int";
      }
      if (["==", "!=", "<", ">", "<=", ">="].includes(node.operator)) {
        return "ding_bool";
      }
      return "DingValue";
    }
    // Member access on structs resolves to the field type
    if (node.type === "MemberExpression") {
      const objName = node.object.type === "Identifier" ? node.object.name : null;
      if (objName) {
        for (const [, decl] of this.structs) {
          const field = decl.fields.find((f) => f.name === node.property);
          if (field) return this.fieldTypeToCType(field.fieldType) as CType;
        }
      }
    }
    return inferCType(node);
  }

  /** Emit expression coerced to a target type (unwrap/wrap as needed) */
  private emitAs(node: Expression, target: CType): string {
    const expr = this.emitExpression(node);
    const actual = this.resolveType(node);
    if (actual === target) return expr;
    // Unwrap DingValue → primitive
    if (actual === "DingValue") {
      if (target === "ding_int") return `${expr}.as_int`;
      if (target === "ding_float" || target === "ding_float64") return `${expr}.as_float`;
      if (target === "ding_bool") return `${expr}.as_bool`;
      if (target === "ding_string") return `${expr}.as_string`;
      if (target === "ding_cstring") return `(ding_cstring)${expr}.as_string`;
      // Narrower integer types: unwrap then narrow
      if (isIntegerType(target)) return `(${target})${expr}.as_int`;
      // Narrower float types: unwrap then narrow
      if (isFloatType(target)) return `(${target})${expr}.as_float`;
    }
    // Wrap primitive → DingValue
    if (target === "DingValue" && actual !== "DingValue") return wrapAsDingValue(expr, actual);
    // Numeric narrowing/widening casts between concrete types —
    // but skip the cast when the two types are equivalent under the
    // hood: ding_int ↔ ding_int64 (both int64_t), ding_float ↔ ding_float64
    // (both double). Avoids uglifying the emitted C with redundant casts.
    if (isNumericType(actual) && isNumericType(target)) {
      if (areEquivalentNumeric(actual, target)) return expr;
      return `(${target})(${expr})`;
    }
    return expr;
  }
}

/** True when two numeric CTypes are the same underlying C type, so a cast
 *  between them is a no-op. Keeps emitted C clean. */
function areEquivalentNumeric(a: CType, b: CType): boolean {
  const intDefaults = new Set<CType>(["ding_int", "ding_int64"]);
  const floatDefaults = new Set<CType>(["ding_float", "ding_float64"]);
  if (intDefaults.has(a) && intDefaults.has(b)) return true;
  if (floatDefaults.has(a) && floatDefaults.has(b)) return true;
  return false;
}
