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

// ---------------------------------------------------------------------------
// Double-dash separator
// ---------------------------------------------------------------------------

/**
 * Splits a command string on the first top-level standalone `--`.
 * Respects quotes and backslash escapes.
 * Returns { pre: string; post: string }.
 */
export function splitOnDoubleDash(input: string): { pre: string; post: string } {
  let pre = "";
  let post = "";
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;
  let found = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escapeNext) {
      if (found) post += ch;
      else pre += ch;
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && !inSingle && !inDouble) {
      escapeNext = true;
      if (found) post += ch;
      else pre += ch;
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      if (found) post += ch;
      else pre += ch;
      continue;
    }

    if (inDouble) {
      if (ch === '"') inDouble = false;
      if (found) post += ch;
      else pre += ch;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      if (found) post += ch;
      else pre += ch;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      if (found) post += ch;
      else pre += ch;
      continue;
    }

    if (ch === '-' && i + 1 < input.length && input[i + 1] === '-') {
      const prev = i > 0 ? input[i - 1] : ' ';
      const nextIdx = i + 2;
      const isWhitespace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
      if (isWhitespace(prev) && (nextIdx >= input.length || isWhitespace(input[nextIdx]))) {
        found = true;
        i++; // skip second dash
        continue;
      }
    }

    if (found) post += ch;
    else pre += ch;
  }

  return { pre: pre.trim(), post: post.trim() };
}
