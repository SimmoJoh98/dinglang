import { DingError } from "../../errors/index.js";
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
} from "../../ast/nodes.js";
import { isDingModule, getPolyfill, getModule } from "../../std/index.js";

export { JSEmitter as Emitter };

export class JSEmitter {
  private ast: Program;
  private indent: number = 0;
  private polyfills: string[] = [];
  private tempCounter: number = 0;
  private mapVars: Set<string> = new Set();

  constructor(ast: Program) {
    this.ast = ast;
  }

  emit(): string {
    const lines: string[] = [];

    for (const stmt of this.ast.body) {
      const result = this.emitStatement(stmt);
      if (result !== null) {
        lines.push(result);
      }
    }

    if (this.polyfills.length > 0) {
      return [...this.polyfills, ...lines].join("\n");
    }

    return lines.join("\n");
  }

  // ── Statements ─────────────────────────────────────────────────────

  private emitStatement(node: Statement): string | null {
    switch (node.type) {
      case "VariableDeclaration":
        return this.emitVariableDeclaration(node);
      case "ExpressionStatement":
        return this.emitExpressionStatement(node);
      case "ImportDeclaration":
        return this.emitImportDeclaration(node);
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
        return this.emitStructDeclaration(node);
      case "TryCatchStatement":
        return this.emitTryCatchStatement(node);
      case "ThrowStatement":
        return this.emitThrowStatement(node);
      case "EnumDeclaration":
        return this.emitEnumDeclaration(node);
      case "MatchStatement":
        return this.emitMatchStatement(node);
      case "DestructuringDeclaration":
        return this.emitDestructuringDeclaration(node);
      case "SpawnStatement":
        return `${this.pad()}setTimeout(() => { ${this.emitExpression(node.body)}; }, 0);`;
      case "TypeAliasDeclaration":
        return null; // types erased in JS
      default:
        throw new DingError("emitter", `Internal compiler error — unknown statement type '${(node as any).type}'`, {
          hint: "Please report this at github.com/user/dinglang",
        });
    }
  }

  private emitEnumDeclaration(node: EnumDeclaration): string {
    const entries: string[] = [];
    let nextValue = 0;
    for (const member of node.members) {
      if (member.value && member.value.type === "NumberLiteral") {
        nextValue = member.value.value;
      }
      entries.push(`${member.name}: ${nextValue}`);
      nextValue++;
    }
    return `${this.pad()}const ${node.name} = Object.freeze({ ${entries.join(", ")} });`;
  }

  private emitMatchStatement(node: MatchStatement): string {
    return this.emitMatchArms(node.subject, node.arms);
  }

  private emitMatchArms(subject: Expression, arms: MatchArm[]): string {
    const subjectExpr = this.emitExpression(subject);
    const tmp = `__match_${this.tempCounter++}`;
    const lines: string[] = [];
    lines.push(`${this.pad()}const ${tmp} = ${subjectExpr};`);

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      if (arm.pattern.kind === "wildcard") {
        if (i > 0) lines.push(`${this.pad()}} else {`);
        else lines.push(`${this.pad()}{`);
      } else {
        const cond = this.emitMatchCondition(tmp, arm.pattern);
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
        return `${subjectVar} === ${this.emitExpression(pattern.value)}`;
      case "range":
        return `${subjectVar} >= ${this.emitExpression(pattern.start)} && ${subjectVar} < ${this.emitExpression(pattern.end)}`;
      case "wildcard":
        return "true";
    }
  }

  private emitVariableDeclaration(node: VariableDeclaration): string {
    if (node.init.type === "MapLiteral") this.mapVars.add(node.name);
    const init = this.emitExpression(node.init);
    return `${this.pad()}${node.kind} ${node.name} = ${init};`;
  }

  private emitDestructuringDeclaration(node: DestructuringDeclaration): string {
    const init = this.emitExpression(node.init);
    if (node.pattern.kind === "array") {
      const elems = node.pattern.elements.map((e) => e ?? "").join(", ");
      return `${this.pad()}${node.kind} [${elems}] = ${init};`;
    } else {
      const props = node.pattern.properties.join(", ");
      return `${this.pad()}${node.kind} { ${props} } = ${init};`;
    }
  }

  private emitExpressionStatement(node: ExpressionStatement): string {
    return `${this.pad()}${this.emitExpression(node.expression)};`;
  }

  private emitImportDeclaration(node: ImportDeclaration): string | null {
    if (isDingModule(node.source)) {
      // Default import: resolve as polyfill
      if (node.default) {
        this.polyfills.push(getPolyfill(node.source, node.default));
      }
      // Named imports: resolve each as polyfill
      for (const name of node.named) {
        this.polyfills.push(getPolyfill(node.source, name));
      }
      // Namespace import: inject all exports from the module
      if (node.namespace) {
        const mod = getModule(node.source);
        const entries: string[] = [];
        for (const [key, entry] of mod) {
          entries.push(`${key}: ${entry.implementation.replace(/^const \w+ = /, "")}`);
        }
        this.polyfills.push(`const ${node.namespace} = { ${entries.join(", ")} };`);
      }
      return null;
    }

    // External module — emit valid JS import
    const parts: string[] = [];
    if (node.default) parts.push(node.default);
    if (node.named.length > 0) parts.push(`{ ${node.named.join(", ")} }`);
    if (node.namespace) parts.push(`* as ${node.namespace}`);
    return `${this.pad()}import ${parts.join(", ")} from "${node.source}";`;
  }

  private emitReturnStatement(node: ReturnStatement): string {
    if (node.value === null) {
      return `${this.pad()}return;`;
    }
    return `${this.pad()}return ${this.emitExpression(node.value)};`;
  }

  private emitIfStatement(node: IfStatement): string {
    const test = this.emitExpression(node.test);
    const consequent = this.emitBlock(node.consequent);

    let out = `${this.pad()}if (${test}) {\n${consequent}\n${this.pad()}}`;

    if (node.alternate) {
      if (
        node.alternate.length === 1 &&
        node.alternate[0].type === "IfStatement"
      ) {
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
    const start = this.emitExpression(node.start);
    const end = this.emitExpression(node.end);
    const body = this.emitBlock(node.body);
    return `${this.pad()}for (let ${id} = ${start}; ${id} < ${end}; ${id}++) {\n${body}\n${this.pad()}}`;
  }

  private emitForInStatement(node: ForInStatement): string {
    const id = node.identifier;
    const iterable = this.emitExpression(node.iterable);
    const body = this.emitBlock(node.body);
    // Map iteration: iterate keys
    if (node.iterable.type === "Identifier" && this.mapVars.has(node.iterable.name)) {
      return `${this.pad()}for (const ${id} of ${iterable}.keys()) {\n${body}\n${this.pad()}}`;
    }
    return `${this.pad()}for (const ${id} of ${iterable}) {\n${body}\n${this.pad()}}`;
  }

  private emitWhileStatement(node: WhileStatement): string {
    const condition = this.emitExpression(node.condition);
    const body = this.emitBlock(node.body);
    return `${this.pad()}while (${condition}) {\n${body}\n${this.pad()}}`;
  }

  private emitStructDeclaration(node: StructDeclaration): string {
    const lines: string[] = [];
    lines.push(`${this.pad()}class ${node.name} {`);
    this.indent++;

    // constructor
    const fieldNames = node.fields.map((f) => f.name);
    lines.push(`${this.pad()}constructor(${fieldNames.map((n) => `${n}`).join(", ")}) {`);
    this.indent++;
    for (const f of fieldNames) {
      lines.push(`${this.pad()}this.${f} = ${f};`);
    }
    this.indent--;
    lines.push(`${this.pad()}}`);

    // methods
    for (const method of node.methods) {
      // Filter out 'self' from params — it becomes 'this' in JS
      const params = method.params
        .filter((p) => p.name !== "self")
        .map((p) => p.name)
        .join(", ");

      if (Array.isArray(method.body)) {
        const body = this.emitBlock(method.body);
        lines.push(`${this.pad()}${method.name}(${params}) {`);
        // Replace 'self.' with 'this.' in the body
        lines.push(body.replace(/\bself\b/g, "this"));
        lines.push(`${this.pad()}}`);
      } else {
        const expr = this.emitExpression(method.body);
        lines.push(`${this.pad()}${method.name}(${params}) {`);
        this.indent++;
        lines.push(`${this.pad()}return ${expr.replace(/\bself\b/g, "this")};`);
        this.indent--;
        lines.push(`${this.pad()}}`);
      }
    }

    this.indent--;
    lines.push(`${this.pad()}}`);
    return lines.join("\n");
  }

  private emitTryCatchStatement(node: TryCatchStatement): string {
    const body = this.emitBlock(node.body);
    const catchBody = this.emitBlock(node.catch);
    let out = `${this.pad()}try {\n${body}\n${this.pad()}} catch (${node.param}) {\n${catchBody}\n${this.pad()}}`;

    if (node.finally) {
      const finallyBody = this.emitBlock(node.finally);
      out += ` finally {\n${finallyBody}\n${this.pad()}}`;
    }

    return out;
  }

  private emitThrowStatement(node: ThrowStatement): string {
    return `${this.pad()}throw ${this.emitExpression(node.value)};`;
  }

  private emitBlock(statements: Statement[]): string {
    this.indent++;
    const body = statements
      .map((s) => this.emitStatement(s))
      .filter((s): s is string => s !== null)
      .join("\n");
    this.indent--;
    return body;
  }

  // ── Expressions ────────────────────────────────────────────────────

  private emitExpression(node: Expression): string {
    switch (node.type) {
      case "NumberLiteral":
        return String(node.value);
      case "StringLiteral":
        return `"${node.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      case "BooleanLiteral":
        return String(node.value);
      case "NullLiteral":
        return "null";
      case "Identifier":
        return node.name;
      case "BinaryExpression":
        return this.emitBinaryExpression(node);
      case "UnaryExpression":
        return `(${node.operator}${this.emitExpression(node.operand)})`;
      case "ArrowFunction":
        return this.emitArrowFunction(node);
      case "CallExpression":
        return this.emitCallExpression(node);
      case "TemplateLiteral":
        return this.emitTemplateLiteral(node);
      case "ArrayLiteral":
        return this.emitArrayLiteral(node);
      case "ArrayAccess":
        return this.emitArrayAccess(node);
      case "LengthExpression":
        return this.emitLengthExpression(node);
      case "MemberExpression":
        return this.emitMemberExpression(node);
      case "StructInstantiation":
        return this.emitStructInstantiation(node);
      case "ErrorPropagation":
        return this.emitErrorPropagation(node);
      case "NullishCoalescing":
        return this.emitNullishCoalescing(node);
      case "NullAssertion":
        return this.emitNullAssertion(node);
      case "AssignmentExpression":
        return this.emitAssignmentExpression(node);
      case "MapLiteral":
        return this.emitMapLiteral(node);
      case "MatchExpression":
        return this.emitMatchExpression(node);
      default:
        throw new DingError("emitter", `Internal compiler error — unknown expression type '${(node as any).type}'`, {
          hint: "Please report this at github.com/user/dinglang",
        });
    }
  }

  private emitMapLiteral(node: MapLiteral): string {
    const entries = node.entries.map((e) =>
      `[${this.emitExpression(e.key)}, ${this.emitExpression(e.value)}]`
    ).join(", ");
    return `new Map([${entries}])`;
  }

  private emitMatchExpression(node: MatchExpression): string {
    // Emit as IIFE with if/else chain
    const tmp = `__match_${this.tempCounter++}`;
    const lines: string[] = [];
    lines.push(`(() => {`);
    this.indent++;
    lines.push(`${this.pad()}const ${tmp} = ${this.emitExpression(node.subject)};`);

    for (let i = 0; i < node.arms.length; i++) {
      const arm = node.arms[i];
      if (arm.pattern.kind === "wildcard") {
        if (i > 0) lines.push(`${this.pad()}} else {`);
        else lines.push(`${this.pad()}{`);
      } else {
        const cond = this.emitMatchCondition(tmp, arm.pattern);
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
        lines.push(`${this.pad()}return ${this.emitExpression(arm.body)};`);
      }
      this.indent--;
    }
    if (node.arms.length > 0) lines.push(`${this.pad()}}`);
    this.indent--;
    lines.push(`${this.pad()}})()`);
    return lines.join("\n");
  }

  private emitBinaryExpression(node: BinaryExpression): string {
    // String repeat: "str" * n → "str".repeat(n)
    if (node.operator === "*") {
      if (node.left.type === "StringLiteral" || node.left.type === "TemplateLiteral") {
        return `${this.emitExpression(node.left)}.repeat(${this.emitExpression(node.right)})`;
      }
      if (node.right.type === "StringLiteral" || node.right.type === "TemplateLiteral") {
        return `${this.emitExpression(node.right)}.repeat(${this.emitExpression(node.left)})`;
      }
    }
    const left = this.emitExpression(node.left);
    const right = this.emitExpression(node.right);
    const op = node.operator === "!=" ? "!==" : node.operator === "==" ? "===" : node.operator;
    return `${left} ${op} ${right}`;
  }

  private emitArrowFunction(node: ArrowFunction): string {
    const params = node.params.map((p) => {
      if (p.defaultValue) return `${p.name} = ${this.emitExpression(p.defaultValue)}`;
      return p.name;
    }).join(", ");

    if (Array.isArray(node.body)) {
      const block = this.emitBlock(node.body);
      return `(${params}) => {\n${block}\n${this.pad()}}`;
    }

    return `(${params}) => ${this.emitExpression(node.body)}`;
  }

  private emitCallExpression(node: CallExpression): string {
    // Map.keys() and Map.values() need Array.from() wrapper in JS
    if (node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && this.mapVars.has(node.callee.object.name)) {
      const method = node.callee.property;
      if (method === "keys" || method === "values") {
        return `Array.from(${node.callee.object.name}.${method}())`;
      }
    }
    const callee = this.emitExpression(node.callee);
    const args = node.arguments.map((a) => this.emitExpression(a)).join(", ");
    return `${callee}(${args})`;
  }

  private emitTemplateLiteral(node: TemplateLiteral): string {
    const inner = node.parts
      .map((part) =>
        typeof part === "string" ? part : `\${${this.emitExpression(part)}}`
      )
      .join("");
    return `\`${inner}\``;
  }

  private emitArrayLiteral(node: ArrayLiteral): string {
    const elements = node.elements.map((e) => {
      if (e.type === "SpreadElement") return `...${this.emitExpression(e.argument)}`;
      return this.emitExpression(e);
    }).join(", ");
    return `[${elements}]`;
  }

  private emitArrayAccess(node: ArrayAccess): string {
    if (node.array.type === "Identifier" && this.mapVars.has(node.array.name)) {
      return `${node.array.name}.get(${this.emitExpression(node.index)})`;
    }
    return `${this.emitExpression(node.array)}[${this.emitExpression(node.index)}]`;
  }

  private emitLengthExpression(node: LengthExpression): string {
    if (node.target.type === "Identifier" && this.mapVars.has(node.target.name)) {
      return `${node.target.name}.size`;
    }
    return `${this.emitExpression(node.target)}.length`;
  }

  private emitMemberExpression(node: MemberExpression): string {
    const object = this.emitExpression(node.object);
    return node.optional ? `${object}?.${node.property}` : `${object}.${node.property}`;
  }

  private emitStructInstantiation(node: StructInstantiation): string {
    const fields = node.fields.map((f) => this.emitExpression(f.value)).join(", ");
    return `new ${node.name}(${fields})`;
  }

  private emitErrorPropagation(node: ErrorPropagation): string {
    const expr = this.emitExpression(node.expression);
    return `(() => { try { return ${expr}; } catch(__e) { throw __e; } })()`;
  }

  private emitNullishCoalescing(node: NullishCoalescing): string {
    return `(${this.emitExpression(node.left)} ?? ${this.emitExpression(node.right)})`;
  }

  private emitNullAssertion(node: NullAssertion): string {
    const expr = this.emitExpression(node.expression);
    return `((__v) => { if (__v == null) throw new Error("null assertion failed"); return __v; })(${expr})`;
  }

  private emitAssignmentExpression(node: AssignmentExpression): string {
    // Map bracket assignment: map["key"] = value
    if (node.target.type === "ArrayAccess" && node.target.array.type === "Identifier" && this.mapVars.has(node.target.array.name)) {
      return `${node.target.array.name}.set(${this.emitExpression(node.target.index)}, ${this.emitExpression(node.value)})`;
    }
    return `${this.emitExpression(node.target)} = ${this.emitExpression(node.value)}`;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private pad(): string {
    return "  ".repeat(this.indent);
  }
}
