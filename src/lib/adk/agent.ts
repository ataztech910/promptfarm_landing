import type { McpExecutionRecord } from "@/lib/adk/executionTypes";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

type OllamaGenerateResponse = {
  response?: string;
  error?: string;
};

export type LlmAgentTool = {
  serverId?: string;
  name: string;
  description: string;
  kind?: "builtin" | "mcp";
  invoke?: () => string | Promise<string>;
};

type LlmAgentConfig = {
  name: string;
  model?: string;
  instruction?: string;
  tools?: LlmAgentTool[];
  outputKey?: string;
};

type RunArgs = {
  input: string;
  signal?: AbortSignal;
  instruction?: string;
};

type RunWithTraceResult = {
  output: string;
  mcpExecutionRecords: McpExecutionRecord[];
};

export class LlmAgent {
  private readonly name: string;
  private readonly model: string;
  private readonly instruction: string;
  private readonly tools: LlmAgentTool[];
  private readonly outputKey?: string;

  constructor(config: LlmAgentConfig) {
    this.name = config.name;
    this.model = config.model ?? OLLAMA_MODEL;
    this.instruction = config.instruction ?? "";
    this.tools = config.tools ?? [];
    this.outputKey = config.outputKey;
  }

  private createRecordId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async buildToolContextAndMcpTrace(): Promise<{
    contextLines: string[];
    mcpExecutionRecords: McpExecutionRecord[];
  }> {
    const contextLines: string[] = [];
    const mcpExecutionRecords: McpExecutionRecord[] = [];

    for (const tool of this.tools) {
      if (typeof tool.invoke !== "function") continue;

      if (tool.kind === "mcp") {
        const invokeRecord: McpExecutionRecord = {
          id: this.createRecordId(),
          serverId: tool.serverId || tool.name,
          serverName: tool.name,
          toolName: tool.name,
          status: "invoked",
        };
        mcpExecutionRecords.push(invokeRecord);
      }

      try {
        const result = await tool.invoke();
        const compact = typeof result === "string" ? result.trim() : "";
        if (compact) {
          contextLines.push(`- ${tool.name}: ${compact}`);
        }
        if (tool.kind === "mcp") {
          mcpExecutionRecords.push({
            id: this.createRecordId(),
            serverId: tool.serverId || tool.name,
            serverName: tool.name,
            toolName: tool.name,
            status: "succeeded",
            message: compact || "MCP tool executed successfully.",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "tool invocation failed";
        contextLines.push(`- ${tool.name}: ${message}`);
        if (tool.kind === "mcp") {
          mcpExecutionRecords.push({
            id: this.createRecordId(),
            serverId: tool.serverId || tool.name,
            serverName: tool.name,
            toolName: tool.name,
            status: "failed",
            message,
          });
        }
      }
    }

    return { contextLines, mcpExecutionRecords };
  }

  async runWithTrace({ input, signal, instruction }: RunArgs): Promise<RunWithTraceResult> {
    const activeInstruction = instruction ?? this.instruction;
    const parts: string[] = [];

    if (activeInstruction) {
      parts.push(activeInstruction);
    }

    if (this.tools.length > 0) {
      parts.push(
        [
          "## Available Runtime Tools",
          ...this.tools.map((tool) => `- ${tool.name}${tool.kind ? ` (${tool.kind})` : ""}: ${tool.description}`),
        ].join("\n")
      );
    }

    const { contextLines: toolContext, mcpExecutionRecords } = await this.buildToolContextAndMcpTrace();
    if (toolContext.length > 0) {
      parts.push(["## Runtime Tool Context", ...toolContext].join("\n"));
    }

    if (this.outputKey) {
      parts.push(`## Output Key\nReturn the final answer in key: ${this.outputKey}`);
    }

    parts.push(input);
    const prompt = parts.filter(Boolean).join("\n\n");

    const upstream = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
      }),
      cache: "no-store",
      signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      throw new Error(
        `${this.name} request failed (${upstream.status}). ${detail || upstream.statusText}`
      );
    }

    const data = (await upstream.json()) as OllamaGenerateResponse;
    if (data.error) {
      throw new Error(data.error);
    }

    if (typeof data.response === "string") {
      return {
        output: data.response,
        mcpExecutionRecords,
      };
    }

    return {
      output: JSON.stringify(data),
      mcpExecutionRecords,
    };
  }

  async run({ input, signal, instruction }: RunArgs): Promise<string> {
    const result = await this.runWithTrace({ input, signal, instruction });
    return result.output;
  }
}

export const rootAgent = new LlmAgent({
  name: "local_adk_agent",
  model: OLLAMA_MODEL,
  instruction: "You are a helpful assistant executing a compiled app prompt.",
});
