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
  messages?: Array<Pick<ChatMessage, "role" | "content">>;
  selection?: SelectionRecord | null;
  fileContext?: AiFileContext | null;
}

const modelName = process.env.AI_MODEL ?? "gpt-4.1-mini";

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
          : "Test assistant using the selected passage.",
    provider: "none"
  };
};

const notConfigured = (): AiResponse => ({
  title: "AI provider not configured",
  content: "No AI provider is configured. Set OPENAI_API_KEY on the Bun backend to enable translation, definitions, and chat.",
  provider: "none"
});

const taskSystemPrompt = (task: AiTask) => {
  const base =
    "You are Derp Reader's study copilot. Help readers understand foreign-language or difficult native-language text. Be precise, concise, and adapt explanations to a reading workflow.";

  if (task === "translate") {
    return `${base} Translate the selected passage faithfully. Include short notes for idioms, ambiguity, grammar, or cultural context.`;
  }

  if (task === "define") {
    return `${base} Define important words and phrases from the selection. Include plain-language meaning and a tiny usage example when useful.`;
  }

  return `${base} Continue the saved chat about the selected text or image region. Use prior messages and preserve context.`;
};

const buildPrompt = (args: GenerateArgs) => {
  if (args.task === "translate") {
    return `Source language: ${args.sourceLanguage ?? "auto"}\nTarget language: ${args.targetLanguage ?? "English"}\n\nSelection:\n${args.text}`;
  }

  if (args.task === "define") {
    return `Language: ${args.sourceLanguage ?? "auto"}\n\nSelection:\n${args.text}`;
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

  return `Selected reading context:\n${args.selection?.text || args.text}`;
};

const userMessageFor = (text: string, fileContext?: AiFileContext | null) => {
  if (!fileContext) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { type: "text", text },
      {
        type: "file",
        data: fileContext.bytes,
        mediaType: fileContext.mediaType,
        filename: fileContext.filename
      }
    ]
  };
};

export const generateAiResponse = async (args: GenerateArgs): Promise<AiResponse> => {
  if (process.env.AI_TEST_MOCK === "1") return testMock(args);
  if (!process.env.OPENAI_API_KEY) return notConfigured();

  const aiModule: any = await import("ai");
  const openAiModule: any = await import("@ai-sdk/openai");
  const createOpenAI = openAiModule.createOpenAI ?? openAiModule.default;
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = openai(modelName);

  const prompt = buildPrompt(args);
  const messages =
    args.task === "chat"
      ? [
          userMessageFor(prompt, args.fileContext),
          ...(args.messages ?? []).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content
          }))
        ]
      : [userMessageFor(prompt, args.fileContext)];

  const result = await aiModule.generateText({
    model,
    system: taskSystemPrompt(args.task),
    messages
  });

  return {
    title: args.task === "translate" ? "Translation" : args.task === "define" ? "Definitions" : "AI chat",
    content: String(result.text ?? ""),
    provider: "ai-sdk"
  };
};
