import {
  inferLegacyOutputContractFromPrompt,
  type OutputContract,
} from "@/lib/adk/outputContract";
import {
  createRuntimeMcpRegistry,
  resolveCompiledMcpBindings,
  type RuntimeMcpId,
  type RuntimeMcpRegistry,
  type RuntimeMcpToolset,
} from "@/lib/adk/mcpRegistry";
import {
  getStepExecutionSegments,
  type StructuredStep,
} from "@/lib/adk/structuredSteps";

type StepDefinition = StructuredStep;

type McpServerDefinition = {
  id: string;
  name: string;
  command?: string;
  url?: string;
  description?: string;
};

type ValidationIssue = {
  level: "warning" | "error";
  code: string;
  message: string;
};

export type AdkExecutionArtifact = {
  compiledPrompt: string;
  adkYaml: string;
  outputContract?: OutputContract | null;
  definition: {
    steps: StepDefinition[];
    mcpServers: McpServerDefinition[];
    outputContract?: OutputContract | null;
  };
  validation?: {
    isValid: boolean;
    issues: ValidationIssue[];
  };
};

export type BoundMcpTool = {
  declaredId: string;
  serverId: string;
  serverName: string;
  runtimeId?: RuntimeMcpId;
  enabled: boolean;
  status: "bound" | "unavailable" | "unknown";
  toolset?: RuntimeMcpToolset;
  command?: string;
  args?: string[];
  url?: string;
  reason?: string;
};

export type RuntimeOutputContract = OutputContract & {
  instructions?: string;
};

export type AdkRuntimePlan = {
  instruction: string;
  planningSteps: string[];
  boundMcpTools: BoundMcpTool[];
  outputContract?: RuntimeOutputContract;
  warnings: string[];
};

export type RuntimeInfrastructure = {
  model?: string;
  mcpRegistry?: RuntimeMcpRegistry;
};

export function createRuntimeInfrastructureFromEnv(
  env: NodeJS.ProcessEnv = process.env
): RuntimeInfrastructure {
  return {
    model: env.OLLAMA_MODEL || env.NEXT_PUBLIC_OLLAMA_MODEL || undefined,
    mcpRegistry: createRuntimeMcpRegistry(env),
  };
}

function deriveOutputContract(artifact: AdkExecutionArtifact): RuntimeOutputContract {
  const base = artifact.outputContract
    ?? artifact.definition.outputContract
    ?? inferLegacyOutputContractFromPrompt(artifact.compiledPrompt);

  let instructions: string;
  if (base.format === "json") {
    if (base.fields.length > 0) {
      instructions = `Return only valid JSON matching contract "${base.name}" with fields: ${base.fields.map((field) => `${field.name}:${field.type}${field.required ? "(required)" : ""}`).join(", ")}.`;
    } else {
      instructions = `Return only valid JSON for contract "${base.name}".`;
    }
  } else {
    instructions = "Return concise plain text output.";
  }

  return {
    ...base,
    instructions,
  };
}

function buildPlanningSteps(artifact: AdkExecutionArtifact): string[] {
  if (artifact.definition.steps.length === 0) return [];
  return artifact.definition.steps.map((step, index) => {
    const title = step.title?.trim() || `Step ${index + 1}`;
    const segments = getStepExecutionSegments(step);
    if (segments.length === 0) return `${index + 1}. ${title}`;
    const rendered = segments.map((segment) => `${segment.key}: ${segment.value}`).join(" | ");
    return `${index + 1}. ${title}: ${rendered}`;
  });
}

function buildMcpBindings(
  artifact: AdkExecutionArtifact,
  infrastructure?: RuntimeInfrastructure
): { boundMcpTools: BoundMcpTool[]; warnings: string[] } {
  const registry = infrastructure?.mcpRegistry ?? createRuntimeMcpRegistry();
  const declaredIds = artifact.definition.mcpServers.map((server) => server.id || server.name);
  const resolved = resolveCompiledMcpBindings(declaredIds, { registry });
  const boundMcpTools = artifact.definition.mcpServers.map((server, index) => {
    const binding = resolved.bindings[index];
    const declaredId = (server.id || server.name).trim();

    if (!binding || binding.status === "unknown") {
      return {
        declaredId,
        serverId: declaredId || `mcp-${index + 1}`,
        serverName: server.name || declaredId || `MCP ${index + 1}`,
        enabled: false,
        status: "unknown" as const,
        reason: binding?.warning || `Unknown MCP declaration "${declaredId}".`,
      };
    }

    if (binding.status === "unavailable") {
      const entry = binding.entry;
      return {
        declaredId,
        serverId: binding.canonicalId || declaredId || `mcp-${index + 1}`,
        serverName: entry?.label || server.name || binding.canonicalId || declaredId || `MCP ${index + 1}`,
        runtimeId: binding.canonicalId || undefined,
        enabled: false,
        status: "unavailable" as const,
        reason: binding.warning || entry?.reason || "Runtime toolset is unavailable.",
      };
    }

    const entry = binding.entry;
    const toolset = entry?.toolset ?? undefined;
    return {
      declaredId,
      serverId: binding.canonicalId || declaredId || `mcp-${index + 1}`,
      serverName: entry?.label || server.name || binding.canonicalId || declaredId || `MCP ${index + 1}`,
      runtimeId: binding.canonicalId || undefined,
      enabled: true,
      status: "bound" as const,
      toolset,
      command: toolset?.command,
      args: toolset?.args,
      url: toolset?.url,
    };
  });

  return { boundMcpTools, warnings: resolved.warnings };
}

function buildInstructionText(
  artifact: AdkExecutionArtifact,
  planningSteps: string[],
  boundMcpTools: BoundMcpTool[],
  outputContract: RuntimeOutputContract,
  warnings: string[],
  infrastructure?: RuntimeInfrastructure
): string {
  const parts: string[] = [];
  const model = infrastructure?.model?.trim();

  parts.push("You are executing a compiled app definition locally.");
  if (model) {
    parts.push(`Runtime model: ${model}`);
  }

  parts.push("## Core Instruction");
  parts.push(artifact.compiledPrompt.trim() || "No compiled prompt was provided.");

  if (planningSteps.length > 0) {
    parts.push("## Planning Steps");
    parts.push(planningSteps.join("\n"));
  }

  if (boundMcpTools.length > 0) {
    parts.push("## MCP Tool Availability");
    parts.push(
      boundMcpTools
        .map((tool) => {
          if (tool.status === "bound") return `- ${tool.serverName}: available`;
          return `- ${tool.serverName}: ${tool.status}${tool.reason ? ` (${tool.reason})` : ""}`;
        })
        .join("\n")
    );
  }

  parts.push("## Output Contract");
  parts.push(`Format: ${outputContract.format}`);
  parts.push(`Name: ${outputContract.name}`);
  if (outputContract.description) {
    parts.push(`Description: ${outputContract.description}`);
  }
  if (outputContract.fields.length > 0) {
    parts.push(
      `Fields: ${outputContract.fields
        .map((field) => `${field.name}:${field.type}${field.required ? "(required)" : ""}`)
        .join(", ")}`
    );
  }
  if (outputContract.instructions) {
    parts.push(outputContract.instructions);
  }

  if (warnings.length > 0) {
    parts.push("## Runtime Warnings");
    parts.push(warnings.map((warning) => `- ${warning}`).join("\n"));
  }

  return parts.join("\n\n");
}

export function buildAdkRuntimePlan(
  artifact: AdkExecutionArtifact,
  options?: { infrastructure?: RuntimeInfrastructure }
): AdkRuntimePlan {
  const infrastructure = options?.infrastructure;
  const planningSteps = buildPlanningSteps(artifact);
  const outputContract = deriveOutputContract(artifact);
  const { boundMcpTools, warnings: bindingWarnings } = buildMcpBindings(artifact, infrastructure);
  const warnings = [...bindingWarnings];

  if (outputContract.format === "json" && outputContract.fields.length === 0) {
    warnings.push(`Output contract "${outputContract.name}" has no declared fields.`);
  }

  for (const issue of artifact.validation?.issues ?? []) {
    if (issue.level === "error" || issue.code.startsWith("OUTPUT_")) {
      const prefix = issue.level === "error" ? "Compile error" : "Compile warning";
      warnings.push(`${prefix} [${issue.code}]: ${issue.message}`);
    }
  }

  const instruction = buildInstructionText(
    artifact,
    planningSteps,
    boundMcpTools,
    outputContract,
    warnings,
    infrastructure
  );

  return {
    instruction,
    planningSteps,
    boundMcpTools,
    outputContract,
    warnings,
  };
}
