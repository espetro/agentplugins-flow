import { describe, it, expect } from "vitest";
import { parseFlowCmd, FLOW_HELP } from "../src/cli/flow.js";
import { CliError } from "../src/cli/parse.js";

describe("parseFlowCmd", () => {
  it("returns help for empty cmd", () => {
    const result = parseFlowCmd("");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for 'help'", () => {
    const result = parseFlowCmd("help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for '--help'", () => {
    const result = parseFlowCmd("--help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for '-h'", () => {
    const result = parseFlowCmd("-h");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for 'flow help'", () => {
    const result = parseFlowCmd("flow help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for 'flow --help'", () => {
    const result = parseFlowCmd("flow --help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("parses single item with all required flags", () => {
    const result = parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth' --concern 'verify'");
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.items.length).toBe(1);
    const item = result.parsed!.items[0];
    expect(item.type).toBe("scout");
    expect(item.intent).toBe("Map auth");
    expect(item.aim).toBe("Map auth");
    expect(item.concern).toBe("verify");
  });

  it("parses single item with short flags", () => {
    const result = parseFlowCmd("-t scout -i 'Map auth' -a 'Map auth' -c 'verify'");
    expect(result.parsed!.items[0].type).toBe("scout");
    expect(result.parsed!.items[0].intent).toBe("Map auth");
  });

  it("throws on missing --type", () => {
    expect(() => parseFlowCmd("--intent 'Map auth' --aim 'Map auth' --concern 'verify'")).toThrow(CliError);
  });

  it("throws on missing --intent", () => {
    expect(() => parseFlowCmd("--type scout --aim 'Map auth' --concern 'verify'")).toThrow(CliError);
  });

  it("throws on missing --aim", () => {
    expect(() => parseFlowCmd("--type scout --intent 'Map auth' --concern 'verify'")).toThrow(CliError);
  });

  it("throws on missing --concern", () => {
    expect(() => parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth'")).toThrow(CliError);
  });

  it("throws on invalid --type", () => {
    expect(() => parseFlowCmd("--type invalid --intent 'Map auth' --aim 'Map auth' --concern 'verify'")).toThrow(CliError);
  });

  it("throws on invalid --complexity", () => {
    expect(() => parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth' --concern 'verify' --complexity invalid")).toThrow(CliError);
  });

  it("parses optional --acceptance and --cwd", () => {
    const result = parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth' --concern 'verify' --acceptance 'Tests pass' --cwd /tmp");
    const item = result.parsed!.items[0];
    expect(item.acceptance).toBe("Tests pass");
    expect(item.cwd).toBe("/tmp");
  });

  it("parses two items with ; chain", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x'; --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items.length).toBe(2);
    expect(result.parsed!.items[0].type).toBe("scout");
    expect(result.parsed!.items[1].type).toBe("build");
  });

  it("parses two items with && chain", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' && --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items.length).toBe(2);
  });

  it("applies global --confirm false on first item", () => {
    const result = parseFlowCmd("--confirm false --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.confirm).toBe(false);
  });

  it("applies global --audit 1 on first item", () => {
    const result = parseFlowCmd("--audit 1 --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.audit).toBe(1);
  });

  it("parses dispatch with --", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch read src/auth.ts");
    expect(result.parsed!.items[0].dispatch).toBe("batch read src/auth.ts");
  });

  it("parses dispatch with ; chain inside", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch read foo; batch bash ls");
    expect(result.parsed!.items[0].dispatch).toBe("batch read foo; batch bash ls");
  });

  it("parses dispatch with quoted && in bash command", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch bash 'echo a && echo b'");
    expect(result.parsed!.items[0].dispatch).toBe("batch bash 'echo a && echo b'");
  });

  it("throws on unknown flag", () => {
    expect(() => parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' --unknown val")).toThrow(CliError);
  });

  it("parses --flag=value syntax", () => {
    const result = parseFlowCmd("--type=scout --intent='Map' --aim='Map' --concern='x'");
    expect(result.parsed!.items[0].type).toBe("scout");
  });

  it("parses long cmd with 5+ items", () => {
    const cmd = Array.from({ length: 5 }, (_, i) => `--type scout --intent 'Map ${i}' --aim 'Map ${i}' --concern 'x'`).join("; ");
    const result = parseFlowCmd(cmd);
    expect(result.parsed!.items.length).toBe(5);
  });

  it("throws when only global flags, no items", () => {
    expect(() => parseFlowCmd("--confirm false")).toThrow(CliError);
  });

  it("strips double flow keyword", () => {
    const result = parseFlowCmd("flow flow --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.items[0].type).toBe("scout");
  });

  it("ignores leading ;", () => {
    const result = parseFlowCmd("; --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.items.length).toBe(1);
  });

  it("ignores trailing ;", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x';");
    expect(result.parsed!.items.length).toBe(1);
  });

  it("preserves ; inside quoted intent", () => {
    const result = parseFlowCmd(`--type scout --intent "verify; then audit" --aim 'Map' --concern 'x'`);
    expect(result.parsed!.items[0].intent).toBe("verify; then audit");
  });

  it("is case-insensitive on type", () => {
    const result = parseFlowCmd("--type SCOUT --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.items[0].type).toBe("scout");
  });

  it("is case-insensitive on complexity", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' --complexity COMPLEX");
    expect(result.parsed!.items[0].complexity).toBe("complex");
  });

  it("preserves trailing -- in dispatch", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch bash echo --");
    expect(result.parsed!.items[0].dispatch).toBe("batch bash echo --");
  });

  it("preserves -- in quoted dispatch", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- git diff --");
    expect(result.parsed!.items[0].dispatch).toBe("git diff --");
  });

  it("preserves -- in rm dispatch", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- rm -- -file");
    expect(result.parsed!.items[0].dispatch).toBe("rm -- -file");
  });

  it("tags items with kind after &&", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' && --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items[0].kind).toBe("run");
    expect(result.parsed!.items[1].kind).toBe("and");
  });

  it("tags items with run after ;", () => {
    const result = parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x'; --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items[0].kind).toBe("run");
    expect(result.parsed!.items[1].kind).toBe("run");
  });

  it("throws on --confirm in second chain link", () => {
    expect(() =>
      parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x'; --confirm false --type build --intent 'Build' --aim 'Build' --concern 'y'")
    ).toThrow(CliError);
  });

  it("throws on --audit in second chain link", () => {
    expect(() =>
      parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' && --audit 1 --type build --intent 'Build' --aim 'Build' --concern 'y'")
    ).toThrow(CliError);
  });
});
