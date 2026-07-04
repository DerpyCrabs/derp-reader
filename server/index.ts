import { basename, join, normalize } from "node:path";
import {
  addChatMessage,
  createChat,
  createDocument,
  createNote,
  createSelection,
  databaseFile,
  deleteChat,
  deleteDocument,
  deleteNote,
  deleteSelection,
  getChat,
  getDocument,
  getDocumentFileContent,
  getDocumentSourcePath,
  getPageSourcePath,
  getReadingPosition,
  getSelection,
  listChats,
  listDocuments,
  listLibraryLocations,
  listNotes,
  listSelections,
  recordLibraryLocation,
  saveReadingPosition,
  search,
  updateNote
} from "./db";
import { generateAiResponse } from "./ai";
import { importBlob, importPath } from "./importer";
import { contentTypeForPath, parseArchiveSourceRef, parseDataUrl, readArchiveEntry } from "./media";
import { resolveSelectionFileContext } from "./selectionContext";
import type {
  CreateChatInput,
  CreateDocumentInput,
  ImportBlobInput,
  CreateNoteInput,
  CreateSelectionInput,
  ReadingPosition,
  SelectionRecord
} from "../shared/types";

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "0.0.0.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
};

const contentDispositionForPath = (path: string) =>
  `inline; filename="${basename(path).replace(/["\\]/g, "_")}"`;

const bytesResponseBody = (bytes: Uint8Array) => new Blob([bytes as unknown as BlobPart]);

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });

const readJson = async <T>(request: Request): Promise<T> => {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON request body");
  }
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const requireText = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${label} is required`);
  }
  return value.trim();
};

const transientSelectionFrom = (context: {
  documentId: string;
  pageId?: string | null;
  kind: "text" | "image";
  text?: string;
  region?: SelectionRecord["region"];
}): SelectionRecord => ({
  id: "",
  documentId: context.documentId,
  pageId: context.pageId ?? null,
  kind: context.kind,
  text: context.text ?? "",
  imageData: null,
  region: context.region ?? null,
  language: null,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now()
});

const distRoot = join(import.meta.dir, "..", "dist");

const staticFileResponse = async (requestPath: string) => {
  if (requestPath.startsWith("/api")) return null;
  const requested = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const normalized = normalize(requested);
  if (normalized.startsWith("..")) return null;

  const filePath = join(distRoot, normalized);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: {
        "Content-Type": contentTypeForPath(filePath)
      }
    });
  }

  const index = Bun.file(join(distRoot, "index.html"));
  if (await index.exists()) {
    return new Response(index, {
      headers: {
        "Content-Type": "text/html"
      }
    });
  }

  return null;
};

const route = async (request: Request) => {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, databaseFile });
  }

  if (request.method === "GET" && path === "/api/documents") {
    return json({ documents: listDocuments() });
  }

  if (request.method === "POST" && path === "/api/documents") {
    if (process.env.ALLOW_TEST_DOCUMENT_CREATE !== "1") {
      throw new HttpError(403, "Direct document content creation is disabled. Use /api/import/path to open files from the filesystem.");
    }
    const input = await readJson<CreateDocumentInput>(request);
    return json({ document: createDocument(input) }, 201);
  }

  if (request.method === "POST" && path === "/api/import/path") {
    const input = await readJson<{ path: string }>(request);
    return json({ document: await importPath(requireText(input.path, "Path")) }, 201);
  }

  if (request.method === "POST" && path === "/api/import/blob") {
    const input = await readJson<ImportBlobInput>(request);
    return json({ document: await importBlob(input) }, 201);
  }

  const documentMatch = path.match(/^\/api\/documents\/([^/]+)$/);
  if (documentMatch && request.method === "GET") {
    const document = getDocument(documentMatch[1]);
    if (!document) throw new HttpError(404, "Document not found");
    return json({ document });
  }

  if (documentMatch && request.method === "DELETE") {
    return json(deleteDocument(documentMatch[1]));
  }

  const documentFileMatch = path.match(/^\/api\/documents\/([^/]+)\/file$/);
  if (documentFileMatch && request.method === "GET") {
    const sourcePath = getDocumentSourcePath(documentFileMatch[1]);
    if (!sourcePath) {
      const content = getDocumentFileContent(documentFileMatch[1]);
      if (!content) throw new HttpError(404, "Document file content not found");
      const parsed = parseDataUrl(content.data);
      return new Response(bytesResponseBody(parsed.bytes), {
        headers: {
          ...headers,
          "Content-Disposition": "inline",
          "Content-Type": content.contentType ?? parsed.mediaType
        }
      });
    }
    return new Response(Bun.file(sourcePath), {
      headers: {
        ...headers,
        "Content-Disposition": contentDispositionForPath(sourcePath),
        "Content-Type": sourcePath.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"
      }
    });
  }

  const pageFileMatch = path.match(/^\/api\/documents\/([^/]+)\/pages\/(\d+)\/file$/);
  if (pageFileMatch && request.method === "GET") {
    const sourcePath = getPageSourcePath(pageFileMatch[1], Number(pageFileMatch[2]));
    if (!sourcePath) throw new HttpError(404, "Page file path not found");
    const archiveRef = parseArchiveSourceRef(sourcePath);
    if (archiveRef) {
      const bytes = await readArchiveEntry(archiveRef);
      return new Response(bytesResponseBody(bytes), {
        headers: {
          ...headers,
          "Content-Disposition": contentDispositionForPath(archiveRef.entryName),
          "Content-Type": contentTypeForPath(archiveRef.entryName)
        }
      });
    }
    return new Response(Bun.file(sourcePath), {
      headers: {
        ...headers,
        "Content-Disposition": contentDispositionForPath(sourcePath),
        "Content-Type": contentTypeForPath(sourcePath)
      }
    });
  }

  const positionMatch = path.match(/^\/api\/documents\/([^/]+)\/position$/);
  if (positionMatch && request.method === "GET") {
    const position = getReadingPosition(positionMatch[1]);
    return json({ position });
  }

  if (positionMatch && request.method === "PATCH") {
    const input = await readJson<Partial<ReadingPosition>>(request);
    return json({ position: saveReadingPosition(positionMatch[1], input) });
  }

  if (request.method === "GET" && path === "/api/library/locations") {
    return json({ locations: listLibraryLocations() });
  }

  if (request.method === "POST" && path === "/api/library/locations") {
    const input = await readJson<{
      kind: "document" | "folder";
      name: string;
      pathHint?: string | null;
      documentId?: string | null;
    }>(request);
    return json({ location: recordLibraryLocation(input) }, 201);
  }

  if (request.method === "GET" && path === "/api/selections") {
    return json({ selections: listSelections(url.searchParams.get("documentId") ?? undefined) });
  }

  if (request.method === "POST" && path === "/api/selections") {
    const input = await readJson<CreateSelectionInput>(request);
    return json({ selection: createSelection(input) }, 201);
  }

  const selectionMatch = path.match(/^\/api\/selections\/([^/]+)$/);
  if (selectionMatch && request.method === "DELETE") {
    return json(deleteSelection(selectionMatch[1]));
  }

  if (request.method === "GET" && path === "/api/notes") {
    return json({ notes: listNotes(url.searchParams.get("documentId") ?? undefined) });
  }

  if (request.method === "POST" && path === "/api/notes") {
    const input = await readJson<CreateNoteInput>(request);
    requireText(input.body, "Note body");
    return json({ note: createNote(input) }, 201);
  }

  const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/);
  if (noteMatch && request.method === "PATCH") {
    const input = await readJson<{ body: string }>(request);
    const note = updateNote(noteMatch[1], requireText(input.body, "Note body"));
    if (!note) throw new HttpError(404, "Note not found");
    return json({ note });
  }

  if (noteMatch && request.method === "DELETE") {
    return json({ deleted: deleteNote(noteMatch[1]) });
  }

  if (request.method === "GET" && path === "/api/chats") {
    return json({
      chats: listChats({
        documentId: url.searchParams.get("documentId") ?? undefined,
        selectionId: url.searchParams.get("selectionId") ?? undefined
      })
    });
  }

  if (request.method === "POST" && path === "/api/chats") {
    const input = await readJson<CreateChatInput>(request);
    return json({ chat: createChat(input) }, 201);
  }

  const chatMatch = path.match(/^\/api\/chats\/([^/]+)$/);
  if (chatMatch && request.method === "GET") {
    const chat = getChat(chatMatch[1]);
    if (!chat) throw new HttpError(404, "Chat not found");
    return json({ chat });
  }

  if (chatMatch && request.method === "DELETE") {
    return json({ deleted: deleteChat(chatMatch[1]) });
  }

  const chatMessagesMatch = path.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch && request.method === "POST") {
    const input = await readJson<{
      content: string;
      selectionId?: string | null;
      selectionContexts?: Array<{
        documentId: string;
        pageId?: string | null;
        kind: "text" | "image";
        text?: string;
        region?: SelectionRecord["region"];
      }>;
    }>(request);
    const chat = getChat(chatMessagesMatch[1]);
    if (!chat) throw new HttpError(404, "Chat not found");

    addChatMessage(chat.id, "user", requireText(input.content, "Message"));
    const transientSelections = (input.selectionContexts ?? []).map(transientSelectionFrom);
    const persistedSelection = input.selectionId ? getSelection(input.selectionId) : chat.selectionId ? getSelection(chat.selectionId) : null;
    const selection = transientSelections[0] ?? persistedSelection;
    const fileContext = await resolveSelectionFileContext(transientSelections.find((item) => item.kind === "image") ?? selection);
    const selectedText = transientSelections.length
      ? transientSelections.map((item, index) => `Selection ${index + 1}:\n${item.text || JSON.stringify(item.region)}`).join("\n\n")
      : selection?.text ?? "";
    const nextChat = getChat(chat.id);
    const ai = await generateAiResponse({
      task: "chat",
      text: selectedText,
      selection,
      fileContext,
      messages: nextChat?.messages ?? []
    });
    const assistant = addChatMessage(chat.id, "assistant", ai.content);
    return json({ message: assistant, chat: getChat(chat.id), ai });
  }

  if (request.method === "POST" && path === "/api/ai/translate") {
    const input = await readJson<{
      text?: string;
      selectionId?: string;
      selectionContext?: {
        documentId: string;
        pageId?: string | null;
        kind: "text" | "image";
        text?: string;
        region?: SelectionRecord["region"];
      } | null;
      sourceLanguage?: string | null;
      targetLanguage?: string | null;
    }>(request);
    const selection = input.selectionContext ? transientSelectionFrom(input.selectionContext) : input.selectionId ? getSelection(input.selectionId) : null;
    const fileContext = await resolveSelectionFileContext(selection);
    const text = input.text ?? selection?.text ?? "";
    if (!fileContext) requireText(text, "Selected text");
    return json({
      result: await generateAiResponse({
        task: "translate",
        text,
        selection,
        fileContext,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage
      })
    });
  }

  if (request.method === "POST" && path === "/api/ai/define") {
    const input = await readJson<{
      text?: string;
      selectionId?: string;
      selectionContext?: {
        documentId: string;
        pageId?: string | null;
        kind: "text" | "image";
        text?: string;
        region?: SelectionRecord["region"];
      } | null;
      sourceLanguage?: string | null;
    }>(request);
    const selection = input.selectionContext ? transientSelectionFrom(input.selectionContext) : input.selectionId ? getSelection(input.selectionId) : null;
    const fileContext = await resolveSelectionFileContext(selection);
    const text = input.text ?? selection?.text ?? "";
    if (!fileContext) requireText(text, "Selected text");
    return json({
      result: await generateAiResponse({
        task: "define",
        text,
        selection,
        fileContext,
        sourceLanguage: input.sourceLanguage
      })
    });
  }

  if (request.method === "GET" && path === "/api/search") {
    return json({ results: search(url.searchParams.get("q") ?? "") });
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const staticResponse = await staticFileResponse(path);
    if (staticResponse) return staticResponse;
  }

  throw new HttpError(404, "Route not found");
};

export const handleApiRequest = async (request: Request) => {
  try {
    return await route(request);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return json({ error: message }, 500);
  }
};

export const startServer = () =>
  Bun.serve({
    hostname,
    port,
    fetch: handleApiRequest
  });

if (import.meta.main) {
  startServer();
  console.log(`Derp Reader listening on http://${hostname}:${port}`);
}
