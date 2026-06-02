import { describe, it, expect } from "vitest";
import { parseFlowCmd, FLOW_HELP } from "../src/cli/flow.js";
import { CliError } from "../src/cli/parse.js";

describe("parseFlowCmd", () => {
  it("returns help for empty cmd", async () => {
    const result = await parseFlowCmd("");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for 'help'", async () => {
    const result = await parseFlowCmd("help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for '--help'", async () => {
    const result = await parseFlowCmd("--help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for '-h'", async () => {
    const result = await parseFlowCmd("-h");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for 'flow help'", async () => {
    const result = await parseFlowCmd("flow help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("returns help for 'flow --help'", async () => {
    const result = await parseFlowCmd("flow --help");
    expect(result.help).toBe(FLOW_HELP);
  });

  it("parses single item with all required flags", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth' --concern 'verify'");
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.items.length).toBe(1);
    const item = result.parsed!.items[0];
    expect(item.type).toBe("scout");
    expect(item.intent).toBe("Map auth");
    expect(item.aim).toBe("Map auth");
    expect(item.concern).toBe("verify");
  });

  it("parses single item with short flags", async () => {
    const result = await parseFlowCmd("-t scout -i 'Map auth' -a 'Map auth' -c 'verify'");
    expect(result.parsed!.items[0].type).toBe("scout");
    expect(result.parsed!.items[0].intent).toBe("Map auth");
  });

  it("throws on missing --type", async () => {
    await expect(parseFlowCmd("--intent 'Map auth' --aim 'Map auth' --concern 'verify'")).rejects.toThrow(CliError);
  });

  it("throws on missing --intent", async () => {
    await expect(parseFlowCmd("--type scout --aim 'Map auth' --concern 'verify'")).rejects.toThrow(CliError);
  });

  it("throws on missing --aim", async () => {
    await expect(parseFlowCmd("--type scout --intent 'Map auth' --concern 'verify'")).rejects.toThrow(CliError);
  });

  it("throws on missing --concern", async () => {
    await expect(parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth'")).rejects.toThrow(CliError);
  });

  it("throws on invalid --type", async () => {
    await expect(parseFlowCmd("--type invalid --intent 'Map auth' --aim 'Map auth' --concern 'verify'")).rejects.toThrow(CliError);
  });

  it("throws on invalid --complexity", async () => {
    await expect(parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth' --concern 'verify' --complexity invalid")).rejects.toThrow(CliError);
  });

  it("parses optional --acceptance and --cwd", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map auth' --aim 'Map auth' --concern 'verify' --acceptance 'Tests pass' --cwd /tmp");
    const item = result.parsed!.items[0];
    expect(item.acceptance).toBe("Tests pass");
    expect(item.cwd).toBe("/tmp");
  });

  it("parses two items with ; chain", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x'; --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items.length).toBe(2);
    expect(result.parsed!.items[0].type).toBe("scout");
    expect(result.parsed!.items[1].type).toBe("build");
  });

  it("parses two items with && chain", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' && --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items.length).toBe(2);
  });

  it("applies global --confirm false on first item", async () => {
    const result = await parseFlowCmd("--confirm false --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.confirm).toBe(false);
  });

  it("applies global --confirm false with short flag", async () => {
    const result = await parseFlowCmd("-y false --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.confirm).toBe(false);
  });

  it("applies global --audit 1 on first item", async () => {
    const result = await parseFlowCmd("--audit 1 --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.audit).toBe(1);
  });

  it("applies global --audit 1 with short flag", async () => {
    const result = await parseFlowCmd("-u 1 --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.audit).toBe(1);
  });

  it("parses dispatch with --", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch read src/auth.ts");
    expect(result.parsed!.items[0].dispatch).toBe("batch read src/auth.ts");
  });

  it("parses dispatch with quoted ; inside", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch read 'foo; batch bash ls'");
    expect(result.parsed!.items[0].dispatch).toBe("batch read 'foo; batch bash ls'");
  });

  it("parses dispatch with quoted && in bash command", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch bash 'echo a && echo b'");
    expect(result.parsed!.items[0].dispatch).toBe("batch bash 'echo a && echo b'");
  });

  it("throws on unknown flag", async () => {
    await expect(parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' --unknown val")).rejects.toThrow(CliError);
  });

  it("parses --flag=value syntax", async () => {
    const result = await parseFlowCmd("--type=scout --intent='Map' --aim='Map' --concern='x'");
    expect(result.parsed!.items[0].type).toBe("scout");
  });

  it("parses long cmd with 5+ items", async () => {
    const cmd = Array.from({ length: 5 }, (_, i) => `--type scout --intent 'Map ${i}' --aim 'Map ${i}' --concern 'x'`).join("; ");
    const result = await parseFlowCmd(cmd);
    expect(result.parsed!.items.length).toBe(5);
  });

  it("throws when only global flags, no items", async () => {
    await expect(parseFlowCmd("--confirm false")).rejects.toThrow(CliError);
  });

  it("strips double flow keyword", async () => {
    const result = await parseFlowCmd("flow flow --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.items[0].type).toBe("scout");
  });

  it("ignores leading ;", async () => {
    const result = await parseFlowCmd("; --type scout --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.items.length).toBe(1);
  });

  it("ignores trailing ;", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x';");
    expect(result.parsed!.items.length).toBe(1);
  });

  it("preserves ; inside quoted intent", async () => {
    const result = await parseFlowCmd(`--type scout --intent "verify; then audit" --aim 'Map' --concern 'x'`);
    expect(result.parsed!.items[0].intent).toBe("verify; then audit");
  });

  it("is case-insensitive on type", async () => {
    const result = await parseFlowCmd("--type SCOUT --intent 'Map' --aim 'Map' --concern 'x'");
    expect(result.parsed!.items[0].type).toBe("scout");
  });

  it("is case-insensitive on complexity", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' --complexity COMPLEX");
    expect(result.parsed!.items[0].complexity).toBe("complex");
  });

  it("preserves trailing -- in dispatch", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- batch bash echo --");
    expect(result.parsed!.items[0].dispatch).toBe("batch bash echo --");
  });

  it("preserves -- in quoted dispatch", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- git diff --");
    expect(result.parsed!.items[0].dispatch).toBe("git diff --");
  });

  it("preserves -- in rm dispatch", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' -- rm -- -file");
    expect(result.parsed!.items[0].dispatch).toBe("rm -- -file");
  });

  it("tags items with kind after &&", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' && --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items[0].kind).toBe("run");
    expect(result.parsed!.items[1].kind).toBe("and");
  });

  it("tags items with run after ;", async () => {
    const result = await parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x'; --type build --intent 'Build' --aim 'Build' --concern 'y'");
    expect(result.parsed!.items[0].kind).toBe("run");
    expect(result.parsed!.items[1].kind).toBe("run");
  });

  it("throws on --confirm in second chain link", async () => {
    await expect(
      parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x'; --confirm false --type build --intent 'Build' --aim 'Build' --concern 'y'")
    ).rejects.toThrow(CliError);
  });

  it("throws on --audit in second chain link", async () => {
    await expect(
      parseFlowCmd("--type scout --intent 'Map' --aim 'Map' --concern 'x' && --audit 1 --type build --intent 'Build' --aim 'Build' --concern 'y'")
    ).rejects.toThrow(CliError);
  });

  it("parses new short aliases", async () => {
    const result = await parseFlowCmd("-t scout -i 'Map' -a 'Map' -c 'x' -A 'Tests pass' -w /tmp -x moderate");
    const item = result.parsed!.items[0];
    expect(item.type).toBe("scout");
    expect(item.intent).toBe("Map");
    expect(item.aim).toBe("Map");
    expect(item.concern).toBe("x");
    expect(item.acceptance).toBe("Tests pass");
    expect(item.cwd).toBe("/tmp");
    expect(item.complexity).toBe("moderate");
  });
});
