import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../pipeline.ts", () => ({
  evaluate: vi.fn(),
}));

vi.mock("../reviewers/config.ts", () => ({
  safeHarnessReviewer: vi.fn(),
}));

import {
  createAgentCyaPlugin,
  AgentCya,
  default as DefaultExport,
} from "./opencode-plugin.ts";
import { evaluate } from "../pipeline.ts";
import { safeHarnessReviewer } from "../reviewers/config.ts";

const evaluateMock = vi.mocked(evaluate);
const harnessReviewerMock = vi.mocked(safeHarnessReviewer);

const invokePlugin = async (
  plugin: ReturnType<typeof createAgentCyaPlugin>,
): Promise<Record<string, (...args: never[]) => Promise<void>>> => {
  return (
    plugin as unknown as () => Promise<
      Record<string, (...args: never[]) => Promise<void>>
    >
  )();
};

/* eslint-disable functional/prefer-immutable-types -- `output` is intentionally mutable; the plugin's contract is to mutate output.status, and the test observes that mutation */
const callPermissionAsk = (
  hooks: Readonly<Record<string, (...args: never[]) => Promise<void>>>,
  input: Readonly<{ type?: string; pattern?: string }>,
  output: { status: "ask" | "deny" | "allow" },
): Promise<void> =>
  (
    hooks["permission.ask"] as unknown as (
      i: typeof input,
      o: typeof output,
    ) => Promise<void>
  )(input, output);
/* eslint-enable functional/prefer-immutable-types */

describe("createAgentCyaPlugin", () => {
  beforeEach(() => {
    evaluateMock.mockReset();
    evaluateMock.mockResolvedValue({
      decision: { decision: "allow", reason: "safe" },
      source: "llm",
      reviewer: "claude",
    });
    harnessReviewerMock.mockReset();
    harnessReviewerMock.mockReturnValue(undefined);
  });

  it("invoking the factory yields a hooks object with permission.ask", async () => {
    const hooks = await invokePlugin(createAgentCyaPlugin());
    expect(typeof hooks["permission.ask"]).toBe("function");
  });

  it("forwards input.type/input.pattern to evaluate and sets output.status", async () => {
    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls -la" }, output);

    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "ls -la", fileContent: null },
      "opencode",
      0,
    );
    expect(output.status).toBe("allow");
  });

  it("defaults command to '' when input.pattern is missing", async () => {
    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash" }, output);

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "", fileContent: null },
      "opencode",
      0,
    );
  });

  it("defaults command to '' when input.pattern is a string array", async () => {
    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(
      hooks,
      { type: "Bash", pattern: ["ls", "-la"] } as unknown as Readonly<{
        type: string;
        pattern: string;
      }>,
      output,
    );

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "", fileContent: null },
      "opencode",
      0,
    );
  });

  it("writes the LLM decision through to output.status", async () => {
    evaluateMock.mockResolvedValueOnce({
      decision: { decision: "deny", reason: "nope" },
      source: "rule",
    });

    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(
      hooks,
      { type: "Bash", pattern: "rm -rf /" },
      output,
    );

    expect(output.status).toBe("deny");
  });

  it("passes 'opencode' to evaluate when configured with reviewer: 'opencode'", async () => {
    const hooks = await invokePlugin(
      createAgentCyaPlugin({ reviewer: "opencode" }),
    );
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(
      hooks,
      { type: "Write", pattern: "foo.ts" },
      output,
    );

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Write", command: "foo.ts", fileContent: null },
      "opencode",
      0,
    );
  });

  it("createAgentCyaPlugin({ reviewer: 'openai' }) forwards openai through to evaluate", async () => {
    evaluateMock.mockResolvedValueOnce({
      decision: { decision: "allow", reason: "safe via openai" },
      source: "llm",
      reviewer: "openai",
    });

    const hooks = await invokePlugin(
      createAgentCyaPlugin({ reviewer: "openai" }),
    );
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls -la" }, output);

    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "ls -la", fileContent: null },
      "openai",
      0,
    );
    expect(output.status).toBe("allow");
  });

  it("factory arg wins over harness config", async () => {
    harnessReviewerMock.mockReturnValue("openai");

    const hooks = await invokePlugin(
      createAgentCyaPlugin({ reviewer: "claude" }),
    );
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls" }, output);

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "ls", fileContent: null },
      "claude",
      0,
    );
  });

  it("harness config used when factory arg absent", async () => {
    harnessReviewerMock.mockReturnValue("openai");

    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls" }, output);

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "ls", fileContent: null },
      "openai",
      0,
    );
  });

  it("built-in default used when both factory arg and harness config absent", async () => {
    harnessReviewerMock.mockReturnValue(undefined);

    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls" }, output);

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "ls", fileContent: null },
      "opencode",
      0,
    );
  });

  it("harnessReviewer is called once per plugin instance, not once per permission.ask invocation", async () => {
    harnessReviewerMock.mockReturnValue(undefined);

    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls" }, output);
    await callPermissionAsk(hooks, { type: "Bash", pattern: "pwd" }, output);

    expect(harnessReviewerMock.mock.calls.length).toBe(1);
  });

  it("falls back to 'opencode' default and still loads when safeHarnessReviewer returns undefined due to a config error", async () => {
    // safeHarnessReviewer returns undefined (swallowing the internal error) when config is broken
    harnessReviewerMock.mockReturnValue(undefined);

    const hooks = await invokePlugin(createAgentCyaPlugin());
    const output = { status: "ask" as "ask" | "deny" | "allow" };

    await callPermissionAsk(hooks, { type: "Bash", pattern: "ls" }, output);

    expect(evaluateMock).toHaveBeenCalledWith(
      { toolType: "Bash", command: "ls", fileContent: null },
      "opencode",
      0,
    );
  });
});

describe("AgentCya default instance", () => {
  beforeEach(() => {
    evaluateMock.mockReset();
    evaluateMock.mockResolvedValue({
      decision: { decision: "allow", reason: "safe" },
      source: "llm",
      reviewer: "claude",
    });
    harnessReviewerMock.mockReset();
    harnessReviewerMock.mockReturnValue(undefined);
  });

  it("default export equals the AgentCya named export", () => {
    expect(DefaultExport).toBe(AgentCya);
  });
});
