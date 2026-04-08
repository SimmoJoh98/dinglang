import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  DiagnosticSeverity,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  Hover,
  MarkupKind,
  TextDocumentPositionParams,
  DocumentSymbol,
  SymbolKind,
  Location,
  Range,
  Position,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Lexer } from "../lexer/index.js";
import { Parser } from "../parser/index.js";
import { DingError } from "../errors/index.js";
import type { Program, Statement } from "../ast/nodes.js";

/**
 * Pure function for validating a Ding document.
 * Runs the lexer and parser and returns any diagnostics discovered.
 * Exported for direct unit testing without spinning up an LSP connection.
 */
export function validateDingDocument(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    const tokens = new Lexer(content).tokenize();
    try {
      new Parser(tokens, content).parse();
    } catch (err) {
      if (err instanceof DingError) {
        diagnostics.push(dingErrorToDiagnostic(err));
      }
    }
  } catch (err) {
    if (err instanceof DingError) {
      diagnostics.push(dingErrorToDiagnostic(err));
    }
  }

  return diagnostics;
}

function dingErrorToDiagnostic(err: DingError): Diagnostic {
  const line = (err.line ?? 1) - 1;
  const col = (err.col ?? 1) - 1;
  return {
    range: {
      start: { line: Math.max(0, line), character: Math.max(0, col) },
      end: { line: Math.max(0, line), character: Math.max(0, col) + 10 },
    },
    message: err.message,
    severity: DiagnosticSeverity.Error,
    source: "ding",
  };
}

// ─── Completion data ──────────────────────────────────────────────────────

const KEYWORDS = [
  "const", "let", "for", "while", "if", "else", "return",
  "struct", "import", "from", "in", "null", "true", "false",
  "break", "continue", "throw", "try", "catch", "finally",
  "enum", "match", "self", "as", "spawn",
];

const STDLIB_SNIPPETS: Array<{ label: string; insert: string }> = [
  { label: "log", insert: "log(${1:value})" },
  { label: "warn", insert: "warn(${1:value})" },
  { label: "assert", insert: "assert(${1:condition}, ${2:message})" },
];

const TYPE_KEYWORDS = [
  "number", "string", "bool", "int", "int8", "int16", "int32",
  "int64", "uint8", "uint32", "uint64", "float", "float32",
  "float64", "double", "byte", "cstring",
];

const SNIPPET_COMPLETIONS: Array<{ label: string; insert: string }> = [
  { label: "for-range", insert: "for ${1:i} = ${2:0}..${3:10} {\n\t$0\n}" },
  { label: "for-in", insert: "for ${1:item} in ${2:items} {\n\t$0\n}" },
  { label: "struct", insert: "struct ${1:Name} {\n\t${2:field}: ${3:type}\n}" },
  { label: "arrow", insert: "const ${1:name} = (${2:params}) => {\n\t$0\n}" },
  { label: "if", insert: "if (${1:condition}) {\n\t$0\n}" },
  { label: "try", insert: "try {\n\t$0\n} catch (${1:e}) {\n\t\n}" },
  { label: "import-std", insert: "import { ${1:log} } from 'ding:std'" },
  { label: "import-math", insert: "import { ${1:floor} } from 'ding:math'" },
  { label: "enum", insert: "enum ${1:Name} {\n\t${2:Value},\n\t$0\n}" },
  { label: "match", insert: "match (${1:value}) {\n\t${2:pattern} => ${3:result},\n\t_ => ${0:default}\n}" },
  { label: "map", insert: ".map((${1:x}) => ${0:x})" },
  { label: "filter", insert: ".filter((${1:x}) => ${0:condition})" },
  { label: "reduce", insert: ".reduce((${1:acc}, ${2:x}) => ${3:acc + x}, ${0:initial})" },
  { label: "map-literal", insert: "Map { '${1:key}': ${2:value} }" },
  { label: "import-file", insert: "import { ${1:Name} } from './${2:file}.dg'" },
  { label: "import-io", insert: "import { ${1:readFile}, ${2:writeFile} } from 'ding:io'" },
  { label: "import-json", insert: "import { parse, stringify } from 'ding:json'" },
  { label: "import-http", insert: "import { get, post } from 'ding:http'" },
  { label: "import-concurrent", insert: "import { Channel } from 'ding:concurrent'" },
  { label: "spawn", insert: "spawn () => {\n\t$0\n}" },
  { label: "ternary", insert: "${1:condition} ? ${2:then} : ${3:else}" },
];

export function getCompletionItems(): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const kw of KEYWORDS) {
    items.push({ label: kw, kind: CompletionItemKind.Keyword });
  }

  for (const { label, insert } of STDLIB_SNIPPETS) {
    items.push({
      label,
      kind: CompletionItemKind.Function,
      insertText: insert,
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  for (const t of TYPE_KEYWORDS) {
    items.push({ label: t, kind: CompletionItemKind.TypeParameter });
  }

  for (const { label, insert } of SNIPPET_COMPLETIONS) {
    items.push({
      label,
      kind: CompletionItemKind.Snippet,
      insertText: insert,
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  return items;
}

// ─── Hover data ───────────────────────────────────────────────────────────

const HOVER_DOCS: Record<string, string> = {
  const: "Declare an immutable binding",
  let: "Declare a mutable binding",
  struct: "Define a named data structure",
  for: "for i = 0..n { } or for item in arr { }",
  null: "The absence of a value (type: null)",
  true: "Boolean literal",
  false: "Boolean literal",
  int32: "32-bit signed integer (int32_t in C)",
  uint8: "8-bit unsigned integer, alias: byte",
  float64: "64-bit float, alias: double",
  cstring: "Raw C string (const char*), zero-copy",
  enum: "Define an enumeration type: enum Name { A, B, C }",
  match: "Pattern matching: match (val) { pattern => result, _ => default }",
  self: "Reference to the current struct instance in methods",
  map: "Transform each element: arr.map((x) => x * 2)",
  filter: "Keep elements matching condition: arr.filter((x) => x > 0)",
  reduce: "Accumulate into single value: arr.reduce((acc, x) => acc + x, 0)",
  forEach: "Execute for each element: arr.forEach((x) => log(x))",
  find: "Find first matching element: arr.find((x) => x > 5)",
  includes: "Check if array contains value: arr.includes(42)",
  Map: "Create a map (hash table): Map { 'key': value }. Access with map['key'], methods: .has(), .keys(), .values(), .delete()",
  readFile: "Read entire file as string: readFile('path.txt')",
  writeFile: "Write string to file: writeFile('path.txt', content)",
  appendFile: "Append string to file: appendFile('path.txt', content)",
  readLine: "Read a line from stdin: readLine()",
  args: "Get command-line arguments as string[]: args()",
  exists: "Check if file exists: exists('path.txt')",
  parse: "Parse JSON string into ding value: parse('{\"key\": 1}')",
  stringify: "Convert ding value to JSON string: stringify(data)",
  get: "HTTP GET request: get('https://api.example.com')",
  post: "HTTP POST request: post('https://api.example.com', body)",
  Channel: "Create a channel for concurrent communication: Channel(). Methods: .send(val), .receive()",
  spawn: "Spawn a concurrent task: spawn () => { ... }",
};

export function getHoverForWord(word: string): Hover | null {
  const doc = HOVER_DOCS[word];
  if (!doc) return null;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: doc,
    },
  };
}

function getWordAt(text: string, line: number, character: number): string | null {
  const lines = text.split("\n");
  const lineText = lines[line];
  if (lineText == null) return null;
  const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);
  if (character > lineText.length) return null;
  let start = character;
  while (start > 0 && isWordChar(lineText[start - 1])) start--;
  let end = character;
  while (end < lineText.length && isWordChar(lineText[end])) end++;
  if (start === end) return null;
  return lineText.slice(start, end);
}

// ─── Document symbols ────────────────────────────────────────────────────

interface DeclInfo {
  name: string;
  kind: SymbolKind;
  line: number;
}

function parseSafely(content: string): Program | null {
  try {
    const tokens = new Lexer(content).tokenize();
    return new Parser(tokens, content).parse();
  } catch {
    return null;
  }
}

export function getDocumentSymbols(content: string): DocumentSymbol[] {
  const ast = parseSafely(content);
  if (!ast) return [];
  const symbols: DocumentSymbol[] = [];
  const lines = content.split("\n");

  for (const stmt of ast.body) {
    const info = getDeclInfo(stmt);
    if (!info) continue;
    // Find the line where this name appears
    const lineIdx = findNameLine(lines, info.name, info.line);
    const range = Range.create(lineIdx, 0, lineIdx, lines[lineIdx]?.length ?? 0);
    const selRange = range;
    symbols.push(DocumentSymbol.create(info.name, undefined, info.kind, range, selRange));
  }
  return symbols;
}

function getDeclInfo(stmt: Statement): DeclInfo | null {
  switch (stmt.type) {
    case "VariableDeclaration":
      return {
        name: stmt.name,
        kind: stmt.init.type === "ArrowFunction" ? SymbolKind.Function : SymbolKind.Variable,
        line: 0,
      };
    case "StructDeclaration":
      return { name: stmt.name, kind: SymbolKind.Class, line: 0 };
    case "EnumDeclaration":
      return { name: stmt.name, kind: SymbolKind.Enum, line: 0 };
    case "TypeAliasDeclaration":
      return { name: stmt.name, kind: SymbolKind.TypeParameter, line: 0 };
    default:
      return null;
  }
}

function findNameLine(lines: string[], name: string, startHint: number): number {
  // Search for the line containing this declaration name
  for (let i = startHint; i < lines.length; i++) {
    if (lines[i].includes(name)) return i;
  }
  // Fallback: search from beginning
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(name)) return i;
  }
  return 0;
}

// ─── Go-to-definition ────────────────────────────────────────────────────

export function getDefinitionLocation(content: string, word: string): Location | null {
  const ast = parseSafely(content);
  if (!ast) return null;
  const lines = content.split("\n");

  for (const stmt of ast.body) {
    const info = getDeclInfo(stmt);
    if (!info || info.name !== word) continue;
    const lineIdx = findNameLine(lines, word, 0);
    const col = lines[lineIdx]?.indexOf(word) ?? 0;
    return Location.create("", Range.create(lineIdx, col, lineIdx, col + word.length));
  }
  return null;
}

// ─── Context-aware completions ───────────────────────────────────────────

const METHOD_COMPLETIONS: CompletionItem[] = [
  // Array methods
  { label: "push", kind: CompletionItemKind.Method },
  { label: "map", kind: CompletionItemKind.Method, insertText: "map((${1:x}) => ${0:x})", insertTextFormat: InsertTextFormat.Snippet },
  { label: "filter", kind: CompletionItemKind.Method, insertText: "filter((${1:x}) => ${0:condition})", insertTextFormat: InsertTextFormat.Snippet },
  { label: "reduce", kind: CompletionItemKind.Method, insertText: "reduce((${1:acc}, ${2:x}) => ${3:acc + x}, ${0:initial})", insertTextFormat: InsertTextFormat.Snippet },
  { label: "forEach", kind: CompletionItemKind.Method, insertText: "forEach((${1:x}) => ${0:body})", insertTextFormat: InsertTextFormat.Snippet },
  { label: "find", kind: CompletionItemKind.Method },
  { label: "includes", kind: CompletionItemKind.Method },
  // String methods
  { label: "indexOf", kind: CompletionItemKind.Method },
  { label: "slice", kind: CompletionItemKind.Method },
  { label: "trim", kind: CompletionItemKind.Method },
  { label: "toUpperCase", kind: CompletionItemKind.Method },
  { label: "toLowerCase", kind: CompletionItemKind.Method },
  { label: "startsWith", kind: CompletionItemKind.Method },
  { label: "endsWith", kind: CompletionItemKind.Method },
  { label: "split", kind: CompletionItemKind.Method },
  { label: "replace", kind: CompletionItemKind.Method },
  // Map methods
  { label: "has", kind: CompletionItemKind.Method },
  { label: "keys", kind: CompletionItemKind.Method },
  { label: "values", kind: CompletionItemKind.Method },
  { label: "delete", kind: CompletionItemKind.Method },
  // Channel methods
  { label: "send", kind: CompletionItemKind.Method },
  { label: "receive", kind: CompletionItemKind.Method },
];

const MODULE_COMPLETIONS: CompletionItem[] = [
  { label: "ding:std", kind: CompletionItemKind.Module },
  { label: "ding:math", kind: CompletionItemKind.Module },
  { label: "ding:io", kind: CompletionItemKind.Module },
  { label: "ding:json", kind: CompletionItemKind.Module },
  { label: "ding:http", kind: CompletionItemKind.Module },
  { label: "ding:concurrent", kind: CompletionItemKind.Module },
];

export function getContextualCompletions(content: string, line: number, character: number): CompletionItem[] {
  const lines = content.split("\n");
  const lineText = lines[line] ?? "";
  const prefix = lineText.slice(0, character);

  // After '.': return method completions
  if (prefix.endsWith(".")) {
    return METHOD_COMPLETIONS;
  }

  // After 'from ': return module completions
  if (/from\s+['"]$/.test(prefix)) {
    return MODULE_COMPLETIONS;
  }

  // Default: all completions
  return getCompletionItems();
}

// ─── LSP bootstrap ────────────────────────────────────────────────────────

export function startServer(): void {
  // Use stdio transport explicitly so `ding lsp` works regardless of
  // whether the editor passes `--stdio` on the command line.
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments<TextDocument>(TextDocument);

  connection.onInitialize((_params: InitializeParams): InitializeResult => {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
          triggerCharacters: [".", ":", '"', "'"],
          resolveProvider: false,
        },
        hoverProvider: true,
        documentSymbolProvider: true,
        definitionProvider: true,
      },
    };
  });

  const runValidation = (doc: TextDocument): void => {
    try {
      const diagnostics = validateDingDocument(doc.getText());
      void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
    } catch (err) {
      connection.console.error(
        `validation crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  documents.onDidOpen((e) => runValidation(e.document));
  documents.onDidChangeContent((e) => runValidation(e.document));

  connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    try {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return getCompletionItems();
      return getContextualCompletions(doc.getText(), params.position.line, params.position.character);
    } catch (err) {
      connection.console.error(
        `completion crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  });

  connection.onDocumentSymbol((params) => {
    try {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return [];
      return getDocumentSymbols(doc.getText());
    } catch (err) {
      connection.console.error(
        `document symbols crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  });

  connection.onDefinition((params) => {
    try {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return null;
      const word = getWordAt(doc.getText(), params.position.line, params.position.character);
      if (!word) return null;
      const loc = getDefinitionLocation(doc.getText(), word);
      if (!loc) return null;
      // Return with the actual document URI
      return Location.create(params.textDocument.uri, loc.range);
    } catch (err) {
      connection.console.error(
        `go-to-definition crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  });

  connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    try {
      const doc = documents.get(params.textDocument.uri);
      if (!doc) return null;
      const word = getWordAt(doc.getText(), params.position.line, params.position.character);
      if (!word) return null;
      return getHoverForWord(word);
    } catch (err) {
      connection.console.error(
        `hover crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  });

  documents.listen(connection);
  connection.listen();
}

// Support running `node dist/lsp/server.js` directly.
// In that case this module is the entry point, so start the server.
// When imported (e.g. via `ding lsp`), startServer() is called by the caller.
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("lsp/server.js");

if (isDirectInvocation) {
  startServer();
}
