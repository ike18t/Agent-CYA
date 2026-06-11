import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractScriptPath, enrichBashFileContent } from "./file-enrich.ts";

describe("extractScriptPath", () => {
  it("extracts interpreter target: bash /tmp/x.sh", () => {
    expect(extractScriptPath("bash /tmp/x.sh")).toBe("/tmp/x.sh");
  });

  it("extracts interpreter target with flags: bash -x script.sh", () => {
    expect(extractScriptPath("bash -x script.sh")).toBe("script.sh");
  });

  it("extracts node target: node ./run.js", () => {
    expect(extractScriptPath("node ./run.js")).toBe("./run.js");
  });

  it("extracts python target: python3 /tmp/exfil.py", () => {
    expect(extractScriptPath("python3 /tmp/exfil.py")).toBe("/tmp/exfil.py");
  });

  it("extracts ./script style", () => {
    expect(extractScriptPath("./deploy.sh --prod")).toBe("./deploy.sh");
  });

  it("extracts /abs/path style", () => {
    expect(extractScriptPath("/usr/local/bin/foo --bar")).toBe(
      "/usr/local/bin/foo",
    );
  });

  it("only considers the first segment before && / ;", () => {
    expect(extractScriptPath("bash a.sh && rm a.sh")).toBe("a.sh");
  });

  it("returns null for non-script commands", () => {
    expect(extractScriptPath("ls -la")).toBeNull();
    expect(extractScriptPath("npm test")).toBeNull();
    expect(extractScriptPath("git status")).toBeNull();
  });

  it("returns null for bash -c with inline command", () => {
    expect(extractScriptPath('bash -c "echo hi"')).toBeNull();
  });

  it("returns null for empty command", () => {
    expect(extractScriptPath("")).toBeNull();
  });
});

describe("enrichBashFileContent", () => {
  const ctx = { dir: "" };

  beforeEach(() => {
    ctx.dir = mkdtempSync(join(tmpdir(), "agent-cya-test-"));
  });

  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("reads script content when Bash command references a real file", () => {
    const scriptPath = join(ctx.dir, "hello.sh");
    writeFileSync(scriptPath, "#!/bin/bash\necho hello\n");

    const result = enrichBashFileContent({
      toolType: "Bash",
      command: `bash ${scriptPath}`,
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toContain("echo hello");
    expect(result.fileContent).toContain(scriptPath);
  });

  it("resolves relative paths against workingDirectory", () => {
    writeFileSync(join(ctx.dir, "run.sh"), "echo relative\n");

    const result = enrichBashFileContent({
      toolType: "Bash",
      command: "bash ./run.sh",
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toContain("echo relative");
  });

  it("leaves fileContent null when file does not exist", () => {
    const result = enrichBashFileContent({
      toolType: "Bash",
      command: "bash /tmp/definitely-does-not-exist-xyz123.sh",
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toBeNull();
  });

  it("skips when toolType is not Bash", () => {
    const scriptPath = join(ctx.dir, "hello.sh");
    writeFileSync(scriptPath, "echo hello\n");

    const result = enrichBashFileContent({
      toolType: "Write",
      command: scriptPath,
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toBeNull();
  });

  it("does not overwrite existing fileContent", () => {
    const scriptPath = join(ctx.dir, "hello.sh");
    writeFileSync(scriptPath, "echo from disk\n");

    const result = enrichBashFileContent({
      toolType: "Bash",
      command: `bash ${scriptPath}`,
      fileContent: "preserved",
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toBe("preserved");
  });

  it("skips when command does not reference a script", () => {
    const result = enrichBashFileContent({
      toolType: "Bash",
      command: "ls -la",
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toBeNull();
  });

  it("skips when target is a directory, not a file", () => {
    const subdir = join(ctx.dir, "subdir");
    mkdirSync(subdir);

    const result = enrichBashFileContent({
      toolType: "Bash",
      command: `bash ${subdir}`,
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toBeNull();
  });

  it("skips relative paths when workingDirectory is missing", () => {
    const result = enrichBashFileContent({
      toolType: "Bash",
      command: "bash ./run.sh",
      fileContent: null,
    });

    expect(result.fileContent).toBeNull();
  });

  it("truncates very large files", () => {
    const scriptPath = join(ctx.dir, "big.sh");
    const big = "x".repeat(20_000);
    writeFileSync(scriptPath, big);

    const result = enrichBashFileContent({
      toolType: "Bash",
      command: `bash ${scriptPath}`,
      fileContent: null,
      workingDirectory: ctx.dir,
    });

    expect(result.fileContent).toContain("[truncated]");
  });
});
