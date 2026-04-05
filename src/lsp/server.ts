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
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Lexer } from "../lexer/index.js";
import { Parser } from "../parser/index.js";
import { DingError } from "../errors/index.js";

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
        diagnosticProvider: {
          interFileDependencies: false,
          workspaceDiagnostics: false,
        },
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

  connection.onCompletion((_params: TextDocumentPositionParams): CompletionItem[] => {
    try {
      return getCompletionItems();
    } catch (err) {
      connection.console.error(
        `completion crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
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
