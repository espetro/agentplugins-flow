/**
 * Shared output truncation for batch read, rg, and bash results.
 *
 * Applies limits in order: per-line bytes → total lines → total bytes.
 */

import {
	MAX_BYTES_PER_LINE,
	MAX_BASH_OUTPUT_BYTES,
	MAX_BASH_OUTPUT_LINES,
	RG_MAX_OUTPUT_BYTES,
	RG_MAX_OUTPUT_LINES,
} from "./constants.js";

interface TruncateOutputOptions {
	maxLines?: number;
	maxBytes?: number;
	maxBytesPerLine?: number;
}

export interface TruncateOutputResult {
	text: string;
	truncated: boolean;
	longLinesTruncated: number;
	truncatedLines: boolean;
	truncatedBytes: boolean;
	totalLines: number;
	totalBytes: number;
}

/** Truncate a single line to maxBytes (UTF-8 safe). */
export function truncateLineBytes(
	line: string,
	maxBytes: number,
): { line: string; truncated: boolean; originalBytes: number } {
	const originalBytes = Buffer.byteLength(line, "utf-8");
	if (originalBytes <= maxBytes) {
		return { line, truncated: false, originalBytes };
	}

	const suffix = `[… ${originalBytes} bytes, truncated to ${maxBytes} …]`;
	const suffixBytes = Buffer.byteLength(suffix, "utf-8");
	const keepBytes = Math.max(1, maxBytes - suffixBytes);

	const buf = Buffer.from(line, "utf-8");
	let cutAt = Math.min(keepBytes, buf.length);
	while (cutAt > 0 && (buf[cutAt] & 0xc0) === 0x80) {
		cutAt--;
	}
	if (cutAt <= 0) {
		return { line: suffix.trim(), truncated: true, originalBytes };
	}

	return {
		line: buf.slice(0, cutAt).toString("utf-8") + suffix,
		truncated: true,
		originalBytes,
	};
}

function truncateAtByteBoundary(text: string, maxBytes: number): string {
	const totalBytes = Buffer.byteLength(text, "utf-8");
	if (totalBytes <= maxBytes) return text;

	const buf = Buffer.from(text, "utf-8");
	let cutAt = maxBytes;
	while (cutAt > 0) {
		while (cutAt > 0 && (buf[cutAt] & 0xc0) === 0x80) {
			cutAt--;
		}
		if (cutAt <= 0) break;
		if (buf[cutAt] === 0x0a) break;
		cutAt--;
	}
	if (cutAt <= 0) {
		cutAt = maxBytes;
		while (cutAt > 0 && (buf[cutAt] & 0xc0) === 0x80) {
			cutAt--;
		}
	}
	return (
		buf.slice(0, cutAt).toString("utf-8") +
		`\n[... truncated at ${(maxBytes / 1024).toFixed(0)} KB, ${totalBytes} total ...]`
	);
}

/** Truncate multi-line tool output with per-line, line-count, and byte caps. */
export function truncateOutput(
	text: string,
	options: TruncateOutputOptions = {},
): TruncateOutputResult {
	const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY;
	const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
	const maxBytesPerLine = options.maxBytesPerLine ?? MAX_BYTES_PER_LINE;

	if (!text) {
		return {
			text: "",
			truncated: false,
			longLinesTruncated: 0,
			truncatedLines: false,
			truncatedBytes: false,
			totalLines: 0,
			totalBytes: 0,
		};
	}

	const totalLines = text.split("\n").length;
	const totalBytes = Buffer.byteLength(text, "utf-8");

	let lines = text.split("\n");
	let longLinesTruncated = 0;

	lines = lines.map((line) => {
		const { line: trimmed, truncated } = truncateLineBytes(line, maxBytesPerLine);
		if (truncated) longLinesTruncated++;
		return trimmed;
	});

	let truncated = longLinesTruncated > 0;
	let truncatedLines = false;
	let truncatedBytes = false;
	let result = lines.join("\n");

	if (lines.length > maxLines) {
		result = lines.slice(0, maxLines).join("\n");
		result += `\n[... truncated at ${maxLines} lines, ${totalLines} total ...]`;
		truncated = true;
		truncatedLines = true;
	}

	if (Buffer.byteLength(result, "utf-8") > maxBytes) {
		result = truncateAtByteBoundary(result, maxBytes);
		truncated = true;
		truncatedBytes = true;
	}

	return {
		text: result,
		truncated,
		longLinesTruncated,
		truncatedLines,
		truncatedBytes,
		totalLines,
		totalBytes,
	};
}

export function truncateBashOutputText(
	text: string,
	maxBytes: number = MAX_BASH_OUTPUT_BYTES,
	maxLines: number = MAX_BASH_OUTPUT_LINES,
): string {
	return truncateOutput(text, {
		maxLines,
		maxBytes,
		maxBytesPerLine: MAX_BYTES_PER_LINE,
	}).text;
}

export function truncateRgOutputText(text: string): TruncateOutputResult {
	return truncateOutput(text, {
		maxLines: RG_MAX_OUTPUT_LINES,
		maxBytes: RG_MAX_OUTPUT_BYTES,
		maxBytesPerLine: MAX_BYTES_PER_LINE,
	});
}
