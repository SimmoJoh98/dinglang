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
  EnumDeclaration,
  MatchArm,
  DestructuringDeclaration,
} from "../../ast/nodes.js";
import {
  mapAnnotationToCType,
  inferCType,
  isIntegerType,
  isFloatType,
  isStringType,
  type CType,
} from "./types.js";
import { C_STD_FUNCTION_MAP, C_MATH_FUNCTION_MAP, C_STRING_METHOD_MAP, C_IO_FUNCTION_MAP, C_JSON_FUNCTION_MAP, C_HTTP_FUNCTION_MAP, C_CONCURRENT_FUNCTION_MAP } from "./stdlib.js";

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
    }
  | {
      kind: "array-method";
      op: "map" | "filter" | "forEach" | "reduce" | "find" | "includes";
      receiverIsDingValue: boolean;
      callback?: ArrowFunction;      // for map/filter/forEach/reduce/find
      initialValue?: Expression;      // for reduce's second argument
    }
  | {
      kind: "map-builtin";
      op: "has" | "keys" | "values" | "delete";
    };

export interface FunctionSignature {
  params: Parameter[];
  paramTypes: CType[];
  returnType: CType;
}

interface ScopeFrame {
  vars: Map<string, CType>;
  isFunctionBoundary: boolean;
}

export interface CaptureInfo {
  captures: Map<string, CType>; // variable name → type
  envStructName: string;        // generated name: __closure_env_0
}

export class Resolver {
  readonly exprTypes: WeakMap<Expression, CType> = new WeakMap();
  readonly callTargets: WeakMap<CallExpression, CallTarget> = new WeakMap();
  /** Identifier nodes that were resolved to a top-level global binding */
  readonly globalRefs: WeakSet<Identifier> = new WeakSet();
  /** Closure capture info: which variables each closure captures. */
  readonly closureInfos: WeakMap<ArrowFunction, CaptureInfo> = new WeakMap();
  /** Quick check: does this arrow function capture variables? */
  readonly isClosure: WeakSet<ArrowFunction> = new WeakSet();
  /** For each enclosing function, which of its locals are captured by inner closures. */
  readonly escapedVars: WeakMap<ArrowFunction, Set<string>> = new WeakMap();
  private closureCounter: number = 0;
  /** Stack of ArrowFunction nodes we're currently inside (for capture tracking). */
  private fnStack: ArrowFunction[] = [];

  readonly structs: Map<string, StructDeclaration> = new Map();
  readonly enums: Map<string, EnumDeclaration> = new Map();
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
  readonly ioRenames: Map<string, string> = new Map();
  readonly jsonRenames: Map<string, string> = new Map();
  readonly httpRenames: Map<string, string> = new Map();
  readonly concurrentRenames: Map<string, string> = new Map();
  importedStd: boolean = false;
  importedMath: boolean = false;
  importedIo: boolean = false;
  importedJson: boolean = false;
  importedHttp: boolean = false;
  importedConcurrent: boolean = false;
  readonly typeAliases: Map<string, CType> = new Map();

  /** Scope stack. The outermost frame is the file/module scope; globals
   *  live in `globals`, not on this stack, so that local declarations
   *  can properly shadow them without mutating global state. */
  private scopes: ScopeFrame[] = [{ vars: new Map(), isFunctionBoundary: false }];

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
      if (stmt.type === "TypeAliasDeclaration") {
        this.typeAliases.set(stmt.name, mapAnnotationToCType(stmt.alias));
      }
      if (stmt.type === "EnumDeclaration") {
        this.enums.set(stmt.name, stmt);
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
      if (this.scopes[i].vars.has(name)) return false;
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

  private pushScope(isFunctionBoundary: boolean = false): void {
    this.scopes.push({ vars: new Map(), isFunctionBoundary });
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private declare(name: string, type: CType): void {
    this.scopes[this.scopes.length - 1].vars.set(name, type);
  }

  private lookupVar(name: string): CType | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const hit = this.scopes[i].vars.get(name);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Look up a variable, and if it crosses a function boundary, record it as captured. */
  private lookupVarWithCapture(name: string, identNode?: Identifier): CType | undefined {
    let crossedBoundary = false;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (i < this.scopes.length - 1 && this.scopes[i + 1].isFunctionBoundary) {
        crossedBoundary = true;
      }
      const hit = this.scopes[i].vars.get(name);
      if (hit && crossedBoundary && this.fnStack.length > 0) {
        // This variable is captured from an outer scope
        const currentFn = this.fnStack[this.fnStack.length - 1];
        let info = this.closureInfos.get(currentFn);
        if (!info) {
          info = { captures: new Map(), envStructName: `__closure_env_${this.closureCounter++}` };
          this.closureInfos.set(currentFn, info);
          this.isClosure.add(currentFn);
        }
        info.captures.set(name, hit);

        // Mark the variable as escaped in the enclosing function
        for (let f = this.fnStack.length - 2; f >= 0; f--) {
          const outerFn = this.fnStack[f];
          let escaped = this.escapedVars.get(outerFn);
          if (!escaped) {
            escaped = new Set();
            this.escapedVars.set(outerFn, escaped);
          }
          escaped.add(name);
          break; // only immediate parent needs to know
        }
        return hit;
      }
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
    if (node.source === "ding:io") {
      this.importedIo = true;
      if (node.default) register(node.default, C_IO_FUNCTION_MAP, this.ioRenames);
      for (const n of node.named) register(n, C_IO_FUNCTION_MAP, this.ioRenames);
    }
    if (node.source === "ding:json") {
      this.importedJson = true;
      if (node.default) register(node.default, C_JSON_FUNCTION_MAP, this.jsonRenames);
      for (const n of node.named) register(n, C_JSON_FUNCTION_MAP, this.jsonRenames);
    }
    if (node.source === "ding:http") {
      this.importedHttp = true;
      if (node.default) register(node.default, C_HTTP_FUNCTION_MAP, this.httpRenames);
      for (const n of node.named) register(n, C_HTTP_FUNCTION_MAP, this.httpRenames);
    }
    if (node.source === "ding:concurrent") {
      this.importedConcurrent = true;
      if (node.default) register(node.default, C_CONCURRENT_FUNCTION_MAP, this.concurrentRenames);
      for (const n of node.named) register(n, C_CONCURRENT_FUNCTION_MAP, this.concurrentRenames);
    }
  }

  // ── Type helpers ──────────────────────────────────────────────────

  private annotationType(ann: TypeAnnotation | undefined): CType {
    if (ann && this.typeAliases.has(ann.name)) {
      return this.typeAliases.get(ann.name)!;
    }
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
      case "EnumDeclaration":
        return; // collected in pass 1
      case "MatchStatement": {
        this.visitExpression(stmt.subject);
        for (const arm of stmt.arms) this.visitMatchArm(arm);
        return;
      }
      case "DestructuringDeclaration":
        return this.visitDestructuringDeclaration(stmt);
      case "SpawnStatement":
        this.visitExpression(stmt.body);
        return;
      case "TypeAliasDeclaration":
        return; // collected in pass 1
      case "ImportDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
  }

  private visitMatchArm(arm: MatchArm): void {
    if (arm.pattern.kind === "literal") this.visitExpression(arm.pattern.value);
    if (arm.pattern.kind === "range") {
      this.visitExpression(arm.pattern.start);
      this.visitExpression(arm.pattern.end);
    }
    if (Array.isArray(arm.body)) {
      this.visitBlock(arm.body);
    } else {
      this.visitExpression(arm.body);
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
    if (node.init.type === "MapLiteral") varType = "DingMap*";
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

  private visitDestructuringDeclaration(node: DestructuringDeclaration): void {
    this.visitExpression(node.init);
    const initType = this.typeOf(node.init);

    if (node.pattern.kind === "array") {
      for (const name of node.pattern.elements) {
        if (name !== null) this.declare(name, "DingValue");
      }
    } else {
      // Object destructuring — try to resolve field types from struct
      let structDecl: StructDeclaration | undefined;
      if (typeof initType === "string" && initType.endsWith("*")) {
        const base = initType.slice(0, -1);
        structDecl = this.structs.get(base);
      }
      for (const prop of node.pattern.properties) {
        let fieldCType: CType = "DingValue";
        if (structDecl) {
          const field = structDecl.fields.find((f) => f.name === prop);
          if (field) fieldCType = this.fieldType(field.fieldType);
        }
        this.declare(prop, fieldCType);
      }
    }
  }

  private visitArrowFunction(fn: ArrowFunction, knownReturnType?: CType): void {
    this.pushScope(true); // function boundary
    this.fnStack.push(fn);
    for (const p of fn.params) {
      this.declare(p.name, this.annotationType(p.annotation));
    }
    if (Array.isArray(fn.body)) {
      for (const s of fn.body) this.visitStatement(s);
    } else {
      this.visitExpression(fn.body);
    }
    this.fnStack.pop();
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
        const known = this.fnStack.length > 0
          ? this.lookupVarWithCapture(expr.name, expr)
          : this.lookupVar(expr.name);
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
        const isLogical = ["&&", "||"].includes(expr.operator);
        if (isComp || isLogical) return "ding_bool";
        if (expr.operator === "**") return "ding_float";
        if (expr.operator === "+" && (isStringType(lt) || isStringType(rt))) {
          return "ding_string";
        }
        if (expr.operator === "*" && (isStringType(lt) || isStringType(rt))) {
          return "ding_string";
        }
        // Bitwise operators always return integer
        const isBitwise = ["&", "|", "^", "<<", ">>"].includes(expr.operator);
        if (isBitwise) return "ding_int";
        if (isFloatType(lt) || isFloatType(rt)) return "ding_float";
        if (isIntegerType(lt) && isIntegerType(rt)) return "ding_int";
        // Mixed with DingValue → result as ding_int (emitter unwraps operands).
        if (lt === "DingValue" || rt === "DingValue") {
          const arith = ["+", "-", "*", "/", "%"].includes(expr.operator);
          if (arith) return "ding_int";
        }
        return "DingValue";
      }
      case "UnaryExpression": {
        const operandType = this.visitExpression(expr.operand);
        if (expr.operator === "!") return "ding_bool";
        if (expr.operator === "~") return "ding_int";
        if (expr.operator === "-") return operandType;
        return operandType;
      }
      case "CallExpression": {
        this.visitExpression(expr.callee);
        for (const a of expr.arguments) this.visitExpression(a);
        const target = this.resolveCallTarget(expr);
        if (target) {
          this.callTargets.set(expr, target);
          if (target.kind === "array-builtin") return "void";
          if (target.kind === "array-method") {
            switch (target.op) {
              case "map": case "filter": return "DingArray*";
              case "forEach": return "void";
              case "reduce": case "find": return "DingValue";
              case "includes": return "ding_bool";
            }
          }
          if (target.kind === "map-builtin") {
            switch (target.op) {
              case "has": return "ding_bool";
              case "keys": case "values": return "DingArray*";
              case "delete": return "void";
            }
          }
          return target.returnType;
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
        for (const el of expr.elements) {
          if (el.type === "SpreadElement") {
            this.visitExpression(el.argument);
          } else {
            this.visitExpression(el);
          }
        }
        return "DingArray*";
      }
      case "MapLiteral": {
        for (const entry of expr.entries) {
          this.visitExpression(entry.key);
          this.visitExpression(entry.value);
        }
        return "DingMap*";
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
        // Enum access: Color.Red → ding_int
        if (expr.object.type === "Identifier" && this.enums.has(expr.object.name)) {
          return "ding_int";
        }
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
      case "MatchExpression": {
        this.visitExpression(expr.subject);
        for (const arm of expr.arms) this.visitMatchArm(arm);
        return "DingValue";
      }
    }
  }

  // ── Call-target resolution ────────────────────────────────────────

  private resolveCallTarget(call: CallExpression): CallTarget | undefined {
    // Method calls: callee is MemberExpression
    if (call.callee.type === "MemberExpression") {
      const receiverType = this.visitExpression(call.callee.object);
      const method = call.callee.property;

      // String method calls
      if (isStringType(receiverType)) {
        const strMethod = C_STRING_METHOD_MAP[method];
        if (strMethod) {
          return {
            kind: "std",
            cName: strMethod.cName,
            paramTypes: call.arguments.map(() => "ding_string" as CType),
            returnType: strMethod.returnType as CType,
          };
        }
      }

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
        const arrayMethods = ["map", "filter", "forEach", "reduce", "find", "includes"] as const;
        type ArrayMethodOp = typeof arrayMethods[number];
        if (arrayMethods.includes(method as ArrayMethodOp)) {
          const op = method as ArrayMethodOp;
          let callback: ArrowFunction | undefined;
          let initialValue: Expression | undefined;
          if (op !== "includes" && call.arguments.length >= 1 && call.arguments[0].type === "ArrowFunction") {
            callback = call.arguments[0];
            this.visitArrowFunction(callback);
          }
          if (op === "reduce" && call.arguments.length >= 2) {
            initialValue = call.arguments[1];
            this.visitExpression(initialValue);
          }
          if (op === "includes" && call.arguments.length >= 1) {
            this.visitExpression(call.arguments[0]);
          }
          return {
            kind: "array-method",
            op,
            receiverIsDingValue: receiverType === "DingValue",
            callback,
            initialValue,
          };
        }
      }

      // Channel methods
      if (receiverType === "DingChannel*") {
        if (method === "send" || method === "receive") {
          for (const a of call.arguments) this.visitExpression(a);
          return {
            kind: "std",
            cName: method === "send" ? "ding_channel_send" : "ding_channel_receive",
            paramTypes: method === "send" ? ["DingChannel*" as CType, "DingValue"] : ["DingChannel*" as CType],
            returnType: method === "send" ? "void" : "DingValue",
          };
        }
      }

      // Map methods
      if (receiverType === "DingMap*" || receiverType === "DingValue") {
        const mapMethods = ["has", "keys", "values", "delete"] as const;
        type MapMethodOp = typeof mapMethods[number];
        if (mapMethods.includes(method as MapMethodOp)) {
          for (const a of call.arguments) this.visitExpression(a);
          return {
            kind: "map-builtin",
            op: method as MapMethodOp,
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
      if (this.ioRenames.has(name)) {
        const cName = this.ioRenames.get(name)!;
        // IO function return types vary
        const retTypes: Record<string, CType> = {
          ding_io_readFile: "ding_string",
          ding_io_writeFile: "void",
          ding_io_appendFile: "void",
          ding_io_readLine: "ding_string",
          ding_io_args: "DingArray*",
          ding_io_exists: "ding_bool",
        };
        return {
          kind: "std",
          cName,
          paramTypes: call.arguments.map(() => "ding_string" as CType),
          returnType: retTypes[cName] ?? "DingValue",
        };
      }
      if (this.jsonRenames.has(name)) {
        const cName = this.jsonRenames.get(name)!;
        return {
          kind: "std",
          cName,
          paramTypes: cName === "ding_json_parse"
            ? ["ding_string" as CType]
            : ["DingValue" as CType],
          returnType: cName === "ding_json_parse" ? "DingValue" : "ding_string",
        };
      }
      if (this.httpRenames.has(name)) {
        const cName = this.httpRenames.get(name)!;
        return {
          kind: "std",
          cName,
          paramTypes: call.arguments.map(() => "ding_string" as CType),
          returnType: "ding_string",
        };
      }
      if (this.concurrentRenames.has(name)) {
        const cName = this.concurrentRenames.get(name)!;
        return {
          kind: "std",
          cName,
          paramTypes: [],
          returnType: "DingChannel*" as CType,
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
