import { describe, expect, test } from "vitest";
import { compileArtifact } from "@/lib/adk/compileArtifact";
import { buildYamlInput } from "@/lib/adk/buildYamlInput";
import { inspectArtifact } from "@/lib/adk/inspectArtifact";

describe("structured step pipeline", () => {
  const baseArtifact = {
    version: "v1",
    agent: {
      prompt: "Base prompt",
      mcp_servers: [
        { id: "airbnb", name: "airbnb", description: "Search apartments and stays" },
        { id: "flights", name: "flights", description: "Search flights and prices" },
      ],
    },
  };

  test("compile preserves structured steps", () => {
    const source = {
      ...baseArtifact,
      steps: [
        {
          id: "step-1",
          before: "extract request fields",
          runner: "decide which MCP tools are useful",
          after: "summarize available information",
        },
        {
          id: "step-2",
          runner: "search accommodation options",
          after: "normalize result fields",
        },
      ],
    };

    const compiled = compileArtifact(source);

    expect(compiled.steps).toBeDefined();
    expect(Array.isArray(compiled.steps)).toBe(true);
    expect(compiled.steps).toHaveLength(2);

    expect(compiled.steps[0]).toMatchObject({
      id: "step-1",
      before: "extract request fields",
      runner: "decide which MCP tools are useful",
      after: "summarize available information",
    });

    expect(compiled.steps[1]).toMatchObject({
      id: "step-2",
      runner: "search accommodation options",
      after: "normalize result fields",
    });
  });

  test("compile rejects a step with no runner", () => {
    const source = {
      ...baseArtifact,
      steps: [
        {
          id: "step-1",
          before: "extract request fields",
          after: "summarize available information",
        },
      ],
    };

    expect(() => compileArtifact(source)).toThrow(/runner/i);
  });

  test("yaml generation input preserves structured steps", () => {
    const source = {
      ...baseArtifact,
      steps: [
        {
          id: "step-1",
          before: "extract request fields",
          runner: "decide which MCP tools are useful",
          after: "summarize available information",
        },
      ],
    };

    const compiled = compileArtifact(source);
    const yamlInput = buildYamlInput(compiled);

    expect(yamlInput.steps).toBeDefined();
    expect(Array.isArray(yamlInput.steps)).toBe(true);
    expect(yamlInput.steps).toHaveLength(1);
    expect(yamlInput.steps[0]).toMatchObject({
      id: "step-1",
      runner: "decide which MCP tools are useful",
    });
  });

  test("inspect reports correct step count", () => {
    const source = {
      ...baseArtifact,
      steps: [
        { id: "step-1", runner: "r1" },
        { id: "step-2", runner: "r2" },
        { id: "step-3", runner: "r3" },
      ],
    };

    const compiled = compileArtifact(source);
    const summary = inspectArtifact(compiled);

    expect(summary.steps).toBe(3);
  });

  test("prompt prose is not accepted as the only carrier of steps", () => {
    const source = {
      ...baseArtifact,
      agent: {
        ...baseArtifact.agent,
        prompt: `
## Step 1
### Before
Extract fields
### Runner
Search tools
### After
Return summary
        `.trim(),
      },
      steps: [],
    };

    expect(() => compileArtifact(source)).toThrow(/structured steps/i);
  });

  test("mcp declarations survive after step preservation fix", () => {
    const source = {
      ...baseArtifact,
      steps: [{ id: "step-1", runner: "search accommodation options" }],
    };

    const compiled = compileArtifact(source);
    const yamlInput = buildYamlInput(compiled);

    expect(compiled.agent.mcp_servers).toHaveLength(2);
    expect(yamlInput.agent.mcp_servers).toHaveLength(2);
    expect(yamlInput.agent.mcp_servers.map((m) => m.id)).toEqual(
      expect.arrayContaining(["airbnb", "flights"]),
    );
  });
});
