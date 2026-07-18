import type { AiResponse, ChatMessage, SelectionRecord } from "../shared/types";

type AiTask = "translate" | "define" | "chat";

export interface AiFileContext {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
  region: SelectionRecord["region"];
  source: "page-image" | "document-pdf";
}

interface GenerateArgs {
  task: AiTask;
  text: string;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  messages?: Array<Pick<ChatMessage, "role" | "content" | "selectionContexts">>;
  selection?: SelectionRecord | null;
  fileContext?: AiFileContext | null;
}

type ProviderConfig = {
  kind: "lm-studio" | "openrouter" | "openai";
  apiKey: string;
  modelName: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

const providerConfig = () => {
  const lmStudioBaseURL = process.env.LM_STUDIO_BASE_URL?.trim();
  if (lmStudioBaseURL) {
    return {
      kind: "lm-studio",
      apiKey: process.env.LM_STUDIO_API_KEY?.trim() || "lm-studio",
      modelName: process.env.LM_STUDIO_MODEL?.trim() || "google/gemma-4-26b-a4b-qat",
      baseURL: lmStudioBaseURL
    } satisfies ProviderConfig;
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    return {
      kind: "openrouter",
      apiKey: openRouterKey,
      modelName: process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Derp Reader"
      }
    } satisfies ProviderConfig;
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    return {
      kind: "openai",
      apiKey: openAiKey,
      modelName: process.env.AI_MODEL?.trim() || "gpt-4.1-mini"
    } satisfies ProviderConfig;
  }

  return null;
};

const testMock = (args: GenerateArgs): AiResponse => {
  if (args.task === "translate") {
    return {
      title: "Translation",
      content:
        args.selection?.kind === "image" && args.fileContext
          ? `Test translation using the selected ${args.fileContext.source}.`
          : `Test translation: ${args.text}`,
      provider: "none"
    };
  }
  if (args.task === "define") {
    return {
      title: "Definitions",
      content:
        args.selection?.kind === "image" && args.fileContext
          ? `Test definitions using the selected ${args.fileContext.source}.`
          : `Test definitions for: ${args.text}`,
      provider: "none"
    };
  }
  return {
    title: "AI chat",
    content:
      args.selection?.kind === "image" && args.fileContext
        ? `Test assistant using the selected ${args.fileContext.source}.`
        : args.selection?.kind === "image"
          ? "Test assistant using the selected image region metadata."
          : args.selection
            ? "Test assistant using the selected passage."
            : args.text.trim()
              ? "Test assistant using the open document."
              : "Test assistant without reading context.",
    provider: "none"
  };
};

const notConfigured = (): AiResponse => ({
  title: "AI provider not configured",
  content: "No AI provider is configured. Set LM_STUDIO_BASE_URL, OPENROUTER_API_KEY, or OPENAI_API_KEY on the Bun backend to enable translation, definitions, and chat.",
  provider: "none"
});

const taskSystemPrompt = (args: Pick<GenerateArgs, "task" | "targetLanguage">) => {
  const { task } = args;
  const base =
    "You are Derp Reader's study copilot. The UI already shows the action, so never repeat headings like Translation, Definitions, Notes, or Answer.";

  if (task === "translate") {
    return `Translate the user's text into ${args.targetLanguage?.trim() || "English"}. Output only the translation.`;
  }

  if (task === "define") {
    return `${base} Define or explain the user's exact selected text. Do not say that no selection was provided or ask for a more specific selection. Keep the answer short and useful. Prefer one compact paragraph. Do not use markdown headings, bullet lists, tables, or standalone label lines.`;
  }

  return `${base} Continue the saved chat about the open document or selected reading context. Use prior messages and preserve context. Use normal markdown when it genuinely helps: short headings, bullets, and lists are allowed. Do not split a sentence into heading fragments or standalone label lines; headings must be real section titles, not words from the sentence. Keep the answer focused.`;
};

const buildPrompt = (args: GenerateArgs) => {
  if (args.task === "translate") {
    if (args.fileContext) {
      return args.selection?.region
        ? `Translate only the text in this selected image region: ${JSON.stringify(args.selection.region)}`
        : "Translate the text in this image.";
    }
    return args.text;
  }

  if (args.task === "define") {
    return `Language: ${args.sourceLanguage ?? "auto"}\n\nDefine or explain this exact selection. Keep it short, usually one compact paragraph. Do not add headings, labels, bullets, or markdown.\n\n${args.text}`;
  }

  if (args.selection?.kind === "image") {
    const fileLine = args.fileContext
      ? `Attached file: ${args.fileContext.filename} (${args.fileContext.mediaType}).`
      : "No source file bytes could be resolved for this selection.";
    return `The reader selected a visual region while reading. ${fileLine}
Region metadata: ${JSON.stringify(args.selection.region)}.
Use the attached file and the region metadata as visual context. If the file is a PDF, inspect the referenced page/area as closely as the model allows.

Current context:
${args.text}`;
  }

  return `Selected reading context:\n${args.selection?.text || args.text}\n\nAnswer the user's latest message directly. Use clean markdown only when it improves readability.`;
};

const userMessageFor = (text: string, fileContext?: AiFileContext | null) => {
  if (!fileContext) return { role: "user", content: text };
  const attachment = fileContext.mediaType.startsWith("image/")
    ? {
        type: "file",
        data: new URL(`data:${fileContext.mediaType};base64,${Buffer.from(fileContext.bytes).toString("base64")}`),
        mediaType: fileContext.mediaType,
        filename: fileContext.filename
      }
    : {
        type: "file",
        data: fileContext.bytes,
        mediaType: fileContext.mediaType,
        filename: fileContext.filename
      };
  return {
    role: "user",
    content: [
      { type: "text", text },
      attachment
    ]
  };
};

const dataUrlFor = (fileContext: AiFileContext) =>
  `data:${fileContext.mediaType};base64,${Buffer.from(fileContext.bytes).toString("base64")}`;

const isLmStudioRasterImage = (mediaType: string) => /image\/(png|jpe?g|webp)/i.test(mediaType);

const lmStudioResponse = async (provider: ProviderConfig, args: GenerateArgs): Promise<AiResponse> => {
  if (!provider.baseURL) throw new Error("LM Studio request requires a base URL.");
  const prompt = buildPrompt(args);
  const content = args.fileContext && isLmStudioRasterImage(args.fileContext.mediaType)
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrlFor(args.fileContext) } }
      ]
    : prompt;
  const messages = [
    { role: "system", content: taskSystemPrompt(args) },
    ...(args.task === "chat"
      ? [
          { role: "user", content },
          ...(args.messages ?? []).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content
          }))
        ]
      : [{ role: "user", content }])
  ];
  const response = await fetch(`${provider.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.headers ?? {})
    },
    body: JSON.stringify({
      model: provider.modelName,
      messages,
      max_tokens: 1024,
      ...(args.task === "translate" ? { reasoning_effort: "none", temperature: 0 } : {})
    })
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : body?.error?.message ?? response.statusText;
    throw new Error(`LM Studio chat completion failed: ${message}`);
  }
  const message = body?.choices?.[0]?.message;
  const text = String(message?.content || (args.task === "translate" ? "" : message?.reasoning_content) || "").trim();
  if (args.task === "translate" && !text) {
    throw new Error("The translation model returned no answer. Its reasoning output was intentionally hidden.");
  }
  return {
    title: args.task === "translate" ? "Translation" : args.task === "define" ? "Definitions" : "AI chat",
    content: text,
    provider: "lm-studio"
  };
};

const generateWithAiSdk = async (provider: ProviderConfig, args: GenerateArgs): Promise<AiResponse> => {
  const aiModule: any = await import("ai");
  const openAiModule: any = await import("@ai-sdk/openai");
  const createOpenAI = openAiModule.createOpenAI ?? openAiModule.default;
  const openai = createOpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    headers: provider.headers
  });
  const model = openai.chat(provider.modelName);

  const prompt = buildPrompt(args);
  const messages =
    args.task === "chat"
      ? [
          userMessageFor(prompt, args.fileContext),
          ...(args.messages ?? []).map((message) => {
            const contextText = (message.selectionContexts ?? [])
              .map((context, index) =>
                context.kind === "image"
                  ? `Selection ${index + 1}: image region ${JSON.stringify(context.region)}`
                  : `Selection ${index + 1}: ${context.text ?? ""}`
              )
              .join("\n");
            return {
              role: message.role === "assistant" ? "assistant" : "user",
              content: contextText ? `${contextText}\n\n${message.content}` : message.content
            };
          })
        ]
      : [userMessageFor(prompt, args.fileContext)];

  const result = await aiModule.generateText({
    model,
    system: taskSystemPrompt(args),
    messages
  });

  return {
    title: args.task === "translate" ? "Translation" : args.task === "define" ? "Definitions" : "AI chat",
    content: args.task === "translate" ? String(result.text ?? "").trim() : String(result.text ?? ""),
    provider: "ai-sdk"
  };
};

export const generateAiResponse = async (args: GenerateArgs): Promise<AiResponse> => {
  if (process.env.AI_TEST_MOCK === "1") return testMock(args);
  const provider = providerConfig();
  if (!provider) return notConfigured();

  if (provider.kind === "lm-studio" && (args.task === "translate" || args.fileContext)) {
    if (args.task === "translate" || (args.fileContext && isLmStudioRasterImage(args.fileContext.mediaType))) {
      return lmStudioResponse(provider, args);
    }
    return generateWithAiSdk(provider, { ...args, fileContext: null });
  }

  return generateWithAiSdk(provider, args);
};

const titleFallback = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Chat";
  return clean.length > 42 ? `${clean.slice(0, 41).trim()}...` : clean;
};

export const generateChatTitle = async (text: string): Promise<string> => {
  if (process.env.AI_TEST_MOCK === "1") return titleFallback(text);
  const provider = providerConfig();
  if (!provider) return titleFallback(text);

  const prompt = `Create a concise chat title for this reader question and context.
Return only the title. No quotes. No punctuation unless needed. Max 5 words.

${text}`;

  try {
    const response = await generateWithAiSdk(provider, {
      task: "chat",
      text: prompt,
      messages: []
    });
    return titleFallback(response.content);
  } catch {
    return titleFallback(text);
  }
};
