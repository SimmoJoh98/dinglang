import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Lexer } from "../lexer/index.js";
import { Parser } from "../parser/index.js";
import { DingError } from "../errors/index.js";
import { extractDirectives } from "../directives/index.js";
import type { Program, Statement, ImportDeclaration } from "../ast/nodes.js";
import { isDingModule } from "../std/index.js";

interface ModuleInfo {
  path: string;
  source: string;
  ast: Program;
  exports: Set<string>;
  directives: ReturnType<typeof extractDirectives>["directives"];
}

export class ModuleGraph {
  private modules: Map<string, ModuleInfo> = new Map();
  private order: string[] = [];
  private visiting: Set<string> = new Set();

  build(entryPath: string): void {
    const absPath = resolve(entryPath);
    this.trace(absPath, null);
  }

  private trace(absPath: string, importedFrom: string | null): void {
    if (this.modules.has(absPath)) return;

    if (this.visiting.has(absPath)) {
      const cycle = [...this.visiting, absPath].join(" → ");
      throw new DingError("module", `Circular import detected: ${cycle}`);
    }

    if (!existsSync(absPath)) {
      const msg = importedFrom
        ? `File not found: '${absPath}' (imported from ${importedFrom})`
        : `File not found: '${absPath}'`;
      throw new DingError("module", msg);
    }

    this.visiting.add(absPath);

    const rawSource = readFileSync(absPath, "utf-8");
    const { directives, source } = extractDirectives(rawSource);
    const tokens = new Lexer(source).tokenize();
    const ast = new Parser(tokens, source).parse();

    // Collect top-level exports (all top-level declarations are public)
    const exports = new Set<string>();
    for (const stmt of ast.body) {
      if (stmt.type === "VariableDeclaration") exports.add(stmt.name);
      if (stmt.type === "StructDeclaration") exports.add(stmt.name);
      if (stmt.type === "EnumDeclaration") exports.add(stmt.name);
    }

    this.modules.set(absPath, { path: absPath, source, ast, exports, directives });

    // Trace user-file imports
    for (const stmt of ast.body) {
      if (stmt.type !== "ImportDeclaration") continue;
      if (isDingModule(stmt.source)) continue;
      if (!stmt.source.startsWith("./") && !stmt.source.startsWith("../")) continue;

      let importPath = resolve(dirname(absPath), stmt.source);
      if (!importPath.endsWith(".dg")) importPath += ".dg";

      this.trace(importPath, absPath);

      // Validate imported names exist
      const targetModule = this.modules.get(importPath)!;
      const allNames = [...(stmt.named || [])];
      if (stmt.default) allNames.push(stmt.default);

      for (const name of allNames) {
        if (!targetModule.exports.has(name)) {
          const available = [...targetModule.exports].join(", ");
          throw new DingError("module",
            `'${name}' is not defined in '${stmt.source}' — available exports: ${available}`,
          );
        }
      }
    }

    this.visiting.delete(absPath);
    this.order.push(absPath);
  }

  /** Return a single merged Program with all modules in dependency order.
   *  User-file import declarations are stripped (resolved by the merge).
   *  ding:std/math imports are preserved (deduplicated by the resolver). */
  getMergedProgram(): Program {
    const mergedBody: Statement[] = [];
    const seenNames = new Map<string, string>(); // name → module path (for collision detection)

    for (const absPath of this.order) {
      const mod = this.modules.get(absPath)!;

      for (const stmt of mod.ast.body) {
        // Strip user-file imports (they're resolved by concatenation)
        if (stmt.type === "ImportDeclaration") {
          if (isDingModule(stmt.source)) {
            mergedBody.push(stmt);
          }
          // else: user import, skip
          continue;
        }

        // Check for name collisions on top-level declarations
        let declName: string | null = null;
        if (stmt.type === "VariableDeclaration") declName = stmt.name;
        if (stmt.type === "StructDeclaration") declName = stmt.name;
        if (stmt.type === "EnumDeclaration") declName = stmt.name;

        if (declName && seenNames.has(declName)) {
          const otherPath = seenNames.get(declName)!;
          if (otherPath !== absPath) {
            throw new DingError("module",
              `Name collision: '${declName}' is defined in both ${otherPath} and ${absPath}`,
            );
          }
        }
        if (declName) seenNames.set(declName, absPath);

        mergedBody.push(stmt);
      }
    }

    return { type: "Program", body: mergedBody };
  }

  /** Return directives from the entry file (first in build order = last in topo order). */
  getEntryDirectives() {
    const entryPath = this.order[this.order.length - 1];
    return this.modules.get(entryPath)!.directives;
  }

  /** Whether this is a multi-file build (more than one module). */
  isMultiFile(): boolean {
    return this.modules.size > 1;
  }
}
