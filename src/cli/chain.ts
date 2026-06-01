/**
 * Chain splitter.
 *
 * Splits a command string on top-level `;` and `&&`.
 * Respects quotes and backslash escapes.
 * Returns: Array<{ kind: "run" | "and"; cmd: string }>.
 * The first op is always kind: "run"; subsequent ops are "run" after `;`
 * and "and" after `&&`.
 */

export interface ChainOp {
  kind: "run" | "and";
  cmd: string;
}

export function splitChain(input: string): ChainOp[] {
  const ops: ChainOp[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;
  let nextKind: "run" | "and" = "run";

  function flush() {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      ops.push({ kind: nextKind, cmd: trimmed });
    }
    current = "";
    return trimmed.length > 0;
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && !inSingle && !inDouble) {
      escapeNext = true;
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      current += ch;
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      }
      current += ch;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }

    // Check for && first (two chars) before ; (one char)
    if (ch === '&' && i + 1 < input.length && input[i + 1] === '&') {
      if (flush()) {
        nextKind = "and";
      }
      i++; // skip second &
      continue;
    }

    if (ch === ';') {
      flush();
      nextKind = "run";
      continue;
    }

    current += ch;
  }

  // Final flush
  flush();

  if (ops.length === 0) {
    ops.push({ kind: "run", cmd: "" });
  }

  return ops;
}
