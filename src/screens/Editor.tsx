"use client";

import { Container, SiteFooter } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AdkRunError,
  AdkGenerationSummary,
  ExecutionBackend,
  ExecutionEvent,
  InputAttachment,
  MessagePayload,
  RuntimeBindingSummary,
  UiBlockRender,
  UiBlockRequest,
  inspectCompiledArtifactViaAdk,
  runViaAdk,
  serializeMessagePayloadForExecution,
} from "@/lib/execution/adkRunner";
import type { AdkRunResult } from "@/lib/execution/adkRunner";
import type { McpExecutionSummary } from "@/lib/adk/executionTypes";
import {
  parseOutputContractFromMarkdown,
  type OutputContract,
  type OutputValidationResult,
} from "@/lib/adk/outputContract";
import {
  CANONICAL_RUNTIME_MCP_IDS,
  normalizeCompiledMcpId,
} from "@/lib/adk/mcpRegistry";
import type { StructuredStep } from "@/lib/adk/structuredSteps";
import { cn } from "@/lib/utils";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  CompiledOutput,
  EditorBlock,
  EditorSegment,
  PromptEditor,
  useCompiledText,
  Variable,
  VariablesBar,
} from "@promptfarm/prompt-editor";
import { ArrowUp, Braces, ChevronDown, FileText, Loader2, Paperclip, Plus, Square, X } from "lucide-react";
import "@promptfarm/prompt-editor/styles.css";

const USER_INPUT_MARKER = "{{user_input}}";
const FALLBACK_USER_INPUT_SECTION = "## User Input";
const FALLBACK_MODEL = "llama3.2";
const EXECUTION_BACKEND: ExecutionBackend = process.env.NEXT_PUBLIC_EXECUTION_BACKEND === "default" ? "default" : "adk";

type StepDefinition = StructuredStep;

type McpServerDefinition = {
  id: string;
  name: string;
  command?: string;
  url?: string;
  description?: string;
};

type AgentDefinition = {
  sourceMarkdown: string;
  mcpServers: McpServerDefinition[];
  steps: StepDefinition[];
  outputContract: OutputContract | null;
};

type CompiledArtifact = {
  definition: AgentDefinition;
  compiledPrompt: string;
  compiledAt: string;
  adkYaml: string;
  outputContract?: OutputContract | null;
  validation: CompileValidationResult;
};

type AppRunState = "idle" | "running" | "dirty" | "stopped";
type AppSession = {
  id: string;
  startedAt: string;
  backend: ExecutionBackend;
  status: "idle" | "active" | "stopped";
};
type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  backend?: ExecutionBackend;
  status?: "pending" | "complete" | "error";
  attachments?: InputAttachment[];
  requestedUiBlocks?: UiBlockRequest[];
  renderedUiBlocks?: UiBlockRender[];
};
type CompileIssue = {
  level: "warning" | "error";
  code: string;
  message: string;
};

type CompileValidationResult = {
  isValid: boolean;
  issues: CompileIssue[];
};

type RightDebugTab = "snapshot" | "execution" | "adk-yaml";

function slugifyServerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseMcpServersFromMarkdown(markdown: string): McpServerDefinition[] {
  const lines = markdown.split(/\r?\n/);
  const mcpSectionStart = lines.findIndex((line) => /^##\s+MCP\s*$/i.test(line.trim()));
  if (mcpSectionStart === -1) return [];

  const servers: McpServerDefinition[] = [];
  let current: Omit<McpServerDefinition, "id"> | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const index = servers.length + 1;
    const name = current.name.trim();
    const canonicalId = normalizeCompiledMcpId(name);
    servers.push({
      ...current,
      name,
      id: canonicalId || `${slugifyServerName(name) || "server"}-${index}`,
    });
    current = null;
  };

  for (let i = mcpSectionStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^##\s+/.test(line)) {
      break;
    }

    const serverMatch = line.match(/^###\s+Server:\s*(.*)$/i);
    if (serverMatch) {
      pushCurrent();
      current = { name: serverMatch[1].trim() };
      continue;
    }

    if (!current) continue;

    const descriptionMatch = line.match(/^Description:\s*(.+)$/i);
    if (descriptionMatch) {
      current.description = descriptionMatch[1].trim();
      continue;
    }

    const commandMatch = line.match(/^Command:\s*(.+)$/i);
    if (commandMatch) {
      current.command = commandMatch[1].trim();
      continue;
    }

    const urlMatch = line.match(/^URL:\s*(.+)$/i);
    if (urlMatch) {
      current.url = urlMatch[1].trim();
    }
  }

  pushCurrent();
  return servers;
}

type StepFieldKey = "before" | "runner" | "after" | "if_success" | "if_error";

type MutableParsedStep = {
  id: string;
  title: string;
  before: string[];
  runner: string[];
  after: string[];
  if_success: string[];
  if_error: string[];
  loose: string[];
};

function toStepText(lines: string[]): string | undefined {
  const value = lines.join("\n").trim();
  return value || undefined;
}

function hasStepText(step: MutableParsedStep): boolean {
  return step.before.length > 0
    || step.runner.length > 0
    || step.after.length > 0
    || step.if_success.length > 0
    || step.if_error.length > 0
    || step.loose.length > 0;
}

function appendToStepField(step: MutableParsedStep, field: StepFieldKey, line: string) {
  if (field === "before") {
    step.before.push(line);
    return;
  }
  if (field === "runner") {
    step.runner.push(line);
    return;
  }
  if (field === "after") {
    step.after.push(line);
    return;
  }
  if (field === "if_success") {
    step.if_success.push(line);
    return;
  }
  step.if_error.push(line);
}

function parseStepHeader(text: string, level: 2 | 3): string | null {
  const pattern = level === 2
    ? /^##\s+Step(?:\s+\d+)?(?:\s*[:\-]\s*(.*))?\s*$/i
    : /^###\s+Step(?:\s+\d+)?(?:\s*[:\-]\s*(.*))?\s*$/i;
  const match = text.match(pattern);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

function parseStepFieldHeader(text: string): StepFieldKey | null {
  const match = text.match(/^#{3,4}\s+(.+)$/);
  if (!match) return null;
  const normalized = match[1]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (normalized === "before") return "before";
  if (normalized === "runner") return "runner";
  if (normalized === "after") return "after";
  if (normalized === "if_success") return "if_success";
  if (normalized === "if_error") return "if_error";
  return null;
}

function parseStepsFromMarkdown(markdown: string): StepDefinition[] {
  const lines = markdown.split(/\r?\n/);
  const steps: StepDefinition[] = [];
  let inStepsSection = false;
  let currentStep: MutableParsedStep | null = null;
  let currentField: StepFieldKey | null = null;

  const pushCurrentStep = () => {
    if (!currentStep) return;
    const index = steps.length + 1;
    const before = toStepText(currentStep.before);
    const runner = toStepText(currentStep.runner) ?? toStepText(currentStep.loose) ?? "";
    const after = toStepText(currentStep.after);
    const ifSuccess = toStepText(currentStep.if_success);
    const ifError = toStepText(currentStep.if_error);
    const title = currentStep.title.trim() || `Step ${index}`;
    const instruction = [before, runner, after, ifSuccess, ifError].filter(Boolean).join("\n\n");
    steps.push({
      id: currentStep.id || `step-${index}`,
      title,
      before,
      runner,
      after,
      if_success: ifSuccess,
      if_error: ifError,
      instruction: instruction || undefined,
    });
    currentStep = null;
    currentField = null;
  };

  const startStep = (title?: string) => {
    const index = steps.length + 1;
    currentStep = {
      id: `step-${index}`,
      title: title?.trim() || `Step ${index}`,
      before: [],
      runner: [],
      after: [],
      if_success: [],
      if_error: [],
      loose: [],
    };
    currentField = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^##\s+Steps\s*$/i.test(line)) {
      pushCurrentStep();
      inStepsSection = true;
      continue;
    }

    const stepH2 = parseStepHeader(line, 2);
    if (stepH2 !== null) {
      pushCurrentStep();
      inStepsSection = false;
      startStep(stepH2);
      continue;
    }

    if (/^##\s+/.test(line)) {
      pushCurrentStep();
      inStepsSection = false;
      continue;
    }

    if (inStepsSection) {
      const field = parseStepFieldHeader(line);
      const hasAnyStepText = currentStep ? hasStepText(currentStep) : false;

      if (!currentStep && /^###\s+/.test(line) && !field) {
        startStep(line.replace(/^###\s+/, "").trim());
        continue;
      }

      if (currentStep && /^###\s+/.test(line) && !field && hasAnyStepText) {
        pushCurrentStep();
        startStep(line.replace(/^###\s+/, "").trim());
        continue;
      }

      if (field && currentStep) {
        currentField = field;
        continue;
      }
    }

    if (!currentStep) continue;
    const step = currentStep as MutableParsedStep;
    if (!line) {
      if (currentField) appendToStepField(step, currentField, rawLine);
      continue;
    }
    if (currentField) {
      appendToStepField(step, currentField, rawLine);
      continue;
    }
    step.loose.push(rawLine);
  }

  pushCurrentStep();
  if (steps.length > 0) return steps;
  return parseFallbackStepsFromMarkdown(markdown);
}

function parseFallbackStepsFromMarkdown(markdown: string): StepDefinition[] {
  const lines = markdown.split(/\r?\n/);
  const steps: StepDefinition[] = [];

  const sectionNames = ["task", "tasks", "plan", "workflow", "steps"];
  let inCandidateSection = false;

  const push = (runner: string, title?: string) => {
    const text = runner.trim();
    if (!text) return;
    const index = steps.length + 1;
    steps.push({
      id: `step-${index}`,
      title: title?.trim() || `Step ${index}`,
      runner: text,
      instruction: text,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const normalized = h2[1].trim().toLowerCase();
      inCandidateSection = sectionNames.includes(normalized);
      continue;
    }
    if (!inCandidateSection) continue;
    if (/^###\s+/.test(line)) {
      const title = line.replace(/^###\s+/, "").trim();
      if (title) {
        push(title, title);
      }
      continue;
    }
    const bullet = line.match(/^(?:-|\*|\d+\.)\s+(.+)$/);
    if (bullet) {
      push(bullet[1]);
      continue;
    }
    if (line.length > 0) {
      push(line);
    }
  }

  return steps;
}

function parseStepsFromBlocks(blocks: EditorBlock[]): StepDefinition[] {
  const candidates = blocks.filter((block) =>
    block.enabled && ["task", "constraint", "example"].includes(String(block.kind))
  );
  const steps: StepDefinition[] = [];
  for (const block of candidates) {
    const content = block.content?.trim();
    if (!content) continue;
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const title = lines[0].length > 48 ? `${lines[0].slice(0, 48)}...` : lines[0];
    steps.push({
      id: `step-${steps.length + 1}`,
      title: String(block.kind).toUpperCase(),
      runner: lines.join("\n"),
      instruction: lines.join("\n"),
    });
    if (title) {
      steps[steps.length - 1].title = title;
    }
  }
  return steps;
}

function toYamlBlockLines(value: string, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines = value.split(/\r?\n/);
  if (lines.length === 0) return [`${pad}`];
  return lines.map((line) => `${pad}${line}`);
}

function toYamlInlineValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const time = Date.now().toString(36);
  const ticks = typeof performance !== "undefined" ? Math.floor(performance.now()).toString(36) : "0";
  return `session-${time}-${ticks}`;
}

function createMessageId(): string {
  return `msg-${createSessionId()}`;
}

function revokeAttachmentPreviewUrl(attachment: InputAttachment) {
  if (!attachment.previewUrl?.startsWith("blob:")) return;
  URL.revokeObjectURL(attachment.previewUrl);
}

async function buildAttachmentFromFile(
  file: File,
  kind: InputAttachment["kind"]
): Promise<InputAttachment> {
  const base: InputAttachment = {
    id: createMessageId(),
    kind,
    name: file.name,
    mimeType: file.type || undefined,
  };

  if (kind === "image") {
    return {
      ...base,
      previewUrl: URL.createObjectURL(file),
    };
  }

  return {
    ...base,
    content: await file.text(),
  };
}

function createUiBlockRequest(type: UiBlockRequest["type"]): UiBlockRequest {
  if (type === "hotel-cards") {
    return { id: createMessageId(), type, variant: "blue" };
  }
  if (type === "train-map") {
    return { id: createMessageId(), type, source: "ivan" };
  }
  return { id: createMessageId(), type };
}

function buildAssistantUiBlockRenders(requests: UiBlockRequest[]): UiBlockRender[] {
  return requests.map((request) => {
    if (request.type === "hotel-cards") {
      return {
        id: `render-${request.id}`,
        type: request.type,
        props: {
          variant: request.variant ?? "default",
          hotels: [
            { name: "Central Stay", price: "$180", rating: "4.6" },
            { name: "River View Suites", price: "$220", rating: "4.8" },
            { name: "Old Town Lodge", price: "$145", rating: "4.3" },
          ],
        },
      };
    }

    if (request.type === "train-map") {
      return {
        id: `render-${request.id}`,
        type: request.type,
        props: {
          source: request.source ?? "default",
          route: "Central Station -> Airport Terminal",
          lines: ["S1", "RE7"],
        },
      };
    }

    return {
      id: `render-${request.id}`,
      type: request.type,
      props: {
        items: [
          "Morning: city center walk",
          "Afternoon: museum district",
          "Evening: riverside dinner",
        ],
      },
    };
  });
}

function validateCompiledDefinition(definition: AgentDefinition): CompileValidationResult {
  const issues: CompileIssue[] = [];
  const addIssue = (level: CompileIssue["level"], code: string, message: string) => {
    issues.push({ level, code, message });
  };

  if (!definition.sourceMarkdown.trim()) {
    addIssue("error", "SOURCE_EMPTY", "Source markdown is empty.");
  }
  if (definition.steps.length === 0 && /(?:^|\n)##\s*Step\b/i.test(definition.sourceMarkdown)) {
    addIssue("error", "STRUCTURED_STEPS_MISSING", "Prompt contains step prose but no structured steps were compiled.");
  }

  const seenStepTitles = new Set<string>();
  for (const [index, step] of definition.steps.entries()) {
    const title = step.title?.trim() || "";
    const runner = step.runner?.trim() || "";
    if (!runner) {
      addIssue("error", "STEP_RUNNER_MISSING", `Step ${index + 1} is missing a runner block.`);
    }
    if (title) {
      const key = title.toLowerCase();
      if (seenStepTitles.has(key)) {
        addIssue("warning", "STEP_TITLE_DUPLICATE", `Duplicate step title: "${title}".`);
      } else {
        seenStepTitles.add(key);
      }
    }
  }

  const seenServerNames = new Set<string>();
  const seenCanonicalIds = new Set<string>();
  for (const [index, server] of definition.mcpServers.entries()) {
    const name = server.name.trim();
    const declaredId = (server.id || server.name).trim();
    const canonicalId = normalizeCompiledMcpId(declaredId) ?? normalizeCompiledMcpId(name);
    if (!name) {
      addIssue("error", "MCP_NAME_MISSING", `MCP server ${index + 1} is missing a name.`);
    }
    if (!canonicalId) {
      addIssue(
        "warning",
        "MCP_ID_UNKNOWN",
        `MCP server "${name || declaredId || `#${index + 1}`}" is unknown. Use one of: ${CANONICAL_RUNTIME_MCP_IDS.join(", ")}.`
      );
    } else {
      if (seenCanonicalIds.has(canonicalId)) {
        addIssue("warning", "MCP_ID_DUPLICATE", `Duplicate MCP server id: "${canonicalId}".`);
      } else {
        seenCanonicalIds.add(canonicalId);
      }
    }
    if (name) {
      const key = name.toLowerCase();
      if (seenServerNames.has(key)) {
        addIssue("warning", "MCP_NAME_DUPLICATE", `Duplicate MCP server name: "${name}".`);
      } else {
        seenServerNames.add(key);
      }
    }
  }

  if (definition.outputContract) {
    if (!definition.outputContract.name.trim()) {
      addIssue("error", "OUTPUT_CONTRACT_NAME_MISSING", "Output contract name is missing.");
    }
    if (definition.outputContract.format === "json" && definition.outputContract.fields.length === 0) {
      addIssue("warning", "OUTPUT_FIELDS_EMPTY", "JSON output contract has no fields.");
    }
    const seenFieldNames = new Set<string>();
    for (const field of definition.outputContract.fields) {
      const key = field.name.trim().toLowerCase();
      if (!key) {
        addIssue("error", "OUTPUT_FIELD_NAME_MISSING", "Output contract has a field with missing name.");
        continue;
      }
      if (seenFieldNames.has(key)) {
        addIssue("warning", "OUTPUT_FIELD_DUPLICATE", `Duplicate output field: "${field.name}".`);
      } else {
        seenFieldNames.add(key);
      }
    }
  }

  return {
    isValid: issues.every((issue) => issue.level !== "error"),
    issues,
  };
}

function buildAdkYaml(definition: AgentDefinition, compiledPrompt: string): string {
  const lines: string[] = [];

  lines.push('version: "v1"');
  lines.push("");
  lines.push("agent:");
  lines.push("  prompt: |");
  lines.push(...toYamlBlockLines(compiledPrompt, 4));

  if (definition.steps.length > 0) {
    lines.push("");
    lines.push("  steps:");
    for (const step of definition.steps) {
      lines.push(`    - id: ${toYamlInlineValue(step.id)}`);
      if (step.title?.trim()) {
        lines.push(`      title: ${toYamlInlineValue(step.title.trim())}`);
      }
      if (step.before?.trim()) {
        lines.push("      before: |");
        lines.push(...toYamlBlockLines(step.before, 8));
      }
      lines.push("      runner: |");
      lines.push(...toYamlBlockLines(step.runner || "", 8));
      if (step.after?.trim()) {
        lines.push("      after: |");
        lines.push(...toYamlBlockLines(step.after, 8));
      }
      if (step.if_success?.trim()) {
        lines.push("      if_success: |");
        lines.push(...toYamlBlockLines(step.if_success, 8));
      }
      if (step.if_error?.trim()) {
        lines.push("      if_error: |");
        lines.push(...toYamlBlockLines(step.if_error, 8));
      }
    }
  }

  if (definition.mcpServers.length > 0) {
    lines.push("");
    lines.push("  mcp_servers:");
    for (const server of definition.mcpServers) {
      lines.push(`    - id: ${toYamlInlineValue(server.id)}`);
      lines.push(`      name: ${toYamlInlineValue(server.name)}`);
      if (server.description) lines.push(`      description: ${toYamlInlineValue(server.description)}`);
      if (server.command) lines.push(`      command: ${toYamlInlineValue(server.command)}`);
      if (server.url) lines.push(`      url: ${toYamlInlineValue(server.url)}`);
    }
  }

  if (definition.outputContract) {
    lines.push("");
    lines.push("  output_contract:");
    lines.push(`    name: ${toYamlInlineValue(definition.outputContract.name)}`);
    lines.push(`    format: ${toYamlInlineValue(definition.outputContract.format)}`);
    if (definition.outputContract.description) {
      lines.push(`    description: ${toYamlInlineValue(definition.outputContract.description)}`);
    }
    if (definition.outputContract.fields.length > 0) {
      lines.push("    fields:");
      for (const field of definition.outputContract.fields) {
        lines.push(`      - id: ${toYamlInlineValue(field.id)}`);
        lines.push(`        name: ${toYamlInlineValue(field.name)}`);
        lines.push(`        type: ${toYamlInlineValue(field.type)}`);
        lines.push(`        required: ${field.required ? "true" : "false"}`);
        if (field.description) {
          lines.push(`        description: ${toYamlInlineValue(field.description)}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function compileMarkdownToArtifact(markdown: string, blocks: EditorBlock[]): CompiledArtifact {
  const parsedSteps = parseStepsFromMarkdown(markdown);
  const steps = parsedSteps.length > 0 ? parsedSteps : parseStepsFromBlocks(blocks);
  const mcpServers = parseMcpServersFromMarkdown(markdown);
  const outputContract = parseOutputContractFromMarkdown(markdown);
  const definition: AgentDefinition = {
    sourceMarkdown: markdown,
    steps,
    mcpServers,
    outputContract,
  };
  const compiledPrompt = definition.sourceMarkdown;
  const adkYaml = buildAdkYaml(definition, compiledPrompt);
  const validation = validateCompiledDefinition(definition);
  console.debug("[compile] boundaries", {
    editorStepsRaw: parsedSteps.length,
    serializedSteps: steps.length,
    compiledSteps: definition.steps.length,
    generationInputSteps: definition.steps.length,
    steps: definition.steps.length,
    mcpServers: definition.mcpServers.length,
    yamlLength: adkYaml.length,
  });

  return {
    definition,
    compiledPrompt,
    compiledAt: new Date().toISOString(),
    adkYaml,
    outputContract,
    validation,
  };
}

function buildRuntimePrompt(templateMarkdown: string, userMessage: string): string {
  const template = templateMarkdown.trim();
  const runtime = userMessage.trim();

  if (template.includes(USER_INPUT_MARKER)) {
    return template.split(USER_INPUT_MARKER).join(runtime);
  }

  const base = template.trimEnd();
  if (!base) {
    return `${FALLBACK_USER_INPUT_SECTION}\n${runtime}`;
  }

  return `${base}\n\n${FALLBACK_USER_INPUT_SECTION}\n${runtime}`;
}

const Editor = () => {
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [editorBlocks, setEditorBlocks] = useState<EditorBlock[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [appRunState, setAppRunState] = useState<AppRunState>("idle");
  const [activeCompiledArtifact, setActiveCompiledArtifact] = useState<CompiledArtifact | null>(null);
  const [activeSession, setActiveSession] = useState<AppSession | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastResultBackend, setLastResultBackend] = useState<ExecutionBackend | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [runOutput, setRunOutput] = useState("");
  const [lastMcpExecution, setLastMcpExecution] = useState<McpExecutionSummary | null>(null);
  const [lastOutputValidation, setLastOutputValidation] = useState<OutputValidationResult | null>(null);
  const [lastStructuredOutput, setLastStructuredOutput] = useState<unknown>(null);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<InputAttachment[]>([]);
  const [composerUiBlocks, setComposerUiBlocks] = useState<UiBlockRequest[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([FALLBACK_MODEL]);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODEL);
  const [rightDebugTab, setRightDebugTab] = useState<RightDebugTab>("snapshot");
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(true);
  const [runtimeBindingSummary, setRuntimeBindingSummary] = useState<RuntimeBindingSummary | null>(null);
  const [generationSummary, setGenerationSummary] = useState<AdkGenerationSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const pendingAssistantRef = useRef<{ requestId: number; messageId: string } | null>(null);
  const composerAttachmentsRef = useRef<InputAttachment[]>([]);
  const conversationMessagesRef = useRef<ConversationMessage[]>([]);
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const compiledText = useCompiledText(segments, variables);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const response = await fetch("/api/llm/stream", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as { models?: string[]; defaultModel?: string };
        const models = Array.isArray(data.models)
          ? data.models.map((value) => value.trim()).filter(Boolean)
          : [];

        if (!models.length || cancelled) return;

        setAvailableModels(models);
        setSelectedModel((prev) => {
          if (models.includes(prev)) return prev;
          if (data.defaultModel && models.includes(data.defaultModel)) return data.defaultModel;
          return models[0];
        });
      } catch {
        // Keep fallback model list when loading fails.
      }
    };

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversationMessages, runOutput]);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => {
    conversationMessagesRef.current = conversationMessages;
  }, [conversationMessages]);

  useEffect(() => {
    return () => {
      for (const attachment of composerAttachmentsRef.current) {
        revokeAttachmentPreviewUrl(attachment);
      }
      for (const message of conversationMessagesRef.current) {
        for (const attachment of message.attachments ?? []) {
          revokeAttachmentPreviewUrl(attachment);
        }
      }
    };
  }, []);

  const readApiErrorMessage = async (response: Response): Promise<string> => {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const data = (await response.json()) as { error?: string; message?: string };
        return data.error || data.message || `Request failed (${response.status})`;
      } catch {
        return `Request failed (${response.status})`;
      }
    }

    const text = await response.text();
    if (text.trim().startsWith("<!DOCTYPE html") || text.trim().startsWith("<html")) {
      return `API route error (${response.status}). Received HTML instead of JSON/text.`;
    }

    return text.trim() || `Request failed (${response.status})`;
  };

  const appendExecutionEvent = (event: ExecutionEvent) => {
    setExecutionEvents((prev) => [...prev.slice(-19), event]);
  };

  const clearComposerAttachments = () => {
    setComposerAttachments((prev) => {
      for (const attachment of prev) revokeAttachmentPreviewUrl(attachment);
      return [];
    });
  };

  const clearComposerUiBlocks = () => {
    setComposerUiBlocks([]);
  };

  const removeComposerAttachment = (attachmentId: string) => {
    setComposerAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === attachmentId);
      if (target) revokeAttachmentPreviewUrl(target);
      return prev.filter((attachment) => attachment.id !== attachmentId);
    });
  };

  const addAttachmentsFromFiles = async (
    files: FileList | null,
    kind: InputAttachment["kind"]
  ) => {
    if (!files || files.length === 0) return;
    const built = await Promise.all(Array.from(files).map((file) => buildAttachmentFromFile(file, kind)));
    setComposerAttachments((prev) => [...prev, ...built]);
  };

  const addComposerUiBlock = (type: UiBlockRequest["type"]) => {
    setComposerUiBlocks((prev) => [...prev, createUiBlockRequest(type)]);
  };

  const removeComposerUiBlock = (blockId: string) => {
    setComposerUiBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const clearConversationMessages = () => {
    setConversationMessages((prev) => {
      for (const message of prev) {
        for (const attachment of message.attachments ?? []) {
          revokeAttachmentPreviewUrl(attachment);
        }
      }
      return [];
    });
  };

  const appendConversationMessage = (message: ConversationMessage) => {
    setConversationMessages((prev) => [...prev, message]);
  };

  const updatePendingAssistantMessage = (
    requestId: number,
    updater: (message: ConversationMessage) => ConversationMessage
  ) => {
    const pending = pendingAssistantRef.current;
    if (!pending || pending.requestId !== requestId) return;
    setConversationMessages((prev) =>
      prev.map((message) => (message.id === pending.messageId ? updater(message) : message))
    );
  };

  const clearPendingAssistantMessage = (requestId: number) => {
    const pending = pendingAssistantRef.current;
    if (!pending || pending.requestId !== requestId) return;
    pendingAssistantRef.current = null;
  };

  const handleExecutionEvent = (requestId: number, event: ExecutionEvent) => {
    if (requestId !== requestIdRef.current) return;
    appendExecutionEvent(event);
    if (event.type === "token") {
      setRunOutput((prev) => prev + event.value);
      updatePendingAssistantMessage(requestId, (message) => ({
        ...message,
        content: message.content + event.value,
        status: "pending",
      }));
    }
    if (event.type === "result") {
      setRunOutput(event.value);
      updatePendingAssistantMessage(requestId, (message) => ({
        ...message,
        content: event.value,
        status: "complete",
      }));
    }
  };

  const handleStop = () => {
    const hadInFlightRequest = isRunning;
    const inFlightRequestId = requestIdRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    setIsRunning(false);
    if (hadInFlightRequest) {
      appendExecutionEvent({ type: "status", message: "Execution cancelled." });
      setRunOutput((prev) => prev || "Generation stopped.");
      updatePendingAssistantMessage(inFlightRequestId, (message) => ({
        ...message,
        status: "error",
        content: message.content || "Generation stopped.",
      }));
      clearPendingAssistantMessage(inFlightRequestId);
    }
  };

  const handleAppRunToggle = () => {
    if (appRunState === "running") {
      if (isRunning) {
        handleStop();
      }
      setActiveCompiledArtifact(null);
      setActiveSession((prev) => (prev ? { ...prev, status: "stopped" } : null));
      setAppRunState("stopped");
      setLastResultBackend(null);
      setLastMcpExecution(null);
      setLastOutputValidation(null);
      setLastStructuredOutput(null);
      setRuntimeBindingSummary(null);
      setGenerationSummary(null);
      pendingAssistantRef.current = null;
      return;
    }

    // Build and activate a compiled artifact from current editor markdown.
    const artifact = compileMarkdownToArtifact(compiledText, editorBlocks);
    setActiveCompiledArtifact(artifact);
    setRunOutput("");
    setExecutionEvents([]);
    clearConversationMessages();
    clearComposerAttachments();
    clearComposerUiBlocks();
    setAppRunState("running");
    setLastResultBackend(null);
    setLastMcpExecution(null);
    setLastOutputValidation(null);
    setLastStructuredOutput(null);
    setRuntimeBindingSummary(null);
    setGenerationSummary(null);
    pendingAssistantRef.current = null;
    setActiveSession({
      id: createSessionId(),
      startedAt: new Date().toISOString(),
      backend: EXECUTION_BACKEND,
      status: "active",
    });
    void inspectCompiledArtifactViaAdk({
      artifact: {
        compiledPrompt: artifact.compiledPrompt,
        adkYaml: artifact.adkYaml,
        outputContract: artifact.outputContract ?? artifact.definition.outputContract,
        definition: {
          steps: artifact.definition.steps,
          mcpServers: artifact.definition.mcpServers,
          outputContract: artifact.definition.outputContract,
        },
        validation: artifact.validation,
      },
    }).then((inspection) => {
      setRuntimeBindingSummary(inspection.runtimeBindingSummary);
      setGenerationSummary(inspection.generationSummary);
      appendExecutionEvent({
        type: "status",
        message: `Runtime inspect: MCP resolved ${inspection.runtimeBindingSummary.resolved}/${inspection.runtimeBindingSummary.declared}.`,
      });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to inspect compiled artifact.";
      appendExecutionEvent({ type: "error", message });
    });
  };

  const runViaDefaultStreaming = async (
    prompt: string,
    model: string,
    signal: AbortSignal,
    onEvent: (event: ExecutionEvent) => void
  ): Promise<void> => {
    onEvent({ type: "status", message: "Starting default run..." });
    const response = await fetch("/api/llm/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model }),
      signal,
    });

    if (!response.ok) {
      const message = await readApiErrorMessage(response);
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("No response stream from API.");
    }

    onEvent({ type: "status", message: "Streaming result..." });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      output += chunk;
      onEvent({ type: "token", value: chunk });
    }
    onEvent({ type: "result", value: output });
    onEvent({ type: "status", message: "Result received." });
  };

  const handleSendMessage = async () => {
    if (isRunning) return;
    if (appRunState !== "running" || activeCompiledArtifact === null) return;
    const pushSystemMessage = (content: string) => {
      appendConversationMessage({
        id: createMessageId(),
        role: "system",
        content,
        createdAt: new Date().toISOString(),
        status: "error",
      });
    };
    if (!activeSession || activeSession.status !== "active") {
      setRunOutput("Run the app to start an active session.");
      pushSystemMessage("Run the app to start an active session.");
      return;
    }
    const payload: MessagePayload = {
      text: runtimeMessage.trim(),
      attachments: composerAttachments,
      uiBlocks: composerUiBlocks,
    };

    if (!activeCompiledArtifact.compiledPrompt.trim()) {
      setRunOutput("Add prompt content first, click Run, then send.");
      pushSystemMessage("Add prompt content first, click Run, then send.");
      return;
    }
    if (!activeCompiledArtifact.validation.isValid) {
      setRunOutput("Compile errors detected. Fix issues and click Run again before sending.");
      pushSystemMessage("Compile errors detected. Fix issues and click Run again before sending.");
      return;
    }
    if (!payload.text && payload.attachments.length === 0 && payload.uiBlocks.length === 0) {
      setRunOutput("Type a message, add a UI block, or attach a file before sending.");
      pushSystemMessage("Type a message, add a UI block, or attach a file before sending.");
      return;
    }

    const serializedUserInput = serializeMessagePayloadForExecution(payload);
    const finalPrompt = buildRuntimePrompt(activeCompiledArtifact.compiledPrompt, serializedUserInput);
    const abortController = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current = abortController;
    const userMessageId = createMessageId();
    const assistantMessageId = createMessageId();
    const messageAttachments = payload.attachments.map((attachment) => ({ ...attachment }));
    const requestedUiBlocks = payload.uiBlocks.map((block) => ({ ...block }));
    const assistantUiBlockRenders = buildAssistantUiBlockRenders(requestedUiBlocks);
    pendingAssistantRef.current = { requestId, messageId: assistantMessageId };

    setIsRunning(true);
    setRunOutput("");
    setRuntimeMessage("");
    setComposerAttachments([]);
    setComposerUiBlocks([]);
    setExecutionEvents([]);
    setLastMcpExecution(null);
    setLastOutputValidation(null);
    setLastStructuredOutput(null);
    setConversationMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        content: payload.text,
        createdAt: new Date().toISOString(),
        attachments: messageAttachments,
        requestedUiBlocks,
        status: "complete",
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        backend: activeSession.backend,
        status: "pending",
      },
    ]);
    handleExecutionEvent(requestId, { type: "status", message: `Session ${activeSession.id.slice(-6)} active.` });

    try {
      if (EXECUTION_BACKEND === "adk") {
        try {
          const adkResult: AdkRunResult = await runViaAdk({
            artifact: {
              compiledPrompt: activeCompiledArtifact.compiledPrompt,
              adkYaml: activeCompiledArtifact.adkYaml,
              outputContract: activeCompiledArtifact.outputContract ?? activeCompiledArtifact.definition.outputContract,
              definition: {
                steps: activeCompiledArtifact.definition.steps,
                mcpServers: activeCompiledArtifact.definition.mcpServers,
                outputContract: activeCompiledArtifact.definition.outputContract,
              },
            },
            userPayload: payload,
            sessionId: activeSession.id,
            signal: abortController.signal,
            onEvent: (event) => handleExecutionEvent(requestId, event),
          });
          if (requestId === requestIdRef.current) {
            setRunOutput(adkResult.output);
            setLastMcpExecution(adkResult.mcpExecution ?? null);
            setLastOutputValidation(adkResult.outputValidation ?? null);
            setLastStructuredOutput(adkResult.structuredOutput ?? null);
            setRuntimeBindingSummary(adkResult.runtimeBindingSummary ?? runtimeBindingSummary);
            setGenerationSummary(adkResult.generationSummary ?? generationSummary);
            setLastResultBackend("adk");
            setActiveSession((prev) => (prev ? { ...prev, backend: "adk", status: "active" } : prev));
            updatePendingAssistantMessage(requestId, (pendingMessage) => ({
              ...pendingMessage,
              backend: "adk",
              status: "complete",
              content: pendingMessage.content || adkResult.output,
              renderedUiBlocks: assistantUiBlockRenders,
            }));
            clearPendingAssistantMessage(requestId);
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;

          if (error instanceof AdkRunError && error.fallbackRecommended) {
            handleExecutionEvent(requestId, { type: "status", message: "ADK unavailable. Falling back to default backend..." });
            await runViaDefaultStreaming(
              finalPrompt,
              selectedModel,
              abortController.signal,
              (event) => handleExecutionEvent(requestId, event)
            );
            if (requestId === requestIdRef.current) {
              setLastResultBackend("default");
              setLastMcpExecution(null);
              setLastOutputValidation(null);
              setLastStructuredOutput(null);
              setActiveSession((prev) => (prev ? { ...prev, backend: "default", status: "active" } : prev));
              updatePendingAssistantMessage(requestId, (pendingMessage) => ({
                ...pendingMessage,
                backend: "default",
                status: "complete",
                renderedUiBlocks: assistantUiBlockRenders,
              }));
              clearPendingAssistantMessage(requestId);
            }
          } else {
            throw error;
          }
        }
      } else {
        await runViaDefaultStreaming(
          finalPrompt,
          selectedModel,
          abortController.signal,
          (event) => handleExecutionEvent(requestId, event)
        );
        if (requestId === requestIdRef.current) {
          setLastResultBackend("default");
          setLastMcpExecution(null);
          setLastOutputValidation(null);
          setLastStructuredOutput(null);
          setActiveSession((prev) => (prev ? { ...prev, backend: "default", status: "active" } : prev));
          updatePendingAssistantMessage(requestId, (pendingMessage) => ({
            ...pendingMessage,
            backend: "default",
            status: "complete",
            renderedUiBlocks: assistantUiBlockRenders,
          }));
          clearPendingAssistantMessage(requestId);
        }
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        appendExecutionEvent({ type: "status", message: "Execution cancelled." });
        setRunOutput((prev) => prev || "Generation stopped.");
        updatePendingAssistantMessage(requestId, (pendingMessage) => ({
          ...pendingMessage,
          status: "error",
          content: pendingMessage.content || "Generation stopped.",
        }));
        clearPendingAssistantMessage(requestId);
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to run request.";
      const compact = message.length > 300 ? `${message.slice(0, 300)}...` : message;
      appendExecutionEvent({ type: "error", message: compact });
      setRunOutput(`Run failed: ${compact}`);
      updatePendingAssistantMessage(requestId, (pendingMessage) => ({
        ...pendingMessage,
        status: "error",
        content: pendingMessage.content || `Run failed: ${compact}`,
      }));
      clearPendingAssistantMessage(requestId);
      if (lastResultBackend === null) {
        setLastResultBackend(EXECUTION_BACKEND);
      }
      setLastMcpExecution(null);
      setLastOutputValidation(null);
      setLastStructuredOutput(null);
    } finally {
      if (requestId === requestIdRef.current) {
        if (abortRef.current === abortController) {
          abortRef.current = null;
        }
        setIsRunning(false);
      }
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (appRunState !== "running" || activeCompiledArtifact === null) return;
    if (!activeSession || activeSession.status !== "active") return;
    if (isRunning) return;
    void handleSendMessage();
  };

  const isAppRunning = appRunState === "running";
  const hasActiveSession = activeSession?.status === "active";
  const isComposerDisabled = !(isAppRunning && activeCompiledArtifact !== null && hasActiveSession);
  const compileIssues = activeCompiledArtifact?.validation.issues ?? [];
  const compileErrorCount = compileIssues.filter((issue) => issue.level === "error").length;
  const compileWarningCount = compileIssues.filter((issue) => issue.level === "warning").length;
  const hasCompileErrors = compileErrorCount > 0;
  const hasRuntimeInspection = runtimeBindingSummary !== null;
  const runtimeDeclaredMcpCount = runtimeBindingSummary?.declared ?? 0;
  const runtimeBoundMcpCount = runtimeBindingSummary?.resolved ?? 0;
  const runtimeUnavailableMcpCount = runtimeBindingSummary?.unavailable ?? 0;
  const runtimeUnknownMcpCount = runtimeBindingSummary?.unknown ?? 0;
  const runtimeBindingItems = runtimeBindingSummary?.items ?? [];
  const runtimePlanWarnings = runtimeBindingSummary?.warnings ?? [];
  const generatedWarnings = generationSummary?.warnings ?? [];
  const mcpExecutionRecords = lastMcpExecution?.records ?? [];
  const outputContract = activeCompiledArtifact
    ? (activeCompiledArtifact.outputContract ?? activeCompiledArtifact.definition.outputContract ?? null)
    : null;
  const outputContractSummary = outputContract
    ? `${outputContract.format} (${outputContract.name}) • fields: ${outputContract.fields.length}`
    : "none";
  const outputValidationIssues = lastOutputValidation?.issues ?? [];
  const outputValidationSummary = !lastOutputValidation
    ? "not validated yet"
    : lastOutputValidation.isValid
      ? "valid"
      : `invalid (${outputValidationIssues.length} issue${outputValidationIssues.length === 1 ? "" : "s"})`;
  const validationSummary = !activeCompiledArtifact
    ? "Validation: not compiled"
    : hasCompileErrors
      ? `Validation: ${compileErrorCount} error${compileErrorCount === 1 ? "" : "s"}${compileWarningCount > 0 ? `, ${compileWarningCount} warning${compileWarningCount === 1 ? "" : "s"}` : ""}`
      : compileWarningCount > 0
        ? `Validation: ${compileWarningCount} warning${compileWarningCount === 1 ? "" : "s"}`
        : "Validation: OK";
  const composerHint = appRunState === "dirty"
    ? "Changes detected. Run again to apply them."
    : appRunState === "stopped"
      ? "The app is stopped. Run it again to continue."
      : !isAppRunning
        ? "Run the app to start chatting."
      : !hasActiveSession
        ? "Run the app to start an active session."
        : "Run the app to start chatting.";
  const canSend = hasActiveSession
    && !hasCompileErrors
    && (runtimeMessage.trim().length > 0 || composerAttachments.length > 0 || composerUiBlocks.length > 0)
    && (activeCompiledArtifact?.compiledPrompt.trim().length ?? 0) > 0;
  const isRunButtonInStopMode = isAppRunning;
  const lifecycleLabel = appRunState === "running"
    ? "Running"
    : appRunState === "dirty"
      ? "Dirty"
      : appRunState === "stopped"
        ? "Stopped"
        : "Idle";
  const lifecycleBadgeClass = appRunState === "running"
    ? "border-[#86efac] bg-[#dcfce7] text-[#166534]"
    : appRunState === "dirty"
      ? "border-[#fcd34d] bg-[#fef3c7] text-[#92400e]"
      : appRunState === "stopped"
        ? "border-[#d1d5db] bg-[#f3f4f6] text-[#374151]"
        : "border-[#d1d5db] bg-white text-[#4b5563]";
  const runButtonLabel = appRunState === "running"
    ? "Stop"
    : appRunState === "dirty"
      ? "Run again"
      : "Run";
  const stepsCount = activeCompiledArtifact?.definition.steps?.length ?? 0;
  const mcpServersCount = activeCompiledArtifact?.definition.mcpServers.length ?? 0;
  const visibleExecutionEvents = executionEvents.slice(-6);
  const runtimeOutputSummary = outputContract
    ? `${outputContract.format} (${outputContract.name})`
    : "text";
  const backendForDisplay = (isRunning ? EXECUTION_BACKEND : (lastResultBackend ?? EXECUTION_BACKEND)).toUpperCase();
  const sessionState = activeSession?.status ?? (appRunState === "stopped" ? "stopped" : "idle");
  const sessionLabel = sessionState === "active" ? "Active" : sessionState === "stopped" ? "Stopped" : "Idle";
  const sessionSuffix = activeSession ? ` #${activeSession.id.slice(-6)}` : "";
  const conversationEmptyMessage = hasActiveSession
    ? "The app is running. Send a message to begin."
    : appRunState === "stopped"
      ? "Session stopped. Run again to continue this workflow."
      : "Run the app to start chatting.";
  const renderUiBlock = (block: UiBlockRender) => {
    if (block.type === "hotel-cards") {
      const hotels = Array.isArray(block.props.hotels)
        ? (block.props.hotels as Array<{ name?: string; price?: string; rating?: string }>)
        : [];
      return (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#2563eb]">
            Hotel Cards {typeof block.props.variant === "string" ? `(${block.props.variant})` : ""}
          </p>
          <div className="grid gap-2">
            {hotels.map((hotel, index) => (
              <div key={`${block.id}-${index}`} className="rounded border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1.5">
                <p className="text-xs font-medium text-[#1e3a8a]">{hotel.name ?? "Hotel option"}</p>
                <p className="text-[11px] text-[#1d4ed8]">{hotel.price ?? ""} {hotel.rating ? `• rating ${hotel.rating}` : ""}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (block.type === "train-map") {
      return (
        <div className="rounded border border-[#c7d2fe] bg-[#eef2ff] px-2 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#4338ca]">
            Train Map {typeof block.props.source === "string" ? `(${block.props.source})` : ""}
          </p>
          <p className="text-xs text-[#3730a3]">{typeof block.props.route === "string" ? block.props.route : "Route preview"}</p>
          {Array.isArray(block.props.lines) && (
            <p className="mt-1 text-[11px] text-[#4f46e5]">
              Lines: {(block.props.lines as string[]).join(", ")}
            </p>
          )}
        </div>
      );
    }

    const items = Array.isArray(block.props.items) ? (block.props.items as string[]) : [];
    return (
      <div className="rounded border border-[#d1fae5] bg-[#ecfdf5] px-2 py-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#047857]">Itinerary List</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-[#065f46]">
          {items.map((item, index) => (
            <li key={`${block.id}-${index}`}>{item}</li>
          ))}
        </ol>
      </div>
    );
  };

  return (<div className="min-h-screen">
    <main className="pt-24 pb-24">
    <section className="border-b border-border py-12">
        <Container className="max-w-4xl">
          <p className="mb-4 text-xs font-mono-app uppercase tracking-[0.24em] text-primary">Prompt editor — demo</p>
          <h1 className="mb-6 text-4xl font-bold tracking-display md:text-5xl text-balance leading-[1.1]">
            Use real logic to produce your prompts, without leaving the editor.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl text-pretty mb-6">
            The PromptFarm editor treats prompts as structured documents — with typed variables, composable blocks, and live compilation. Write once, run anywhere.
          </p>
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-text-tertiary font-mono-app">
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Typed input variables</li>
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Live compiled output</li>
            <li className="flex items-center gap-2"><span className="text-primary">→</span> MCP tool integration</li>
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Structured step execution</li>
          </ul>
        </Container>
      </section>
      <section className="py-0">
        <Container className="max-w-6xl overflow-hidden rounded-xl border border-[#d8dbe2] bg-[#f3f4f6] md:grid md:grid-cols-2 md:h-[calc(100dvh-12rem)]">
          <div className="relative flex min-h-[420px] flex-col border-b border-[#d8dbe2] md:h-full md:min-h-0 md:border-b-0 md:border-r"
            onPointerDownCapture={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("input,textarea,button,a,[role='button'],[contenteditable='true']")) return;

              const wrapper = e.currentTarget as HTMLElement;
              const root = wrapper.querySelector<HTMLElement>(".pe-root");
              if (!root) return;

              requestAnimationFrame(() => {
                // PromptEditor focuses through its own root onClick handler.
                root.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

                // Fallback for environments where synthetic click doesn't move DOM focus.
                const editable = root.querySelector<HTMLElement>(".ProseMirror, .tiptap");
                if (editable && document.activeElement !== editable) {
                  editable.focus({ preventScroll: true });
                }
              });
            }}
          >
            <div className="absolute right-3 top-[5px] z-20 flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2 py-1 text-[11px] font-medium leading-none",
                  lifecycleBadgeClass,
                )}
              >
                {lifecycleLabel}
              </span>
              <Button
                type="button"
                size="sm"
                variant={isRunButtonInStopMode ? "outline" : "default"}
                onClick={handleAppRunToggle}
                className={cn(
                  "h-8 rounded-full px-3",
                  !isRunButtonInStopMode && "bg-[#2ED3A8] text-[#0b1f1a] hover:bg-[#2ED3A8]/90",
                )}
                title={
                  isRunButtonInStopMode
                    ? "Stop app"
                    : "Run app"
                }
                aria-label={isRunButtonInStopMode ? "Stop app run state" : "Run app"}
              >
                {runButtonLabel}
              </Button>
            </div>
            <VariablesBar
              variables={variables}
              onChange={setVariables}
              className="shrink-0 border-b border-[#d8dbe2] pr-48 !bg-[#f3f4f6]"
            />
            <PromptEditor
              onChange={(_text, blocks, segs) => {
                setEditorBlocks(blocks);
                setSegments(segs);
                setAppRunState((prev) => (prev === "running" ? "dirty" : prev));
                setActiveSession((prev) => (prev?.status === "active" ? { ...prev, status: "idle" } : prev));
              }}
              className="min-h-0 flex-1 !bg-[#f3f4f6]"
            />
          </div>
          <div className="flex min-h-[420px] flex-col md:h-full md:min-h-0">
            <div className="shrink-0 border-b border-[#d8dbe2] px-4 !h-[44px] flex items-center justify-between gap-3">
              <h2 className="font-bold text-[#111827] tracking-display">Compiled Prompt</h2>
              <span className="text-xs font-mono-app text-[#4b5563]">
                {selectedModel} • Backend: {backendForDisplay} • Session: {sessionLabel}{sessionSuffix}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-4 flex flex-col gap-3">

             {/*<CompiledOutput
                compiledPrompt={compiledText}
                className="border-l border-gray-200"
              />*/}

              <div
                ref={outputRef}
                className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#d8dbe2] bg-[#f8f9fb] px-3 py-3 whitespace-pre-wrap text-sm text-[#111827]"
              >
                {conversationMessages.length === 0 ? (
                  <p className="text-sm text-[#6b7280]">{runOutput || conversationEmptyMessage}</p>
                ) : (
                  <div className="space-y-3">
                    {conversationMessages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "max-w-[92%] rounded-lg border px-3 py-2",
                          message.role === "user"
                            ? "ml-auto border-[#a7f3d0] bg-[#ecfdf5]"
                            : message.role === "assistant"
                              ? "border-[#dbe4ff] bg-white"
                              : "border-[#fca5a5] bg-[#fff1f2]"
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-[#6b7280]">
                          <span className="uppercase tracking-[0.12em]">
                            {message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System"}
                          </span>
                          <span>
                            {message.status === "pending" ? "Pending" : message.status === "error" ? "Error" : "Complete"}
                            {message.backend ? ` • ${message.backend.toUpperCase()}` : ""}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-[#111827]">
                          {message.content
                            || ((message.attachments?.length ?? 0) > 0 ? "Attachment message." : "")
                            || ((message.requestedUiBlocks?.length ?? 0) > 0 ? "UI block request." : "")
                            || (message.status === "pending" ? "Thinking..." : "")}
                        </p>
                        {message.requestedUiBlocks && message.requestedUiBlocks.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.requestedUiBlocks.map((block) => (
                              <span
                                key={block.id}
                                className="inline-flex items-center rounded border border-[#dbeafe] bg-[#eff6ff] px-2 py-1 text-[11px] text-[#1d4ed8]"
                              >
                                {block.type}
                                {block.variant ? ` • variant=${block.variant}` : ""}
                                {block.source ? ` • source=${block.source}` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="inline-flex items-center gap-2 rounded border border-[#d8dbe2] bg-[#f8f9fb] px-2 py-1 text-[11px] text-[#374151]"
                              >
                                {attachment.kind === "image" && attachment.previewUrl ? (
                                  <Image
                                    src={attachment.previewUrl}
                                    alt={attachment.name}
                                    width={32}
                                    height={32}
                                    unoptimized
                                    className="h-8 w-8 rounded object-cover"
                                  />
                                ) : attachment.kind === "json" ? (
                                  <Braces className="h-3 w-3 shrink-0" />
                                ) : (
                                  <FileText className="h-3 w-3 shrink-0" />
                                )}
                                <span className="max-w-[160px] truncate">{attachment.name}</span>
                                <span className="text-[#6b7280]">{attachment.kind}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {message.renderedUiBlocks && message.renderedUiBlocks.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {message.renderedUiBlocks.map((block) => (
                              <div key={block.id}>{renderUiBlock(block)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Collapsible
                open={isDebugPanelOpen}
                onOpenChange={setIsDebugPanelOpen}
                className="shrink-0 rounded-lg border border-[#d8dbe2] bg-[#f8f9fb]"
              >
                <div className="flex items-center justify-between border-b border-[#d8dbe2] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-[#d8dbe2] bg-white px-2 py-1 text-[11px] text-[#374151]"
                      >
                        {isDebugPanelOpen ? "Hide" : "Show"}
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            isDebugPanelOpen && "rotate-180"
                          )}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <p className="text-xs font-mono-app uppercase tracking-[0.15em] text-[#4b5563]">
                      Snapshot / Execution / ADK YAML
                    </p>
                  </div>
                  {appRunState === "dirty" && (
                    <span className="text-[11px] text-[#b45309]">Outdated</span>
                  )}
                </div>
                <CollapsibleContent>
                  <Tabs
                    value={rightDebugTab}
                    onValueChange={(value) => setRightDebugTab(value as RightDebugTab)}
                    className="w-full"
                  >
                    <div className="border-b border-[#d8dbe2] px-3 py-2">
                      <TabsList className="grid h-8 w-full grid-cols-3">
                        <TabsTrigger value="snapshot" className="px-2 text-[11px]">Snapshot</TabsTrigger>
                        <TabsTrigger value="execution" className="px-2 text-[11px]">Execution</TabsTrigger>
                        <TabsTrigger value="adk-yaml" className="px-2 text-[11px]">ADK YAML</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="snapshot" className="m-0 px-3 py-2">
                  {activeCompiledArtifact ? (
                    <div className="space-y-2 text-[11px] text-[#4b5563]">
                      <p>Compiled at {activeCompiledArtifact.compiledAt} • Steps: {stepsCount} • MCP declared: {mcpServersCount}</p>
                      {hasRuntimeInspection ? (
                        <p>Runtime binding • declared: {runtimeDeclaredMcpCount} • resolved: {runtimeBoundMcpCount} • unavailable: {runtimeUnavailableMcpCount} • unknown: {runtimeUnknownMcpCount} • Output: {runtimeOutputSummary}</p>
                      ) : (
                        <p className="text-[#6b7280]">Runtime binding not inspected yet.</p>
                      )}
                      <p>Output contract • {outputContractSummary} • last validation: {outputValidationSummary}</p>
                      <p
                        className={cn(
                          hasCompileErrors
                            ? "text-[#b91c1c]"
                            : compileWarningCount > 0
                              ? "text-[#b45309]"
                          : "text-[#166534]"
                        )}
                      >
                        {validationSummary}
                      </p>
                      {compileIssues.length > 0 && (
                        <ul className="max-h-20 space-y-1 overflow-auto">
                          {compileIssues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              {issue.level === "error" ? "Error" : "Warning"} [{issue.code}]: {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                      {generationSummary && (
                        <p>
                          ADK generation • Agent generated: {generationSummary.agentGenerated ? "yes" : "no"} • Model: {generationSummary.model} • Tools bound: {generationSummary.toolsBound} • Tools skipped: {generationSummary.toolsSkipped} • Output key: {generationSummary.outputKey ?? "n/a"}
                        </p>
                      )}
                      {runtimeBindingItems.length > 0 && (
                        <ul className="max-h-20 space-y-1 overflow-auto">
                          {runtimeBindingItems.slice(0, 8).map((tool) => (
                            <li key={`runtime-binding-${tool.serverId}-${tool.declaredId}`}>
                              {tool.declaredId} → {tool.status}
                              {tool.reason ? ` (${tool.reason})` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#6b7280]">No active snapshot yet. Click Run to compile the app.</p>
                  )}
                </TabsContent>
                    <TabsContent value="execution" className="m-0 px-3 py-2">
                  <div className="space-y-2 text-[11px] text-[#4b5563]">
                    <div className="max-h-20 space-y-1 overflow-auto">
                      {visibleExecutionEvents.length === 0 ? (
                        <p className="text-[#6b7280]">No execution in progress.</p>
                      ) : (
                        visibleExecutionEvents.map((event, index) => (
                          <p key={`${event.type}-${index}`}>
                            {event.type === "status" && `• ${event.message}`}
                            {event.type === "error" && `Error: ${event.message}`}
                            {event.type === "token" && `Streaming token chunk (${event.value.length} chars)`}
                            {event.type === "result" && "Result finalized."}
                          </p>
                        ))
                      )}
                    </div>
                    {activeCompiledArtifact && (
                      <p>
                        MCP execution • available: {lastMcpExecution?.available ?? 0} • invoked: {lastMcpExecution?.invoked ?? 0} • failed: {lastMcpExecution?.failed ?? 0} • skipped: {lastMcpExecution?.skipped ?? 0}
                      </p>
                    )}
                    {runtimePlanWarnings.length > 0 && (
                      <ul className="max-h-20 space-y-1 overflow-auto text-[#92400e]">
                        {runtimePlanWarnings.slice(0, 6).map((warning, index) => (
                          <li key={`runtime-warning-${index}`}>Runtime warning: {warning}</li>
                        ))}
                      </ul>
                    )}
                    {generatedWarnings.length > 0 && (
                      <ul className="max-h-20 space-y-1 overflow-auto text-[#92400e]">
                        {generatedWarnings.slice(0, 6).map((warning, index) => (
                          <li key={`generation-warning-${index}`}>Generation warning: {warning}</li>
                        ))}
                      </ul>
                    )}
                    {mcpExecutionRecords.length > 0 && (
                      <ul className="max-h-20 space-y-1 overflow-auto">
                        {mcpExecutionRecords.slice(-6).map((record) => (
                          <li key={record.id}>
                            {record.serverName} → {record.status}
                            {record.message ? ` (${record.message})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {outputValidationIssues.length > 0 && (
                      <ul className="max-h-20 space-y-1 overflow-auto text-[#92400e]">
                        {outputValidationIssues.slice(0, 6).map((issue, index) => (
                          <li key={`output-validation-${index}`}>
                            {issue.level === "error" ? "Error" : "Warning"}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {lastStructuredOutput !== null && (
                      <pre className="max-h-20 overflow-auto whitespace-pre-wrap text-[11px] text-[#374151]">
                        {JSON.stringify(lastStructuredOutput, null, 2)}
                      </pre>
                    )}
                  </div>
                    </TabsContent>
                    <TabsContent value="adk-yaml" className="m-0 px-3 py-2">
                  {activeCompiledArtifact ? (
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-[#374151]">
                      {activeCompiledArtifact.adkYaml || "No YAML generated."}
                    </pre>
                  ) : (
                    <p className="text-xs text-[#6b7280]">No active app snapshot. Click Run to compile the app.</p>
                  )}
                    </TabsContent>
                  </Tabs>
                </CollapsibleContent>
              </Collapsible>
            </div>
            <div className="shrink-0 border-t border-[#d8dbe2] bg-[#f3f4f6] px-3 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isComposerDisabled}
                      className="h-9 rounded-md border border-[#d8dbe2] bg-white px-3 text-sm text-[#111827] inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      aria-label="Upload options"
                    >
                      <Paperclip className="h-4 w-4" />
                      Upload
                      <ChevronDown className="h-4 w-4 text-[#6b7280]" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      disabled={isComposerDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (isComposerDisabled) return;
                        textFileInputRef.current?.click();
                      }}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Attach text file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isComposerDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (isComposerDisabled) return;
                        jsonFileInputRef.current?.click();
                      }}
                    >
                      <Braces className="mr-2 h-4 w-4" />
                      Attach JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isComposerDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (isComposerDisabled) return;
                        imageFileInputRef.current?.click();
                      }}
                    >
                      <Paperclip className="mr-2 h-4 w-4" />
                      Attach image
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isComposerDisabled}
                      className="h-9 rounded-md border border-[#d8dbe2] bg-white px-3 text-sm text-[#111827] inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      aria-label="Insert UI block"
                    >
                      <Plus className="h-4 w-4" />
                      Insert block
                      <ChevronDown className="h-4 w-4 text-[#6b7280]" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      disabled={isComposerDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (isComposerDisabled) return;
                        addComposerUiBlock("hotel-cards");
                      }}
                    >
                      Hotel cards (blue)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isComposerDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (isComposerDisabled) return;
                        addComposerUiBlock("train-map");
                      }}
                    >
                      Train map (source=ivan)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isComposerDisabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (isComposerDisabled) return;
                        addComposerUiBlock("itinerary-list");
                      }}
                    >
                      Itinerary list
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <input
                  ref={textFileInputRef}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown,text/*"
                  multiple
                  className="hidden"
                  onChange={async (event) => {
                    await addAttachmentsFromFiles(event.target.files, "text-file");
                    event.target.value = "";
                  }}
                />
                <input
                  ref={jsonFileInputRef}
                  type="file"
                  accept=".json,application/json,text/json"
                  multiple
                  className="hidden"
                  onChange={async (event) => {
                    await addAttachmentsFromFiles(event.target.files, "json");
                    event.target.value = "";
                  }}
                />
                <input
                  ref={imageFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (event) => {
                    await addAttachmentsFromFiles(event.target.files, "image");
                    event.target.value = "";
                  }}
                />

                <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isComposerDisabled}>
                  <SelectTrigger className="h-9 w-[180px] border-[#d8dbe2] bg-white text-[#111827]">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isRunning && (
                  <div className="ml-auto inline-flex items-center gap-1 text-xs text-[#4b5563]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing...
                  </div>
                )}
              </div>

              {isComposerDisabled && (
                <p className="mb-2 text-xs text-[#6b7280]">{composerHint}</p>
              )}
              {!isComposerDisabled && hasCompileErrors && (
                <p className="mb-2 text-xs text-[#b91c1c]">
                  Compile errors detected. Fix them and click Run again before sending.
                </p>
              )}
              {composerUiBlocks.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {composerUiBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-md border border-[#dbeafe] bg-[#eff6ff] px-2 py-1 text-xs text-[#1d4ed8]"
                    >
                      <span>{block.type}</span>
                      {block.variant && <span>variant={block.variant}</span>}
                      {block.source && <span>source={block.source}</span>}
                      <button
                        type="button"
                        className="rounded p-0.5 text-[#1d4ed8] hover:bg-[#dbeafe] disabled:opacity-50"
                        onClick={() => removeComposerUiBlock(block.id)}
                        disabled={isRunning}
                        aria-label={`Remove ${block.type}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {composerAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {composerAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-md border border-[#d8dbe2] bg-white px-2 py-1 text-xs text-[#374151]"
                    >
                      {attachment.kind === "image" && attachment.previewUrl ? (
                        <Image
                          src={attachment.previewUrl}
                          alt={attachment.name}
                          width={32}
                          height={32}
                          unoptimized
                          className="h-8 w-8 rounded object-cover"
                        />
                      ) : attachment.kind === "json" ? (
                        <Braces className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate max-w-[180px]">{attachment.name}</span>
                      <span className="text-[#6b7280]">{attachment.kind}</span>
                      <button
                        type="button"
                        className="rounded p-0.5 text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-50"
                        onClick={() => removeComposerAttachment(attachment.id)}
                        disabled={isRunning}
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <Textarea
                  value={runtimeMessage}
                  disabled={isComposerDisabled}
                  onChange={(event) => setRuntimeMessage(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Type your runtime message... (Enter to send, Shift+Enter for newline)"
                  className="min-h-[48px] max-h-32 resize-y border-[#d8dbe2] bg-white text-[#111827] focus-visible:ring-1 focus-visible:ring-[#2ED3A8] focus-visible:ring-offset-0"
                />
                <button
                  type="button"
                  onClick={isRunning ? handleStop : () => void handleSendMessage()}
                  disabled={isComposerDisabled || (!isRunning && !canSend)}
                  className={cn(
                    "h-10 w-10 shrink-0 rounded-full text-[#0b1f1a] inline-flex items-center justify-center transition disabled:opacity-60 disabled:cursor-not-allowed",
                    isRunning
                      ? "bg-[linear-gradient(120deg,#2ED3A8,#98f3dd,#2ED3A8)] bg-[length:200%_200%] animate-send-processing"
                      : "bg-[#2ED3A8] hover:brightness-95",
                  )}
                  aria-label={isRunning ? "Stop generation" : "Send message"}
                  title={isRunning ? "Stop generation" : "Send message"}
                >
                  {isRunning ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </main>
    <SiteFooter />
  </div>)
};

export default Editor;
