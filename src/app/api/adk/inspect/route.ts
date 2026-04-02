import { NextResponse } from "next/server";
import type { AdkExecutionArtifact } from "@/lib/adk/runtimeBinding";
import {
  buildAdkRuntimePlan,
  createRuntimeInfrastructureFromEnv,
} from "@/lib/adk/runtimeBinding";
import { buildGeneratedAdkAgentSpec } from "@/lib/adk/agentGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function buildRuntimeBindingSummary(runtimePlan: ReturnType<typeof buildAdkRuntimePlan>) {
  const declared = runtimePlan.boundMcpTools.length;
  const resolved = runtimePlan.boundMcpTools.filter((tool) => tool.status === "bound").length;
  const unavailable = runtimePlan.boundMcpTools.filter((tool) => tool.status === "unavailable").length;
  const unknown = runtimePlan.boundMcpTools.filter((tool) => tool.status === "unknown").length;

  return {
    declared,
    resolved,
    unavailable,
    unknown,
    items: runtimePlan.boundMcpTools.map((tool) => ({
      declaredId: tool.declaredId,
      serverId: tool.serverId,
      serverName: tool.serverName,
      status: tool.status,
      reason: tool.reason,
    })),
    warnings: runtimePlan.warnings,
  };
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const artifact = (payload as { artifact?: unknown })?.artifact as AdkExecutionArtifact | undefined;
  if (!artifact || typeof artifact.compiledPrompt !== "string" || typeof artifact.adkYaml !== "string") {
    return errorResponse("Invalid or missing `artifact` payload.", 400);
  }

  const infrastructure = createRuntimeInfrastructureFromEnv(process.env);
  const runtimePlan = buildAdkRuntimePlan(artifact, { infrastructure });
  const generated = buildGeneratedAdkAgentSpec({
    artifact,
    runtimePlan,
    model: infrastructure.model,
  });
  const runtimeBindingSummary = buildRuntimeBindingSummary(runtimePlan);
  const generationSummary = {
    agentGenerated: true,
    model: generated.model,
    toolsBound: generated.toolsBound,
    toolsSkipped: generated.toolsSkipped,
    outputKey: generated.outputKey,
    warnings: generated.warnings,
  };

  const mcpEnvPresence = ["AIRBNB", "FLIGHTS", "BOOKING", "TRIPADVISOR"].map((prefix) => ({
    id: prefix.toLowerCase(),
    hasCommand: Boolean(process.env[`${prefix}_MCP_COMMAND`]),
    hasUrl: Boolean(process.env[`${prefix}_MCP_URL`]),
    hasArgs: Boolean(process.env[`${prefix}_MCP_ARGS`]),
  }));
  console.info("[adk.inspect] summary", {
    steps: artifact.definition.steps.length,
    mcpDeclared: artifact.definition.mcpServers.length,
    yamlLength: artifact.adkYaml.length,
    runtimeBinding: {
      declared: runtimeBindingSummary.declared,
      resolved: runtimeBindingSummary.resolved,
      unavailable: runtimeBindingSummary.unavailable,
      unknown: runtimeBindingSummary.unknown,
    },
    generation: {
      model: generationSummary.model,
      toolsBound: generationSummary.toolsBound,
      toolsSkipped: generationSummary.toolsSkipped,
    },
    envPresence: mcpEnvPresence,
  });

  return NextResponse.json({
    runtimeBindingSummary,
    generationSummary,
  });
}
