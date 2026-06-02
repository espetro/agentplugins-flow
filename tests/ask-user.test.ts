import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAskUserCliTool } from "../src/tools/ask-user.js";
import { parseAskUserCmd, parseAskUserCmdSync, ASK_USER_HELP } from "../src/cli/ask-user.js";
import { CliError } from "../src/cli/parse.js";

vi.mock("../config/config.js", () => ({
  loadFlowSettings: vi.fn(() => ({
    askUser: { enabled: true, timeout: 300 },
  })),
}));

describe("createAskUserCliTool", () => {
  let tool: ReturnType<typeof createAskUserCliTool>;

  beforeEach(() => {
    tool = createAskUserCliTool();
  });

  it("returns correct name and label", () => {
    expect(tool.name).toBe("ask_user");
    expect(tool.label).toBe("Ask User");
  });

  it("has parameter schema with cmd string", () => {
    const params = tool.parameters as any;
    expect(params.kind).toBe("object");
    expect(params.properties.cmd.kind).toBe("string");
  });

  it("renderCall shows question and option count", () => {
    const theme = {
      fg: vi.fn((key: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const result = tool.renderCall(
      { cmd: 'ask_user "What color?" -o Red -o Blue' },
      theme,
    );
    const text = result.toString();
    expect(text).toContain("What color?");
    expect(text).toContain("2 option(s)");
  });

  it("renderCall handles missing options gracefully", () => {
    const theme = {
      fg: vi.fn((key: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const result = tool.renderCall({ cmd: 'ask_user "What?"' }, theme);
    const text = result.toString();
    expect(text).toContain("What?");
  });

  it("renderResult shows cancelled state", () => {
    const theme = {
      fg: vi.fn((key: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const result = tool.renderResult(
      { details: { cancelled: true, question: "Q", options: [], response: null } },
      {},
      theme,
      {},
    );
    expect(result.toString()).toContain("Cancelled");
  });

  it("renderResult shows selection response", () => {
    const theme = {
      fg: vi.fn((key: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const result = tool.renderResult(
      {
        details: {
          cancelled: false,
          question: "Q",
          options: [{ title: "A", description: "Desc A" }],
          response: { kind: "selection", selections: ["A"] },
        },
      },
      {},
      theme,
      {},
    );
    const text = result.toString();
    expect(text).toContain("A");
    expect(text).not.toContain("(wrote)");
  });

  it("renderResult shows error when details.error present", () => {
    const theme = {
      fg: vi.fn((key: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const result = tool.renderResult(
      { details: { error: "Something broke", cancelled: false, question: "Q", options: [], response: null } },
      {},
      theme,
      {},
    );
    expect(result.toString()).toContain("Something broke");
  });

  it("renderResult expanded mode shows options list", () => {
    const theme = {
      fg: vi.fn((key: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const result = tool.renderResult(
      {
        details: {
          cancelled: false,
          question: "Q",
          options: [
            { title: "A", description: "Desc A" },
            { title: "B", description: "Desc B" },
          ],
          response: { kind: "selection", selections: ["A"] },
        },
      },
      { expanded: true },
      theme,
      {},
    );
    const text = result.toString();
    expect(text).toContain("Q: Q");
    expect(text).toContain("Options:");
  });

  it("execute throws when no UI available", async () => {
    await expect(
      tool.execute("tc1", { cmd: 'ask_user "What?" -o A' }, undefined, undefined, { hasUI: false, ui: null } as any),
    ).rejects.toThrow(/Ask requires interactive mode/);
  });

  it("execute returns cancelled on aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute(
      "tc1",
      { cmd: 'ask_user "What?" -o A' },
      controller.signal,
      undefined,
      { hasUI: true, ui: {} } as any,
    );
    expect(result.content[0].text).toBe("Cancelled");
    expect(result.details.cancelled).toBe(true);
  });

  it("execute rejects empty options", async () => {
    const result = await tool.execute(
      "tc1",
      { cmd: 'ask_user "Name?" -o " "' },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: {
          select: vi.fn(async () => "A"),
          custom: vi.fn(async () => undefined),
        },
      } as any,
    );
    expect(result.content[0].text).toContain("Error: Empty option value");
    expect(result.details.error).toContain("Empty option value");
  });

  it("execute rejects missing options", async () => {
    const result = await tool.execute(
      "tc1",
      { cmd: 'ask_user "Name?"' },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: {
          select: vi.fn(async () => "A"),
          custom: vi.fn(async () => undefined),
        },
      } as any,
    );
    expect(result.content[0].text).toContain("Error: Missing required flag: -o");
    expect(result.details.error).toContain("Missing required flag: -o");
  });

  it("execute handles selection via dialog", async () => {
    const result = await tool.execute(
      "tc1",
      { cmd: 'ask_user "Pick?" -o A -o B' },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: {
          select: vi.fn(async () => "B"),
          custom: vi.fn(async () => undefined),
        },
      } as any,
    );
    expect(result.content[0].text).toContain("User answered: B");
    expect(result.details.response).toEqual({ kind: "selection", selections: ["B"] });
  });

  it("execute handles selection cancellation", async () => {
    const result = await tool.execute(
      "tc1",
      { cmd: 'ask_user "Pick?" -o A -o B' },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: {
          select: vi.fn(async () => undefined),
          custom: vi.fn(async () => undefined),
        },
      } as any,
    );
    expect(result.content[0].text).toBe("User cancelled the question");
    expect(result.details.cancelled).toBe(true);
  });

  it("execute calls onUpdate while waiting", async () => {
    const onUpdate = vi.fn();
    await tool.execute(
      "tc1",
      { cmd: 'ask_user "Pick?" -o A -o B' },
      undefined,
      onUpdate,
      {
        hasUI: true,
        ui: {
          select: vi.fn(async () => "A"),
          custom: vi.fn(async () => undefined),
        },
      } as any,
    );
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ text: "Waiting for user input..." }),
        ]),
      }),
    );
  });

  it("execute returns help for help cmd", async () => {
    const result = await tool.execute(
      "tc1",
      { cmd: "help" },
      undefined,
      undefined,
      { hasUI: true, ui: {} } as any,
    );
    expect(result.content[0].text).toContain("USAGE:");
    expect(result.content[0].text).toContain("ask_user");
  });
});

describe("parseAskUserCmd", () => {
  it("empty string returns help", async () => {
    const result = await parseAskUserCmd("");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("help returns help", async () => {
    const result = await parseAskUserCmd("help");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("--help returns help", async () => {
    const result = await parseAskUserCmd("--help");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("-h returns help", async () => {
    const result = await parseAskUserCmd("-h");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("ask_user help returns help", async () => {
    const result = await parseAskUserCmd("ask_user help");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("missing question throws CliError", async () => {
    await expect(parseAskUserCmd("-o A")).rejects.toThrow(CliError);
    await expect(parseAskUserCmd("-o A")).rejects.toThrow("Missing required argument");
  });

  it("no options throws CliError", async () => {
    await expect(parseAskUserCmd('"Q?"')).rejects.toThrow(CliError);
    await expect(parseAskUserCmd('"Q?"')).rejects.toThrow("Missing required flag: -o");
  });

  it("empty option throws CliError", async () => {
    await expect(parseAskUserCmd('"Q?" -o " "')).rejects.toThrow(CliError);
    await expect(parseAskUserCmd('"Q?" -o " "')).rejects.toThrow("Empty option value");
  });

  it("single colon splits title and description", async () => {
    const result = await parseAskUserCmd('"Q?" -o "A: desc"');
    expect(result.parsed?.options[0]).toEqual({ title: "A", description: " desc" });
  });

  it("multiple colons split on first only", async () => {
    const result = await parseAskUserCmd('"Q?" -o "url:https://x"');
    expect(result.parsed?.options[0]).toEqual({ title: "url", description: "https://x" });
  });

  it("no colon means description equals title", async () => {
    const result = await parseAskUserCmd('"Q?" -o A');
    expect(result.parsed?.options[0]).toEqual({ title: "A", description: "A" });
  });

  it("extra positional after question throws CliError", async () => {
    await expect(parseAskUserCmd('"Q?" extra -o A')).rejects.toThrow(CliError);
    await expect(parseAskUserCmd('"Q?" extra -o A')).rejects.toThrow("Unexpected extra arguments");
  });

  it("ask_user prefix is stripped", async () => {
    const result = await parseAskUserCmd('ask_user "Q?" -o A');
    expect(result.parsed?.question).toBe("Q?");
    expect(result.parsed?.options).toEqual([{ title: "A", description: "A" }]);
  });

  it("happy path with multiple options", async () => {
    const result = await parseAskUserCmd('ask_user "Q?" -o A -o "B: d"');
    expect(result.parsed?.question).toBe("Q?");
    expect(result.parsed?.options).toEqual([
      { title: "A", description: "A" },
      { title: "B", description: " d" },
    ]);
  });
});

describe("parseAskUserCmdSync", () => {
  it("empty string returns help", () => {
    const result = parseAskUserCmdSync("");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("help returns help", () => {
    const result = parseAskUserCmdSync("help");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("--help returns help", () => {
    const result = parseAskUserCmdSync("--help");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("-h returns help", () => {
    const result = parseAskUserCmdSync("-h");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("ask_user help returns help", () => {
    const result = parseAskUserCmdSync("ask_user help");
    expect(result.help).toBe(ASK_USER_HELP);
  });

  it("missing question throws CliError", () => {
    expect(() => parseAskUserCmdSync("-o A")).toThrow(CliError);
    expect(() => parseAskUserCmdSync("-o A")).toThrow("Missing required argument");
  });

  it("no options throws CliError", () => {
    expect(() => parseAskUserCmdSync('"Q?"')).toThrow(CliError);
    expect(() => parseAskUserCmdSync('"Q?"')).toThrow("Missing required flag: -o");
  });

  it("happy path with multiple options", () => {
    const result = parseAskUserCmdSync('ask_user "Q?" -o A -o "B: d"');
    expect(result.parsed?.question).toBe("Q?");
    expect(result.parsed?.options).toEqual([
      { title: "A", description: "A" },
      { title: "B", description: " d" },
    ]);
  });
});
