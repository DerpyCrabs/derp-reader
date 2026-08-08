import { getCodexCredentials } from "./codexAuth";

export type ChatGptInputContent =
  | string
  | Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string }
      | { type: "input_file"; filename: string; file_data: string }
    >;

export interface ChatGptInputMessage {
  role: "user" | "assistant";
  content: ChatGptInputContent;
}

interface ChatGptRequest {
  model: string;
  instructions: string;
  input: ChatGptInputMessage[];
  reasoningEffort?: string | null;
  serviceTier?: "default" | "priority";
}

const outputTextFromResponse = (response: any) =>
  (response?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");

export const parseChatGptSse = (body: string) => {
  let deltas = "";
  let completed = "";

  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;

    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltas += event.delta;
    } else if (event.type === "response.output_item.done") {
      completed += outputTextFromResponse({ output: [event.item] });
    } else if (event.type === "response.completed") {
      completed ||= outputTextFromResponse(event.response);
    } else if (event.type === "response.failed" || event.type === "error") {
      throw new Error(event.response?.error?.message || event.error?.message || event.message || "ChatGPT response failed.");
    }
  }

  return (deltas || completed).trim();
};

const requestOnce = async (args: ChatGptRequest, forceRefresh: boolean) => {
  const credentials = await getCodexCredentials(forceRefresh);
  const timeoutMs = Number(process.env.CHATGPT_TIMEOUT_MS?.trim() || 60_000);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000);
  try {
    const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${credentials.accessToken}`,
        "ChatGPT-Account-ID": credentials.accountId,
        "Content-Type": "application/json",
        originator: "codex_cli_rs",
        "User-Agent": "derp-reader/0.1.0"
      },
      body: JSON.stringify({
        model: args.model,
        instructions: args.instructions,
        input: args.input,
        store: false,
        stream: true,
        ...(args.serviceTier === "priority" ? { service_tier: "priority" } : {}),
        ...(args.reasoningEffort
          ? { reasoning: { effort: args.reasoningEffort, summary: "auto" } }
          : {})
      }),
      signal: controller.signal
    });
    return {
      response,
      dispose: () => clearTimeout(timeout),
      timedOut: () => timedOut
    };
  } catch (error) {
    clearTimeout(timeout);
    if (timedOut) throw new Error("ChatGPT request timed out.");
    throw error;
  }
};

const readResponseBody = async (response: Response) => {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      body += decoder.decode(value, { stream: !done });
      if (
        /"type"\s*:\s*"response\.(?:completed|failed)"/.test(body) ||
        /data:\s*\[DONE\]/.test(body)
      ) {
        await reader.cancel();
        break;
      }
      if (done) break;
    }
    return body;
  } finally {
    reader.releaseLock();
  }
};

export const generateChatGptText = async (args: ChatGptRequest) => {
  let attempt: Awaited<ReturnType<typeof requestOnce>>;
  try {
    attempt = await requestOnce(args, false);
    if (attempt.response.status === 401) {
      await attempt.response.body?.cancel();
      attempt.dispose();
      attempt = await requestOnce(args, true);
    }
  } catch (error) {
    throw error;
  }

  let body: string;
  try {
    body = await readResponseBody(attempt.response);
  } catch (error) {
    if (attempt.timedOut()) throw new Error("ChatGPT request timed out.");
    throw error;
  } finally {
    attempt.dispose();
  }
  const response = attempt.response;
  if (!response.ok) {
    let detail = body.slice(0, 500).trim();
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message || parsed?.detail || detail;
    } catch {
      // Preserve bounded response text.
    }
    if (response.status === 429) {
      throw new Error(`ChatGPT subscription limit reached.${detail ? ` ${detail}` : ""}`);
    }
    throw new Error(`ChatGPT request failed (${response.status}).${detail ? ` ${detail}` : ""}`);
  }

  const text = response.headers.get("content-type")?.includes("text/event-stream") || /^(?:event|data):/m.test(body)
    ? parseChatGptSse(body)
    : outputTextFromResponse(JSON.parse(body));
  if (!text) throw new Error("ChatGPT returned no final answer.");
  return text;
};
