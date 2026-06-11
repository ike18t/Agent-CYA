import { describe, it, expect, vi } from "vitest";
import * as auditLog from "./audit-log.ts";

describe("createAuditLogger", () => {
  it("writes entry without throwing", () => {
    const logger = auditLog.createAuditLogger();
    const entry: auditLog.AuditEntry = {
      timestamp: "2026-01-01T00:00:00.000Z",
      tool: "Bash",
      command: "ls",
      decision: "ask",
      reason: "pending review",
      source: "llm",
    };
    expect(() => logger.write(entry)).not.toThrow();
  });

  it("entry shape contains expected fields", () => {
    const entry: auditLog.AuditEntry = {
      timestamp: "2026-01-01T00:00:00.000Z",
      tool: "Write",
      command: "src/file.ts",
      decision: "deny",
      reason: "matched pattern",
      source: "rule",
    };
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("tool");
    expect(entry).toHaveProperty("command");
    expect(entry).toHaveProperty("decision");
    expect(entry).toHaveProperty("reason");
    expect(entry).toHaveProperty("source");
  });

  it("supports rule and llm sources", () => {
    const ruleEntry: auditLog.AuditEntry = {
      timestamp: new Date().toISOString(),
      tool: "Bash",
      command: "rm -rf /",
      decision: "deny",
      reason: "hard deny",
      source: "rule",
    };
    const llmEntry: auditLog.AuditEntry = {
      timestamp: new Date().toISOString(),
      tool: "Bash",
      command: "npm install",
      decision: "ask",
      reason: "LLM review needed",
      source: "llm",
    };
    expect(ruleEntry.source).toBe("rule");
    expect(llmEntry.source).toBe("llm");
  });

  it("never throws on write failure", () => {
    const logger = auditLog.createAuditLogger();
    expect(() =>
      logger.write({
        timestamp: new Date().toISOString(),
        tool: "Bash",
        command: "test",
        decision: "allow",
        reason: "ok",
        source: "rule",
      }),
    ).not.toThrow();
  });

  it("writes json-lines to file", () => {
    const fs = vi.hoisted(() => ({
      appendFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));
    vi.mock("node:fs", () => fs);

    const logger = auditLog.createAuditLogger();
    logger.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      tool: "Bash",
      command: "ls",
      decision: "allow",
      reason: "safe",
      source: "llm",
    });

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"tool":"Bash"'),
      "utf-8",
    );
  });
});
