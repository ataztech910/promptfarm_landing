export type OutputContractFieldType = "string" | "number" | "boolean" | "object" | "array";

export type OutputContractField = {
  id: string;
  name: string;
  type: OutputContractFieldType;
  required: boolean;
  description?: string;
};

export type OutputContract = {
  format: "text" | "json";
  name: string;
  description?: string;
  fields: OutputContractField[];
};

export type OutputValidationIssue = {
  level: "warning" | "error";
  message: string;
};

export type OutputValidationResult = {
  isValid: boolean;
  issues: OutputValidationIssue[];
  parsed?: unknown;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeFieldType(value: string): OutputContractFieldType | null {
  const lower = value.trim().toLowerCase();
  if (lower === "string") return "string";
  if (lower === "number") return "number";
  if (lower === "boolean") return "boolean";
  if (lower === "object") return "object";
  if (lower === "array") return "array";
  return null;
}

export function parseOutputContractFromMarkdown(markdown: string): OutputContract | null {
  const lines = markdown.split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => /^##\s+Output\s+Contract\s*$/i.test(line.trim()));
  if (sectionStart === -1) return null;

  let name = "output_contract";
  let description: string | undefined;
  let format: OutputContract["format"] = "json";
  const fields: OutputContractField[] = [];
  let currentField:
    | {
      name: string;
      type?: OutputContractFieldType;
      required?: boolean;
      description?: string;
    }
    | null = null;

  const pushCurrentField = () => {
    if (!currentField) return;
    const fieldName = currentField.name.trim();
    if (!fieldName) {
      currentField = null;
      return;
    }
    fields.push({
      id: `${slugify(fieldName) || "field"}-${fields.length + 1}`,
      name: fieldName,
      type: currentField.type ?? "string",
      required: currentField.required ?? true,
      description: currentField.description,
    });
    currentField = null;
  };

  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^##\s+/.test(line)) {
      pushCurrentField();
      break;
    }
    if (!line) continue;

    const nameMatch = line.match(/^Name:\s*(.+)$/i);
    if (nameMatch) {
      name = nameMatch[1].trim() || name;
      continue;
    }

    const descriptionMatch = line.match(/^Description:\s*(.+)$/i);
    if (descriptionMatch) {
      description = descriptionMatch[1].trim() || undefined;
      continue;
    }

    const formatMatch = line.match(/^Format:\s*(text|json)\s*$/i);
    if (formatMatch) {
      format = formatMatch[1].toLowerCase() as OutputContract["format"];
      continue;
    }

    const fieldHeaderMatch = line.match(/^###\s+Field:\s*(.+)$/i);
    if (fieldHeaderMatch) {
      pushCurrentField();
      currentField = { name: fieldHeaderMatch[1].trim() };
      continue;
    }

    if (currentField) {
      const fieldTypeMatch = line.match(/^Type:\s*(string|number|boolean|object|array)\s*$/i);
      if (fieldTypeMatch) {
        const type = normalizeFieldType(fieldTypeMatch[1]);
        if (type) currentField.type = type;
        continue;
      }

      const fieldRequiredMatch = line.match(/^Required:\s*(true|false|yes|no)\s*$/i);
      if (fieldRequiredMatch) {
        const flag = fieldRequiredMatch[1].toLowerCase();
        currentField.required = flag === "true" || flag === "yes";
        continue;
      }

      const fieldDescriptionMatch = line.match(/^Description:\s*(.+)$/i);
      if (fieldDescriptionMatch) {
        currentField.description = fieldDescriptionMatch[1].trim() || undefined;
        continue;
      }
    }

    // Backward-compatible fallback line syntax:
    // - field_name: string required - description
    const fieldMatch = line.match(
      /^-\s*([a-zA-Z0-9_.-]+)\s*:\s*(string|number|boolean|object|array)\s*(required|optional)?(?:\s*-\s*(.+))?$/i
    );
    if (fieldMatch) {
      const fieldName = fieldMatch[1].trim();
      const type = normalizeFieldType(fieldMatch[2]);
      if (!type) continue;
      const requirement = fieldMatch[3]?.toLowerCase();
      const fieldDescription = fieldMatch[4]?.trim() || undefined;
      fields.push({
        id: `${slugify(fieldName) || "field"}-${fields.length + 1}`,
        name: fieldName,
        type,
        required: requirement !== "optional",
        description: fieldDescription,
      });
    }
  }
  pushCurrentField();

  if (fields.length === 0 && format === "json") {
    // JSON with no fields is still valid as an open contract.
  }

  return {
    format,
    name,
    description,
    fields,
  };
}

export function inferLegacyOutputContractFromPrompt(prompt: string): OutputContract {
  const formatMatch = prompt.match(/(?:^|\n)\s*(?:output\s*format|format)\s*:\s*(json|text)\s*$/im);
  const schemaMatch = prompt.match(/(?:^|\n)\s*(?:schema|schema\s*name)\s*:\s*([^\n]+)\s*$/im);
  const format = formatMatch?.[1]?.toLowerCase() === "json" ? "json" : "text";
  const name = schemaMatch?.[1]?.trim() || "output_contract";
  return {
    format,
    name,
    fields: [],
  };
}

function extractJsonCandidate(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return trimmed;

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function isValueOfType(value: unknown, type: OutputContractFieldType): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return false;
}

export function validateOutputAgainstContract(
  output: string,
  contract?: OutputContract | null
): OutputValidationResult {
  if (!contract) {
    return {
      isValid: true,
      issues: [],
    };
  }

  if (contract.format === "text") {
    return {
      isValid: true,
      issues: [],
    };
  }

  const issues: OutputValidationIssue[] = [];
  const candidate = extractJsonCandidate(output);
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      isValid: false,
      issues: [{ level: "error", message: `Output is not valid JSON for contract "${contract.name}".` }],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    issues.push({
      level: "error",
      message: `JSON output for contract "${contract.name}" must be an object.`,
    });
    return {
      isValid: false,
      issues,
      parsed,
    };
  }

  const record = parsed as Record<string, unknown>;
  for (const field of contract.fields) {
    const hasField = Object.prototype.hasOwnProperty.call(record, field.name);
    if (!hasField) {
      if (field.required) {
        issues.push({
          level: "error",
          message: `Missing required field "${field.name}".`,
        });
      }
      continue;
    }

    if (!isValueOfType(record[field.name], field.type)) {
      issues.push({
        level: "error",
        message: `Field "${field.name}" should be ${field.type}.`,
      });
    }
  }

  return {
    isValid: issues.every((issue) => issue.level !== "error"),
    issues,
    parsed,
  };
}
