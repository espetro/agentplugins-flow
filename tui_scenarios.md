# TUI Rendering Scenarios

This artifact demonstrates the updated TUI rendering logic, featuring the new `●` status icon which replaces the previous checkmark.

## 1. Flow Scenarios

### Running Flow
The running state features a scintillating yellow dot and animated text.

```text
● flow     refactor and test
└─ cmd ▸   read src/index.ts
   ▲ 1.2k -  2.5 t/s - 128 - gemini-2.0-flash
```

### Completed Flow (Success)
The completed state shows a solid success-colored dot (typically green or blue depending on the theme).

```text
● flow     refactor and test
└─ cmd ▸   done
   ▲ 1.2k -  0.0 t/s - 128 - gemini-2.0-flash
```

### Flow with Error
Errors are indicated with an `✗` or a red `●`.

```text
✗ flow     refactor and test [error]
   Error: context_length_exceeded
```

---

## 2. Batch Scenarios

### Batch Result (Tree View)
The checkmark `✓` has been replaced with `●` for a more consistent and modern look.

```text
batch  ·  5 ops  ·  5 ok  ·  5 file
├─ ● read: src/config.ts  ·  45 lines
├─ ● edit: src/core/utils.ts  ·  2 blocks
├─ ● write: src/models/user.ts  ·  1024 bytes
├─ ● delete: tmp/old_cache.log
└─ ● patch: src/index.ts  ·  M index.ts
```

### Batch Expanded View
Shows content previews under each operation.

```text
batch  ·  1 op  ·  1 ok  ·  1 file
└─ ● read: src/main.ts  ·  10 lines
   import { start } from "./app";
   start();
```

---

## 3. Trace Scenarios

Trace is a minimalist version of flow, now featuring the consistent dot style.

```text
trace    analyze prior failure
└─ cmd ▸ read logs/error.log
```

---

## Visual Mockup
Below is a high-fidelity design mockup showing the intended aesthetic for these scenarios.

![TUI Mockup](file:///Users/dev/.gemini/antigravity-cli/brain/tui_scenarios_mockup.png)
