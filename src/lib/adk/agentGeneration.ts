import { LlmAgent, type LlmAgentTool } from "@/lib/adk/agent";
import type { AdkExecutionArtifact, AdkRuntimePlan } from "@/lib/adk/runtimeBinding";
import type { RuntimeMcpId, RuntimeMcpToolset } from "@/lib/adk/mcpRegistry";

export type GeneratedAdkTool = {
  id: string;
  serverId?: string;
  runtimeId?: RuntimeMcpId;
  name: string;
  kind: "builtin" | "mcp";
  description: string;
  endpoint?: string;
  runtimeToolset?: RuntimeMcpToolset;
};

export type GeneratedAdkAgentSpec = {
  instruction: string;
  tools: GeneratedAdkTool[];
  outputKey?: string;
  model: string;
  warnings: string[];
  toolsBound: number;
  toolsSkipped: number;
};

export type GeneratedAdkAgent = GeneratedAdkAgentSpec & {
  agent: LlmAgent;
  generatedAt: string;
};

type GenerateAdkAgentArgs = {
  artifact: AdkExecutionArtifact;
  runtimePlan: AdkRuntimePlan;
  model?: string;
};

type GenerateAdkAgentOptions = {
  createMcpInvoker?: (tool: GeneratedAdkTool) => (() => string | Promise<string>) | undefined;
};

function getModel(model?: string): string {
  return model?.trim() || process.env.OLLAMA_MODEL || "llama3.2";
}

function dedupeWarnings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function buildBuiltinTools(): GeneratedAdkTool[] {
  return [
    {
      id: "builtin-current-time",
      name: "current_time",
      kind: "builtin",
      description: "Returns the current UTC time in ISO format.",
    },
  ];
}

function buildMcpTools(runtimePlan: AdkRuntimePlan): {
  tools: GeneratedAdkTool[];
  warnings: string[];
  skipped: number;
} {
  const tools: GeneratedAdkTool[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const bound of runtimePlan.boundMcpTools) {
    if (bound.status !== "bound") {
      skipped += 1;
      warnings.push(
        `Skipped MCP tool "${bound.serverName}" because it is ${bound.status}${bound.reason ? `: ${bound.reason}` : ""}.`
      );
      continue;
    }

    const endpoint = bound.command?.trim()
      ? `command:${bound.command.trim()}${bound.args?.length ? ` ${bound.args.join(" ")}` : ""}`
      : bound.url?.trim()
        ? `url:${bound.url.trim()}`
        : undefined;

    if (!endpoint) {
      skipped += 1;
      warnings.push(`Skipped MCP tool "${bound.serverName}" because no command/url endpoint was resolved.`);
      continue;
    }

    tools.push({
      id: `mcp-${bound.serverId}`,
      serverId: bound.serverId,
      runtimeId: bound.runtimeId,
      name: bound.serverName,
      kind: "mcp",
      description: `Bound MCP server ${bound.serverName}`,
      endpoint,
      runtimeToolset: bound.toolset,
    });
  }

  return { tools, warnings, skipped };
}

function buildGeneratedInstruction(
  artifact: AdkExecutionArtifact,
  runtimePlan: AdkRuntimePlan,
  tools: GeneratedAdkTool[],
  outputKey?: string
): string {
  const parts: string[] = [];
  parts.push(runtimePlan.instruction);
  parts.push("## Compiled Artifact Context");
  parts.push(`Steps parsed: ${artifact.definition.steps.length}`);
  parts.push(`MCP declared: ${artifact.definition.mcpServers.length}`);

  if (tools.length > 0) {
    parts.push("## Generated Tool Registry");
    parts.push(
      tools
        .map((tool) =>
          `- ${tool.name} [${tool.kind}]${tool.endpoint ? ` endpoint=${tool.endpoint}` : ""}: ${tool.description}`
        )
        .join("\n")
    );
    parts.push("Use tools only when needed and when they match user intent.");
  }

  if (runtimePlan.outputContract) {
    parts.push("## Response Contract");
    parts.push(`Target format: ${runtimePlan.outputContract.format}`);
    parts.push(`Name: ${runtimePlan.outputContract.name}`);
    if (runtimePlan.outputContract.description) {
      parts.push(`Description: ${runtimePlan.outputContract.description}`);
    }
    if (runtimePlan.outputContract.fields.length > 0) {
      parts.push(
        `Fields: ${runtimePlan.outputContract.fields
          .map((field) => `${field.name}:${field.type}${field.required ? "(required)" : ""}`)
          .join(", ")}`
      );
    }
    if (runtimePlan.outputContract.instructions) {
      parts.push(runtimePlan.outputContract.instructions);
    }
  }

  if (outputKey) {
    parts.push(`## Output Key\nFinal response key: ${outputKey}`);
  }

  return parts.join("\n\n");
}

function toLlmAgentTools(
  tools: GeneratedAdkTool[],
  options?: GenerateAdkAgentOptions
): LlmAgentTool[] {
  return tools.map((tool) => {
    if (tool.kind === "builtin" && tool.name === "current_time") {
      return {
        serverId: tool.serverId,
        name: tool.name,
        kind: tool.kind,
        description: tool.description,
        invoke: () => new Date().toISOString(),
      };
    }

    return {
      serverId: tool.serverId,
      name: tool.name,
      kind: tool.kind,
      description: tool.endpoint ? `${tool.description} (${tool.endpoint})` : tool.description,
      invoke: tool.kind === "mcp" ? options?.createMcpInvoker?.(tool) : undefined,
    };
  });
}

export function buildGeneratedAdkAgentSpec({
  artifact,
  runtimePlan,
  model,
}: GenerateAdkAgentArgs): GeneratedAdkAgentSpec {
  const builtinTools = buildBuiltinTools();
  const mcp = buildMcpTools(runtimePlan);
  const tools = [...builtinTools, ...mcp.tools];
  const outputKey = runtimePlan.outputContract?.format === "json" ? "json_output" : "text_output";
  const instruction = buildGeneratedInstruction(artifact, runtimePlan, tools, outputKey);
  const warnings = dedupeWarnings([...runtimePlan.warnings, ...mcp.warnings]);

  return {
    instruction,
    tools,
    outputKey,
    model: getModel(model),
    warnings,
    toolsBound: tools.length,
    toolsSkipped: mcp.skipped,
  };
}

export function generateAdkAgent(
  args: GenerateAdkAgentArgs,
  options?: GenerateAdkAgentOptions
): GeneratedAdkAgent {
  const spec = buildGeneratedAdkAgentSpec(args);
  const agent = new LlmAgent({
    name: "generated_local_adk_agent",
    model: spec.model,
    instruction: spec.instruction,
    tools: toLlmAgentTools(spec.tools, options),
    outputKey: spec.outputKey,
  });

  return {
    ...spec,
    agent,
    generatedAt: new Date().toISOString(),
  };
}
