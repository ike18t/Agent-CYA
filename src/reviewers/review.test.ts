import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./config.ts", () => ({
  loadOpenAIConfig: vi.fn(),
}));

vi.mock("./openai.ts", () => ({
  reviewViaOpenAI: vi.fn(),
}));

import { review } from "./review.ts";
import { loadOpenAIConfig } from "./config.ts";
import { reviewViaOpenAI } from "./openai.ts";
import type { ReviewInput } from "./prompt.ts";
import type { OpenAIReviewerConfig } from "./config.ts";

const baseInput: ReviewInput = {
  toolType: "Bash",
  command: "ls",
  fileContent: null,
};

const baseConfig: OpenAIReviewerConfig = {
  baseUrl: "https://api.openai.test/v1",
  model: "gpt-test-1",
  apiKey: "sk-test",
};

const stderrBuffer = { messages: [] as string[] };

describe("review dispatch — openai reviewer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stderrBuffer.messages = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrBuffer.messages.push(
        typeof chunk === "string" ? chunk : chunk.toString(),
      );
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches to reviewViaOpenAI and does not spawn", async () => {
    vi.mocked(loadOpenAIConfig).mockResolvedValue(baseConfig);
    vi.mocked(reviewViaOpenAI).mockResolvedValue({
      decision: "allow",
      reason: "safe",
    });
    const mockSpawn = vi.fn();
    const mockFetch = vi.fn();

    const result = await review(
      baseInput,
      "openai",
      0,
      mockSpawn,
      undefined,
      mockFetch,
    );

    expect(result).toEqual({ decision: "allow", reason: "safe" });
    expect(loadOpenAIConfig).toHaveBeenCalledWith(mockSpawn);
    expect(reviewViaOpenAI).toHaveBeenCalledWith(
      baseInput,
      baseConfig,
      mockFetch,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("returns ask fallback when loadOpenAIConfig rejects", async () => {
    vi.mocked(loadOpenAIConfig).mockRejectedValue(
      new Error("config missing at ~/.agent-cya/config.json"),
    );
    const mockSpawn = vi.fn();

    const result = await review(baseInput, "openai", 0, mockSpawn);

    expect(result.decision).toBe("ask");
    expect(result.reason).toMatch(/^LLM unavailable \(openai:/);
    expect(result.reason).toContain("config missing");
    expect(reviewViaOpenAI).not.toHaveBeenCalled();
    expect(stderrBuffer.messages.join("")).toContain(
      "[agent-cya] LLM review failed (openai):",
    );
  });

  it("passes through an ask decision returned by reviewViaOpenAI", async () => {
    vi.mocked(loadOpenAIConfig).mockResolvedValue(baseConfig);
    vi.mocked(reviewViaOpenAI).mockResolvedValue({
      decision: "ask",
      reason: "LLM unavailable (openai: HTTP 500)",
    });

    const result = await review(baseInput, "openai", 0, vi.fn());

    expect(result.decision).toBe("ask");
    expect(result.reason).toBe("LLM unavailable (openai: HTTP 500)");
  });

  it("applies --min-ask-ms padding to the openai ask path", async () => {
    vi.mocked(loadOpenAIConfig).mockResolvedValue(baseConfig);
    vi.mocked(reviewViaOpenAI).mockResolvedValue({
      decision: "ask",
      reason: "needs review",
    });
    const fakeSleep = vi.fn().mockResolvedValue(undefined);

    const result = await review(baseInput, "openai", 100, vi.fn(), fakeSleep);

    expect(fakeSleep).toHaveBeenCalledTimes(1);
    const sleepMs = fakeSleep.mock.calls[0][0] as number;
    expect(sleepMs).toBeGreaterThan(0);
    expect(sleepMs).toBeLessThanOrEqual(100);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("needs review");
    expect(result.reason).toContain("agent-cya held");
  });
});
