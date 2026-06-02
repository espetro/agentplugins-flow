/**
 * batch — re-export shim.
 *
 * The batch tool is now a CLI-style tool (src/cli/batch.ts).
 * This file re-exports the new factory and legacy symbols for
 * backward compatibility with existing imports.
 */

export { createBatchCliTool } from "../cli/register.js";
export { BashProcessTracker, createBatchBashPollTool, pollBatchBashResults, runBashWithLimits } from "./batch-bash.js";

// Backward-compatible alias: createBatchTool → createBatchCliTool
export { createBatchCliTool as createBatchTool } from "../cli/register.js";
