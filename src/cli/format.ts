/**
 * Output formatter for chained CLI ops.
 */

export interface ChainedOp {
  cmd: string;
  output: string;
  error?: string;
  failed?: boolean;
  skipped?: boolean;
}

export function formatChainedOutput(ops: ChainedOp[]): string {
  const total = ops.length;
  if (total === 1 && !ops[0].skipped) {
    if (ops[0].error) {
      return `ERROR: ${ops[0].error}`;
    }
    return ops[0].output;
  }

  const sections: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const header = `--- op ${i + 1}/${total}: ${op.skipped ? `SKIPPED (previous failed)` : op.cmd} ---`;
    sections.push(header);
    if (op.skipped) {
      continue;
    }
    if (op.error) {
      sections.push(`ERROR: ${op.error}`);
    } else {
      sections.push(op.output);
    }
  }
  return sections.join("\n");
}
