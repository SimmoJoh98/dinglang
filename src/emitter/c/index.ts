import { DingError } from "../../errors/index.js";
import { isDingModule } from "../../std/index.js";
import type {
  Program,
  Statement,
  Expression,
  VariableDeclaration,
  ExpressionStatement,
  ImportDeclaration,
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
import { C_ARENA } from "./arena.js";
import {
  C_STDLIB_STD,
  C_STDLIB_MATH,
  C_STD_FUNCTION_MAP,
  C_MATH_FUNCTION_MAP,
} from "./stdlib.js";
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

export class CEmitter {
  private indent: number = 0;
  private output: string[] = [];
  private structs: Map<string, StructDeclaration> = new Map();
  private functions: Map<string, { params: ArrowFunction["params"]; returnType?: CType }> = new Map();
  private importedStd: boolean = false;
  private importedMath: boolean = false;
  private stdRenames: Map<string, string> = new Map();
  private mathRenames: Map<string, string> = new Map();
  private variableTypes: Map<string, CType> = new Map();
  private tempCounter: number = 0;
  private currentReturnType: CType | null = null;

  emit(program: Program): string {
    // Pass 1: collect struct declarations, function declarations, and imports
    for (const stmt of program.body) {
      if (stmt.type === "StructDeclaration") {
        this.structs.set(stmt.name, stmt);
      }
      if (stmt.type === "ImportDeclaration") {
        this.processImport(stmt);
      }
      if (stmt.type === "VariableDeclaration" && stmt.init.type === "ArrowFunction") {
        const fn = stmt.init;
        const returnType = fn.returnType ? mapAnnotationToCType(fn.returnType) : undefined;
        this.functions.set(stmt.name, { params: fn.params, returnType });
      }
    }

    const sections: string[] = [];

    // Runtime header
    sections.push(C_RUNTIME);

    // Arena allocator
    sections.push(C_ARENA);

    // Stdlib sections
    if (this.importedStd) {
      sections.push(C_STDLIB_STD);
    }
    if (this.importedMath) {
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

    // Top-level function declarations
    const mainStatements: string[] = [];

    for (const stmt of program.body) {
      if (stmt.type === "StructDeclaration") continue;
      if (stmt.type === "ImportDeclaration") continue;

      if (stmt.type === "VariableDeclaration" && stmt.init.type === "ArrowFunction") {
        sections.push(this.emitTopLevelFunction(stmt.name, stmt.init));
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

  // ── Import processing ───────────────────────────────────────────────

  private processImport(node: ImportDeclaration): void {
    if (!isDingModule(node.source)) return;

    if (node.source === "ding:std") {
      this.importedStd = true;
      if (node.default) {
        const mapped = C_STD_FUNCTION_MAP[node.default];
        if (mapped) this.stdRenames.set(node.default, mapped);
      }
      for (const name of node.named) {
        const mapped = C_STD_FUNCTION_MAP[name];
        if (mapped) this.stdRenames.set(name, mapped);
      }
    }

    if (node.source === "ding:math") {
      this.importedMath = true;
      if (node.default) {
        const mapped = C_MATH_FUNCTION_MAP[node.default];
        if (mapped) this.mathRenames.set(node.default, mapped);
      }
      for (const name of node.named) {
        const mapped = C_MATH_FUNCTION_MAP[name];
        if (mapped) this.mathRenames.set(name, mapped);
      }
    }
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

    this.variableTypes.set(node.name, cType);
    const init = this.emitExpression(node.init);
    return `${this.pad()}${cType} ${node.name} = ${init};`;
  }

  private emitArrayDeclaration(name: string, node: ArrayLiteral): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}DingArray* ${name} = ding_array_new();`);
    this.variableTypes.set(name, "DingArray*");
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
    this.variableTypes.set(name, "DingValue"); // track as struct pointer
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
    this.variableTypes.set(id, "ding_int");
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

    // Register param types
    const savedReturnType = this.currentReturnType;
    for (const [pName, cType] of paramTypes) {
      this.variableTypes.set(pName, cType as CType);
    }

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

    // Restore scope
    this.currentReturnType = savedReturnType;
    for (const [pName] of paramTypes) {
      this.variableTypes.delete(pName);
    }

    return lines.join("\n");
  }

  private blockHasReturn(stmts: Statement[]): boolean {
    for (const stmt of stmts) {
      if (stmt.type === "ReturnStatement" && stmt.value !== null) return true;
      if (stmt.type === "IfStatement") {
        if (this.blockHasReturn(stmt.consequent)) return true;
        if (stmt.alternate && this.blockHasReturn(stmt.alternate)) return true;
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

    // Register param types in scope and set return type context
    const savedReturnType = this.currentReturnType;
    this.currentReturnType = retType;
    for (const [pName, cType] of paramTypes) {
      this.variableTypes.set(pName, cType);
    }

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

    // Restore scope
    this.currentReturnType = savedReturnType;
    for (const [pName] of paramTypes) {
      this.variableTypes.delete(pName);
    }

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
        return this.emitIdentifier(node.name);
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

  private emitIdentifier(name: string): string {
    // Check stdlib renames
    if (this.stdRenames.has(name)) return this.stdRenames.get(name)!;
    if (this.mathRenames.has(name)) return this.mathRenames.get(name)!;
    // Check if it's a known top-level function
    if (this.functions.has(name)) return `ding_fn_${name}`;
    return name;
  }

  private emitBinaryExpression(node: BinaryExpression): string {
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
    // Method call: obj.method(args) → StructName_method(obj, args)
    if (node.callee.type === "MemberExpression") {
      const obj = this.emitExpression(node.callee.object);
      const method = node.callee.property;
      const args = node.arguments.map((a) => this.emitExpression(a));

      // Check if it's a known struct method
      // Try to find the struct this object belongs to by checking known variables
      const objName = node.callee.object.type === "Identifier" ? node.callee.object.name : null;
      if (objName) {
        // Look through structs for a matching method
        for (const [structName, decl] of this.structs) {
          const hasMethod = decl.methods.some((m) => m.name === method);
          if (hasMethod) {
            return `${structName}_${method}(${[obj, ...args].join(", ")})`;
          }
        }
      }

      // Fallback: generic method call
      return `${obj}_${method}(${args.join(", ")})`;
    }

    const callee = this.emitExpression(node.callee);

    // Determine expected param types for the callee
    let expectedParamTypes: (CType | null)[] | null = null;
    if (node.callee.type === "Identifier") {
      const fnInfo = this.functions.get(node.callee.name);
      if (fnInfo) {
        expectedParamTypes = fnInfo.params.map((p) =>
          p.annotation ? mapAnnotationToCType(p.annotation) : "DingValue" as CType
        );
      }
    }

    const args = node.arguments.map((a, i) => {
      const expr = this.emitExpression(a);
      // For ding_log and similar, wrap arguments as DingValue
      if (this.isStdLogFunction(callee)) {
        const argType = this.resolveType(a);
        return wrapAsDingValue(expr, argType);
      }
      // For user-defined functions with DingValue params, wrap typed args
      if (expectedParamTypes && i < expectedParamTypes.length) {
        const expected = expectedParamTypes[i];
        if (expected === "DingValue") {
          const argType = this.resolveType(a);
          if (argType !== "DingValue") {
            return wrapAsDingValue(expr, argType);
          }
        }
      }
      return expr;
    });

    return `${callee}(${args.join(", ")})`;
  }

  private isStdLogFunction(callee: string): boolean {
    return callee === "ding_log" || callee === "ding_warn" || callee === "ding_error";
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
    const arr = this.emitExpression(node.array);
    const idx = this.emitExpression(node.index);
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
    const left = this.emitExpression(node.left);
    const right = this.emitExpression(node.right);
    const leftType = inferCType(node.left);
    if (leftType === "DingValue") {
      return `(${left}.type != DING_NULL ? ${left} : ${right})`;
    }
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

  /** Resolve the C type of an expression using scope + inference */
  private resolveType(node: Expression): CType {
    if (node.type === "Identifier") {
      const known = this.variableTypes.get(node.name);
      if (known) return known;
    }
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
    // Numeric narrowing/widening casts between concrete types
    if (isNumericType(actual) && isNumericType(target)) return `(${target})(${expr})`;
    return expr;
  }
}
