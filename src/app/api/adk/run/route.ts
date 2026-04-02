import { NextResponse } from "next/server";
import type { AdkExecutionArtifact } from "@/lib/adk/runtimeBinding";
import { generateAdkAgent, type GeneratedAdkTool } from "@/lib/adk/agentGeneration";
import type { McpExecutionRecord, McpExecutionSummary } from "@/lib/adk/executionTypes";
import { validateOutputAgainstContract } from "@/lib/adk/outputContract";
import {
  type AdkRuntimePlan,
  buildAdkRuntimePlan,
  createRuntimeInfrastructureFromEnv,
} from "@/lib/adk/runtimeBinding";
import { buildGeneratedAdkAgentSpec } from "@/lib/adk/agentGeneration";
import { exec as execCb, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exec = promisify(execCb);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function buildAgentInput(
  userMessage: string,
  sessionId: string,
  warnings: string[]
): string {
  const parts: string[] = [];

  parts.push(`Session ID: ${sessionId || "none"}`);
  if (warnings.length > 0) {
    parts.push("## Runtime Warnings");
    parts.push(warnings.map((warning) => `- ${warning}`).join("\n"));
  }
  parts.push("## User Message");
  parts.push(userMessage);

  return parts.join("\n\n");
}

function compactText(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return text.length > 280 ? `${text.slice(0, 280)}...` : text;
}

function buildRuntimeBindingSummary(runtimePlan: AdkRuntimePlan) {
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

async function invokeCommandToolset(
  command: string,
  args: string[],
  toolName: string
): Promise<string> {
  if (args.length === 0) {
    const { stdout, stderr } = await exec(command, {
      timeout: 3000,
      maxBuffer: 128 * 1024,
      cwd: process.cwd(),
    });
    const merged = compactText(`${stdout || ""}\n${stderr || ""}`);
    return merged || `${toolName} command executed.`;
  }

  const resolvedArgs = args.map((arg) => {
    if (!arg.startsWith("./")) return arg;
    return path.resolve(process.cwd(), arg);
  });

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, resolvedArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out for tool "${toolName}".`));
    }, 3000);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const merged = compactText(`${stdout || ""}\n${stderr || ""}`);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(merged || `Command failed with exit code ${code ?? -1}.`));
        return;
      }
      resolve(merged || `${toolName} command executed.`);
    });

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: "local-adk",
      method: "tools/list",
      params: { source: "prompt-landing" },
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

function createMcpInvoker(tool: GeneratedAdkTool) {
  if (tool.kind !== "mcp") return undefined;
  const runtimeToolset = tool.runtimeToolset;
  if (runtimeToolset?.kind === "url" && runtimeToolset.url?.trim()) {
    const url = runtimeToolset.url.trim();
    return async () => {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      if (!response.ok) {
        const body = compactText(await response.text());
        throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
      }
      const text = compactText(await response.text());
      return text || "MCP URL call succeeded.";
    };
  }

  if (runtimeToolset?.kind === "command" && runtimeToolset.command?.trim()) {
    const command = runtimeToolset.command.trim();
    const args = runtimeToolset.args ?? [];
    if (args.length > 0) {
      return async () => invokeCommandToolset(command, args, tool.name);
    }

    return async () => {
      const { stdout, stderr } = await exec(command, {
        timeout: 3000,
        maxBuffer: 128 * 1024,
      });
      const merged = compactText(`${stdout || ""}\n${stderr || ""}`);
      return merged || "MCP command executed.";
    };
  }

  const endpoint = tool.endpoint?.trim();
  if (endpoint?.startsWith("url:")) {
    const url = endpoint.slice(4).trim();
    if (!url) return undefined;
    return async () => {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      if (!response.ok) {
        const body = compactText(await response.text());
        throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
      }
      const text = compactText(await response.text());
      return text || "MCP URL call succeeded.";
    };
  }

  if (endpoint?.startsWith("command:")) {
    const command = endpoint.slice(8).trim();
    if (!command) return undefined;
    return async () => {
      const { stdout, stderr } = await exec(command, {
        timeout: 3000,
        maxBuffer: 128 * 1024,
      });
      const merged = compactText(`${stdout || ""}\n${stderr || ""}`);
      return merged || "MCP command executed.";
    };
  }

  return undefined;
}

function buildSkippedRecords(runtimePlan: AdkRuntimePlan): McpExecutionRecord[] {
  const records: McpExecutionRecord[] = [];
  for (const tool of runtimePlan.boundMcpTools) {
    if (tool.status === "bound") continue;
    records.push({
      id: `skip-${tool.serverId}`,
      serverId: tool.serverId,
      serverName: tool.serverName,
      toolName: tool.serverName,
      status: "skipped",
      message: tool.reason || `Tool marked as ${tool.status} during runtime binding.`,
    });
  }
  return records;
}

function summarizeMcpExecution(records: McpExecutionRecord[], available: number): McpExecutionSummary {
  const invoked = records.filter((record) => record.status === "invoked").length;
  const compactMap = new Map<string, McpExecutionRecord>();
  for (const record of records) {
    const key = record.serverId || record.serverName;
    compactMap.set(key, record);
  }
  const compactRecords = Array.from(compactMap.values());
  const failed = compactRecords.filter((record) => record.status === "failed").length;
  const skipped = compactRecords.filter((record) => record.status === "skipped").length;
  return {
    available,
    invoked,
    failed,
    skipped,
    records: compactRecords,
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
  const userMessage = typeof (payload as { userMessage?: unknown })?.userMessage === "string"
    ? (payload as { userMessage: string }).userMessage.trim()
    : "";
  const sessionId = typeof (payload as { sessionId?: unknown })?.sessionId === "string"
    ? (payload as { sessionId: string }).sessionId.trim()
    : "";

  if (!artifact || typeof artifact.compiledPrompt !== "string" || typeof artifact.adkYaml !== "string") {
    return errorResponse("Invalid or missing `artifact` payload.", 400);
  }

  if (!userMessage) {
    return errorResponse("`userMessage` is required.", 400);
  }

  // Split: artifact carries authored/compiled source, infrastructure resolves runtime bindings.
  const infrastructure = createRuntimeInfrastructureFromEnv(process.env);
  const runtimePlan = buildAdkRuntimePlan(artifact, { infrastructure });
  const runtimeBindingSummary = buildRuntimeBindingSummary(runtimePlan);
  const generationSummary = buildGeneratedAdkAgentSpec({
    artifact,
    runtimePlan,
    model: infrastructure.model,
  });
  const generatedAgent = generateAdkAgent({
    artifact,
    runtimePlan,
    model: infrastructure.model,
  }, {
    createMcpInvoker,
  });
  const input = buildAgentInput(userMessage, sessionId, generatedAgent.warnings);
  const skippedRecords = buildSkippedRecords(runtimePlan);
  const availableMcp = runtimePlan.boundMcpTools.filter((tool) => tool.status === "bound").length;
  const mcpEnvPresence = ["AIRBNB", "FLIGHTS", "BOOKING", "TRIPADVISOR"].map((prefix) => ({
    id: prefix.toLowerCase(),
    hasCommand: Boolean(process.env[`${prefix}_MCP_COMMAND`]),
    hasUrl: Boolean(process.env[`${prefix}_MCP_URL`]),
    hasArgs: Boolean(process.env[`${prefix}_MCP_ARGS`]),
  }));
  console.info("[adk.run] setup", {
    sessionId: sessionId || "none",
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

  try {
    const trace = await generatedAgent.agent.runWithTrace({
      input,
      signal: request.signal,
    });
    const mcpRecords = [...skippedRecords, ...trace.mcpExecutionRecords];
    const outputValidation = validateOutputAgainstContract(trace.output, runtimePlan.outputContract);
    return NextResponse.json({
      output: trace.output,
      mcpExecution: summarizeMcpExecution(mcpRecords, availableMcp),
      outputValidation: {
        isValid: outputValidation.isValid,
        issues: outputValidation.issues,
      },
      structuredOutput: outputValidation.parsed ?? null,
      runtimeBindingSummary,
      generationSummary: {
        agentGenerated: true,
        model: generationSummary.model,
        toolsBound: generationSummary.toolsBound,
        toolsSkipped: generationSummary.toolsSkipped,
        outputKey: generationSummary.outputKey,
        warnings: generationSummary.warnings,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local ADK execution error.";
    return errorResponse(`In-process ADK execution failed: ${message}`, 502);
  }
}
