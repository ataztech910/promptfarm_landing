import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const OLLAMA_MODELS = process.env.OLLAMA_MODELS ?? "";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

function getConfiguredModels(): string[] {
  const raw = [OLLAMA_MODELS, OLLAMA_MODEL]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (raw.length === 0) {
    return ["llama3.2"];
  }

  return [...new Set(raw)];
}

const CONFIGURED_MODELS = getConfiguredModels();
const DEFAULT_MODEL = CONFIGURED_MODELS[0] ?? "llama3.2";

type OllamaStreamChunk = {
  response?: string;
  done?: boolean;
  error?: string;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function enqueueChunk(line: string, controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder) {
  if (!line.trim()) return;

  let parsed: OllamaStreamChunk;
  try {
    parsed = JSON.parse(line) as OllamaStreamChunk;
  } catch {
    return;
  }

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  if (parsed.response) {
    controller.enqueue(encoder.encode(parsed.response));
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const prompt = typeof (payload as { prompt?: unknown })?.prompt === "string"
    ? ((payload as { prompt: string }).prompt ?? "").trim()
    : "";

  const requestedModel = typeof (payload as { model?: unknown })?.model === "string"
    ? ((payload as { model: string }).model ?? "").trim()
    : "";

  if (!prompt) {
    return errorResponse("`prompt` is required.", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: requestedModel || DEFAULT_MODEL,
        prompt,
        stream: true,
      }),
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown connection error";
    return errorResponse(`Could not connect to Ollama at ${OLLAMA_HOST}: ${message}`, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text();
    return errorResponse(
      `Ollama request failed (${upstream.status}). ${detail || upstream.statusText}`,
      502
    );
  }

  if (!upstream.body) {
    return errorResponse("Ollama returned an empty response stream.", 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            enqueueChunk(line, controller, encoder);
          }
        }

        if (buffer.trim()) {
          enqueueChunk(buffer, controller, encoder);
        }

        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream processing failed.";
        controller.error(new Error(message));
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  return NextResponse.json({
    models: CONFIGURED_MODELS,
    defaultModel: DEFAULT_MODEL,
    host: OLLAMA_HOST,
  });
}
