import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  aggregate,
  formatJson,
  formatText,
  runSuggest,
  registerSuggestCommand,
} from "./suggest.ts";
import type { AuditEntry } from "./audit-log.ts";
import { Command } from "commander";

const allow = (command: string, timestamp: string): AuditEntry => ({
  timestamp,
  tool: "Bash",
  command,
  decision: "allow",
  reason: "ok",
  source: "llm",
  reviewer: "claude",
});

const deny = (command: string, timestamp: string): AuditEntry => ({
  timestamp,
  tool: "Bash",
  command,
  decision: "deny",
  reason: "blocked",
  source: "rule",
});

const ask = (command: string, timestamp: string): AuditEntry => ({
  timestamp,
  tool: "Bash",
  command,
  decision: "ask",
  reason: "unsure",
  source: "llm",
  reviewer: "claude",
});

const repeat = (entry: AuditEntry, n: number): AuditEntry[] =>
  Array.from({ length: n }, () => entry);

describe("aggregate", () => {
  it("returns empty result on empty input", () => {
    const r = aggregate([], { minAllows: 5 });
    expect(r.suggestions).toEqual([]);
    expect(r.clusters).toEqual([]);
  });

  it("suggests a command that meets the allow threshold with no denies", () => {
    const entries = repeat(allow("git status", "2026-06-10T00:00:00Z"), 5);
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions).toEqual([
      { command: "git status", allows: 5, lastSeen: "2026-06-10T00:00:00Z" },
    ]);
    expect(r.clusters).toEqual([]);
  });

  it("does not suggest a command below the allow threshold", () => {
    const entries = repeat(allow("git status", "2026-06-10T00:00:00Z"), 4);
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions).toEqual([]);
  });

  it("does not suggest a command with any deny", () => {
    const entries = [
      ...repeat(allow("git status", "2026-06-10T00:00:00Z"), 10),
      deny("git status", "2026-06-11T00:00:00Z"),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions).toEqual([]);
  });

  it("ignores ask decisions (positive evidence only)", () => {
    const entries = [
      ...repeat(allow("git status", "2026-06-10T00:00:00Z"), 3),
      ...repeat(ask("git status", "2026-06-10T00:00:00Z"), 100),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions).toEqual([]);
  });

  it("ignores non-Bash entries", () => {
    const writeEntry: AuditEntry = {
      timestamp: "2026-06-10T00:00:00Z",
      tool: "Write",
      command: "src/file.ts",
      decision: "allow",
      reason: "ok",
      source: "rule",
    };
    const r = aggregate(repeat(writeEntry, 10), { minAllows: 5 });
    expect(r.suggestions).toEqual([]);
  });

  it("normalizes whitespace when bucketing", () => {
    const entries = [
      allow("git  status", "2026-06-10T00:00:00Z"),
      allow(" git status ", "2026-06-10T00:00:00Z"),
      allow("git status", "2026-06-10T00:00:00Z"),
      allow("git status", "2026-06-10T00:00:00Z"),
      allow("git status", "2026-06-10T00:00:00Z"),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]?.command).toBe("git status");
    expect(r.suggestions[0]?.allows).toBe(5);
  });

  it("keeps the latest timestamp as lastSeen", () => {
    const entries = [
      allow("git status", "2026-06-10T00:00:00Z"),
      allow("git status", "2026-06-12T00:00:00Z"),
      allow("git status", "2026-06-11T00:00:00Z"),
      allow("git status", "2026-06-09T00:00:00Z"),
      allow("git status", "2026-06-08T00:00:00Z"),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions[0]?.lastSeen).toBe("2026-06-12T00:00:00Z");
  });

  it("sorts suggestions by allow count desc, then command asc", () => {
    const entries = [
      ...repeat(allow("npm test", "2026-06-10T00:00:00Z"), 7),
      ...repeat(allow("git status", "2026-06-10T00:00:00Z"), 7),
      ...repeat(allow("tsc --noEmit", "2026-06-10T00:00:00Z"), 9),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions.map((s) => s.command)).toEqual([
      "tsc --noEmit",
      "git status",
      "npm test",
    ]);
  });

  it("clusters 3+ below-threshold siblings sharing a first-two-tokens prefix", () => {
    const entries = [
      ...repeat(allow("npm test -- a.test.ts", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("npm test -- b.test.ts", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("npm test -- c.test.ts", "2026-06-10T00:00:00Z"), 2),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions).toEqual([]);
    expect(r.clusters).toEqual([
      { prefix: "npm test", variantCount: 3, totalAllows: 6 },
    ]);
  });

  it("does not cluster only 2 siblings even if aggregate >= N", () => {
    const entries = [
      ...repeat(allow("npm test -- a.test.ts", "2026-06-10T00:00:00Z"), 3),
      ...repeat(allow("npm test -- b.test.ts", "2026-06-10T00:00:00Z"), 3),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.clusters).toEqual([]);
  });

  it("does not cluster if sibling total is below the allow threshold", () => {
    const entries = [
      allow("npm test -- a.test.ts", "2026-06-10T00:00:00Z"),
      allow("npm test -- b.test.ts", "2026-06-10T00:00:00Z"),
      allow("npm test -- c.test.ts", "2026-06-10T00:00:00Z"),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.clusters).toEqual([]);
  });

  it("excludes a suggested 3-token key from cluster totalAllows", () => {
    const entries = [
      ...repeat(allow("npm test --coverage", "2026-06-10T00:00:00Z"), 6),
      ...repeat(allow("npm test -- a.test.ts", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("npm test -- b.test.ts", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("npm test -- c.test.ts", "2026-06-10T00:00:00Z"), 2),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions.map((s) => s.command)).toEqual([
      "npm test --coverage",
    ]);
    expect(r.clusters).toEqual([
      { prefix: "npm test", variantCount: 3, totalAllows: 6 },
    ]);
  });

  it("excludes suggested keys from cluster aggregates", () => {
    const entries = [
      ...repeat(allow("npm test", "2026-06-10T00:00:00Z"), 6),
      ...repeat(allow("npm test -- a.test.ts", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("npm test -- b.test.ts", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("npm test -- c.test.ts", "2026-06-10T00:00:00Z"), 2),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions.map((s) => s.command)).toEqual(["npm test"]);
    expect(r.clusters).toEqual([
      { prefix: "npm test", variantCount: 3, totalAllows: 6 },
    ]);
  });

  it("excludes denied keys from cluster aggregates", () => {
    const entries = [
      ...repeat(allow("git push origin a", "2026-06-10T00:00:00Z"), 2),
      ...repeat(allow("git push origin b", "2026-06-10T00:00:00Z"), 2),
      allow("git push -f origin x", "2026-06-10T00:00:00Z"),
      deny("git push -f origin x", "2026-06-10T00:00:00Z"),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.clusters).toEqual([]);
  });

  it("a deny on one key does NOT poison a clean key sharing the same prefix", () => {
    // Original blocker scenario: `git status && rm -rf /tmp/foo` denied
    // must not prevent `git status` from being suggested.
    const entries = [
      ...repeat(allow("git status", "2026-06-10T00:00:00Z"), 7),
      deny("git status && rm -rf /tmp/foo", "2026-06-10T00:00:00Z"),
    ];
    const r = aggregate(entries, { minAllows: 5 });
    expect(r.suggestions.map((s) => s.command)).toEqual(["git status"]);
  });

  it("caps clusters at the top 10 by total allows", () => {
    // 12 clusters, each with 3 base below-threshold variants (2 allows each)
    // plus `i` extra below-threshold variants (1 allow each).
    // minAllows = 6. Every variant individually has 1 or 2 allows (< 6 ✓).
    // Cluster totals: 6 + i, so 6, 7, ..., 17. All meet the >= 6 cluster threshold.
    const buildCluster = (i: number): AuditEntry[] => {
      const base = [
        ...repeat(allow(`alpha${i} cmd a`, "2026-06-10T00:00:00Z"), 2),
        ...repeat(allow(`alpha${i} cmd b`, "2026-06-10T00:00:00Z"), 2),
        ...repeat(allow(`alpha${i} cmd c`, "2026-06-10T00:00:00Z"), 2),
      ];
      const extras = Array.from({ length: i }, (_, j) =>
        allow(`alpha${i} cmd e${j}`, "2026-06-10T00:00:00Z"),
      );
      return [...base, ...extras];
    };
    const entries = Array.from({ length: 12 }, (_, i) =>
      buildCluster(i),
    ).flat();
    const r = aggregate(entries, { minAllows: 6 });
    expect(r.clusters).toHaveLength(10);
    // Top cluster: i=11 → total = 6 + 11 = 17, prefix = "alpha11 cmd"
    expect(r.clusters[0]?.prefix).toBe("alpha11 cmd");
    expect(r.clusters[0]?.totalAllows).toBe(17);
  });
});

describe("formatJson", () => {
  it("emits the documented shape", () => {
    const out = formatJson(
      {
        suggestions: [
          {
            command: "git status",
            allows: 47,
            lastSeen: "2026-06-13T10:14:22.000Z",
          },
        ],
        clusters: [{ prefix: "npm test", variantCount: 47, totalAllows: 112 }],
      },
      1247,
    );
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      scannedEntries: 1247,
      suggestions: [
        {
          command: "git status",
          allows: 47,
          lastSeen: "2026-06-13T10:14:22.000Z",
        },
      ],
      clusters: [{ prefix: "npm test", variantCount: 47, totalAllows: 112 }],
    });
  });

  it("emits valid JSON for empty result", () => {
    const out = formatJson({ suggestions: [], clusters: [] }, 0);
    expect(JSON.parse(out)).toEqual({
      scannedEntries: 0,
      suggestions: [],
      clusters: [],
    });
  });

  it("ends with a trailing newline", () => {
    const out = formatJson({ suggestions: [], clusters: [] }, 0);
    expect(out.endsWith("\n")).toBe(true);
  });
});

const NOW = Date.parse("2026-06-15T12:00:00Z");

describe("formatText", () => {
  it("prints the friendly 'no audit log' message when scannedEntries is null", () => {
    const out = formatText(
      { suggestions: [], clusters: [] },
      null,
      "/tmp/missing.log",
      { now: NOW, minAllows: 5 },
    );
    expect(out).toContain(
      "No audit log found at /tmp/missing.log — nothing to suggest yet.",
    );
  });

  it("prints the empty-result message when log exists but produces nothing", () => {
    const out = formatText(
      { suggestions: [], clusters: [] },
      0,
      "/tmp/audit.log",
      { now: NOW, minAllows: 5 },
    );
    expect(out).toContain(
      "No suggestions yet — keep using AgentCYA and try again later.",
    );
  });

  it("renders a single suggestion with humanized last-seen", () => {
    const out = formatText(
      {
        suggestions: [
          {
            command: "git status",
            allows: 47,
            lastSeen: "2026-06-13T12:00:00.000Z",
          },
        ],
        clusters: [],
      },
      1247,
      "/tmp/audit.log",
      { now: NOW, minAllows: 5 },
    );
    expect(out).toContain("Scanned 1247 Bash entries from /tmp/audit.log");
    expect(out).toContain("Suggested commands (≥5 allows, 0 denies):");
    expect(out).toContain("git status");
    expect(out).toContain("47 allows");
    expect(out).toContain("last seen 2d ago");
  });

  it("renders a cluster row", () => {
    const out = formatText(
      {
        suggestions: [],
        clusters: [{ prefix: "npm test", variantCount: 47, totalAllows: 112 }],
      },
      500,
      "/tmp/audit.log",
      { now: NOW, minAllows: 5 },
    );
    expect(out).toContain("Clusters worth reviewing manually:");
    expect(out).toContain("npm test");
    expect(out).toContain("47 variants");
    expect(out).toContain("112 total allows");
  });

  it("humanizes relative time across magnitudes", () => {
    const base = NOW;
    const cases: ReadonlyArray<[number, string]> = [
      [30 * 1000, "just now"],
      [5 * 60 * 1000, "5m ago"],
      [3 * 60 * 60 * 1000, "3h ago"],
      [2 * 24 * 60 * 60 * 1000, "2d ago"],
      [40 * 24 * 60 * 60 * 1000, "1mo ago"],
      [400 * 24 * 60 * 60 * 1000, "1y ago"],
    ];
    /* eslint-disable functional/no-loop-statements -- iterating test cases */
    for (const [deltaMs, expected] of cases) {
      const out = formatText(
        {
          suggestions: [
            {
              command: "x",
              allows: 5,
              lastSeen: new Date(base - deltaMs).toISOString(),
            },
          ],
          clusters: [],
        },
        1,
        "/tmp/audit.log",
        { now: base, minAllows: 5 },
      );
      expect(out).toContain(`last seen ${expected}`);
    }
    /* eslint-enable functional/no-loop-statements */
  });

  it("uses exactly one blank line between the header and the first section", () => {
    const out = formatText(
      {
        suggestions: [
          {
            command: "git status",
            allows: 5,
            lastSeen: "2026-06-15T11:00:00.000Z",
          },
        ],
        clusters: [],
      },
      1,
      "/tmp/audit.log",
      { now: NOW, minAllows: 5 },
    );
    // header line, exactly one blank line, then the section header
    expect(out).toMatch(/\.\n\nSuggested commands /);
    // never three newlines in a row
    expect(out).not.toMatch(/\n\n\n/);
  });

  it("notes when a rotated log was scanned alongside the current log", () => {
    const out = formatText(
      {
        suggestions: [
          {
            command: "git status",
            allows: 5,
            lastSeen: "2026-06-15T11:00:00.000Z",
          },
        ],
        clusters: [],
      },
      100,
      "/tmp/audit.log",
      { now: NOW, minAllows: 5, rotatedScanned: true },
    );
    expect(out).toContain("/tmp/audit.log (+1 rotated)");
  });
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runSuggest", () => {
  const ctx = { dir: "", logPath: "", stdout: [] as string[] };

  beforeEach(() => {
    ctx.dir = mkdtempSync(join(tmpdir(), "agent-cya-suggest-"));
    ctx.logPath = join(ctx.dir, "audit.log");
    ctx.stdout = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      ctx.stdout.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const writeAllow = (command: string, n: number): void => {
    const lines = Array.from({ length: n }, () =>
      JSON.stringify({
        timestamp: "2026-06-13T12:00:00.000Z",
        tool: "Bash",
        command,
        decision: "allow",
        reason: "ok",
        source: "llm",
        reviewer: "claude",
      }),
    ).join("\n");
    writeFileSync(ctx.logPath, lines + "\n", "utf-8");
  };

  it("prints the friendly missing-log message when the file does not exist", async () => {
    await runSuggest({
      auditLog: join(ctx.dir, "does-not-exist.log"),
      json: false,
      minAllows: 5,
    });
    expect(ctx.stdout.join("")).toContain("No audit log found at");
  });

  it("reads the rotated log when only .1 exists (e.g. between rotation and next write)", async () => {
    const rotatedPath = `${ctx.logPath}.1`;
    const line = JSON.stringify({
      timestamp: "2026-06-13T12:00:00.000Z",
      tool: "Bash",
      command: "git status",
      decision: "allow",
      reason: "ok",
      source: "llm",
      reviewer: "claude",
    });
    // Only write the rotated file; the primary audit.log does NOT exist.
    writeFileSync(
      rotatedPath,
      Array.from({ length: 7 }, () => line).join("\n") + "\n",
      "utf-8",
    );
    await runSuggest({
      auditLog: ctx.logPath,
      json: false,
      minAllows: 5,
    });
    const out = ctx.stdout.join("");
    expect(out).not.toContain("No audit log found");
    expect(out).toContain("git status");
    expect(out).toContain("7 allows");
  });

  it("prints text suggestions to stdout", async () => {
    writeAllow("git status", 7);
    await runSuggest({
      auditLog: ctx.logPath,
      json: false,
      minAllows: 5,
    });
    const out = ctx.stdout.join("");
    expect(out).toContain("git status");
    expect(out).toContain("7 allows");
  });

  it("prints valid JSON when --json is set", async () => {
    writeAllow("npm test", 6);
    await runSuggest({
      auditLog: ctx.logPath,
      json: true,
      minAllows: 5,
    });
    const parsed = JSON.parse(ctx.stdout.join(""));
    expect(parsed.suggestions[0].command).toBe("npm test");
    expect(parsed.suggestions[0].allows).toBe(6);
    expect(parsed.scannedEntries).toBe(6);
  });

  it("honors --min-allows override", async () => {
    writeAllow("git status", 3);
    await runSuggest({
      auditLog: ctx.logPath,
      json: false,
      minAllows: 2,
    });
    expect(ctx.stdout.join("")).toContain("git status");
  });
});

describe("registerSuggestCommand option parsing", () => {
  it("rejects negative --min-allows at the Commander boundary", () => {
    const program = new Command();
    program.exitOverride();
    registerSuggestCommand(program);
    expect(() =>
      program.parse(["suggest", "--min-allows", "-1"], { from: "user" }),
    ).toThrow(/non-negative finite/);
  });

  it("rejects non-numeric --min-allows", () => {
    const program = new Command();
    program.exitOverride();
    registerSuggestCommand(program);
    expect(() =>
      program.parse(["suggest", "--min-allows", "foo"], { from: "user" }),
    ).toThrow(/non-negative finite/);
  });
});
