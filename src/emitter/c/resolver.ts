// ── Resolver ────────────────────────────────────────────────────────
//
// Walks a Program once up-front and records, for every node the
// emitter will later need to look at:
//
//   exprTypes   — the resolved CType of every Expression
//   callTargets — for every CallExpression, what it actually calls
//                 (a std/math runtime function, a user function,
//                  a struct method, or an array builtin like push)
//
// The emitter is then a dumb consumer: it never has to guess a type
// or re-derive a call target, which is the class of mistake that
// produced the five bugs in features.dg (null check using the wrong
// union field, method call on a struct field falling through to the
// generic fallback, LengthExpression being wrapped as a DingValue,
// etc). If the resolver can't answer a question, the emitter fails
// loudly rather than silently guessing — that is the point.

import { isDingModule } from "../../std/index.js";
import type {
  Program,
  Statement,
  Expression,
  VariableDeclaration,
  CallExpression,
  StructDeclaration,
  ArrowFunction,
  Parameter,
  TypeAnnotation,
  ImportDeclaration,
  Identifier,
} from "../../ast/nodes.js";
import {
  mapAnnotationToCType,
  inferCType,
  isIntegerType,
  isFloatType,
  isStringType,
  type CType,
} from "./types.js";
import { C_STD_FUNCTION_MAP, C_MATH_FUNCTION_MAP } from "./stdlib.js";

/** What a CallExpression actually calls. */
export type CallTarget =
  | {
      kind: "user";
      cName: string;         // e.g. "ding_fn_safeGet"
      paramTypes: CType[];   // for argument coercion
      returnType: CType;
    }
  | {
      kind: "std";
      cName: string;         // e.g. "ding_log"
      paramTypes: CType[];   // usually [DingValue]
      returnType: CType;
    }
  | {
      kind: "math";
      cName: string;
      paramTypes: CType[];
      returnType: CType;
    }
  | {
      kind: "method";
      structName: string;    // e.g. "Player"
      methodName: string;    // e.g. "greet"
      cName: string;         // e.g. "Player_greet"
      paramTypes: CType[];   // excluding self
      returnType: CType;
    }
  | {
      kind: "array-builtin";
      op: "push";
      receiverIsDingValue: boolean; // need to unwrap .as_array?
      elementType: CType;            // for wrapping the argument
    };

export interface FunctionSignature {
  params: Parameter[];
  paramTypes: CType[];
  returnType: CType;
}

type Scope = Map<string, CType>;

export class Resolver {
  readonly exprTypes: WeakMap<Expression, CType> = new WeakMap();
  readonly callTargets: WeakMap<CallExpression, CallTarget> = new WeakMap();
  /** Identifier nodes that were resolved to a top-level global binding
   *  (i.e. not shadowed by any local in scope at that use site).
   *  The emitter uses this to decide whether to name-mangle with the
   *  ding_g_ prefix at each reference. */
  readonly globalRefs: WeakSet<Identifier> = new WeakSet();

  readonly structs: Map<string, StructDeclaration> = new Map();
  readonly functions: Map<string, FunctionSignature> = new Map();
  /** Top-level variable bindings (non-function). Emitted as C globals. */
  readonly globals: Map<string, CType> = new Map();
  /** Original declaration node for each global — the emitter uses this to
   *  generate its initializer inside ding_init_globals(). */
  readonly globalDecls: Map<string, VariableDeclaration> = new Map();
  /** Order globals were declared (source order), for deterministic init. */
  readonly globalOrder: string[] = [];
  readonly stdRenames: Map<string, string> = new Map();
  readonly mathRenames: Map<string, string> = new Map();
  importedStd: boolean = false;
  importedMath: boolean = false;

  /** Scope stack. The outermost frame is the file/module scope; globals
   *  live in `globals`, not on this stack, so that local declarations
   *  can properly shadow them without mutating global state. */
  private scopes: Scope[] = [new Map()];

  // ── Public entry point ────────────────────────────────────────────

  resolve(program: Program): void {
    // Pass 1: collect top-level declarations so forward references work.
    // We record:
    //   - struct declarations (needed for member access / method lookup)
    //   - imports (stdlib renames + which modules are active)
    //   - top-level functions (name → signature)
    //   - top-level non-function bindings as GLOBALS (name → C type)
    //
    // Globals get a provisional type from their annotation if any;
    // initializer-inferred types are filled in during the walk pass.
    for (const stmt of program.body) {
      if (stmt.type === "StructDeclaration") {
        this.structs.set(stmt.name, stmt);
      }
      if (stmt.type === "ImportDeclaration") {
        this.collectImport(stmt);
      }
      if (stmt.type === "VariableDeclaration") {
        if (stmt.init.type === "ArrowFunction") {
          const fn = stmt.init;
          const paramTypes = fn.params.map((p) => this.annotationType(p.annotation));
          const returnType = this.inferFunctionReturnType(fn);
          this.functions.set(stmt.name, { params: fn.params, paramTypes, returnType });
        } else {
          // Non-function top-level binding → global. Record the node so
          // the emitter can later emit an initializer inside ding_init_globals().
          // Provisional type from annotation; refined after the walk pass.
          const provisional: CType = stmt.annotation
            ? mapAnnotationToCType(stmt.annotation)
            : "DingValue";
          this.globals.set(stmt.name, provisional);
          this.globalDecls.set(stmt.name, stmt);
          this.globalOrder.push(stmt.name);
        }
      }
    }

    // Pass 2: walk bodies, recording scoped variable types and per-node resolved types.
    // Top-level variable declarations are walked here too, which lets us refine
    // the global's type from the initializer expression when there is no annotation.
    for (const stmt of program.body) {
      this.visitStatement(stmt);
    }
  }

  /** Is `name` a top-level global (and not shadowed locally)? */
  isGlobal(name: string): boolean {
    if (!this.globals.has(name)) return false;
    // If any active scope declares this name, it's shadowed → treat as local.
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return false;
    }
    return true;
  }

  // ── Public query API ──────────────────────────────────────────────

  /** The resolved C type of any expression the resolver has seen. */
  typeOf(expr: Expression): CType {
    const found = this.exprTypes.get(expr);
    if (found) return found;
    // Fall back to shape-based inference for nodes we didn't annotate
    // (e.g. synthetic nodes produced by the emitter).
    return inferCType(expr);
  }

  /** What a given call expression actually resolves to. */
  callTargetOf(call: CallExpression): CallTarget | undefined {
    return this.callTargets.get(call);
  }

  // ── Scope management ──────────────────────────────────────────────

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private declare(name: string, type: CType): void {
    this.scopes[this.scopes.length - 1].set(name, type);
  }

  private lookupVar(name: string): CType | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const hit = this.scopes[i].get(name);
      if (hit) return hit;
    }
    return undefined;
  }

  // ── Imports ───────────────────────────────────────────────────────

  private collectImport(node: ImportDeclaration): void {
    if (!isDingModule(node.source)) return;

    const register = (name: string, map: Record<string, string>, target: Map<string, string>) => {
      const mapped = map[name];
      if (mapped) target.set(name, mapped);
    };

    if (node.source === "ding:std") {
      this.importedStd = true;
      if (node.default) register(node.default, C_STD_FUNCTION_MAP, this.stdRenames);
      for (const n of node.named) register(n, C_STD_FUNCTION_MAP, this.stdRenames);
    }
    if (node.source === "ding:math") {
      this.importedMath = true;
      if (node.default) register(node.default, C_MATH_FUNCTION_MAP, this.mathRenames);
      for (const n of node.named) register(n, C_MATH_FUNCTION_MAP, this.mathRenames);
    }
  }

  // ── Type helpers ──────────────────────────────────────────────────

  private annotationType(ann: TypeAnnotation | undefined): CType {
    return mapAnnotationToCType(ann);
  }

  private fieldType(fieldType: string): CType {
    return mapAnnotationToCType({ type: "TypeAnnotation", name: fieldType });
  }

  private inferFunctionReturnType(fn: ArrowFunction): CType {
    if (fn.returnType) return mapAnnotationToCType(fn.returnType);
    if (Array.isArray(fn.body)) {
      return this.blockHasReturn(fn.body) ? "DingValue" : "void";
    }
    return "DingValue";
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

  // ── Statement visitor ─────────────────────────────────────────────

  private visitStatement(stmt: Statement): void {
    switch (stmt.type) {
      case "VariableDeclaration":
        return this.visitVariableDeclaration(stmt);
      case "ExpressionStatement":
        this.visitExpression(stmt.expression);
        return;
      case "ReturnStatement":
        if (stmt.value) this.visitExpression(stmt.value);
        return;
      case "IfStatement":
        this.visitExpression(stmt.test);
        this.visitBlock(stmt.consequent);
        if (stmt.alternate) this.visitBlock(stmt.alternate);
        return;
      case "ForRangeStatement":
        this.visitExpression(stmt.start);
        this.visitExpression(stmt.end);
        this.pushScope();
        this.declare(stmt.identifier, "ding_int");
        for (const s of stmt.body) this.visitStatement(s);
        this.popScope();
        return;
      case "ForInStatement": {
        this.visitExpression(stmt.iterable);
        this.pushScope();
        // Array element comes out as DingValue from DingArray items.
        this.declare(stmt.identifier, "DingValue");
        for (const s of stmt.body) this.visitStatement(s);
        this.popScope();
        return;
      }
      case "WhileStatement":
        this.visitExpression(stmt.condition);
        this.visitBlock(stmt.body);
        return;
      case "StructDeclaration":
        this.visitStructDeclaration(stmt);
        return;
      case "TryCatchStatement":
        this.visitBlock(stmt.body);
        this.pushScope();
        this.declare(stmt.param, "DingValue");
        for (const s of stmt.catch) this.visitStatement(s);
        this.popScope();
        if (stmt.finally) this.visitBlock(stmt.finally);
        return;
      case "ThrowStatement":
        this.visitExpression(stmt.value);
        return;
      case "ImportDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
  }

  private visitBlock(stmts: Statement[]): void {
    this.pushScope();
    for (const s of stmts) this.visitStatement(s);
    this.popScope();
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    // Top-level arrow functions are already registered in pass 1;
    // we still walk the body so its inner expressions get annotated.
    if (node.init.type === "ArrowFunction") {
      this.visitArrowFunction(node.init, this.functions.get(node.name)?.returnType);
      // The top-level binding itself isn't referenced as a variable
      // (calls are lowered to ding_fn_<name>), so no need to declare it.
      return;
    }

    this.visitExpression(node.init);

    let varType: CType;
    if (node.annotation) {
      varType = mapAnnotationToCType(node.annotation);
    } else {
      varType = this.typeOf(node.init);
    }

    // ArrayLiteral / StructInstantiation bind to pointer types even though
    // their expression type is DingValue/DingArray*.
    if (node.init.type === "ArrayLiteral") varType = "DingArray*";
    if (node.init.type === "StructInstantiation") varType = `${node.init.name}*` as CType;

    // If this is the top-level declaration we registered as a global in
    // pass 1, refine its type here instead of shadowing it into a local.
    // Any *other* declaration (inner block, function body) becomes a local.
    if (this.globalDecls.get(node.name) === node) {
      this.globals.set(node.name, varType);
      return;
    }

    this.declare(node.name, varType);
  }

  private visitArrowFunction(fn: ArrowFunction, knownReturnType?: CType): void {
    this.pushScope();
    for (const p of fn.params) {
      this.declare(p.name, this.annotationType(p.annotation));
    }
    if (Array.isArray(fn.body)) {
      for (const s of fn.body) this.visitStatement(s);
    } else {
      this.visitExpression(fn.body);
    }
    this.popScope();
    void knownReturnType;
  }

  private visitStructDeclaration(decl: StructDeclaration): void {
    for (const method of decl.methods) {
      this.pushScope();
      for (const p of method.params) {
        if (p.name === "self") {
          this.declare("self", `${decl.name}*` as CType);
        } else {
          this.declare(p.name, this.annotationType(p.annotation));
        }
      }
      if (Array.isArray(method.body)) {
        for (const s of method.body) this.visitStatement(s);
      } else {
        this.visitExpression(method.body);
      }
      this.popScope();
    }
  }

  // ── Expression visitor ────────────────────────────────────────────

  /** Visit an expression and return the resolved CType, also caching it. */
  private visitExpression(expr: Expression): CType {
    const cached = this.exprTypes.get(expr);
    if (cached) return cached;
    const t = this.computeExpressionType(expr);
    this.exprTypes.set(expr, t);
    return t;
  }

  private computeExpressionType(expr: Expression): CType {
    switch (expr.type) {
      case "NumberLiteral":
        return Number.isInteger(expr.value) ? "ding_int" : "ding_float";
      case "StringLiteral":
        return "ding_string";
      case "BooleanLiteral":
        return "ding_bool";
      case "NullLiteral":
        return "DingValue";
      case "Identifier": {
        const known = this.lookupVar(expr.name);
        if (known) return known;
        // Not a local → check top-level globals (non-function bindings).
        // Record this specific node so the emitter knows to mangle its
        // name with the ding_g_ prefix. A local of the same name in a
        // nested scope would have matched `lookupVar` above and skipped this.
        const asGlobal = this.globals.get(expr.name);
        if (asGlobal) {
          this.globalRefs.add(expr);
          return asGlobal;
        }
        // Top-level user function referenced by name → function value, not commonly used.
        if (this.functions.has(expr.name)) return "DingValue";
        return "DingValue";
      }
      case "BinaryExpression": {
        const lt = this.visitExpression(expr.left);
        const rt = this.visitExpression(expr.right);
        const isComp = ["==", "!=", "<", ">", "<=", ">="].includes(expr.operator);
        if (isComp) return "ding_bool";
        if (expr.operator === "+" && (isStringType(lt) || isStringType(rt))) {
          return "ding_string";
        }
        if (isFloatType(lt) || isFloatType(rt)) return "ding_float";
        if (isIntegerType(lt) && isIntegerType(rt)) return "ding_int";
        // Mixed with DingValue → result as ding_int (emitter unwraps operands).
        if (lt === "DingValue" || rt === "DingValue") {
          const arith = ["+", "-", "*", "/", "%"].includes(expr.operator);
          if (arith) return "ding_int";
        }
        return "DingValue";
      }
      case "CallExpression": {
        this.visitExpression(expr.callee);
        for (const a of expr.arguments) this.visitExpression(a);
        const target = this.resolveCallTarget(expr);
        if (target) {
          this.callTargets.set(expr, target);
          return target.kind === "array-builtin" ? "void" : target.returnType;
        }
        return "DingValue";
      }
      case "TemplateLiteral": {
        for (const p of expr.parts) {
          if (typeof p !== "string") this.visitExpression(p);
        }
        return "ding_string";
      }
      case "ArrayLiteral": {
        for (const el of expr.elements) this.visitExpression(el);
        return "DingArray*";
      }
      case "ArrayAccess": {
        this.visitExpression(expr.array);
        this.visitExpression(expr.index);
        // Elements are heterogeneous DingValues.
        return "DingValue";
      }
      case "LengthExpression": {
        this.visitExpression(expr.target);
        return "ding_int";
      }
      case "MemberExpression": {
        const objType = this.visitExpression(expr.object);
        // Struct pointer field access.
        if (typeof objType === "string" && objType.endsWith("*")) {
          const base = objType.slice(0, -1);
          const decl = this.structs.get(base);
          if (decl) {
            const field = decl.fields.find((f) => f.name === expr.property);
            if (field) return this.fieldType(field.fieldType);
          }
        }
        // DingArray->length is special-cased elsewhere as LengthExpression,
        // so we fall through to DingValue for unknown accesses.
        return "DingValue";
      }
      case "StructInstantiation": {
        for (const f of expr.fields) this.visitExpression(f.value);
        // The raw expression yields a struct pointer; but in most contexts
        // it's stored into a local that we separately bind as StructName*.
        return `${expr.name}*` as CType;
      }
      case "ErrorPropagation":
        return this.visitExpression(expr.expression);
      case "NullishCoalescing": {
        const lt = this.visitExpression(expr.left);
        this.visitExpression(expr.right);
        return lt;
      }
      case "NullAssertion":
        return this.visitExpression(expr.expression);
      case "AssignmentExpression": {
        this.visitExpression(expr.target);
        return this.visitExpression(expr.value);
      }
      case "ArrowFunction":
        this.visitArrowFunction(expr);
        return "DingValue";
    }
  }

  // ── Call-target resolution ────────────────────────────────────────

  private resolveCallTarget(call: CallExpression): CallTarget | undefined {
    // Method calls: callee is MemberExpression
    if (call.callee.type === "MemberExpression") {
      const receiverType = this.visitExpression(call.callee.object);
      const method = call.callee.property;

      // Array builtins on either DingArray* or a DingValue-wrapped array.
      if (receiverType === "DingArray*" || receiverType === "DingValue") {
        if (method === "push" && call.arguments.length === 1) {
          const elementType = this.visitExpression(call.arguments[0]);
          return {
            kind: "array-builtin",
            op: "push",
            receiverIsDingValue: receiverType === "DingValue",
            elementType,
          };
        }
      }

      // Struct method: need the receiver's concrete struct type.
      let structName: string | null = null;
      if (typeof receiverType === "string" && receiverType.endsWith("*")) {
        const base = receiverType.slice(0, -1);
        if (this.structs.has(base)) structName = base;
      }
      if (!structName) {
        // Last-resort fallback: any struct that declares this method name.
        for (const [name, decl] of this.structs) {
          if (decl.methods.some((m) => m.name === method)) {
            structName = name;
            break;
          }
        }
      }
      if (structName) {
        const decl = this.structs.get(structName)!;
        const methodDecl = decl.methods.find((m) => m.name === method);
        const paramTypes: CType[] = methodDecl
          ? methodDecl.params
              .filter((p) => p.name !== "self")
              .map((p) => this.annotationType(p.annotation))
          : call.arguments.map(() => "DingValue" as CType);
        return {
          kind: "method",
          structName,
          methodName: method,
          cName: `${structName}_${method}`,
          paramTypes,
          returnType: "DingValue",
        };
      }
      return undefined;
    }

    // Identifier calls: stdlib, mathlib, or user function.
    if (call.callee.type === "Identifier") {
      const name = call.callee.name;
      if (this.stdRenames.has(name)) {
        const cName = this.stdRenames.get(name)!;
        return {
          kind: "std",
          cName,
          paramTypes: call.arguments.map(() => "DingValue" as CType),
          returnType: "void",
        };
      }
      if (this.mathRenames.has(name)) {
        const cName = this.mathRenames.get(name)!;
        return {
          kind: "math",
          cName,
          paramTypes: call.arguments.map(() => "ding_float" as CType),
          returnType: "ding_float",
        };
      }
      const userFn = this.functions.get(name);
      if (userFn) {
        return {
          kind: "user",
          cName: `ding_fn_${name}`,
          paramTypes: userFn.paramTypes,
          returnType: userFn.returnType,
        };
      }
    }
    return undefined;
  }
}
