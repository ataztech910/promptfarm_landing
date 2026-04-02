import type { AdkExecutionArtifact } from "@/lib/adk/runtimeBinding";
import type { McpExecutionSummary } from "@/lib/adk/executionTypes";
import type { OutputValidationResult } from "@/lib/adk/outputContract";

export type ExecutionBackend = "default" | "adk";
export type ExecutionEvent =
  | { type: "status"; message: string }
  | { type: "token"; value: string }
  | { type: "result"; value: string }
  | { type: "error"; message: string };
export type InputAttachment = {
  id: string;
  kind: "text-file" | "image" | "json";
  name: string;
  mimeType?: string;
  content?: string;
  previewUrl?: string;
};
export type UiBlockType = "hotel-cards" | "train-map" | "itinerary-list";
export type UiBlockRequest = {
  id: string;
  type: UiBlockType;
  variant?: string;
  source?: string;
};
export type UiBlockRender = {
  id: string;
  type: UiBlockType;
  props: Record<string, unknown>;
};
export type MessagePayload = {
  text: string;
  attachments: InputAttachment[];
  uiBlocks: UiBlockRequest[];
};

export type RuntimeBindingItem = {
  declaredId: string;
  serverId: string;
  serverName: string;
  status: "bound" | "unavailable" | "unknown";
  reason?: string;
};

export type RuntimeBindingSummary = {
  declared: number;
  resolved: number;
  unavailable: number;
  unknown: number;
  items: RuntimeBindingItem[];
  warnings: string[];
};

export type AdkGenerationSummary = {
  agentGenerated: boolean;
  model: string;
  toolsBound: number;
  toolsSkipped: number;
  outputKey?: string;
  warnings: string[];
};

export type { AdkExecutionArtifact };

export class AdkRunError extends Error {
  status?: number;
  fallbackRecommended: boolean;

  constructor(message: string, options?: { status?: number; fallbackRecommended?: boolean }) {
    super(message);
    this.name = "AdkRunError";
    this.status = options?.status;
    this.fallbackRecommended = Boolean(options?.fallbackRecommended);
  }
}

type RunViaAdkArgs = {
  artifact: AdkExecutionArtifact;
  userPayload: MessagePayload;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent?: (event: ExecutionEvent) => void;
};

export type AdkRunResult = {
  output: string;
  mcpExecution?: McpExecutionSummary;
  outputValidation?: OutputValidationResult;
  structuredOutput?: unknown;
  runtimeBindingSummary?: RuntimeBindingSummary;
  generationSummary?: AdkGenerationSummary;
};

export type AdkInspectResult = {
  runtimeBindingSummary: RuntimeBindingSummary;
  generationSummary: AdkGenerationSummary;
};

type InspectAdkArgs = {
  artifact: AdkExecutionArtifact;
  signal?: AbortSignal;
};

function attachmentContentForPrompt(content?: string): string | undefined {
  if (!content?.trim()) return undefined;
  const trimmed = content.trim();
  return trimmed.length > 6000 ? `${trimmed.slice(0, 6000)}\n... (truncated)` : trimmed;
}

export function serializeMessagePayloadForExecution(payload: MessagePayload): string {
  const text = payload.text.trim();
  if (payload.attachments.length === 0 && payload.uiBlocks.length === 0) return text;

  const lines: string[] = [];
  if (text) {
    lines.push(text);
    lines.push("");
  }

  if (payload.uiBlocks.length > 0) {
    lines.push("## Requested UI Blocks");
    for (const block of payload.uiBlocks) {
      const parts = [`- ${block.type}`];
      if (block.variant) parts.push(`variant=${block.variant}`);
      if (block.source) parts.push(`source=${block.source}`);
      lines.push(parts.join(" "));
    }
    lines.push("");
  }

  if (payload.attachments.length > 0) {
    lines.push("## Attachments");
    for (const attachment of payload.attachments) {
      lines.push(`- name: ${attachment.name}`);
      lines.push(`  kind: ${attachment.kind}`);
      if (attachment.mimeType) lines.push(`  type: ${attachment.mimeType}`);
      const content = attachmentContentForPrompt(attachment.content);
      if (content) {
        lines.push("  content: |");
        for (const line of content.split(/\r?\n/)) {
          lines.push(`    ${line}`);
        }
      }
    }
  }

  return lines.join("\n").trim();
}

function shouldFallback(status?: number): boolean {
  if (!status) return true;
  return [404, 501, 502, 503, 504].includes(status);
}

async function readAdkErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      return data.error || data.message || `ADK request failed (${response.status})`;
    } catch {
      return `ADK request failed (${response.status})`;
    }
  }

  const text = (await response.text()).trim();
  if (!text) return `ADK request failed (${response.status})`;
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

export async function inspectCompiledArtifactViaAdk({
  artifact,
  signal,
}: InspectAdkArgs): Promise<AdkInspectResult> {
  const response = await fetch("/api/adk/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact }),
    signal,
  });

  if (!response.ok) {
    const message = await readAdkErrorMessage(response);
    throw new AdkRunError(message, {
      status: response.status,
      fallbackRecommended: false,
    });
  }

  const data = (await response.json()) as {
    runtimeBindingSummary?: RuntimeBindingSummary;
    generationSummary?: AdkGenerationSummary;
  };

  if (!data.runtimeBindingSummary || !data.generationSummary) {
    throw new AdkRunError("Invalid ADK inspect response format.", { fallbackRecommended: false });
  }

  return {
    runtimeBindingSummary: data.runtimeBindingSummary,
    generationSummary: data.generationSummary,
  };
}

export async function runViaAdk({ artifact, userPayload, sessionId, signal, onEvent }: RunViaAdkArgs): Promise<AdkRunResult> {
  const userMessage = serializeMessagePayloadForExecution(userPayload);
  onEvent?.({ type: "status", message: "Starting ADK run..." });
  if (sessionId) {
    onEvent?.({ type: "status", message: `Using session ${sessionId.slice(-6)}...` });
  }
  let response: Response;
  try {
    onEvent?.({ type: "status", message: "Executing compiled app..." });
    response = await fetch("/api/adk/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact,
        userMessage,
        sessionId,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : "Failed to call ADK execution route.";
    onEvent?.({ type: "error", message });
    throw new AdkRunError(message, { fallbackRecommended: true });
  }

  if (!response.ok) {
    const message = await readAdkErrorMessage(response);
    onEvent?.({ type: "error", message });
    throw new AdkRunError(message, {
      status: response.status,
      fallbackRecommended: shouldFallback(response.status),
    });
  }

  let data: unknown;
  try {
    onEvent?.({ type: "status", message: "Waiting for result..." });
    data = await response.json();
  } catch {
    onEvent?.({ type: "error", message: "Invalid ADK response format." });
    throw new AdkRunError("Invalid ADK response format.", { fallbackRecommended: true });
  }

  const output = (data as { output?: unknown })?.output;
  const mcpExecution = (data as { mcpExecution?: unknown })?.mcpExecution as McpExecutionSummary | undefined;
  const outputValidation = (data as { outputValidation?: unknown })?.outputValidation as OutputValidationResult | undefined;
  const structuredOutput = (data as { structuredOutput?: unknown })?.structuredOutput;
  const runtimeBindingSummary = (data as { runtimeBindingSummary?: unknown })?.runtimeBindingSummary as RuntimeBindingSummary | undefined;
  const generationSummary = (data as { generationSummary?: unknown })?.generationSummary as AdkGenerationSummary | undefined;
  if (typeof output !== "string") {
    onEvent?.({ type: "error", message: "ADK response did not include string output." });
    throw new AdkRunError("ADK response did not include string output.", { fallbackRecommended: true });
  }

  if (mcpExecution) {
    onEvent?.({
      type: "status",
      message: `MCP summary: available ${mcpExecution.available}, invoked ${mcpExecution.invoked}, failed ${mcpExecution.failed}, skipped ${mcpExecution.skipped}.`,
    });
  }
  if (outputValidation) {
    onEvent?.({
      type: outputValidation.isValid ? "status" : "error",
      message: outputValidation.isValid
        ? "Output contract validation passed."
        : `Output contract validation failed (${outputValidation.issues.length} issue${outputValidation.issues.length === 1 ? "" : "s"}).`,
    });
  }
  onEvent?.({ type: "result", value: output });
  onEvent?.({ type: "status", message: "Result received." });
  return {
    output,
    mcpExecution,
    outputValidation,
    structuredOutput,
    runtimeBindingSummary,
    generationSummary,
  };
}
