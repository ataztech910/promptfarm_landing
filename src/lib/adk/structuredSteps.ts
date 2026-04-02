export type StructuredStep = {
  id: string;
  title?: string;
  before?: string;
  runner: string;
  after?: string;
  if_success?: string;
  if_error?: string;
  instruction?: string;
};

export const STEP_EXECUTION_ORDER = [
  "before",
  "runner",
  "after",
  "if_success",
  "if_error",
] as const;

type StepExecutionField = (typeof STEP_EXECUTION_ORDER)[number];

function cleanOptionalText(value?: string): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : undefined;
}

export function normalizeStructuredStep(raw: Partial<StructuredStep>, index: number): StructuredStep {
  const id = cleanOptionalText(raw.id) || `step-${index + 1}`;
  const title = cleanOptionalText(raw.title);
  const before = cleanOptionalText(raw.before);
  const after = cleanOptionalText(raw.after);
  const ifSuccess = cleanOptionalText(raw.if_success);
  const ifError = cleanOptionalText(raw.if_error);
  const legacyInstruction = cleanOptionalText(raw.instruction);
  const runner = cleanOptionalText(raw.runner) || legacyInstruction;

  if (!runner) {
    throw new Error(`Step "${id}" is missing required runner.`);
  }

  return {
    id,
    title,
    before,
    runner,
    after,
    if_success: ifSuccess,
    if_error: ifError,
    instruction: legacyInstruction,
  };
}

export function normalizeStructuredSteps(rawSteps: Partial<StructuredStep>[]): StructuredStep[] {
  return rawSteps.map((raw, index) => normalizeStructuredStep(raw, index));
}

export function getStepExecutionSegments(step: StructuredStep): Array<{ key: StepExecutionField; value: string }> {
  const segments: Array<{ key: StepExecutionField; value: string }> = [];

  for (const key of STEP_EXECUTION_ORDER) {
    const value = cleanOptionalText(step[key]);
    if (!value) continue;
    segments.push({ key, value });
  }

  return segments;
}
