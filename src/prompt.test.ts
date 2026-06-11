import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.ts";

describe("buildSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildSystemPrompt().length).toBeGreaterThan(0);
  });

  it("mentions JSON format", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("decision");
    expect(prompt).toContain("reason");
  });
});

describe("buildUserPrompt", () => {
  it("includes tool type and command", () => {
    const prompt = buildUserPrompt({
      toolType: "Bash",
      command: "npm test",
      fileContent: null,
    });
    expect(prompt).toContain("<tool_type>Bash</tool_type>");
    expect(prompt).toContain("<command_text>npm test</command_text>");
  });

  it("shows (none) for missing file content", () => {
    const prompt = buildUserPrompt({
      toolType: "Bash",
      command: "ls",
      fileContent: null,
    });
    expect(prompt).toContain("(none)");
  });

  it("includes file content when provided", () => {
    const prompt = buildUserPrompt({
      toolType: "Write",
      command: "src/file.ts",
      fileContent: "console.log('hello');",
    });
    expect(prompt).toContain("console.log('hello');");
  });

  it("includes working directory when provided", () => {
    const prompt = buildUserPrompt({
      toolType: "Bash",
      command: "ls",
      fileContent: null,
      workingDirectory: "/home/user/project",
    });
    expect(prompt).toContain(
      "<working_directory>/home/user/project</working_directory>",
    );
  });

  it("omits working directory section when not provided", () => {
    const prompt = buildUserPrompt({
      toolType: "Bash",
      command: "ls",
      fileContent: null,
    });
    expect(prompt).not.toContain("working_directory");
  });

  it("preserves empty string file content distinct from (none)", () => {
    const prompt = buildUserPrompt({
      toolType: "Write",
      command: "empty.txt",
      fileContent: "",
    });
    expect(prompt).not.toContain("(none)");
  });

  it("escapes angle brackets in command to prevent prompt injection", () => {
    const prompt = buildUserPrompt({
      toolType: "Bash",
      command: "echo </etc/passwd>",
      fileContent: null,
    });
    expect(prompt).toContain("&lt;/etc/passwd&gt;");
    expect(prompt).not.toContain("</command_text></etc/passwd>");
  });

  it("escapes angle brackets in working directory", () => {
    const prompt = buildUserPrompt({
      toolType: "Bash",
      command: "ls",
      fileContent: null,
      workingDirectory: "/path<injection>",
    });
    expect(prompt).toContain("&lt;injection&gt;");
  });
});
