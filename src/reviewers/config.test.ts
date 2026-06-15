import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctx = { home: "" };

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => ctx.home,
  };
});

import { loadOpenAIConfig, loadConfigFile, harnessReviewer } from "./config.ts";

const writeConfig = (contents: string, mode = 0o600): string => {
  const dir = join(ctx.home, ".agent-cya");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.json");
  writeFileSync(path, contents);
  if (process.platform !== "win32") chmodSync(path, mode);
  return path;
};

type MockChildOpts = Readonly<{
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
  hang?: boolean;
}>;

const makeChild = (opts: MockChildOpts) => ({
  stdout: {
    on: (event: string, handler: (data: Buffer) => void) => {
      if (event === "data" && opts.stdout) handler(Buffer.from(opts.stdout));
    },
  },
  stderr: {
    on: (event: string, handler: (data: Buffer) => void) => {
      if (event === "data" && opts.stderr) handler(Buffer.from(opts.stderr));
    },
  },
  on: (event: string, handler: (val: number | Error) => void) => {
    if (opts.hang) return;
    if (event === "error" && opts.error) handler(opts.error);
    if (event === "close" && opts.error === undefined)
      handler(opts.exitCode ?? 0);
  },
  kill: () => {},
  killed: false,
});

const buffers = { stderr: [] as string[] };

describe("loadOpenAIConfig", () => {
  beforeEach(() => {
    ctx.home = mkdtempSync(join(tmpdir(), "agent-cya-config-"));
    buffers.stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      buffers.stderr.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("loads config with literal apiKey", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: {
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o",
            apiKey: "sk-literal",
          },
        },
      }),
    );

    const config = await loadOpenAIConfig();
    expect(config.baseUrl).toBe("https://api.example.com/v1");
    expect(config.model).toBe("gpt-4o");
    expect(config.apiKey).toBe("sk-literal");
  });

  it("ignores a $schema pointer at the top level", async () => {
    writeConfig(
      JSON.stringify({
        $schema: "https://cdn.jsdelivr.net/npm/agent-cya/config.schema.json",
        reviewers: {
          openai: {
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o",
            apiKey: "sk-literal",
          },
        },
      }),
    );

    const config = await loadOpenAIConfig();
    expect(config.apiKey).toBe("sk-literal");
  });

  it("loads config with apiKeyCmd via spawn", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: {
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o",
            apiKeyCmd: "echo sk-from-helper",
          },
        },
      }),
    );
    const mockSpawn = vi
      .fn()
      .mockReturnValue(makeChild({ stdout: "sk-from-helper\n", exitCode: 0 }));

    const config = await loadOpenAIConfig(mockSpawn as never);
    expect(config.apiKey).toBe("sk-from-helper");
    expect(mockSpawn).toHaveBeenCalledWith(
      "echo sk-from-helper",
      [],
      expect.objectContaining({ shell: true }),
    );
  });

  it("apiKeyCmd wins when both apiKey and apiKeyCmd are set", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: {
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o",
            apiKey: "sk-literal",
            apiKeyCmd: "echo sk-helper",
          },
        },
      }),
    );
    const mockSpawn = vi
      .fn()
      .mockReturnValue(makeChild({ stdout: "sk-helper", exitCode: 0 }));

    const config = await loadOpenAIConfig(mockSpawn as never);
    expect(config.apiKey).toBe("sk-helper");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("throws when reviewers.openai is missing", async () => {
    writeConfig(JSON.stringify({ reviewers: {} }));
    await expect(loadOpenAIConfig()).rejects.toThrow(
      /missing 'reviewers\.openai' section/,
    );
  });

  it("throws when baseUrl is missing", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: { openai: { model: "gpt-4o", apiKey: "k" } },
      }),
    );
    await expect(loadOpenAIConfig()).rejects.toThrow(
      /baseUrl must be a non-empty string/,
    );
  });

  it("throws when model is missing", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: { openai: { baseUrl: "https://x", apiKey: "k" } },
      }),
    );
    await expect(loadOpenAIConfig()).rejects.toThrow(
      /model must be a non-empty string/,
    );
  });

  it("throws when both apiKey and apiKeyCmd are missing", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: { openai: { baseUrl: "https://x", model: "m" } },
      }),
    );
    await expect(loadOpenAIConfig()).rejects.toThrow(
      /requires apiKey or apiKeyCmd/,
    );
  });

  it("throws on malformed JSON", async () => {
    writeConfig("not { valid json");
    await expect(loadOpenAIConfig()).rejects.toThrow(/Malformed JSON/);
  });

  it("throws when config file is missing", async () => {
    await expect(loadOpenAIConfig()).rejects.toThrow(/Failed to read config/);
  });

  it.skipIf(process.platform === "win32")(
    "emits stderr warning when config file mode is permissive",
    async () => {
      writeConfig(
        JSON.stringify({
          reviewers: {
            openai: {
              baseUrl: "https://x",
              model: "m",
              apiKey: "k",
            },
          },
        }),
        0o644,
      );

      await loadOpenAIConfig();
      const stderr = buffers.stderr.join("");
      expect(stderr).toContain("[agent-cya] warning:");
      expect(stderr).toContain("recommend chmod 600");
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not emit warning when mode is 0600",
    async () => {
      writeConfig(
        JSON.stringify({
          reviewers: {
            openai: {
              baseUrl: "https://x",
              model: "m",
              apiKey: "k",
            },
          },
        }),
        0o600,
      );

      await loadOpenAIConfig();
      const stderr = buffers.stderr.join("");
      expect(stderr).not.toContain("warning:");
    },
  );

  it("throws when apiKeyCmd exits non-zero (includes stderr)", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: {
            baseUrl: "https://x",
            model: "m",
            apiKeyCmd: "false",
          },
        },
      }),
    );
    const mockSpawn = vi
      .fn()
      .mockReturnValue(
        makeChild({ stderr: "helper failed: missing session", exitCode: 1 }),
      );

    await expect(loadOpenAIConfig(mockSpawn as never)).rejects.toThrow(
      /helper failed: missing session/,
    );
  });

  it("throws when apiKeyCmd produces empty output", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: {
            baseUrl: "https://x",
            model: "m",
            apiKeyCmd: "echo",
          },
        },
      }),
    );
    const mockSpawn = vi
      .fn()
      .mockReturnValue(makeChild({ stdout: "   \n", exitCode: 0 }));

    await expect(loadOpenAIConfig(mockSpawn as never)).rejects.toThrow(
      /apiKeyCmd produced empty output/,
    );
  });

  it("throws when apiKeyCmd times out", async () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: {
            baseUrl: "https://x",
            model: "m",
            apiKeyCmd: "sleep 10",
          },
        },
      }),
    );
    const mockSpawn = vi.fn().mockReturnValue(makeChild({ hang: true }));

    vi.useFakeTimers();
    const promise = loadOpenAIConfig(mockSpawn as never);
    // Catch rejection synchronously so an unhandled-rejection warning doesn't
    // race with the fake-timer advance below.
    const settled = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await settled;
    vi.useRealTimers();

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/timed out after 5000ms/);
  });
});

describe("loadConfigFile", () => {
  beforeEach(() => {
    ctx.home = mkdtempSync(join(tmpdir(), "agent-cya-config-"));
    buffers.stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      buffers.stderr.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns undefined when config file is missing", () => {
    expect(loadConfigFile()).toBeUndefined();
  });

  it("throws on malformed JSON", () => {
    writeConfig("not { valid json");
    expect(() => loadConfigFile()).toThrow(/Malformed JSON/);
  });

  it("parses a config with only harnesses.opencode.reviewer set", () => {
    writeConfig(
      JSON.stringify({ harnesses: { opencode: { reviewer: "claude" } } }),
    );
    const config = loadConfigFile();
    expect(config?.harnesses?.opencode?.reviewer).toBe("claude");
    expect(config?.reviewers).toBeUndefined();
  });

  it("parses a config with only reviewers.openai set", () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: { baseUrl: "https://x", model: "m", apiKey: "k" },
        },
      }),
    );
    const config = loadConfigFile();
    expect(config?.reviewers?.openai?.baseUrl).toBe("https://x");
    expect(config?.harnesses).toBeUndefined();
  });

  it("parses a config with both reviewers.openai and harnesses set", () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: { baseUrl: "https://x", model: "m", apiKey: "k" },
        },
        harnesses: {
          opencode: { reviewer: "openai" },
          claudeCode: { reviewer: "claude" },
        },
      }),
    );
    const config = loadConfigFile();
    expect(config?.reviewers?.openai?.model).toBe("m");
    expect(config?.harnesses?.opencode?.reviewer).toBe("openai");
    expect(config?.harnesses?.claudeCode?.reviewer).toBe("claude");
  });

  it("throws on invalid reviewer enum value in harnesses.opencode.reviewer", () => {
    writeConfig(
      JSON.stringify({ harnesses: { opencode: { reviewer: "foo" } } }),
    );
    expect(() => loadConfigFile()).toThrow(
      /harnesses\.opencode\.reviewer must be one of/,
    );
  });

  it("throws on unknown harness key", () => {
    writeConfig(
      JSON.stringify({
        harnesses: { notARealHarness: { reviewer: "claude" } },
      }),
    );
    expect(() => loadConfigFile()).toThrow(/unknown harness "notARealHarness"/);
  });

  it.skipIf(process.platform === "win32")(
    "emits permissive-mode warning on Unix",
    () => {
      writeConfig(
        JSON.stringify({
          reviewers: {
            openai: { baseUrl: "https://x", model: "m", apiKey: "k" },
          },
        }),
        0o644,
      );
      loadConfigFile();
      const stderr = buffers.stderr.join("");
      expect(stderr).toContain("[agent-cya] warning:");
      expect(stderr).toContain("recommend chmod 600");
    },
  );
});

describe("harnessReviewer", () => {
  beforeEach(() => {
    ctx.home = mkdtempSync(join(tmpdir(), "agent-cya-config-"));
  });

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns undefined when config file is missing", () => {
    expect(harnessReviewer("claudeCode")).toBeUndefined();
  });

  it("returns undefined when harnesses key is absent", () => {
    writeConfig(
      JSON.stringify({
        reviewers: {
          openai: { baseUrl: "https://x", model: "m", apiKey: "k" },
        },
      }),
    );
    expect(harnessReviewer("claudeCode")).toBeUndefined();
  });

  it("returns the configured reviewer when set", () => {
    writeConfig(
      JSON.stringify({
        harnesses: { claudeCode: { reviewer: "openai" } },
      }),
    );
    expect(harnessReviewer("claudeCode")).toBe("openai");
  });
});
