import { describe, it, expect, vi, beforeEach } from "vitest";
process.env.AGENT_CYA_MIN_ASK_MS = "0";
import { padAskDecision, review } from "./review.ts";
import { parseLlmResponse } from "./parse.ts";

describe("parseLlmResponse", () => {
  it("parses valid allow decision", () => {
    const result = parseLlmResponse(
      JSON.stringify({ decision: "allow", reason: "safe command" }),
    );
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("safe command");
  });

  it("parses valid deny decision", () => {
    const result = parseLlmResponse(
      JSON.stringify({ decision: "deny", reason: "dangerous" }),
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("dangerous");
  });

  it("parses valid ask decision", () => {
    const result = parseLlmResponse(
      JSON.stringify({ decision: "ask", reason: "needs review" }),
    );
    expect(result.decision).toBe("ask");
    expect(result.reason).toBe("needs review");
  });

  it("handles markdown code block", () => {
    const result = parseLlmResponse(
      '```json\n{"decision": "allow", "reason": "safe"}\n```',
    );
    expect(result.decision).toBe("allow");
  });

  it("handles bare JSON in text", () => {
    const result = parseLlmResponse(
      'Here is my analysis: {"decision": "deny", "reason": "risky"}',
    );
    expect(result.decision).toBe("deny");
  });

  it("falls back to ask for invalid JSON", () => {
    const result = parseLlmResponse("not json at all");
    expect(result.decision).toBe("ask");
    expect(result.reason).toBe("Invalid LLM response, needs review");
  });

  it("falls back to ask for missing decision field", () => {
    const result = parseLlmResponse(JSON.stringify({ reason: "test" }));
    expect(result.decision).toBe("ask");
  });

  it("falls back to ask for invalid decision value", () => {
    const result = parseLlmResponse(
      JSON.stringify({ decision: "maybe", reason: "unsure" }),
    );
    expect(result.decision).toBe("ask");
  });

  it("handles missing reason gracefully", () => {
    const result = parseLlmResponse(JSON.stringify({ decision: "allow" }));
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("No reason provided");
  });
});

describe("review", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("spawns claude binary for claude reviewer", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from('{"decision": "allow", "reason": "safe"}'));
        },
      },
      stderr: { on: () => {} },
      on: (event: string, handler: (val: number | Error) => void) => {
        if (event === "close") handler(0);
      },
    });

    const result = await review(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      mockSpawn,
    );

    expect(result.decision).toBe("allow");
    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p"]),
      expect.any(Object),
    );
  });

  it("spawns opencode binary for opencode reviewer", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from('{"decision": "deny", "reason": "dangerous"}'));
        },
      },
      stderr: { on: () => {} },
      on: (event: string, handler: (val: number | Error) => void) => {
        if (event === "close") handler(0);
      },
    });

    const result = await review(
      { toolType: "Bash", command: "rm -rf /", fileContent: null },
      "opencode",
      mockSpawn,
    );

    expect(result.decision).toBe("deny");
    expect(mockSpawn).toHaveBeenCalledWith(
      "opencode",
      expect.arrayContaining(["run"]),
      expect.any(Object),
    );
  });

  it("returns ask fallback with cause in reason on spawn error (and retries once)", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, handler: (val: number | Error) => void) => {
        if (event === "error") handler(new Error("ENOENT"));
      },
      kill: () => {},
      killed: false,
    });
    const fakeSleep = vi.fn().mockResolvedValue(undefined);

    const result = await review(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      mockSpawn,
      fakeSleep,
    );

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("LLM unavailable (claude:");
    expect(result.reason).toContain("ENOENT");
  });

  it("returns ask fallback with cause on non-zero exit (and retries once)", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: { on: () => {} },
      stderr: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from("binary error"));
        },
      },
      on: (event: string, handler: (val: number | Error) => void) => {
        if (event === "close") handler(1);
      },
    });
    const fakeSleep = vi.fn().mockResolvedValue(undefined);

    const result = await review(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      mockSpawn,
      fakeSleep,
    );

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("LLM unavailable (claude:");
    expect(result.reason).toContain("binary error");
  });

  it("retries once on transient failure and uses the second result", async () => {
    const failingChild = {
      stdout: { on: () => {} },
      stderr: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from("transient"));
        },
      },
      on: (event: string, handler: (val: number) => void) => {
        if (event === "close") handler(1);
      },
    };
    const succeedingChild = {
      stdout: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from('{"decision":"allow","reason":"retry worked"}'));
        },
      },
      stderr: { on: () => {} },
      on: (event: string, handler: (val: number) => void) => {
        if (event === "close") handler(0);
      },
    };
    const mockSpawn = vi
      .fn()
      .mockReturnValueOnce(failingChild)
      .mockReturnValueOnce(succeedingChild);
    const fakeSleep = vi.fn().mockResolvedValue(undefined);

    const result = await review(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      mockSpawn,
      fakeSleep,
    );

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("retry worked");
  });

  it("does not retry on timeout failures", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: () => {
        // Never settles — spawnBinary will time out via SPAWN_TIMEOUT_MS.
        // We use fake timers below to fast-forward without waiting 90s.
      },
      killed: false,
      kill: () => {},
    });
    const fakeSleep = vi.fn().mockResolvedValue(undefined);

    vi.useFakeTimers();
    const promise = review(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      mockSpawn,
      fakeSleep,
    );
    await vi.advanceTimersByTimeAsync(95_000);
    const result = await promise;
    vi.useRealTimers();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("timed out");
  });

  describe("padAskDecision", () => {
    beforeEach(() => {
      process.env.AGENT_CYA_MIN_ASK_MS = "60000";
    });

    it("sleeps the remaining ms when ask arrives early", async () => {
      const fakeSleep = vi.fn().mockResolvedValue(undefined);
      const result = await padAskDecision(
        { decision: "ask", reason: "unsure" },
        5_000,
        fakeSleep,
      );
      expect(fakeSleep).toHaveBeenCalledWith(55_000);
      expect(result.decision).toBe("ask");
      expect(result.reason).toContain("60s for human input");
    });

    it("does not sleep when already past the minimum", async () => {
      const fakeSleep = vi.fn().mockResolvedValue(undefined);
      const result = await padAskDecision(
        { decision: "ask", reason: "unsure" },
        61_000,
        fakeSleep,
      );
      expect(fakeSleep).not.toHaveBeenCalled();
      expect(result.reason).toBe("unsure");
    });

    it("does not pad allow decisions", async () => {
      const fakeSleep = vi.fn().mockResolvedValue(undefined);
      const result = await padAskDecision(
        { decision: "allow", reason: "safe" },
        0,
        fakeSleep,
      );
      expect(fakeSleep).not.toHaveBeenCalled();
      expect(result).toEqual({ decision: "allow", reason: "safe" });
    });

    it("does not pad deny decisions", async () => {
      const fakeSleep = vi.fn().mockResolvedValue(undefined);
      const result = await padAskDecision(
        { decision: "deny", reason: "destructive" },
        0,
        fakeSleep,
      );
      expect(fakeSleep).not.toHaveBeenCalled();
      expect(result).toEqual({ decision: "deny", reason: "destructive" });
    });

    it("is disabled by default when AGENT_CYA_MIN_ASK_MS is unset", async () => {
      delete process.env.AGENT_CYA_MIN_ASK_MS;
      const fakeSleep = vi.fn().mockResolvedValue(undefined);
      const result = await padAskDecision(
        { decision: "ask", reason: "unsure" },
        0,
        fakeSleep,
      );
      expect(fakeSleep).not.toHaveBeenCalled();
      expect(result.reason).toBe("unsure");
    });

    it("is disabled when AGENT_CYA_MIN_ASK_MS is 0", async () => {
      process.env.AGENT_CYA_MIN_ASK_MS = "0";
      const fakeSleep = vi.fn().mockResolvedValue(undefined);
      const result = await padAskDecision(
        { decision: "ask", reason: "unsure" },
        0,
        fakeSleep,
      );
      expect(fakeSleep).not.toHaveBeenCalled();
      expect(result.reason).toBe("unsure");
    });
  });

  it("returns ask fallback on malformed binary output", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: {
        on: (_: string, handler: (data: Buffer) => void) => {
          handler(Buffer.from("this is not json"));
        },
      },
      stderr: { on: () => {} },
      on: (event: string, handler: (val: number | Error) => void) => {
        if (event === "close") handler(0);
      },
    });

    const result = await review(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      mockSpawn,
    );

    expect(result.decision).toBe("ask");
    expect(result.reason).toBe("Invalid LLM response, needs review");
  });
});
