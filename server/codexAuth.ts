import { homedir } from "node:os";
import { join } from "node:path";

interface CodexAuthFile {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

export interface CodexCredentials {
  accessToken: string;
  accountId: string;
}

const authPath = () => join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "auth.json");

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

const accountIdFromToken = (token: string) => {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"];
  if (auth && typeof auth === "object") {
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    if (typeof accountId === "string") return accountId;
  }
  return typeof payload?.chatgpt_account_id === "string" ? payload.chatgpt_account_id : null;
};

const expiresSoon = (token: string) => {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" && exp * 1000 <= Date.now() + 120_000;
};

const readCredentials = async (): Promise<CodexCredentials | null> => {
  const file = Bun.file(authPath());
  if (!(await file.exists())) return null;

  let auth: CodexAuthFile;
  try {
    auth = JSON.parse(await file.text());
  } catch {
    throw new Error(`Codex credentials at ${authPath()} are unreadable.`);
  }

  const accessToken = auth.tokens?.access_token?.trim();
  const accountId = auth.tokens?.account_id?.trim() || (accessToken ? accountIdFromToken(accessToken) : null);
  if (!accessToken || !accountId) return null;
  return { accessToken, accountId };
};

const refreshWithCodex = async () => {
  const executable = process.env.CODEX_PATH?.trim() || Bun.which("codex");
  if (!executable) {
    throw new Error("Codex CLI was not found. Install Codex or set CODEX_PATH, then run `codex login`.");
  }

  const processHandle = Bun.spawn([executable, "app-server", "--stdio"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env
  });
  const stderrPromise = new Response(processHandle.stderr).text();
  const input = processHandle.stdin;
  if (!input || typeof input === "number") throw new Error("Could not open Codex app-server stdin.");

  input.write(`${JSON.stringify({
    method: "initialize",
    id: 1,
    params: { clientInfo: { name: "derp_reader", title: "Derp Reader", version: "0.1.0" } }
  })}\n`);
  input.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  input.write(`${JSON.stringify({ method: "account/read", id: 2, params: { refreshToken: true } })}\n`);
  input.flush();

  const reader = processHandle.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          buffered += decoder.decode(value, { stream: !done });
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let message: any;
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }
            if (message.id !== 2) continue;
            if (message.error) throw new Error(message.error.message || "Codex token refresh failed.");
            if (message.result?.account?.type !== "chatgpt") {
              throw new Error("Codex is not signed in with ChatGPT. Run `codex login` and choose ChatGPT.");
            }
            return true;
          }
          if (done) return false;
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Codex credential refresh timed out.")), 15_000);
      })
    ]);
    if (!result) {
      const stderr = (await stderrPromise).trim();
      throw new Error(`Codex app-server exited before refreshing credentials.${stderr ? ` ${stderr}` : ""}`);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    reader.releaseLock();
    try {
      processHandle.kill();
    } catch {
      // Already exited.
    }
  }
};

let refreshPromise: Promise<void> | null = null;

export const getCodexCredentials = async (forceRefresh = false): Promise<CodexCredentials> => {
  let credentials = await readCredentials();
  if (forceRefresh || !credentials || expiresSoon(credentials.accessToken)) {
    refreshPromise ??= refreshWithCodex().finally(() => {
      refreshPromise = null;
    });
    await refreshPromise;
    credentials = await readCredentials();
  }

  if (!credentials) {
    throw new Error(
      `No file-based Codex ChatGPT credentials found at ${authPath()}. Run \`codex login\`; if Codex uses a keyring, set cli_auth_credentials_store = "file" in Codex config and sign in again.`
    );
  }
  return credentials;
};
