import { prepareTraceDispatchArguments } from "../dist/tools/trace-dispatch-prep.js";

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
	const actualJson = JSON.stringify(actual, null, 2);
	const expectedJson = JSON.stringify(expected, null, 2);
	if (actualJson !== expectedJson) {
		console.error(`FAIL: ${label}`);
		console.error(`  expected: ${expectedJson}`);
		console.error(`  actual:   ${actualJson}`);
		failed++;
	} else {
		console.log(`PASS: ${label}`);
		passed++;
	}
}

// a. Exact failing call from bug report
const bugReport = {
	dispatch: [
		{
			tool: "bash",
			ops: [
				{ c: "echo hello" },
				{ tool: "bash", ops: { item: { c: "ls", t: 5000 } } },
			],
		},
	],
};
const bugResult = prepareTraceDispatchArguments(bugReport);
assert(
	"bug report nested dispatcher",
	bugResult,
	{
		dispatch: [
			{
				tool: "bash",
				ops: [
					{ c: "echo hello" },
					{ c: "ls", t: 5000 },
				],
			},
		],
		notes: ["flattened nested dispatcher"],
	}
);

// b. Bare string at ops
const bareString = { dispatch: [{ tool: "bash", ops: "git status" }] };
const bareStringResult = prepareTraceDispatchArguments(bareString);
assert(
	"bare string at ops",
	bareStringResult,
	{
		dispatch: [{ tool: "bash", ops: [{ c: "git status" }] }],
		notes: ["string → bash[1]"],
	}
);

// c. Single object at ops
const singleObj = { dispatch: [{ tool: "bash", ops: { c: "ls" } }] };
const singleObjResult = prepareTraceDispatchArguments(singleObj);
assert(
	"single object at ops",
	singleObjResult,
	{
		dispatch: [{ tool: "bash", ops: [{ c: "ls" }] }],
		notes: ["single obj → array[1]"],
	}
);

// d. Missing o discriminator
const missingO = { dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts" }] }] };
const missingOResult = prepareTraceDispatchArguments(missingO);
assert(
	"missing o discriminator",
	missingOResult,
	{
		dispatch: [{ tool: "batch", ops: [{ p: "src/index.ts", o: "read" }] }],
		notes: ["inferred o=read"],
	}
);

// e. Canonical flat array (regression check)
const canonical = {
	dispatch: [
		{ tool: "batch", ops: [{ o: "read", p: "src/main.ts" }] },
		{ tool: "bash", ops: [{ c: "git status" }] },
	],
};
const canonicalResult = prepareTraceDispatchArguments(canonical);
assert(
	"canonical flat array",
	canonicalResult,
	{
		dispatch: [
			{ tool: "batch", ops: [{ o: "read", p: "src/main.ts" }] },
			{ tool: "bash", ops: [{ c: "git status" }] },
		],
		notes: [],
	}
);

console.log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
