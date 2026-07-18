import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";

interface OllamaGenerateResponse {
  response: string;
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export async function generateJson(prompt: string, model: string = env.OLLAMA_MODEL): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        format: "json",
        stream: false,
        // Thinking models (qwen3, deepseek-r1, ...) put ALL their output in a separate
        // `thinking` field and leave `response` empty — this helper would then always throw
        // "not valid JSON". Disabling it is also just faster on a CPU-only box, and we want
        // structured output, not chain-of-thought. Verified harmless on non-thinking models
        // (llama3.1 ignores it rather than erroring).
        think: false,
      }),
    });
  } catch {
    throw new ServiceUnavailableError(
      `Ollama not reachable at ${env.OLLAMA_BASE_URL} — start it with \`ollama serve\` and ensure \`${model}\` is pulled.`,
    );
  }

  if (!response.ok) {
    throw new ServiceUnavailableError(
      `Ollama returned an error (${response.status}) — check that \`${model}\` is pulled (\`ollama pull ${model}\`).`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  try {
    return JSON.parse(data.response);
  } catch {
    throw new ServiceUnavailableError("Ollama returned a response that was not valid JSON.");
  }
}

/**
 * Free-form text generation — no `format: "json"`, no JSON.parse. For outputs that are prose
 * (e.g. a multi-line markdown notes block), where wrapping a big multi-line string in JSON is
 * needlessly fragile. Same reachability/error handling and `think: false` as generateJson.
 */
export async function generateText(prompt: string, model: string = env.OLLAMA_MODEL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, think: false }),
    });
  } catch {
    throw new ServiceUnavailableError(
      `Ollama not reachable at ${env.OLLAMA_BASE_URL} — start it with \`ollama serve\` and ensure \`${model}\` is pulled.`,
    );
  }

  if (!response.ok) {
    throw new ServiceUnavailableError(
      `Ollama returned an error (${response.status}) — check that \`${model}\` is pulled (\`ollama pull ${model}\`).`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  return data.response;
}

/** Embeds a batch of texts. Returns one vector per input, in input order. */
export async function embed(texts: string[], model: string = env.OLLAMA_EMBED_MODEL): Promise<number[][]> {
  if (texts.length === 0) return [];

  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    });
  } catch {
    throw new ServiceUnavailableError(
      `Ollama not reachable at ${env.OLLAMA_BASE_URL} — start it with \`ollama serve\` and ensure \`${model}\` is pulled.`,
    );
  }

  if (!response.ok) {
    throw new ServiceUnavailableError(
      `Ollama returned an error (${response.status}) — check that \`${model}\` is pulled (\`ollama pull ${model}\`).`,
    );
  }

  const data = (await response.json()) as OllamaEmbedResponse;
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new ServiceUnavailableError("Ollama returned an unexpected number of embeddings.");
  }
  return data.embeddings;
}
