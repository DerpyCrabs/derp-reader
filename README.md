# Derp Reader

Reader for PDFs, manga/images. Has notes, bookmarks, and AI-assisted language study.

```bash
bun install
bun run dev
```

Open http://127.0.0.1:5173.

Select one AI provider on the Bun backend:

```bash
AI_PROVIDER=chatgpt bun run dev
```

`chatgpt` uses current Codex ChatGPT login; run `codex login` first. Derp Reader reads Codex's file-based credentials and asks `codex app-server` to refresh them when needed. It never writes `auth.json`. If Codex uses OS keyring storage, set `cli_auth_credentials_store = "file"` in `~/.codex/config.toml`, then sign in again. Optional overrides: `CHATGPT_MODEL`, `CHATGPT_TIMEOUT_MS`, and `CODEX_PATH`.

Set `CHATGPT_SERVICE_TIER=default` for Standard mode or `CHATGPT_SERVICE_TIER=fast` for Codex Fast mode. `fast` sends the upstream `priority` service tier and consumes ChatGPT credits faster. `priority` is accepted as an alias.

Switch providers without code changes:

```bash
AI_PROVIDER=lm-studio LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1 bun run dev
AI_PROVIDER=openrouter OPENROUTER_API_KEY=... bun run dev
```

ChatGPT mode calls ChatGPT's private Codex Responses endpoint directly. It uses subscription limits, requires a trusted personal machine, and may break if that private endpoint changes.
