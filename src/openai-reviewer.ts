import { buildSystemPrompt, buildUserPrompt } from "./prompt.ts";
import type { ReviewInput } from "./prompt.ts";
import type { OpenAIReviewerConfig } from "./config.ts";
import { parseLlmResponse, RETRY_DELAY_MS } from "./llm.ts";
import type { LlmDecision } from "./llm.ts";

const HTTP_TIMEOUT_MS = 90_000;

const ERROR_BODY_MAX_CHARS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const stripTrailingSlash = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

type HttpOutcome = Readonly<
  | { kind: "ok"; raw: string }
  | { kind: "retryable"; detail: string }
  | { kind: "fatal"; detail: string }
>;

const attemptRequest = async (
  url: string,
  body: string,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<HttpOutcome> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  // Unref so the timer never keeps the process alive on its own.
  timeout.unref?.();

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const excerpt = truncate(bodyText, ERROR_BODY_MAX_CHARS);
      const detail = `HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`;
      return response.status >= 500
        ? { kind: "retryable", detail }
        : { kind: "fatal", detail };
    }

    const parsed = await response
      .json()
      .then((value: unknown) => ({ ok: true as const, value }))
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

    if (!parsed.ok) {
      return {
        kind: "fatal",
        detail: `failed to parse response body: ${parsed.error}`,
      };
    }

    const content = (
      parsed.value as {
        choices?: ReadonlyArray<{ message?: { content?: unknown } }>;
      }
    ).choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return {
        kind: "fatal",
        detail: "response missing choices[0].message.content",
      };
    }
    return { kind: "ok", raw: content };
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      // Match llm.ts:196 — a 90s timeout means the upstream is unresponsive;
      // a retry just doubles the wait before falling back to ask.
      return {
        kind: "fatal",
        detail: `request aborted after ${HTTP_TIMEOUT_MS}ms (timeout)`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "retryable", detail: `network error: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
};

export const reviewViaOpenAI = async (
  input: Readonly<ReviewInput>,
  config: Readonly<OpenAIReviewerConfig>,
  fetchFn: typeof fetch = fetch,
): Promise<LlmDecision> => {
  const url = `${stripTrailingSlash(config.baseUrl)}/chat/completions`;
  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  const first = await attemptRequest(url, body, config.apiKey, fetchFn);

  const final: HttpOutcome =
    first.kind === "ok" || first.kind === "fatal"
      ? first
      : await (async () => {
          process.stderr.write(
            `[agent-cya] retrying openai after: ${first.detail}\n`,
          );
          await sleep(RETRY_DELAY_MS);
          return attemptRequest(url, body, config.apiKey, fetchFn);
        })();

  if (final.kind === "ok") return parseLlmResponse(final.raw);

  process.stderr.write(
    `[agent-cya] LLM review failed (openai): ${final.detail}\n`,
  );
  return {
    decision: "ask",
    reason: `LLM unavailable (openai: ${final.detail})`,
  };
};
