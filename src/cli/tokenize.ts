/**
 * Shell-style tokenizer.
 *
 * Splits a string into tokens respecting single quotes, double quotes,
 * and backslash escapes. Does NOT split on `;` or `&&` — that's the
 * chain splitter's job.
 */

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escapeNext) {
      if (inDouble) {
        // In double quotes, only \", \\, and backslash-newline are special;
        // everything else keeps the backslash literal.
        if (ch === '"' || ch === '\\') {
          current += ch;
        } else {
          current += '\\' + ch;
        }
      } else {
        current += ch;
      }
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escapeNext = true;
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escapeNext) {
    current += '\\';
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
