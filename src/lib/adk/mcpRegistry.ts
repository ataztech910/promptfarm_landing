export const CANONICAL_RUNTIME_MCP_IDS = [
  "airbnb",
  "flights",
  "booking",
  "tripadvisor",
] as const;

export type RuntimeMcpId = (typeof CANONICAL_RUNTIME_MCP_IDS)[number];

const RUNTIME_MCP_LABELS: Record<RuntimeMcpId, string> = {
  airbnb: "Airbnb",
  flights: "Flights",
  booking: "Booking",
  tripadvisor: "Tripadvisor",
};

const RUNTIME_MCP_ALIASES: Record<string, RuntimeMcpId> = {
  airbnb: "airbnb",
  "air-bnb": "airbnb",
  flights: "flights",
  flight: "flights",
  "flights-mcp": "flights",
  booking: "booking",
  "booking-hotels": "booking",
  "booking-hotel": "booking",
  "booking-mcp": "booking",
  "booking-hotels-mcp": "booking",
  tripadvisor: "tripadvisor",
  "tripadvisor-mcp": "tripadvisor",
  "trip-advisor": "tripadvisor",
  "trip-advisor-mcp": "tripadvisor",
};

export type RuntimeMcpToolset = {
  id: RuntimeMcpId;
  label: string;
  kind: "command" | "url";
  command?: string;
  args?: string[];
  url?: string;
};

export type RuntimeMcpRegistryEntry = {
  id: RuntimeMcpId;
  label: string;
  toolset: RuntimeMcpToolset | null;
  status: "available" | "unavailable";
  reason?: string;
};

export type RuntimeMcpRegistry = Record<RuntimeMcpId, RuntimeMcpRegistryEntry>;

export type ResolvedCompiledMcpBinding = {
  declaredId: string;
  canonicalId: RuntimeMcpId | null;
  status: "bound" | "unavailable" | "unknown";
  entry?: RuntimeMcpRegistryEntry;
  warning?: string;
};

export type ResolvedCompiledMcpBindings = {
  bound: RuntimeMcpRegistryEntry[];
  unresolved: string[];
  warnings: string[];
  bindings: ResolvedCompiledMcpBinding[];
};

function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function boolFromEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function readArgsJson(env: NodeJS.ProcessEnv, envKey: string, fallback: string[]): string[] {
  const raw = env[envKey];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed;
    }
  } catch {
    // Keep fallback when args json is invalid.
  }
  return fallback;
}

function hasPlaceholderArgs(args: string[]): boolean {
  return args.some((arg) => arg.includes("OWNER/REPO") || arg.includes("REPLACE_ME"));
}

function createCommandToolset(
  id: RuntimeMcpId,
  command: string,
  args: string[]
): RuntimeMcpToolset {
  return {
    id,
    label: RUNTIME_MCP_LABELS[id],
    kind: "command",
    command,
    args,
  };
}

function createUrlToolset(id: RuntimeMcpId, url: string): RuntimeMcpToolset {
  return {
    id,
    label: RUNTIME_MCP_LABELS[id],
    kind: "url",
    url,
  };
}

function resolveRuntimeToolset(
  id: RuntimeMcpId,
  env: NodeJS.ProcessEnv
): { toolset: RuntimeMcpToolset | null; reason?: string } {
  const prefix = id.toUpperCase();
  const enabled = boolFromEnv(env[`${prefix}_MCP_ENABLED`]);
  if (enabled === false) {
    return { toolset: null, reason: "Disabled by runtime configuration." };
  }

  const url = env[`${prefix}_MCP_URL`]?.trim();
  if (url) {
    return { toolset: createUrlToolset(id, url) };
  }

  if (id === "airbnb") {
    const command = env.AIRBNB_MCP_COMMAND?.trim() || "npx";
    const args = readArgsJson(env, "AIRBNB_MCP_ARGS", [
      "-y",
      "@openbnb/mcp-server-airbnb",
      "--ignore-robots-txt",
    ]);
    if (hasPlaceholderArgs(args)) {
      return { toolset: null, reason: "Configured with placeholder arguments." };
    }
    return { toolset: createCommandToolset(id, command, args) };
  }

  const command = env[`${prefix}_MCP_COMMAND`]?.trim();
  if (!command) {
    return {
      toolset: null,
      reason: `${prefix}_MCP_COMMAND or ${prefix}_MCP_URL is not configured.`,
    };
  }
  const args = readArgsJson(env, `${prefix}_MCP_ARGS`, []);
  if (hasPlaceholderArgs(args)) {
    return { toolset: null, reason: "Configured with placeholder arguments." };
  }
  return { toolset: createCommandToolset(id, command, args) };
}

export function normalizeCompiledMcpId(value?: string | null): RuntimeMcpId | null {
  if (!value) return null;
  const normalized = normalizeLookupKey(value);
  return RUNTIME_MCP_ALIASES[normalized] ?? null;
}

export function createRuntimeMcpRegistry(
  env?: NodeJS.ProcessEnv
): RuntimeMcpRegistry {
  const effectiveEnv: NodeJS.ProcessEnv = env ?? (typeof process === "undefined" ? ({} as NodeJS.ProcessEnv) : process.env);
  const registry = {} as RuntimeMcpRegistry;
  for (const id of CANONICAL_RUNTIME_MCP_IDS) {
    const { toolset, reason } = resolveRuntimeToolset(id, env as unknown as NodeJS.ProcessEnv);
    registry[id] = {
      id,
      label: RUNTIME_MCP_LABELS[id],
      toolset,
      status: toolset ? "available" : "unavailable",
      reason,
    };
  }
  return registry;
}

export function resolveCompiledMcpBindings(
  compiledMcpIds: string[],
  options?: { registry?: RuntimeMcpRegistry }
): ResolvedCompiledMcpBindings {
  const registry = options?.registry ?? createRuntimeMcpRegistry();
  const bindings: ResolvedCompiledMcpBinding[] = [];
  const bound: RuntimeMcpRegistryEntry[] = [];
  const unresolved: string[] = [];
  const warnings: string[] = [];

  for (const rawDeclared of compiledMcpIds) {
    const declaredId = rawDeclared.trim();
    const canonicalId = normalizeCompiledMcpId(declaredId);
    if (!canonicalId) {
      unresolved.push(declaredId);
      const warning = `Unknown MCP declaration "${declaredId}". Supported IDs: ${CANONICAL_RUNTIME_MCP_IDS.join(", ")}.`;
      warnings.push(warning);
      bindings.push({
        declaredId,
        canonicalId: null,
        status: "unknown",
        warning,
      });
      continue;
    }

    const entry = registry[canonicalId];
    if (entry && entry.status === "available" && entry.toolset) {
      bound.push(entry);
      bindings.push({
        declaredId,
        canonicalId,
        status: "bound",
        entry,
      });
      continue;
    }

    unresolved.push(declaredId);
    const reason = entry?.reason || "Runtime toolset is unavailable.";
    const warning = `MCP "${declaredId}" (${canonicalId}) is unavailable: ${reason}`;
    warnings.push(warning);
    bindings.push({
      declaredId,
      canonicalId,
      status: "unavailable",
      entry,
      warning,
    });
  }

  return {
    bound,
    unresolved,
    warnings: Array.from(new Set(warnings)),
    bindings,
  };
}
