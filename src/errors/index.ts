export type Phase = "lexer" | "parser" | "emitter" | "runtime" | "module";

export class DingError extends Error {
  phase: Phase;
  line?: number;
  col?: number;
  source?: string;
  hint?: string;

  constructor(
    phase: Phase,
    message: string,
    options?: { line?: number; col?: number; source?: string; hint?: string },
  ) {
    super(message);
    this.name = "DingError";
    this.phase = phase;
    this.line = options?.line;
    this.col = options?.col;
    this.source = options?.source;
    this.hint = options?.hint;
  }
}

function phaseLabel(phase: Phase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function formatError(err: DingError): string {
  const label = phaseLabel(err.phase);
  const header = `── Ding ${label} Error ──────────────────`;
  const footer = `───────────────────────────────────────`;

  const lines: string[] = [header, ""];

  // Main message with optional location
  if (err.line != null && err.col != null) {
    lines.push(`${err.message} at line ${err.line}, col ${err.col}`);
  } else {
    lines.push(err.message);
  }

  lines.push("");

  // Source line with caret
  if (err.source != null && err.line != null && err.col != null) {
    const lineNum = String(err.line);
    const prefix = `${lineNum} | `;
    lines.push(`${prefix}${err.source}`);

    // Caret line — point at the error column
    const padding = " ".repeat(prefix.length + err.col - 1);
    lines.push(`${padding}^^^`);
  }

  // Hint
  if (err.hint) {
    lines.push(`Hint: ${err.hint}`);
  }

  lines.push("");
  lines.push(footer);

  return lines.join("\n");
}
