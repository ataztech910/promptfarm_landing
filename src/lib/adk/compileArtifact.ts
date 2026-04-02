import type { OutputContract } from "@/lib/adk/outputContract";
import {
  normalizeStructuredSteps,
  type StructuredStep,
} from "@/lib/adk/structuredSteps";

export type McpServerDeclaration = {
  id: string;
  name: string;
  description?: string;
  command?: string;
  url?: string;
};

export type SerializedArtifactSource = {
  version: string;
  agent: {
    prompt: string;
    mcp_servers?: McpServerDeclaration[];
  };
  steps?: Partial<StructuredStep>[];
  output_contract?: OutputContract | null;
};

export type CompiledArtifactSource = {
  version: string;
  agent: {
    prompt: string;
    mcp_servers: McpServerDeclaration[];
  };
  steps: StructuredStep[];
  output_contract?: OutputContract | null;
};

function normalizeMcpServers(servers?: McpServerDeclaration[]): McpServerDeclaration[] {
  if (!Array.isArray(servers)) return [];
  return servers.map((server, index) => {
    const id = (server.id || server.name || `mcp-${index + 1}`).trim();
    const name = (server.name || server.id || `MCP ${index + 1}`).trim();
    return {
      ...server,
      id,
      name,
    };
  });
}

export function compileArtifact(source: SerializedArtifactSource): CompiledArtifactSource {
  const prompt = typeof source.agent?.prompt === "string" ? source.agent.prompt : "";
  const steps = normalizeStructuredSteps(Array.isArray(source.steps) ? source.steps : []);
  const mcpServers = normalizeMcpServers(source.agent?.mcp_servers);

  if (steps.length === 0 && /(?:^|\n)##\s*Step\b/i.test(prompt)) {
    throw new Error("Structured steps are required when prompt contains step prose.");
  }

  return {
    version: source.version || "v1",
    agent: {
      prompt,
      mcp_servers: mcpServers,
    },
    steps,
    output_contract: source.output_contract ?? null,
  };
}
