import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseClaudeCodeHookInput,
  formatClaudeCodeHookOutput,
  exitCodeForDecision,
  resolveHookReviewer,
} from "./claude-code.ts";
import { safeHarnessReviewer } from "../reviewers/config.ts";

vi.mock("../reviewers/config.ts", () => ({
  safeHarnessReviewer: vi.fn(),
}));

const harnessReviewerMock = vi.mocked(safeHarnessReviewer);

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

describe("resolveHookReviewer", () => {
  const stderrLines: string[] = [];

  beforeEach(() => {
    harnessReviewerMock.mockReset();
    stderrLines.length = 0;
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrLines.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  it("returns the flag value when flag is set, even if harness config is also set", () => {
    harnessReviewerMock.mockReturnValue("openai");
    expect(resolveHookReviewer("claude")).toBe("claude");
  });

  it("returns the harness config value when flag is undefined", () => {
    harnessReviewerMock.mockReturnValue("openai");
    expect(resolveHookReviewer(undefined)).toBe("openai");
  });

  it("returns 'claude' default when both flag and harness config are absent", () => {
    harnessReviewerMock.mockReturnValue(undefined);
    expect(resolveHookReviewer(undefined)).toBe("claude");
  });

  it("falls back to 'claude' and emits stderr when safeHarnessReviewer throws due to broken config", () => {
    harnessReviewerMock.mockImplementation(() => {
      process.stderr.write("[agent-cya] config: bad\n");
      return undefined;
    });
    expect(resolveHookReviewer(undefined)).toBe("claude");
    expect(stderrLines.join("")).toContain("[agent-cya] config: bad");
  });
});
