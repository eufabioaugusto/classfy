export type AiProvider = "gemini" | "openrouter" | "lovable" | "none";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function resolveAiProvider(): AiProvider {
  if (Deno.env.get("GEMINI_API_KEY")) return "gemini";
  if (Deno.env.get("OPENROUTER_API_KEY")) return "openrouter";
  if (Deno.env.get("LOVABLE_API_KEY")) return "lovable";
  return "none";
}

export function mapModelForProvider(model: string, provider: AiProvider) {
  if (provider === "gemini") {
    if (model.includes("gemini")) {
      return model.split("/").pop()?.replace("gemini-3-flash-preview", "gemini-2.5-flash") || "gemini-2.5-flash";
    }
    return "gemini-2.5-flash";
  }

  if (provider === "openrouter" || provider === "lovable") {
    return model;
  }

  return model;
}

export async function requestAiTextCompletion(options: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseMimeType?: string;
}) {
  const provider = resolveAiProvider();
  if (provider === "none") {
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }

  const temperature = options.temperature ?? 0.4;
  const maxTokens = options.maxTokens ?? 800;

  if (provider === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mapModelForProvider(options.model, provider)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: extractSystemInstruction(options.messages),
        contents: mapMessagesToGeminiContents(options.messages),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
        },
      }),
    });

    const data = await response.json();
    const text = extractGeminiText(data);
    return { provider, response, data, text };
  }

  const endpoint = provider === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const apiKey = provider === "openrouter" ? Deno.env.get("OPENROUTER_API_KEY") : Deno.env.get("LOVABLE_API_KEY");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: mapModelForProvider(options.model, provider),
      messages: options.messages,
      temperature,
      max_tokens: maxTokens,
      ...(provider === "openrouter"
        ? {
          transforms: ["middle-out"],
        }
        : {}),
    }),
  });

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim?.() || "";
  return { provider, response, data, text };
}

export async function requestAiStructuredJson<T>(options: {
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  schemaHint?: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const schemaInstruction = options.schemaHint
    ? `\nRetorne APENAS JSON válido seguindo exatamente esta estrutura:\n${options.schemaHint}`
    : "\nRetorne APENAS JSON válido sem markdown.";

  const { response, text, data, provider } = await requestAiTextCompletion({
    model: options.model,
    messages: [
      ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt } as ChatMessage] : []),
      {
        role: "user",
        content: `${options.userPrompt}${schemaInstruction}`,
      },
    ],
    temperature: options.temperature ?? 0.2,
    maxTokens: options.maxTokens ?? 1200,
    responseMimeType: "application/json",
  });

  return {
    provider,
    response,
    data,
    parsed: extractJsonObject<T>(text),
    text,
  };
}

export async function transcribeAudioWithAi(options: {
  model: string;
  prompt: string;
  audioBase64: string;
  mimeType: string;
  openRouterModel?: string;
}) {
  const provider = resolveAiProvider();
  if (provider === "none") {
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }

  if (provider === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mapModelForProvider(options.model, provider)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: options.prompt },
              {
                inlineData: {
                  mimeType: options.mimeType,
                  data: options.audioBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4000,
        },
      }),
    });

    const data = await response.json();
    const text = extractGeminiText(data);
    return { provider, response, data, text };
  }

  if (provider === "openrouter") {
    const format = mapAudioFormat(options.mimeType);
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_audio: {
          data: options.audioBase64,
          format,
        },
        model: options.openRouterModel || "openai/whisper-large-v3",
        language: "pt",
      }),
    });

    const data = await response.json();
    const text = data?.text?.trim?.() || "";
    return { provider, response, data, text };
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: mapModelForProvider(options.model, provider),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${options.mimeType};base64,${options.audioBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim?.() || "";
  return { provider, response, data, text };
}

function extractSystemInstruction(messages: ChatMessage[]) {
  const systemMessages = messages.filter((message) => message.role === "system");
  if (systemMessages.length === 0) return undefined;

  return {
    parts: systemMessages.map((message) => ({ text: message.content })),
  };
}

function mapMessagesToGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
}

function extractGeminiText(data: any) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || "")
    .join("")
    .trim() || "";
}

function extractJsonObject<T>(text: string): T {
  const normalized = text.trim();
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || normalized;
  return JSON.parse(candidate) as T;
}

function mapAudioFormat(mimeType: string) {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("m4a") || mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "wav";
}
