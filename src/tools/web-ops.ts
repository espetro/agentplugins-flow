import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { logWarn } from "../config/log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchResult = {
	title: string;
	url: string;
	snippet: string;
	source: "brave" | "duckduckgo";
};

export type WebOpInput =
	| { o: "search"; q: string }
	| { o: "fetch"; u: string; f?: string };

export type WebOpsParams = {
	op: WebOpInput[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SEARCH_RESULTS = 4;
const MAX_SEARCH_SNIPPET_CHARS = 160;
const MAX_MARKDOWN_CHARS = 200_000;
const MAX_FETCH_BYTES = 5_000_000;
const PREVIEW_CHARS = 500;
const ALLOWED_CONTENT_TYPES = [
	"text/html",
	"application/xhtml+xml",
	"text/plain",
	"application/xml",
	"text/xml",
];

// ---------------------------------------------------------------------------
// Core dispatch
// ---------------------------------------------------------------------------

export async function runWebOps(
	params: WebOpsParams,
	ctx: { sessionManager: { getSessionDir(): string } },
	signal?: AbortSignal,
) {
	const parts: string[] = [];
	const details: Array<Record<string, unknown>> = [];

	for (const op of params.op) {
		if (op.o === "search") {
			try {
				const result = await runWebSearch({ query: op.q }, signal);
				parts.push(result.content[0].text);
				details.push({ op: "search", q: op.q, status: "ok", ...result.details });
			} catch (err) {
				const errorText = err instanceof Error ? err.message : String(err);
				parts.push(`--- web error (search: "${op.q}") ---\n${errorText}`);
				details.push({ op: "search", q: op.q, status: "error", error: errorText });
			}
		} else if (op.o === "fetch") {
			try {
				const result = await runWebFetch({ url: op.u, format: op.f }, ctx, signal);
				parts.push(result.content[0].text);
				details.push({ op: "fetch", u: op.u, f: op.f, status: "ok", ...result.details });
			} catch (err) {
				const errorText = err instanceof Error ? err.message : String(err);
				parts.push(`--- web error (fetch: ${op.u}) ---\n${errorText}`);
				details.push({ op: "fetch", u: op.u, f: op.f, status: "error", error: errorText });
			}
		} else {
			const unknownOp = op as Record<string, unknown>;
			const errorText = `Unknown web operation: ${unknownOp.o}`;
			parts.push(`--- web error ---\n${errorText}`);
			details.push({ op: String(unknownOp.o), status: "error", error: errorText });
		}
	}

	const text = parts.join("\n\n---\n\n");
	const truncated = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	}).content;

	return {
		content: [{ type: "text" as const, text: truncated }],
		details: { ops: details },
	};
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function runWebSearch(
	params: { query: string },
	signal?: AbortSignal,
) {
	const { results, errors } = await searchKeyless(params.query, signal);

	let text: string;
	if (results.length > 0) {
		text = results
			.map((result, index) => {
				const snippet = result.snippet ? `\n   ${result.snippet}` : "";
				return `${index + 1}. ${result.title}\n   ${result.url}${snippet}`;
			})
			.join("\n\n");
	} else if (errors.length > 0) {
		text = `Search failed for: ${params.query}\n\nAll search providers returned errors:\n${errors.map((e) => `- ${e}`).join("\n")}`;
	} else {
		text = `No results found for: ${params.query}`;
	}

	text = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES }).content;

	return {
		content: [{ type: "text" as const, text }],
		details: {
			query: params.query,
			results,
			errors: errors.length > 0 ? errors : undefined,
		},
	};
}

async function searchKeyless(
	query: string,
	signal?: AbortSignal,
): Promise<{ results: SearchResult[]; errors: string[] }> {
	const errors: string[] = [];

	try {
		const brave = await braveSearchHtml(query, signal);
		if (brave.length > 0) return { results: brave, errors: [] };
	} catch (err) {
		errors.push(`Brave: ${err instanceof Error ? err.message : String(err)}`);
	}

	try {
		const ddg = await duckDuckGoHtmlSearch(query, signal);
		if (ddg.length > 0) return { results: ddg, errors: [] };
	} catch (err) {
		errors.push(`DuckDuckGo: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (errors.length > 0) {
		logWarn(`[web] searchKeyless failed:\n${errors.join("\n")}`);
	}

	return { results: [], errors };
}

async function braveSearchHtml(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
	const url = new URL("https://search.brave.com/search");
	url.searchParams.set("q", query);
	url.searchParams.set("source", "web");

	const response = await fetch(url.toString(), {
		redirect: "follow",
		signal,
		headers: browserHeaders(),
	});

	if (!response.ok) {
		throw new Error(`Brave search failed with status ${response.status}`);
	}

	const html = await response.text();
	const dom = new JSDOM(html, { url: url.toString() });
	const document = dom.window.document;

	const anchors: HTMLAnchorElement[] = Array.from(
		document.querySelectorAll<HTMLAnchorElement>(
			[
				"a[data-testid='result-title-a']",
				".snippet.fdb a",
				".result h2 a",
				"a.heading-serpresult",
			].join(", "),
		),
	);

	const results: SearchResult[] = [];
	const seen = new Set<string>();

	for (const anchor of anchors) {
		const href = anchor.href?.trim();
		const title = anchor.textContent?.replace(/\s+/g, " ").trim() ?? "";

		if (!href || !title) continue;
		if (!/^https?:\/\//i.test(href)) continue;
		if (href.includes("search.brave.com")) continue;
		if (seen.has(href)) continue;

		const container =
			anchor.closest("[data-type='web']") ??
			anchor.closest(".snippet") ??
			anchor.closest(".fdb") ??
			anchor.parentElement;

		const snippet = extractSnippet(container?.textContent ?? "", title);

		seen.add(href);
		results.push({
			title,
			url: href,
			snippet,
			source: "brave",
		});

		if (results.length >= MAX_SEARCH_RESULTS) break;
	}

	return results;
}

async function duckDuckGoHtmlSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
	const url = new URL("https://html.duckduckgo.com/html/");
	url.searchParams.set("q", query);

	const response = await fetch(url.toString(), {
		method: "GET",
		redirect: "follow",
		signal,
		headers: browserHeaders(),
	});

	if (!response.ok) {
		throw new Error(`DuckDuckGo search failed with status ${response.status}`);
	}

	const html = await response.text();
	const dom = new JSDOM(html, { url: url.toString() });
	const document = dom.window.document;

	const results: SearchResult[] = [];
	const seen = new Set<string>();

	const items: Element[] = Array.from(document.querySelectorAll<Element>(".result"));

	for (const item of items) {
		const titleAnchor = item.querySelector(
			".result__title a, a.result__a",
		) as HTMLAnchorElement | null;
		if (!titleAnchor) continue;

		const href = titleAnchor.href?.trim();
		const title = titleAnchor.textContent?.replace(/\s+/g, " ").trim() ?? "";

		if (!href || !title) continue;
		if (!/^https?:\/\//i.test(href)) continue;
		if (seen.has(href)) continue;

		const snippetNode =
			item.querySelector(".result__snippet") ??
			item.querySelector(".result__body") ??
			item.querySelector(".result__extras");

		const snippet = extractSnippet(snippetNode?.textContent ?? "", title);

		seen.add(href);
		results.push({
			title,
			url: href,
			snippet,
			source: "duckduckgo",
		});

		if (results.length >= MAX_SEARCH_RESULTS) break;
	}

	return results;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function runWebFetch(
	params: { url: string; format?: string },
	ctx: { sessionManager: { getSessionDir(): string } },
	signal?: AbortSignal,
) {
	validateFetchUrl(params.url);

	const format = params.format ?? "markdown";
	const html = await fetchHtml(params.url, signal);

	let content: string;
	let title: string;
	let ext: string;

	if (format === "html") {
		content = html;
		title = extractTitle(html, params.url);
		ext = ".html";
	} else if (format === "text") {
		const result = htmlToMarkdown(html, params.url);
		title = result.title;
		content = stripMarkdownFormatting(result.markdown);
		ext = ".txt";
	} else {
		const result = htmlToMarkdown(html, params.url);
		title = result.title;
		content = result.markdown;
		ext = ".md";
	}

	if (content.length > MAX_MARKDOWN_CHARS) {
		content = trimLargeDocument(content, MAX_MARKDOWN_CHARS);
	}

	const sessionDir = ctx.sessionManager.getSessionDir();
	const filePath = await writeTempFile(sessionDir, params.url, content, ext);
	const preview = content.slice(0, PREVIEW_CHARS).trim();

	let warning: string | undefined;
	if (content.length === 0) {
		warning = "Warning: no readable content was extracted from this page.";
	} else if (content.length < 100) {
		warning = "Warning: very little content was extracted from this page.";
	}

	const text = [
		warning,
		`File: ${filePath}`,
		title ? `Title: ${title}` : undefined,
		`Content length: ${content.length} chars`,
		"",
		"Preview:",
		preview,
	]
		.filter((line) => line != null)
		.join("\n");

	const truncated = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	}).content;

	return {
		content: [{ type: "text" as const, text: truncated }],
		details: {
			url: params.url,
			title,
			filePath,
			contentLength: content.length,
			format,
		},
	};
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
	// Tier 1: direct fetch
	try {
		const response = await fetch(url, {
			redirect: "follow",
			signal,
			headers: browserHeaders(),
		});

		if (response.ok) {
			const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
			if (!contentType || ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
				const contentLength = Number(response.headers.get("content-length") || "0");
				if (contentLength <= MAX_FETCH_BYTES) {
					const text = await response.text();
					if (text.length <= MAX_FETCH_BYTES && text.length >= 100) {
						return text;
					}
				}
			}
		}
	} catch {
		// Fall through to jina.ai
	}

	// Tier 2: jina.ai summarizer/extractor
	try {
		const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
		const jinaResponse = await fetch(jinaUrl, {
			redirect: "follow",
			signal,
			headers: browserHeaders(),
		});

		if (jinaResponse.ok) {
			const text = await jinaResponse.text();
			if (text.length <= MAX_FETCH_BYTES && text.length >= 100) {
				return text;
			}
		}
	} catch {
		// Fall through to curl
	}

	// Tier 3: curl subprocess (last effort)
	const curlText = await fetchWithCurl(url, signal);
	if (curlText.length >= 100) {
		return curlText;
	}

	throw new Error(`Failed to fetch URL (direct + jina.ai + curl all failed). URL: ${url}`);
}

function fetchWithCurl(url: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"curl",
			["-sL", "--max-time", "30", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", url],
			{ maxBuffer: MAX_FETCH_BYTES },
			(error, stdout, stderr) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);

		if (signal) {
			signal.addEventListener("abort", () => {
				child.kill("SIGTERM");
				reject(new Error("Aborted"));
			});
		}
	});
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function extractSnippet(raw: string, title: string): string {
	let text = raw.replace(/\s+/g, " ").trim();
	if (!text || text === title) return "";
	if (text.startsWith(title)) text = text.slice(title.length).trim();
	if (!text) return "";
	return text.slice(0, MAX_SEARCH_SNIPPET_CHARS);
}

export function validateFetchUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`Unsupported URL scheme "${parsed.protocol}" — only http: and https: are allowed`,
		);
	}

	const hostname = parsed.hostname;
	if (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "0.0.0.0" ||
		hostname === "[::1]" ||
		hostname.startsWith("169.254.") ||
		hostname.startsWith("10.") ||
		hostname.startsWith("192.168.") ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
		hostname.endsWith(".local") ||
		hostname.endsWith(".internal")
	) {
		throw new Error(`Blocked: "${hostname}" looks like a private or internal address`);
	}
}

export function htmlToMarkdown(html: string, baseUrl: string): { title: string; markdown: string } {
	const dom = new JSDOM(html, { url: baseUrl });
	const document = dom.window.document;

	for (const selector of [
		"script",
		"style",
		"noscript",
		"iframe",
		"svg",
		"canvas",
		"form",
		"nav",
		"aside",
		"footer",
		"header",
	]) {
		document.querySelectorAll(selector).forEach((el: Element) => el.remove());
	}

	const main =
		document.querySelector("main") ??
		document.querySelector("article") ??
		document.querySelector("[role='main']") ??
		document.body;

	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});

	turndown.remove(["script", "style", "noscript", "iframe", "canvas"]);

	const title = (document.title || "").trim();
	const markdown = turndown.turndown(main?.innerHTML || "");

	return {
		title,
		markdown: markdown.replace(/\n{3,}/g, "\n\n").trim(),
	};
}

export function trimLargeDocument(markdown: string, maxChars: number): string {
	if (markdown.length <= maxChars) return markdown;

	const marker = "\n\n[...content trimmed...]\n\n";
	const budget = maxChars - marker.length;
	const headSize = Math.floor(budget * 0.75);
	const tailSize = budget - headSize;

	const head = markdown.slice(0, headSize).trimEnd();
	const tail = markdown.slice(-tailSize).trimStart();

	return `${head}${marker}${tail}`.slice(0, maxChars);
}

function extractTitle(html: string, _baseUrl: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

export function stripMarkdownFormatting(markdown: string): string {
	return markdown
		.replace(/^#{1,6}\s+/gm, "") // headings
		.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").trim()) // fenced code blocks
		.replace(/\*\*([^*]+)\*\*/g, "$1") // bold
		.replace(/\*([^*]+)\*/g, "$1") // italic
		.replace(/`([^`]+)`/g, "$1") // inline code
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // images
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
		.replace(/^\d+\.\s+/gm, "") // numbered lists
		.replace(/^[-*+]\s+/gm, "") // unordered list markers
		.replace(/^>\s+/gm, "") // blockquotes
		.replace(/^---+$/gm, "") // horizontal rules
		.replace(/^\|.*\|$/gm, (row) =>
			/[\s|:-]+$/.test(row)
				? ""
				: row
						.replace(/^\||\|$/g, "")
						.replace(/\|/g, " — ")
						.trim(),
		) // tables
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function urlToHash(url: string): string {
	return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

async function writeTempFile(
	sessionDir: string,
	url: string,
	content: string,
	ext: string,
): Promise<string> {
	const dir = join(sessionDir, "tmp");
	await mkdir(dir, { recursive: true });
	const hash = urlToHash(url);
	const filePath = join(dir, `fetch-${hash}${ext}`);
	await writeFile(filePath, content, "utf-8");
	return filePath;
}

function browserHeaders(): HeadersInit {
	return {
		"User-Agent":
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
	};
}

// ---------------------------------------------------------------------------
// Prompt steering helpers
// ---------------------------------------------------------------------------

export function looksLikeUrlPrompt(prompt: string | undefined): boolean {
	if (!prompt) return false;
	return /(https?:\/\/\S+|www\.\S+)/i.test(prompt);
}

export function looksLikeWebSearchPrompt(prompt: string | undefined): boolean {
	if (!prompt) return false;
	const text = prompt.toLowerCase();

	const patterns = [
		/\b(search the web|look online|find online|search online|web search)\b/,
		/\b(official documentation|official docs|api docs|api reference)\b/,
		/\b(latest version|latest release|release notes|what's new)\b/,
		/\b(current price|current status|today's|yesterday's|this week's)\b/,
		/\bnews about\b/,
		/\bwhat changed in\b/,
		/\bup to date\b/,
		/\bon the web\b/,
		/\bgoogle\s+(for|how|what|why|when)\b/,
		/\b(find|look up|check)\s+.{0,20}\b(online|on the web|on the internet)\b/,
	];

	return patterns.some((re) => re.test(text));
}
