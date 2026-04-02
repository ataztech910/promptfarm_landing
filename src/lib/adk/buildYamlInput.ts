import type { CompiledArtifactSource } from "@/lib/adk/compileArtifact";

export type YamlGenerationInput = {
  version: string;
  agent: {
    prompt: string;
    mcp_servers: CompiledArtifactSource["agent"]["mcp_servers"];
  };
  steps: CompiledArtifactSource["steps"];
  output_contract?: CompiledArtifactSource["output_contract"];
};

export function buildYamlInput(compiled: CompiledArtifactSource): YamlGenerationInput {
  return {
    version: compiled.version,
    agent: {
      prompt: compiled.agent.prompt,
      mcp_servers: [...compiled.agent.mcp_servers],
    },
    steps: [...compiled.steps],
    output_contract: compiled.output_contract ?? null,
  };
}
