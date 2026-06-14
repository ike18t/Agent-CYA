import { describe, it, expect, vi, beforeEach } from "vitest";
process.env.AGENT_CYA_MIN_ASK_MS = "0";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const auditWrite = vi.fn();
vi.mock("./audit-log.ts", () => ({
  createAuditLogger: () => ({ write: auditWrite }),
}));

import { evaluate } from "./pipeline.ts";
import * as childProcess from "node:child_process";

describe("evaluate", () => {
  beforeEach(() => {
    auditWrite.mockClear();
  });

  it("returns deny from rule path without invoking LLM", async () => {
    const result = await evaluate(
      { toolType: "Bash", command: "rm -rf /", fileContent: null },
      "claude",
    );

    expect(result.source).toBe("rule");
    expect(result.decision.decision).toBe("deny");
    expect(result.decision.reason).toContain("denied pattern");
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("writes a rule-sourced audit entry for hard-deny commands", async () => {
    await evaluate(
      { toolType: "Bash", command: "rm -rf /", fileContent: null },
      "claude",
    );

    expect(auditWrite).toHaveBeenCalledTimes(1);
    const entry = auditWrite.mock.calls[0][0];
    expect(entry.tool).toBe("Bash");
    expect(entry.command).toBe("rm -rf /");
    expect(entry.decision).toBe("deny");
    expect(entry.source).toBe("rule");
    expect(typeof entry.reason).toBe("string");
    expect(typeof entry.timestamp).toBe("string");
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
  });

  it("returns allow from LLM path for safe commands", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue({
      stdout: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(
            Buffer.from('{"decision": "allow", "reason": "safe command"}'),
          );
        },
      } as never,
      stderr: { on: () => {} } as never,
      on: (event: string, handler: (val: number) => void) => {
        if (event === "close") handler(0);
      },
    } as never);

    const result = await evaluate(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
    );

    expect(result.source).toBe("llm");
    expect(result.decision.decision).toBe("allow");
    expect(result.decision.reason).toBe("safe command");
    expect(childProcess.spawn).toHaveBeenCalled();
  });

  it("writes an llm-sourced audit entry on the LLM allow path", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue({
      stdout: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from('{"decision": "allow", "reason": "safe"}'));
        },
      } as never,
      stderr: { on: () => {} } as never,
      on: (event: string, handler: (val: number) => void) => {
        if (event === "close") handler(0);
      },
    } as never);

    await evaluate(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
    );

    expect(auditWrite).toHaveBeenCalledTimes(1);
    const entry = auditWrite.mock.calls[0][0];
    expect(entry.tool).toBe("Bash");
    expect(entry.command).toBe("ls");
    expect(entry.decision).toBe("allow");
    expect(entry.reason).toBe("safe");
    expect(entry.source).toBe("llm");
    expect(typeof entry.timestamp).toBe("string");
  });

  it("falls back to ask when the LLM binary errors", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue({
      stdout: { on: () => {} } as never,
      stderr: { on: () => {} } as never,
      on: (event: string, handler: (val: Error) => void) => {
        if (event === "error") handler(new Error("ENOENT"));
      },
    } as never);

    const result = await evaluate(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
    );

    expect(result.source).toBe("llm");
    expect(result.decision.decision).toBe("ask");
    expect(result.decision.reason).toContain("LLM unavailable");
  });

  it("writes an llm-sourced audit entry for the ask fallback", async () => {
    vi.mocked(childProcess.spawn).mockReturnValue({
      stdout: { on: () => {} } as never,
      stderr: { on: () => {} } as never,
      on: (event: string, handler: (val: Error) => void) => {
        if (event === "error") handler(new Error("ENOENT"));
      },
    } as never);

    await evaluate(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
    );

    expect(auditWrite).toHaveBeenCalledTimes(1);
    const entry = auditWrite.mock.calls[0][0];
    expect(entry.decision).toBe("ask");
    expect(entry.source).toBe("llm");
    expect(entry.command).toBe("ls");
    expect(entry.tool).toBe("Bash");
  });
});
