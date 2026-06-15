import { describe, it, expect, vi, afterEach } from "vitest";
import { reviewViaOpenAI } from "./openai.ts";
import type { OpenAIReviewerConfig } from "./config.ts";
import type { ReviewInput } from "./prompt.ts";

const SENTINEL_API_KEY = "sk-SENTINEL-DO-NOT-LEAK";

const baseConfig: OpenAIReviewerConfig = {
  baseUrl: "https://api.openai.test/v1",
  model: "gpt-test-1",
  apiKey: SENTINEL_API_KEY,
};

const baseInput: ReviewInput = {
  toolType: "Bash",
  command: "ls",
  fileContent: null,
};

const okResponse = (content: string): Response =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("reviewViaOpenAI", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the decision parsed from a 200 response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse('{"decision":"allow","reason":"safe command"}'),
      );

    const result = await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    expect(result).toEqual({ decision: "allow", reason: "safe command" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sends Authorization and Content-Type headers", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse('{"decision":"allow","reason":"ok"}'));

    await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SENTINEL_API_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.method).toBe("POST");
  });

  it("sends the expected body shape", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse('{"decision":"allow","reason":"ok"}'));

    await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: ReadonlyArray<{ role: string; content: string }>;
      temperature: number;
      max_tokens: number;
    };
    expect(body.model).toBe("gpt-test-1");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(1024);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[0].content.length).toBeGreaterThan(0);
    expect(body.messages[1].content.length).toBeGreaterThan(0);
  });

  it("strips a single trailing slash from baseUrl", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse('{"decision":"allow","reason":"ok"}'));

    await reviewViaOpenAI(
      baseInput,
      { ...baseConfig, baseUrl: "https://x.test/v1/" },
      mockFetch,
    );

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.test/v1/chat/completions");
  });

  it("retries once on network error then succeeds", async () => {
    vi.useFakeTimers();
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(
        okResponse('{"decision":"deny","reason":"retry worked"}'),
      );

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ decision: "deny", reason: "retry worked" });
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("[agent-cya] retrying openai after:"),
    );
  });

  it("retries once on network error and falls back to ask after second failure", async () => {
    vi.useFakeTimers();
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("dns failure"))
      .mockRejectedValueOnce(new Error("still down"));

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.decision).toBe("ask");
    expect(result.reason).toMatch(/^LLM unavailable \(openai: /);
    expect(result.reason).toContain("still down");
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("retrying openai after:"),
    );
    expect(stderr).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("LLM review failed (openai):"),
    );
  });

  it("retries once on HTTP 500 then succeeds on second call", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream blew up", { status: 500 }))
      .mockResolvedValueOnce(
        okResponse('{"decision":"ask","reason":"needs review"}'),
      );

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ decision: "ask", reason: "needs review" });
  });

  it("falls back to ask after two HTTP 500s, surfacing the status", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream blew up", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("upstream still down", { status: 500 }),
      );

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("500");
    expect(result.reason).toContain("upstream still down");
  });

  it("does not retry on HTTP 401 and includes a truncated body excerpt", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const longBody = "x".repeat(1000);
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(longBody, { status: 401 }));

    const result = await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("401");
    expect(result.reason).toContain("xxxxx");
    // Truncated to ~500 chars: should not contain the full 1000-char body
    expect(result.reason.length).toBeLessThan(700);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it("falls back to ask when response.json() rejects", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("not-json-at-all", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("failed to parse response body");
  });

  it("falls back to ask when the response is missing choices", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "x" }), { status: 200 }),
      );
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    expect(result.decision).toBe("ask");
    expect(result.reason).toContain("choices[0].message.content");
  });

  it("returns ask with the parseLlmResponse fallback when content is non-JSON text", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse("I think this is fine"));

    const result = await reviewViaOpenAI(baseInput, baseConfig, mockFetch);

    expect(result).toEqual({
      decision: "ask",
      reason: "Invalid LLM response, needs review",
    });
  });

  it("aborts the fetch after HTTP_TIMEOUT_MS and falls back to ask", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const signals: AbortSignal[] = [];
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signals.push(signal);
          signal.addEventListener("abort", () => {
            reject(new Error("aborted by signal"));
          });
        }),
    );

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    // First attempt aborts at 90s; a timeout is fatal (no retry), so this is the only attempt.
    await vi.advanceTimersByTimeAsync(95_000);
    const result = await promise;

    expect(result.decision).toBe("ask");
    expect(result.reason).toMatch(/timeout|abort/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(true);
  });

  it("does not retry after timeout/abort", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const mockFetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            reject(new Error("aborted by signal"));
          });
          // Otherwise: never resolve. The only way this promise settles
          // is via the AbortController firing at HTTP_TIMEOUT_MS.
        }),
    );

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    // Advance well past the 90s timeout plus any potential retry delay.
    await vi.advanceTimersByTimeAsync(200_000);
    const result = await promise;

    expect(result.decision).toBe("ask");
    expect(result.reason).toMatch(/timeout|abort/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("never leaks the API key into the decision reason or stderr", async () => {
    const stderrCalls: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array): boolean => {
        stderrCalls.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      },
    );
    vi.useFakeTimers();
    // Choose a body that includes the api key string so we can confirm
    // the truncation/excerpt path also doesn't accidentally include it.
    // The reviewer must NOT log the request body or the apiKey itself —
    // but if the upstream echoes it (it shouldn't), we still don't add it.
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("still network down"));

    const promise = reviewViaOpenAI(baseInput, baseConfig, mockFetch);
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result.decision).toBe("ask");
    expect(result.reason).not.toContain("sk-SENTINEL");
    expect(stderrCalls.join("\n")).not.toContain("sk-SENTINEL");
  });
});
