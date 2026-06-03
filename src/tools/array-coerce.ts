import { logWarn } from "../config/log.js";

export interface ArrayCoerceResult<T> {
  value: T[];
  notes: string[];
  dropped: number;
}

export function coerceArrayOfObjects<T extends Record<string, unknown>>(
  input: unknown,
  options?: { label?: string },
): ArrayCoerceResult<T> {
  const label = options?.label ?? "array";

  if (!Array.isArray(input)) {
    return {
      value: [],
      notes: [`${label}: not an array, got ${typeof input}`],
      dropped: 0,
    };
  }

  const value: T[] = [];
  const notes: string[] = [];
  let dropped = 0;

  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (item === null || item === undefined) {
      notes.push(`${label}[${i}]: dropped null/undefined`);
      dropped++;
      continue;
    }
    if (typeof item === "string") {
      const snippet = item.slice(0, 40);
      notes.push(`${label}[${i}]: dropped non-object (string: ${JSON.stringify(snippet)})`);
      dropped++;
      continue;
    }
    if (typeof item === "number" || typeof item === "boolean") {
      const snippet = String(item).slice(0, 40);
      notes.push(`${label}[${i}]: dropped non-object (${typeof item}: ${snippet})`);
      dropped++;
      continue;
    }
    if (Array.isArray(item)) {
      notes.push(`${label}[${i}]: dropped nested array`);
      dropped++;
      continue;
    }
    if (typeof item === "object") {
      value.push(item as T);
    }
  }

  if (dropped > 0) {
    logWarn(`[pi-agent-flow] ${label}: dropped ${dropped} non-object element(s) from array`);
  }

  return { value, notes, dropped };
}
