import { describe, it, expect } from "vitest";
import {
	stripDirectives,
	stripDirectivesFromContent,
	stripDirectivesFromMessages,
} from "../src/steering/tool-utils.js";

function makeResult(text?: string) {
	return {
		content: text ? [{ type: "text", text }] : [],
	};
}

describe("stripDirectives", () => {
	it("removes directive text from string", () => {
		const text = 'before\n\n[Directive: Verify your work before advancing — dispatch a follow-up flow.] after';
		expect(stripDirectives(text)).toBe("before after");
	});

	it("removes unfinished directive text from string", () => {
		const text = 'before\n\n[Directive: Unfinished items remain. Resolve them before starting new work.] after';
		expect(stripDirectives(text)).toBe("before after");
	});

	it("removes vague directive text from string", () => {
		const text = 'before\n\n[Directive: Status unclear — dispatch a verification flow to confirm completion.] after';
		expect(stripDirectives(text)).toBe("before after");
	});

	it("removes legacy [Hint:] directives from text", () => {
		const text = 'before\n\n[Hint: Plan next step. Batch ALL pending edits/reads/commands into ONE batch call. Execute decisively.] after';
		expect(stripDirectives(text)).toBe("before after");
	});

	it("returns text unchanged when no directives present", () => {
		const text = "clean text";
		expect(stripDirectives(text)).toBe("clean text");
	});
});

describe("stripDirectivesFromContent", () => {
	it("strips from string content", () => {
		const content = 'before\n\n[Directive: Verify your work before advancing — dispatch a follow-up flow.] after';
		expect(stripDirectivesFromContent(content)).toBe("before after");
	});

	it("strips from text-part array", () => {
		const content = [
			{ type: "text", text: 'before\n\n[Directive: Unfinished items remain. Resolve them before starting new work.] after' },
			{ type: "text", text: "clean" },
		];
		const result = stripDirectivesFromContent(content) as Array<{ type: string; text: string }>;
		expect(result[0].text).toBe("before after");
		expect(result[1].text).toBe("clean");
	});

	it("preserves non-text parts", () => {
		const content = [
			{ type: "text", text: '\n\n[Directive: Status unclear — dispatch a verification flow to confirm completion.]' },
			{ type: "toolCall", name: "bash" },
		];
		const result = stripDirectivesFromContent(content) as Array<{ type: string; text?: string }>;
		expect(result[0].text).toBe("");
		expect(result[1].type).toBe("toolCall");
	});
});

describe("stripDirectivesFromMessages", () => {
	it("strips directives from string content in messages", () => {
		const messages = [
			{ role: "user", content: 'before\n\n[Directive: Verify your work before advancing — dispatch a follow-up flow.] after' },
		];
		const { messages: result, changed } = stripDirectivesFromMessages(messages);
		expect(changed).toBe(true);
		expect(result[0].content).toBe("before after");
	});

	it("strips directives from multipart content in messages", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: 'before\n\n[Directive: Unfinished items remain. Resolve them before starting new work.] after' }] },
		];
		const { messages: result, changed } = stripDirectivesFromMessages(messages);
		expect(changed).toBe(true);
		expect((result[0].content as any[])[0].text).toBe("before after");
	});

	it("returns unchanged flag false when nothing to strip", () => {
		const messages = [{ role: "user", content: "clean" }];
		const { messages: result, changed } = stripDirectivesFromMessages(messages);
		expect(changed).toBe(false);
		expect(result[0].content).toBe("clean");
	});
});
