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
  UnaryExpression,
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
  EnumDeclaration,
  MatchStatement,
  MatchExpression,
  MatchArm,
  DestructuringDeclaration,
  MapLiteral,
  SpawnStatement,
} from "../../ast/nodes.js";
import { C_RUNTIME } from "./runtime.js";
import { cArena, DEFAULT_ARENA_SIZE } from "./arena.js";
import { C_STDLIB_STD, C_STDLIB_MATH, C_STRING_METHODS, C_STRING_METHOD_MAP, C_MAP_RUNTIME, C_STDLIB_IO, C_STDLIB_JSON, C_STDLIB_HTTP, C_STDLIB_CONCURRENT } from "./stdlib.js";
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
import { Resolver, type CallTarget, type CaptureInfo } from "./resolver.js";

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
  private usesStringMethods: boolean = false;
  private closureDecls: string[] = [];

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

    // Pthread header must come before arena when concurrent is imported
    if (this.resolver.importedConcurrent) {
      sections.push("#include <pthread.h>");
    }

    // Arena allocator (capacity baked in from the CEmitter options;
    // a `#[arena(size=...)]` directive flows through here)
    sections.push(cArena(this.arenaSize, this.resolver.importedConcurrent));

    // Stdlib sections
    if (this.resolver.importedStd) {
      sections.push(C_STDLIB_STD);
    }
    if (this.resolver.importedMath) {
      sections.push(C_STDLIB_MATH);
    }

    // String methods — always included (small overhead, widely useful)
    sections.push(C_STRING_METHODS);

    // Map runtime — always included
    sections.push(C_MAP_RUNTIME);

    // IO stdlib
    if (this.resolver.importedIo) {
      sections.push(C_STDLIB_IO);
    }

    // JSON stdlib
    if (this.resolver.importedJson) {
      sections.push(C_STDLIB_JSON);
    }

    // HTTP stdlib
    if (this.resolver.importedHttp) {
      sections.push(C_STDLIB_HTTP);
    }

    // Concurrent stdlib
    if (this.resolver.importedConcurrent) {
      sections.push(C_STDLIB_CONCURRENT);
    }

    // Type aliases
    for (const [name, cType] of this.resolver.typeAliases) {
      sections.push(`typedef ${cType} ${name};`);
    }

    // Enum declarations
    for (const [, decl] of this.resolver.enums) {
      sections.push(this.emitEnumDefinition(decl));
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
    // Buffer top-level functions so closureDecls (populated as a side effect)
    // can be emitted first.
    const topLevelFunctions: string[] = [];
    const mainStatements: string[] = [];

    for (const stmt of program.body) {
      if (stmt.type === "StructDeclaration") continue;
      if (stmt.type === "ImportDeclaration") continue;
      if (stmt.type === "EnumDeclaration") continue; // already emitted above
      if (stmt.type === "TypeAliasDeclaration") continue; // already emitted above

      if (stmt.type === "VariableDeclaration" && stmt.init.type === "ArrowFunction") {
        topLevelFunctions.push(this.emitTopLevelFunction(stmt.name, stmt.init));
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

    // Closure environment structs and functions — must come before top-level functions
    if (this.closureDecls.length > 0) {
      sections.push(this.closureDecls.join("\n"));
    }

    // Top-level user functions
    for (const fn of topLevelFunctions) {
      sections.push(fn);
    }

    // main() function
    if (this.resolver.importedIo) {
      sections.push("int main(int argc, char** argv) {");
      sections.push("  __ding_argc = argc;");
      sections.push("  __ding_argv = argv;");
    } else {
      sections.push("int main() {");
    }
    sections.push("  ding_arena_init();");
    for (const s of mainStatements) {
      sections.push(s);
    }
    sections.push("  ding_arena_free();");
    sections.push("  return 0;");
    sections.push("}");

    return sections.join("\n");
  }

  /** Return additional linker flags required by imported modules. */
  getRequiredLibs(): string[] {
    const libs: string[] = ["-lm"];
    if (this.resolver.importedHttp) libs.push("-lcurl");
    if (this.resolver.importedConcurrent) libs.push("-lpthread");
    return libs;
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
        if (elem.type === "SpreadElement") {
          const srcExpr = this.emitExpression(elem.argument);
          const tmp = `__spread_${this.tempCounter++}`;
          lines.push(`${this.pad()}for (ding_int ${tmp} = 0; ${tmp} < ${srcExpr}->length; ${tmp}++) {`);
          lines.push(`${this.pad()}  ding_array_push(${gName}, ${srcExpr}->items[${tmp}]);`);
          lines.push(`${this.pad()}}`);
        } else {
          const elemExpr = this.emitExpression(elem);
          const elemType = this.resolveType(elem);
          const wrapped = wrapAsDingValue(elemExpr, elemType);
          lines.push(`${this.pad()}ding_array_push(${gName}, ${wrapped});`);
        }
      }
      return lines.join("\n");
    }

    // Map literal: allocate + set each entry.
    if (init.type === "MapLiteral") {
      const lines: string[] = [];
      lines.push(`${this.pad()}${gName} = ding_map_new();`);
      for (const entry of init.entries) {
        const keyExpr = this.emitExpression(entry.key);
        const valExpr = this.emitExpression(entry.value);
        const valType = this.resolveType(entry.value);
        const wrapped = wrapAsDingValue(valExpr, valType);
        lines.push(`${this.pad()}ding_map_set(${gName}, ${keyExpr}, ${wrapped});`);
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
      case "EnumDeclaration":
        return null; // handled in pre-pass
      case "TypeAliasDeclaration":
        return null; // handled in pre-pass
      case "MatchStatement":
        return this.emitMatchStatement(node);
      case "DestructuringDeclaration":
        return this.emitDestructuringDeclaration(node);
      case "SpawnStatement":
        return this.emitSpawnStatement(node);
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

    // Map literal needs multi-statement expansion
    if (node.init.type === "MapLiteral") {
      return this.emitMapDeclaration(node.name, node.init);
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

  private emitDestructuringDeclaration(node: DestructuringDeclaration): string {
    const lines: string[] = [];
    const tmp = `__destr_${this.tempCounter++}`;
    const initType = this.resolveType(node.init);

    if (node.pattern.kind === "array") {
      // Array destructuring: const [a, b, c] = arr
      const initExpr = this.emitExpression(node.init);
      const arrExpr = initType === "DingValue" ? `${initExpr}.as_array` : initExpr;
      lines.push(`${this.pad()}DingArray* ${tmp} = ${arrExpr};`);
      for (let i = 0; i < node.pattern.elements.length; i++) {
        const name = node.pattern.elements[i];
        if (name !== null) {
          lines.push(`${this.pad()}DingValue ${name} = ding_array_get(${tmp}, ${i});`);
        }
      }
    } else {
      // Object/struct destructuring: const { name, age } = person
      const initExpr = this.emitExpression(node.init);
      // Determine struct type
      let structName: string | null = null;
      if (typeof initType === "string" && initType.endsWith("*")) {
        const base = initType.slice(0, -1);
        if (this.structs.has(base)) structName = base;
      }
      if (structName) {
        lines.push(`${this.pad()}${structName}* ${tmp} = ${initExpr};`);
        const decl = this.structs.get(structName)!;
        for (const prop of node.pattern.properties) {
          const field = decl.fields.find((f) => f.name === prop);
          const cType = field ? this.fieldTypeToCType(field.fieldType) : "DingValue";
          lines.push(`${this.pad()}${cType} ${prop} = ${tmp}->${prop};`);
        }
      } else {
        // Fallback: DingValue access
        lines.push(`${this.pad()}DingValue ${tmp} = ${initExpr};`);
        for (const prop of node.pattern.properties) {
          lines.push(`${this.pad()}DingValue ${prop} = ${tmp};`);
        }
      }
    }
    return lines.join("\n");
  }

  private emitArrayDeclaration(name: string, node: ArrayLiteral): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}DingArray* ${name} = ding_array_new();`);
    for (const elem of node.elements) {
      if (elem.type === "SpreadElement") {
        const srcExpr = this.emitExpression(elem.argument);
        const tmp = `__spread_${this.tempCounter++}`;
        lines.push(`${this.pad()}for (ding_int ${tmp} = 0; ${tmp} < ${srcExpr}->length; ${tmp}++) {`);
        lines.push(`${this.pad()}  ding_array_push(${name}, ${srcExpr}->items[${tmp}]);`);
        lines.push(`${this.pad()}}`);
      } else {
        const elemExpr = this.emitExpression(elem);
        const elemType = inferCType(elem);
        const wrapped = wrapAsDingValue(elemExpr, elemType);
        lines.push(`${this.pad()}ding_array_push(${name}, ${wrapped});`);
      }
    }
    return lines.join("\n");
  }

  private emitMapLiteralExpr(node: MapLiteral): string {
    const tmp = `__map_${this.tempCounter++}`;
    const lines: string[] = [];
    lines.push(`({`);
    lines.push(`    DingMap* ${tmp} = ding_map_new();`);
    for (const entry of node.entries) {
      const keyExpr = this.emitExpression(entry.key);
      const valExpr = this.emitExpression(entry.value);
      const valType = this.resolveType(entry.value);
      const wrapped = wrapAsDingValue(valExpr, valType);
      lines.push(`    ding_map_set(${tmp}, ${keyExpr}, ${wrapped});`);
    }
    lines.push(`    ${tmp};`);
    lines.push(`  })`);
    return lines.join("\n");
  }

  private emitMapDeclaration(name: string, node: MapLiteral): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}DingMap* ${name} = ding_map_new();`);
    for (const entry of node.entries) {
      const keyExpr = this.emitExpression(entry.key);
      const valExpr = this.emitExpression(entry.value);
      const valType = this.resolveType(entry.value);
      const wrapped = wrapAsDingValue(valExpr, valType);
      lines.push(`${this.pad()}ding_map_set(${name}, ${keyExpr}, ${wrapped});`);
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
      // Map bracket assignment: map["key"] = value
      if (node.expression.target.type === "ArrayAccess") {
        const arrType = this.resolveType(node.expression.target.array);
        if (arrType === "DingMap*") {
          const map = this.emitExpression(node.expression.target.array);
          const key = this.emitAs(node.expression.target.index, "ding_string");
          const valExpr = this.emitExpression(node.expression.value);
          const valType = this.resolveType(node.expression.value);
          const wrapped = wrapAsDingValue(valExpr, valType);
          return `${this.pad()}ding_map_set(${map}, ${key}, ${wrapped});`;
        }
      }
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
    const iterType = this.resolveType(node.iterable);
    const iterable = this.emitExpression(node.iterable);
    const lines: string[] = [];

    if (iterType === "DingMap*") {
      // Map iteration: iterate buckets, skip unoccupied
      lines.push(`${this.pad()}for (ding_int __i = 0; __i < ${iterable}->capacity; __i++) {`);
      this.indent++;
      lines.push(`${this.pad()}if (!${iterable}->buckets[__i].occupied) continue;`);
      lines.push(`${this.pad()}DingValue ${id} = (DingValue){.type=DING_STRING, .as_string=${iterable}->buckets[__i].key};`);
      for (const stmt of node.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
      lines.push(`${this.pad()}}`);
    } else {
      // Array iteration (default)
      const arr = iterType === "DingValue" ? `${iterable}.as_array` : iterable;
      lines.push(`${this.pad()}for (ding_int __i = 0; __i < ${arr}->length; __i++) {`);
      this.indent++;
      lines.push(`${this.pad()}DingValue ${id} = ${arr}->items[__i];`);
      for (const stmt of node.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
      lines.push(`${this.pad()}}`);
    }

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
      // Default parameter checks
      for (const line of this.emitDefaultParamChecks(fn.params)) {
        lines.push(line);
      }
      for (const stmt of fn.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
    } else {
      this.indent++;
      // Default parameter checks
      for (const line of this.emitDefaultParamChecks(fn.params)) {
        lines.push(line);
      }
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
      case "UnaryExpression":
        return this.emitUnaryExpression(node);
      case "ArrowFunction":
        return this.emitClosureExpression(node);
      case "CallExpression":
        return this.emitCallExpression(node);
      case "TemplateLiteral":
        return this.emitTemplateLiteral(node);
      case "MapLiteral":
        return this.emitMapLiteralExpr(node);
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
      case "MatchExpression":
        return this.emitMatchExpression(node);
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
    if (this.resolver.ioRenames.has(name)) return this.resolver.ioRenames.get(name)!;
    if (this.resolver.jsonRenames.has(name)) return this.resolver.jsonRenames.get(name)!;
    if (this.resolver.httpRenames.has(name)) return this.resolver.httpRenames.get(name)!;
    if (this.resolver.concurrentRenames.has(name)) return this.resolver.concurrentRenames.get(name)!;
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

    // Power operator: lower to pow()
    if (node.operator === "**") {
      const left = this.emitAs(node.left, "ding_float");
      const right = this.emitAs(node.right, "ding_float");
      return `pow(${left}, ${right})`;
    }

    // String repeat: "str" * n or n * "str"
    if (node.operator === "*" && (isStringType(leftType) || isStringType(rightType))) {
      const strExpr = isStringType(leftType) ? this.emitExpression(node.left) : this.emitExpression(node.right);
      const intExpr = isStringType(leftType) ? this.emitAs(node.right, "ding_int") : this.emitAs(node.left, "ding_int");
      return `ding_string_repeat(${strExpr}, ${intExpr})`;
    }

    // String concatenation
    if (node.operator === "+" && (leftType === "ding_string" || rightType === "ding_string")) {
      const left = leftType === "ding_string" ? this.emitExpression(node.left) : this.coerceToString(this.emitExpression(node.left), leftType);
      const right = rightType === "ding_string" ? this.emitExpression(node.right) : this.coerceToString(this.emitExpression(node.right), rightType);
      return `ding_string_concat(${left}, ${right})`;
    }

    // For arithmetic/comparison/bitwise: unwrap DingValue operands to int
    const isArith = ["+", "-", "*", "/", "%"].includes(node.operator);
    const isBitwise = ["&", "|", "^", "<<", ">>"].includes(node.operator);
    const isComp = ["<", ">", "<=", ">=", "==", "!="].includes(node.operator);
    if ((isArith || isComp || isBitwise) && (leftType === "DingValue" || rightType === "DingValue")) {
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

      // String methods — lower to ding_string_* runtime calls.
      if (isStringType(receiverType)) {
        const strMethod = C_STRING_METHOD_MAP[method];
        if (strMethod) {
          const args = node.arguments.map((a) => this.emitExpression(a));
          return `${strMethod.cName}(${[obj, ...args].join(", ")})`;
        }
      }

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
        // Higher-order array methods: delegate to resolver-driven inlining
        const arrayTarget = this.resolver.callTargetOf(node);
        if (arrayTarget && arrayTarget.kind === "array-method") {
          return this.emitArrayMethod(node, arrayTarget);
        }
      }

      // Channel methods
      if (receiverType === "DingChannel*") {
        if (method === "send") {
          const arg = this.emitAs(node.arguments[0], "DingValue");
          return `ding_channel_send(${obj}, ${arg})`;
        }
        if (method === "receive") {
          return `ding_channel_receive(${obj})`;
        }
      }

      // Map methods
      if (receiverType === "DingMap*") {
        const mapTarget = this.resolver.callTargetOf(node);
        if (mapTarget && mapTarget.kind === "map-builtin") {
          const args = node.arguments.map((a) => this.emitExpression(a));
          switch (mapTarget.op) {
            case "has": return `ding_map_has(${obj}, ${args[0]})`;
            case "keys": return `ding_map_keys(${obj})`;
            case "values": return `ding_map_values(${obj})`;
            case "delete": return `ding_map_delete(${obj}, ${args[0]})`;
          }
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
    const target = this.resolver.callTargetOf(node);
    if (target && target.kind === "array-method") {
      return this.emitArrayMethod(node, target);
    }
    if (target && target.kind !== "array-builtin" && target.kind !== "map-builtin") {
      // Pad missing arguments with DING_VALUE_NULL for default parameters
      const totalParams = target.paramTypes.length;
      const args: string[] = [];
      for (let i = 0; i < totalParams; i++) {
        const expected = target.paramTypes[i] ?? "DingValue";
        if (i < node.arguments.length) {
          args.push(this.emitAs(node.arguments[i], expected));
        } else {
          args.push("DING_VALUE_NULL");
        }
      }
      return `${target.cName}(${args.join(", ")})`;
    }

    // Closure call: if the callee is a DingValue (could be a closure),
    // use ding_closure_call with a DingValue args array.
    if (node.callee.type === "Identifier") {
      const calleeType = this.resolveType(node.callee);
      if (calleeType === "DingValue") {
        const callee = this.emitExpression(node.callee);
        if (node.arguments.length === 0) {
          return `ding_closure_call(${callee}, NULL, 0)`;
        }
        const argsTmp = `__args_${this.tempCounter++}`;
        const argExprs = node.arguments.map((a) => this.emitAs(a, "DingValue"));
        const lines = [
          `({`,
          `    DingValue ${argsTmp}[] = { ${argExprs.join(", ")} };`,
          `    ding_closure_call(${callee}, ${argsTmp}, ${node.arguments.length});`,
          `  })`,
        ];
        return lines.join("\n");
      }
    }

    // Fallback for calls the resolver couldn't identify.
    const callee = this.emitExpression(node.callee);
    const args = node.arguments.map((a) => this.emitExpression(a));
    return `${callee}(${args.join(", ")})`;
  }

  // ── Spawn ────────────────────────────────────────────────────────────

  private emitSpawnStatement(node: SpawnStatement): string {
    if (node.body.type !== "ArrowFunction") {
      throw new DingError("emitter", "spawn requires an arrow function: spawn () => { ... }");
    }
    const fn = node.body;
    const spawnFnName = `__spawn_fn_${this.tempCounter++}`;
    const threadVar = `__thread_${this.tempCounter++}`;

    // Check if the arrow captures anything (closure)
    const captureInfo = this.resolver.closureInfos.get(fn);
    const hasCaptures = captureInfo && captureInfo.captures.size > 0;

    if (hasCaptures) {
      // Emit env struct and spawn function that receives it
      const envName = captureInfo!.envStructName;
      this.emitClosureEnvStruct(envName, captureInfo!);

      const lines: string[] = [];
      lines.push(`void* ${spawnFnName}(void* __arg) {`);
      lines.push(`  ${envName}* __env = (${envName}*)__arg;`);
      for (const [varName, varType] of captureInfo!.captures) {
        lines.push(`  ${varType} ${varName} = __env->${varName};`);
      }
      if (Array.isArray(fn.body)) {
        this.indent++;
        for (const stmt of fn.body) {
          const result = this.emitStatement(stmt);
          if (result !== null) lines.push(result);
        }
        this.indent--;
      } else {
        lines.push(`  ${this.emitExpression(fn.body)};`);
      }
      lines.push(`  return NULL;`);
      lines.push(`}`);
      this.closureDecls.push(lines.join("\n"));

      // Emit spawn site with env
      const envTmp = `__env_${this.tempCounter++}`;
      const spawnLines: string[] = [];
      spawnLines.push(`${this.pad()}${envName}* ${envTmp} = (${envName}*)ding_alloc(sizeof(${envName}));`);
      for (const [varName] of captureInfo!.captures) {
        spawnLines.push(`${this.pad()}${envTmp}->${varName} = ${varName};`);
      }
      spawnLines.push(`${this.pad()}pthread_t ${threadVar};`);
      spawnLines.push(`${this.pad()}pthread_create(&${threadVar}, NULL, ${spawnFnName}, ${envTmp});`);
      spawnLines.push(`${this.pad()}pthread_detach(${threadVar});`);
      return spawnLines.join("\n");
    }

    // No captures — simple static function
    const lines: string[] = [];
    lines.push(`void* ${spawnFnName}(void* __arg) {`);
    lines.push(`  (void)__arg;`);
    if (Array.isArray(fn.body)) {
      this.indent++;
      for (const stmt of fn.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
    } else {
      lines.push(`  ${this.emitExpression(fn.body)};`);
    }
    lines.push(`  return NULL;`);
    lines.push(`}`);
    this.closureDecls.push(lines.join("\n"));

    return `${this.pad()}pthread_t ${threadVar};\n${this.pad()}pthread_create(&${threadVar}, NULL, ${spawnFnName}, NULL);\n${this.pad()}pthread_detach(${threadVar});`;
  }

  // ── Closures ──────────────────────────────────────────────────────────

  private emitClosureExpression(node: ArrowFunction): string {
    const info = this.resolver.closureInfos.get(node);
    const fnName = `__closure_fn_${this.tempCounter++}`;

    if (!info || info.captures.size === 0) {
      // No captures — emit as a static function with NULL env
      this.emitClosureFunction(fnName, node, null);
      return `({
    DingClosure* __cl = (DingClosure*)ding_alloc(sizeof(DingClosure));
    __cl->fn = ${fnName};
    __cl->env = NULL;
    (DingValue){.type=DING_CLOSURE, .as_closure=__cl};
  })`;
    }

    // Has captures — emit env struct and closure function
    const envName = info.envStructName;
    this.emitClosureEnvStruct(envName, info);
    this.emitClosureFunction(fnName, node, info);

    // Create environment and closure at the expression site
    const envTmp = `__env_${this.tempCounter++}`;
    const lines: string[] = [];
    lines.push(`({`);
    lines.push(`    ${envName}* ${envTmp} = (${envName}*)ding_alloc(sizeof(${envName}));`);
    for (const [varName] of info.captures) {
      lines.push(`    ${envTmp}->${varName} = ${varName};`);
    }
    lines.push(`    DingClosure* __cl = (DingClosure*)ding_alloc(sizeof(DingClosure));`);
    lines.push(`    __cl->fn = ${fnName};`);
    lines.push(`    __cl->env = ${envTmp};`);
    lines.push(`    (DingValue){.type=DING_CLOSURE, .as_closure=__cl};`);
    lines.push(`  })`);
    return lines.join("\n");
  }

  private emitClosureEnvStruct(envName: string, info: CaptureInfo): void {
    const lines: string[] = [];
    lines.push(`typedef struct {`);
    for (const [varName, varType] of info.captures) {
      lines.push(`  ${varType} ${varName};`);
    }
    lines.push(`} ${envName};`);
    this.closureDecls.push(lines.join("\n"));
  }

  private emitClosureFunction(fnName: string, node: ArrowFunction, info: CaptureInfo | null): void {
    const lines: string[] = [];
    lines.push(`DingValue ${fnName}(void* __env_raw, DingValue* __args, ding_int __argc) {`);

    // Unpack environment — declare local aliases for captured variables
    if (info && info.captures.size > 0) {
      lines.push(`  ${info.envStructName}* __env = (${info.envStructName}*)__env_raw;`);
      for (const [varName, varType] of info.captures) {
        lines.push(`  ${varType} ${varName} = __env->${varName};`);
      }
    }

    // Unpack parameters from args array (always as DingValue — closure calling convention)
    for (let i = 0; i < node.params.length; i++) {
      const p = node.params[i];
      if (p.defaultValue) {
        const defaultExpr = this.emitExpression(p.defaultValue);
        const defaultType = this.resolveType(p.defaultValue);
        lines.push(`  DingValue ${p.name} = ${i} < __argc ? __args[${i}] : ${wrapAsDingValue(defaultExpr, defaultType)};`);
      } else {
        lines.push(`  DingValue ${p.name} = ${i} < __argc ? __args[${i}] : DING_VALUE_NULL;`);
      }
    }

    // Emit body
    const savedReturnType = this.currentReturnType;
    this.currentReturnType = "DingValue";

    if (Array.isArray(node.body)) {
      this.indent++;
      for (const stmt of node.body) {
        const result = this.emitStatement(stmt);
        if (result !== null) lines.push(result);
      }
      this.indent--;
    } else {
      const expr = this.emitClosureBodyExpr(node.body, info);
      const bodyType = this.resolveType(node.body);
      if (bodyType === "void") {
        lines.push(`  ${expr};`);
        lines.push(`  return DING_VALUE_NULL;`);
      } else {
        lines.push(`  return ${wrapAsDingValue(expr, bodyType)};`);
      }
    }

    this.currentReturnType = savedReturnType;
    lines.push(`}`);
    this.closureDecls.push(lines.join("\n"));
  }

  /** Emit an expression body for a closure, rewriting captured variable references. */
  private emitClosureBodyExpr(expr: Expression, info: CaptureInfo | null): string {
    // For captured variables in the expression, they need to go through __env->
    // But since we declared the params from __args and captures would need __env-> prefix,
    // we use a simple approach: the emitter's normal emitExpression works because
    // the variable names match what we declared (params from args, captures from env).
    // For captures, we need to alias them. Actually, we DON'T declare captures as locals —
    // they should be accessed via __env->name. But emitExpression will just emit the name.
    // So for closures with captures, we need to declare local aliases.
    // Let's declare them at the top of the function as locals copied from env.
    // This is already done in emitClosureFunction for statement bodies via the env unpack.
    // For expression bodies, the captures ARE accessible because emitClosureFunction
    // does NOT declare them — let me fix this by having the caller handle it.
    return this.emitExpression(expr);
  }

  /** Emit an inlined array method (map, filter, forEach, reduce, find, includes).
   *  These are expanded as inline loops using GCC statement expressions. */
  private emitArrayMethod(node: CallExpression, target: Extract<CallTarget, { kind: "array-method" }>): string {
    const receiverObj = (node.callee as MemberExpression).object;
    const receiverType = this.resolveType(receiverObj);
    const obj = this.emitExpression(receiverObj);
    const arrExpr = receiverType === "DingValue" ? `${obj}.as_array` : obj;
    const srcTmp = `__src_${this.tempCounter++}`;
    const idxTmp = `__i_${this.tempCounter++}`;

    switch (target.op) {
      case "map": {
        if (!target.callback) throw new DingError("emitter", "map requires a callback");
        const resTmp = `__result_${this.tempCounter++}`;
        const paramName = target.callback.params[0]?.name ?? "__el";
        const body = this.emitInlinedCallbackBody(target.callback, paramName);
        const lines = [
          `({`,
          `    DingArray* ${srcTmp} = ${arrExpr};`,
          `    DingArray* ${resTmp} = ding_array_new();`,
          `    for (ding_int ${idxTmp} = 0; ${idxTmp} < ${srcTmp}->length; ${idxTmp}++) {`,
          `      DingValue ${paramName} = ${srcTmp}->items[${idxTmp}];`,
          `      DingValue __mapped = ${wrapAsDingValue(body, this.inferCallbackBodyType(target.callback))};`,
          `      ding_array_push(${resTmp}, __mapped);`,
          `    }`,
          `    ${resTmp};`,
          `  })`,
        ];
        return lines.join("\n");
      }
      case "filter": {
        if (!target.callback) throw new DingError("emitter", "filter requires a callback");
        const resTmp = `__result_${this.tempCounter++}`;
        const paramName = target.callback.params[0]?.name ?? "__el";
        const body = this.emitInlinedCallbackBody(target.callback, paramName);
        const lines = [
          `({`,
          `    DingArray* ${srcTmp} = ${arrExpr};`,
          `    DingArray* ${resTmp} = ding_array_new();`,
          `    for (ding_int ${idxTmp} = 0; ${idxTmp} < ${srcTmp}->length; ${idxTmp}++) {`,
          `      DingValue ${paramName} = ${srcTmp}->items[${idxTmp}];`,
          `      if (${body}) {`,
          `        ding_array_push(${resTmp}, ${paramName});`,
          `      }`,
          `    }`,
          `    ${resTmp};`,
          `  })`,
        ];
        return lines.join("\n");
      }
      case "forEach": {
        if (!target.callback) throw new DingError("emitter", "forEach requires a callback");
        const paramName = target.callback.params[0]?.name ?? "__el";
        const body = this.emitInlinedCallbackBody(target.callback, paramName);
        const lines = [
          `{`,
          `    DingArray* ${srcTmp} = ${arrExpr};`,
          `    for (ding_int ${idxTmp} = 0; ${idxTmp} < ${srcTmp}->length; ${idxTmp}++) {`,
          `      DingValue ${paramName} = ${srcTmp}->items[${idxTmp}];`,
          `      ${body};`,
          `    }`,
          `  }`,
        ];
        return lines.join("\n");
      }
      case "reduce": {
        if (!target.callback) throw new DingError("emitter", "reduce requires a callback");
        const accTmp = `__acc_${this.tempCounter++}`;
        const accParam = target.callback.params[0]?.name ?? "__acc";
        const elParam = target.callback.params[1]?.name ?? "__el";
        let initVal: string;
        if (target.initialValue) {
          const initExpr = this.emitExpression(target.initialValue);
          const initType = this.resolveType(target.initialValue);
          initVal = wrapAsDingValue(initExpr, initType);
        } else {
          initVal = "DING_VALUE_NULL";
        }
        const body = this.emitInlinedCallbackBody(target.callback, accParam, elParam);
        const lines = [
          `({`,
          `    DingArray* ${srcTmp} = ${arrExpr};`,
          `    DingValue ${accTmp} = ${initVal};`,
          `    for (ding_int ${idxTmp} = 0; ${idxTmp} < ${srcTmp}->length; ${idxTmp}++) {`,
          `      DingValue ${elParam} = ${srcTmp}->items[${idxTmp}];`,
          `      DingValue ${accParam} = ${accTmp};`,
          `      ${accTmp} = ${wrapAsDingValue(body, this.inferCallbackBodyType(target.callback))};`,
          `    }`,
          `    ${accTmp};`,
          `  })`,
        ];
        return lines.join("\n");
      }
      case "find": {
        if (!target.callback) throw new DingError("emitter", "find requires a callback");
        const resTmp = `__result_${this.tempCounter++}`;
        const paramName = target.callback.params[0]?.name ?? "__el";
        const body = this.emitInlinedCallbackBody(target.callback, paramName);
        const lines = [
          `({`,
          `    DingArray* ${srcTmp} = ${arrExpr};`,
          `    DingValue ${resTmp} = DING_VALUE_NULL;`,
          `    for (ding_int ${idxTmp} = 0; ${idxTmp} < ${srcTmp}->length; ${idxTmp}++) {`,
          `      DingValue ${paramName} = ${srcTmp}->items[${idxTmp}];`,
          `      if (${body}) {`,
          `        ${resTmp} = ${paramName};`,
          `        break;`,
          `      }`,
          `    }`,
          `    ${resTmp};`,
          `  })`,
        ];
        return lines.join("\n");
      }
      case "includes": {
        const foundTmp = `__found_${this.tempCounter++}`;
        const needleExpr = this.emitExpression(node.arguments[0]);
        const needleType = this.resolveType(node.arguments[0]);
        const wrappedNeedle = wrapAsDingValue(needleExpr, needleType);
        const lines = [
          `({`,
          `    DingArray* ${srcTmp} = ${arrExpr};`,
          `    ding_bool ${foundTmp} = false;`,
          `    DingValue __needle = ${wrappedNeedle};`,
          `    for (ding_int ${idxTmp} = 0; ${idxTmp} < ${srcTmp}->length; ${idxTmp}++) {`,
          `      if (ding_value_equals(${srcTmp}->items[${idxTmp}], __needle)) {`,
          `        ${foundTmp} = true;`,
          `        break;`,
          `      }`,
          `    }`,
          `    ${foundTmp};`,
          `  })`,
        ];
        return lines.join("\n");
      }
    }
  }

  /** Emit the body of an inline callback. For expression-body arrows, returns
   *  the expression string. For statement-body arrows, throws. */
  private emitInlinedCallbackBody(fn: ArrowFunction, ...paramNames: string[]): string {
    if (Array.isArray(fn.body)) {
      throw new DingError("emitter", "C emitter: array methods only support expression-body callbacks, not statement blocks", {
        hint: "Use (x) => x * 2 instead of (x) => { return x * 2 }",
      });
    }
    void paramNames; // params are already bound in the enclosing scope by the caller
    return this.emitExpression(fn.body);
  }

  /** Infer the C type of a callback's expression body. */
  private inferCallbackBodyType(fn: ArrowFunction): CType {
    if (Array.isArray(fn.body)) return "DingValue";
    return this.resolveType(fn.body);
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
    // Map bracket access: map["key"]
    if (arrType === "DingMap*") {
      const key = this.emitAs(node.index, "ding_string");
      return `ding_map_get(${arrExpr}, ${key})`;
    }
    // DingValue with string index → map access, numeric → array access
    if (arrType === "DingValue") {
      const idxType = this.resolveType(node.index);
      if (isStringType(idxType)) {
        const key = this.emitAs(node.index, "ding_string");
        return `ding_map_get(${arrExpr}.as_map, ${key})`;
      }
      const idx = this.emitAs(node.index, "ding_int");
      return `ding_array_get(${arrExpr}.as_array, ${idx})`;
    }
    const idx = this.emitAs(node.index, "ding_int");
    return `ding_array_get(${arrExpr}, ${idx})`;
  }

  private emitLengthExpression(node: LengthExpression): string {
    const targetType = this.resolveType(node.target);
    const target = this.emitExpression(node.target);
    if (targetType === "DingMap*") return `${target}->length`;
    if (targetType === "DingValue") return `(${target}.type == DING_MAP ? ${target}.as_map->length : ${target}.as_array->length)`;
    return `${target}->length`;
  }

  private emitMemberExpression(node: MemberExpression): string {
    // Enum access: EnumName.Member -> EnumName_Member
    if (node.object.type === "Identifier" && this.resolver.enums.has(node.object.name)) {
      return `${node.object.name}_${node.property}`;
    }
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

  // ── Unary expressions ───────────────────────────────────────────────

  private emitUnaryExpression(node: UnaryExpression): string {
    const operand = this.emitExpression(node.operand);
    return `(${node.operator}${operand})`;
  }

  // ── Enum helpers ───────────────────────────────────────────────────

  private emitEnumDefinition(decl: EnumDeclaration): string {
    const lines: string[] = [];
    lines.push(`enum ${decl.name} {`);
    let nextValue = 0;
    for (const member of decl.members) {
      if (member.value && member.value.type === "NumberLiteral") {
        nextValue = member.value.value;
      }
      lines.push(`  ${decl.name}_${member.name} = ${nextValue},`);
      nextValue++;
    }
    lines.push("};");
    return lines.join("\n");
  }

  // ── Match helpers ──────────────────────────────────────────────────

  private emitMatchStatement(node: MatchStatement): string {
    return this.emitMatchArms(node.subject, node.arms);
  }

  private emitMatchExpression(node: MatchExpression): string {
    const tmp = `__match_${this.tempCounter++}`;
    const subject = this.emitExpression(node.subject);
    const subjectTmp = `__match_subject_${this.tempCounter++}`;
    const subjectType = this.resolveType(node.subject);
    const lines: string[] = [];
    lines.push(`({`);
    lines.push(`    ${subjectType} ${subjectTmp} = ${subject};`);
    lines.push(`    DingValue ${tmp};`);

    for (let i = 0; i < node.arms.length; i++) {
      const arm = node.arms[i];
      const cond = this.emitMatchCondition(subjectTmp, arm.pattern);
      const keyword = i === 0 ? "if" : "} else if";

      if (arm.pattern.kind === "wildcard") {
        if (i > 0) lines.push(`    } else {`);
        else lines.push(`    {`);
      } else {
        lines.push(`    ${keyword} (${cond}) {`);
      }

      if (Array.isArray(arm.body)) {
        for (const stmt of arm.body) {
          const result = this.emitStatement(stmt);
          if (result !== null) lines.push(`    ${result}`);
        }
      } else {
        const val = this.emitAs(arm.body, "DingValue");
        lines.push(`      ${tmp} = ${val};`);
      }
    }
    if (node.arms.length > 0) lines.push(`    }`);
    lines.push(`    ${tmp};`);
    lines.push(`  })`);
    return lines.join("\n");
  }

  private emitMatchArms(subject: Expression, arms: MatchArm[]): string {
    const subjectExpr = this.emitExpression(subject);
    const subjectType = this.resolveType(subject);
    const subjectTmp = `__match_subject_${this.tempCounter++}`;
    const lines: string[] = [];
    lines.push(`${this.pad()}${subjectType} ${subjectTmp} = ${subjectExpr};`);

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      const cond = this.emitMatchCondition(subjectTmp, arm.pattern);

      if (arm.pattern.kind === "wildcard") {
        if (i > 0) lines.push(`${this.pad()}} else {`);
        else lines.push(`${this.pad()}{`);
      } else {
        const keyword = i === 0 ? "if" : "} else if";
        lines.push(`${this.pad()}${keyword} (${cond}) {`);
      }

      this.indent++;
      if (Array.isArray(arm.body)) {
        for (const stmt of arm.body) {
          const result = this.emitStatement(stmt);
          if (result !== null) lines.push(result);
        }
      } else {
        lines.push(`${this.pad()}${this.emitExpression(arm.body)};`);
      }
      this.indent--;
    }
    if (arms.length > 0) lines.push(`${this.pad()}}`);
    return lines.join("\n");
  }

  private emitMatchCondition(subjectVar: string, pattern: MatchArm["pattern"]): string {
    switch (pattern.kind) {
      case "literal":
        return `${subjectVar} == ${this.emitExpression(pattern.value)}`;
      case "range":
        return `${subjectVar} >= ${this.emitExpression(pattern.start)} && ${subjectVar} < ${this.emitExpression(pattern.end)}`;
      case "wildcard":
        return "1";
    }
  }

  // ── Default parameter helpers ──────────────────────────────────────

  private emitDefaultParamChecks(params: ArrowFunction["params"]): string[] {
    const lines: string[] = [];
    for (const p of params) {
      if (p.defaultValue) {
        const defaultExpr = this.emitExpression(p.defaultValue);
        const defaultType = this.resolveType(p.defaultValue);
        const paramType = p.annotation ? mapAnnotationToCType(p.annotation) : "DingValue";
        if (paramType === "DingValue") {
          lines.push(`${this.pad()}if (${p.name}.type == DING_NULL) ${p.name} = ${wrapAsDingValue(defaultExpr, defaultType)};`);
        }
      }
    }
    return lines;
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
