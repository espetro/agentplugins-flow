/**
 * formatDirectoryListing — permissive directory listing for batch file ops.
 *
 * Replaces EISDIR errors. When any file op (read/edit/patch) is called on a
 * directory, this helper produces a clean, agent-parseable listing instead
 * of throwing.
 *
 * Format:
 *   📁 <displayPath>/  (N entries[, M truncated])
 *     [D] dirname/
 *     [F] filename.ext          12.3 KB
 *     [L] symlink-name          -> target
 *     ... M more entries (truncated)
 *
 * Sort order: directories first, then files, alphabetical within each.
 * Hidden files are included in their natural sort position.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MAX_DIRECTORY_LISTING_ENTRIES } from "./constants.js";

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Produce a sorted directory listing for the agent.
 *
 * @param displayPath  The path the user/agent provided (kept verbatim in the
 *                     header so the agent sees the path it asked about).
 * @param resolvedPath The absolute resolved path used for fs calls.
 */
export async function formatDirectoryListing(
	displayPath: string,
	resolvedPath: string,
): Promise<string> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(resolvedPath, { withFileTypes: true });
	} catch (err: any) {
		const code = err?.code ?? "UNKNOWN";
		return `📁 ${displayPath}/  (unreadable: ${code} ${err?.message ?? ""})`;
	}

	entries.sort((a, b) => {
		const aDir = a.isDirectory() ? 0 : 1;
		const bDir = b.isDirectory() ? 0 : 1;
		if (aDir !== bDir) return aDir - bDir;
		return a.name.localeCompare(b.name);
	});

	const total = entries.length;
	const shown = total > MAX_DIRECTORY_LISTING_ENTRIES
		? entries.slice(0, MAX_DIRECTORY_LISTING_ENTRIES)
		: entries;
	const hidden = total - shown.length;

	const lines: string[] = [];
	lines.push(
		`📁 ${displayPath}/  (${total} entr${total === 1 ? "y" : "ies"}${
			hidden > 0 ? `, ${hidden} truncated` : ""
		})`,
	);

	for (const entry of shown) {
		if (entry.isDirectory()) {
			lines.push(`  [D] ${entry.name}/`);
			continue;
		}
		if (entry.isSymbolicLink()) {
			let target = "<unresolvable>";
			try {
				target = await fs.readlink(path.join(resolvedPath, entry.name));
			} catch {
				/* keep placeholder */
			}
			lines.push(`  [L] ${entry.name.padEnd(28)} -> ${target}`);
			continue;
		}
		try {
			const stat = await fs.stat(path.join(resolvedPath, entry.name));
			lines.push(`  [F] ${entry.name.padEnd(28)} ${formatSize(stat.size)}`);
		} catch {
			lines.push(`  [F] ${entry.name}`);
		}
	}

	if (hidden > 0) {
		lines.push(
			`  ... ${hidden} more entr${hidden === 1 ? "y" : "ies"} truncated (set PI_BATCH_MAX_DIR_ENTRIES to see all)`,
		);
	}

	return lines.join("\n");
}
