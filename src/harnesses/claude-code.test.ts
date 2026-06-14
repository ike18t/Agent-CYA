import { describe, it, expect } from "vitest";
import {
  parseClaudeCodeHookInput,
  formatClaudeCodeHookOutput,
  exitCodeForDecision,
} from "./claude-code.ts";

describe("parseClaudeCodeHookInput", () => {
  it("maps a Bash hook input", () => {
    const result = parseClaudeCodeHookInput(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        cwd: "/tmp",
      }),
    );
    expect(result).toEqual({
      toolType: "Bash",
      command: "ls",
      fileContent: null,
      workingDirectory: "/tmp",
    });
  });

  it("maps a Write hook input, capturing file content", () => {
    const result = parseClaudeCodeHookInput(
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "/tmp/x.sh", content: "#!/bin/sh\necho hi" },
        cwd: "/tmp",
      }),
    );
    expect(result.toolType).toBe("Write");
    expect(result.command).toBe("/tmp/x.sh");
    expect(result.fileContent).toBe("#!/bin/sh\necho hi");
    expect(result.workingDirectory).toBe("/tmp");
  });

  it("maps an Edit hook input, serializing old/new strings", () => {
    const result = parseClaudeCodeHookInput(
      JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: "/tmp/x.ts",
          old_string: "foo",
          new_string: "bar",
        },
      }),
    );
    expect(result.toolType).toBe("Edit");
    expect(result.command).toBe("/tmp/x.ts");
    expect(JSON.parse(result.fileContent ?? "{}")).toEqual({
      old_string: "foo",
      new_string: "bar",
    });
  });

  it("falls back to a generic shape for unknown tool types", () => {
    const result = parseClaudeCodeHookInput(
      JSON.stringify({
        tool_name: "SomeOther",
        tool_input: { command: "x" },
      }),
    );
    expect(result.toolType).toBe("SomeOther");
    expect(result.command).toBe("x");
  });

  it("throws when tool_name is missing", () => {
    expect(() =>
      parseClaudeCodeHookInput(JSON.stringify({ tool_input: {} })),
    ).toThrow(/tool_name/);
  });

  it("treats missing tool_input as an empty object", () => {
    const result = parseClaudeCodeHookInput(
      JSON.stringify({ tool_name: "Bash", cwd: "/tmp" }),
    );
    expect(result.command).toBe("");
    expect(result.fileContent).toBeNull();
  });
});

describe("formatClaudeCodeHookOutput", () => {
  it("wraps a decision in Claude Code's PermissionRequest shape", () => {
    const out = formatClaudeCodeHookOutput({
      decision: "allow",
      reason: "safe",
    });
    expect(JSON.parse(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", reason: "safe" },
      },
    });
  });

  it("preserves the decision verbatim for ask/deny", () => {
    expect(
      JSON.parse(formatClaudeCodeHookOutput({ decision: "deny", reason: "X" }))
        .hookSpecificOutput.decision.behavior,
    ).toBe("deny");
    expect(
      JSON.parse(formatClaudeCodeHookOutput({ decision: "ask", reason: "Y" }))
        .hookSpecificOutput.decision.behavior,
    ).toBe("ask");
  });
});

describe("exitCodeForDecision", () => {
  it("returns 2 for deny (the value Claude Code reads as 'block')", () => {
    expect(exitCodeForDecision({ decision: "deny", reason: "" })).toBe(2);
  });
  it("returns 0 for allow", () => {
    expect(exitCodeForDecision({ decision: "allow", reason: "" })).toBe(0);
  });
  it("returns 0 for ask", () => {
    expect(exitCodeForDecision({ decision: "ask", reason: "" })).toBe(0);
  });
});
