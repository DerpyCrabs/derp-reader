import type {
  AiResponse,
  ChatSelectionContext,
  ChatRecord,
  ChatWithMessages,
  CreateSelectionInput,
  DocumentWithPages,
  ImportBlobInput,
  LibraryLocation,
  NoteRecord,
  ReaderDocument,
  ReadingPosition,
  SearchResult,
  SelectionKind,
  SelectionRecord
} from "../shared/types";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });
  } catch {
    throw new Error("Backend unavailable. Check that the Bun API server is running.");
  }

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
};

export const api = {
  async listDocuments() {
    return request<{ documents: ReaderDocument[] }>("/api/documents");
  },
  async importPath(path: string) {
    return request<{ document: DocumentWithPages }>("/api/import/path", {
      method: "POST",
      body: JSON.stringify({ path })
    });
  },
  async importBlob(input: ImportBlobInput) {
    return request<{ document: DocumentWithPages }>("/api/import/blob", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async getDocument(documentId: string) {
    return request<{ document: DocumentWithPages }>(`/api/documents/${documentId}`);
  },
  async deleteDocument(documentId: string) {
    return request<{ deleted: boolean }>(`/api/documents/${documentId}`, { method: "DELETE" });
  },
  async getPosition(documentId: string) {
    return request<{ position: ReadingPosition | null }>(`/api/documents/${documentId}/position`);
  },
  async savePosition(documentId: string, input: Partial<ReadingPosition>, options: Pick<RequestInit, "keepalive"> = {}) {
    return request<{ position: ReadingPosition }>(`/api/documents/${documentId}/position`, {
      method: "PATCH",
      keepalive: options.keepalive,
      body: JSON.stringify(input)
    });
  },
  async listLocations() {
    return request<{ locations: LibraryLocation[] }>("/api/library/locations");
  },
  async recordLocation(input: {
    kind: LibraryLocation["kind"];
    name: string;
    pathHint?: string | null;
    documentId?: string | null;
  }) {
    return request<{ location: LibraryLocation }>("/api/library/locations", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async listSelections(documentId?: string) {
    const suffix = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
    return request<{ selections: SelectionRecord[] }>(`/api/selections${suffix}`);
  },
  async createSelection(input: CreateSelectionInput) {
    return request<{ selection: SelectionRecord }>("/api/selections", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async deleteSelection(selectionId: string) {
    return request<{ deleted: boolean; notes: NoteRecord[]; chats: ChatRecord[] }>(`/api/selections/${selectionId}`, {
      method: "DELETE"
    });
  },
  async listNotes(documentId?: string) {
    const suffix = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
    return request<{ notes: NoteRecord[] }>(`/api/notes${suffix}`);
  },
  async createNote(input: { documentId: string; selectionId?: string | null; body: string }) {
    return request<{ note: NoteRecord }>("/api/notes", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async updateNote(noteId: string, body: string) {
    return request<{ note: NoteRecord }>(`/api/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
  },
  async deleteNote(noteId: string) {
    return request<{ deleted: boolean }>(`/api/notes/${noteId}`, { method: "DELETE" });
  },
  async translate(
    input: { text?: string; selectionId?: string; selectionContext?: ChatSelectionContext | null; sourceLanguage?: string | null; targetLanguage?: string },
    options: Pick<RequestInit, "signal"> = {}
  ) {
    return request<{ result: AiResponse }>("/api/ai/translate", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(input)
    });
  },
  async define(
    input: { text?: string; selectionId?: string; selectionContext?: ChatSelectionContext | null; sourceLanguage?: string | null },
    options: Pick<RequestInit, "signal"> = {}
  ) {
    return request<{ result: AiResponse }>("/api/ai/define", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(input)
    });
  },
  async listChats(filters: { documentId?: string; selectionId?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.documentId) params.set("documentId", filters.documentId);
    if (filters.selectionId) params.set("selectionId", filters.selectionId);
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<{ chats: ChatRecord[] }>(`/api/chats${suffix}`);
  },
  async createChat(input: { documentId?: string | null; selectionId?: string | null; title?: string }) {
    return request<{ chat: ChatWithMessages }>("/api/chats", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async getChat(chatId: string) {
    return request<{ chat: ChatWithMessages }>(`/api/chats/${chatId}`);
  },
  async deleteChat(chatId: string) {
    return request<{ deleted: boolean }>(`/api/chats/${chatId}`, { method: "DELETE" });
  },
  async updateChat(chatId: string, input: { title?: string; pinned?: boolean }) {
    return request<{ chat: ChatWithMessages }>(`/api/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  },
  async sendMessage(chatId: string, content: string, selectionId?: string | null, selectionContexts?: ChatSelectionContext[]) {
    return request<{ chat: ChatWithMessages }>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, selectionId, selectionContexts })
    });
  },
  async search(query: string) {
    return request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
  }
};
