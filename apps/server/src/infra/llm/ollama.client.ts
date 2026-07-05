import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";

interface OllamaGenerateResponse {
  response: string;
}

export async function generateJson(prompt: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        prompt,
        format: "json",
        stream: false,
      }),
    });
  } catch {
    throw new ServiceUnavailableError(
      `Ollama not reachable at ${env.OLLAMA_BASE_URL} — start it with \`ollama serve\` and ensure \`${env.OLLAMA_MODEL}\` is pulled.`,
    );
  }

  if (!response.ok) {
    throw new ServiceUnavailableError(
      `Ollama returned an error (${response.status}) — check that \`${env.OLLAMA_MODEL}\` is pulled (\`ollama pull ${env.OLLAMA_MODEL}\`).`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  try {
    return JSON.parse(data.response);
  } catch {
    throw new ServiceUnavailableError("Ollama returned a response that was not valid JSON.");
  }
}
