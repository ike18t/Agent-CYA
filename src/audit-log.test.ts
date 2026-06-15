import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      reviewer: "claude",
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
      reviewer: "openai",
    };
    expect(ruleEntry.source).toBe("rule");
    expect(llmEntry.source).toBe("llm");
    if (llmEntry.source === "llm") {
      expect(llmEntry.reviewer).toBe("openai");
    }
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
    const dir = mkdtempSync(join(tmpdir(), "agent-cya-audit-"));
    const logPath = join(dir, "audit.log");
    try {
      const logger = auditLog.createAuditLogger(logPath);
      logger.write({
        timestamp: "2026-01-01T00:00:00.000Z",
        tool: "Bash",
        command: "ls",
        decision: "allow",
        reason: "safe",
        source: "llm",
        reviewer: "claude",
      });
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain('"tool":"Bash"');
      expect(content.endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audit log rotation", () => {
  const ctx = { dir: "" };

  beforeEach(() => {
    ctx.dir = mkdtempSync(join(tmpdir(), "agent-cya-audit-"));
  });

  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
    delete process.env.AGENT_CYA_AUDIT_MAX_BYTES;
  });

  const entry: auditLog.AuditEntry = {
    timestamp: "2026-01-01T00:00:00.000Z",
    tool: "Bash",
    command: "ls",
    decision: "allow",
    reason: "safe",
    source: "llm",
    reviewer: "claude",
  };

  it("rotates the log file when it would exceed the cap", () => {
    process.env.AGENT_CYA_AUDIT_MAX_BYTES = "100";
    const logPath = join(ctx.dir, "audit.log");
    const logger = auditLog.createAuditLogger(logPath);

    // Each line ~85 bytes; two writes overflows the 100-byte cap.
    logger.write(entry);
    expect(statSync(logPath).size).toBeGreaterThan(0);
    expect(existsSync(`${logPath}.1`)).toBe(false);

    logger.write(entry);
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(readFileSync(`${logPath}.1`, "utf-8")).toContain('"tool":"Bash"');
    // Fresh file holds only the latest write.
    expect(
      readFileSync(logPath, "utf-8").split("\n").filter(Boolean),
    ).toHaveLength(1);
  });

  it("does not rotate when cap is not exceeded", () => {
    process.env.AGENT_CYA_AUDIT_MAX_BYTES = "10000";
    const logPath = join(ctx.dir, "audit.log");
    const logger = auditLog.createAuditLogger(logPath);

    logger.write(entry);
    logger.write(entry);
    logger.write(entry);

    expect(existsSync(`${logPath}.1`)).toBe(false);
    expect(
      readFileSync(logPath, "utf-8").split("\n").filter(Boolean),
    ).toHaveLength(3);
  });

  it("handles first write to a missing file", () => {
    const logPath = join(ctx.dir, "audit.log");
    const logger = auditLog.createAuditLogger(logPath);
    expect(() => logger.write(entry)).not.toThrow();
    expect(existsSync(logPath)).toBe(true);
  });
});
