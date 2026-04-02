import type { CompiledArtifactSource } from "@/lib/adk/compileArtifact";

export type ArtifactInspectSummary = {
  steps: number;
  mcpDeclared: number;
  yamlLength: number;
};

export function inspectArtifact(
  artifact: CompiledArtifactSource,
  options?: { yamlLength?: number }
): ArtifactInspectSummary {
  return {
    steps: artifact.steps.length,
    mcpDeclared: artifact.agent.mcp_servers.length,
    yamlLength: options?.yamlLength ?? 0,
  };
}
