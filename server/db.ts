import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import type {
  ChatMessage,
  ChatRecord,
  ChatWithMessages,
  CreateChatInput,
  CreateDocumentInput,
  CreateNoteInput,
  CreateSelectionInput,
  DocumentPage,
  DocumentWithPages,
  LibraryLocation,
  NoteRecord,
  ReaderDocument,
  ReadingPosition,
  SearchResult,
  SelectionRecord,
  SelectionRegion
} from "../shared/types";

type Row = Record<string, unknown>;

const databasePath = resolve(process.env.DATABASE_PATH ?? "data/derp-reader.sqlite");

if (process.env.RESET_DB_ON_START === "1" && existsSync(databasePath)) {
  unlinkSync(databasePath);
}

mkdirSync(dirname(databasePath), { recursive: true });

const db = new Database(databasePath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const now = () => Date.now();
const id = () => crypto.randomUUID();

const toJson = (value: unknown) => JSON.stringify(value ?? null);
const fromJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null);
const numberOrNull = (value: unknown) => (typeof value === "number" ? value : null);
const numberValue = (value: unknown, fallback = 0) => (typeof value === "number" ? value : fallback);

db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  source_name TEXT,
  source_path TEXT,
  content_data TEXT,
  content_type TEXT,
  language TEXT,
  page_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS document_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  image_data TEXT,
  source_path TEXT,
  width REAL,
  height REAL,
  UNIQUE(document_id, page_index)
);

CREATE TABLE IF NOT EXISTS selections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES document_pages(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  image_data TEXT,
  region_json TEXT,
  language TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  selection_id TEXT REFERENCES selections(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  selection_id TEXT REFERENCES selections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_locations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path_hint TEXT,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  opened_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_positions (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL DEFAULT 0,
  scroll_y REAL NOT NULL DEFAULT 0,
  zoom REAL NOT NULL DEFAULT 1,
  view_mode TEXT NOT NULL DEFAULT 'continuous',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_document ON document_pages(document_id);
CREATE INDEX IF NOT EXISTS idx_selections_document ON selections(document_id);
CREATE INDEX IF NOT EXISTS idx_notes_document ON notes(document_id);
CREATE INDEX IF NOT EXISTS idx_chats_selection ON chats(selection_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON chat_messages(chat_id);
`);

try {
  db.query("ALTER TABLE documents ADD COLUMN source_path TEXT").run();
} catch {
  // Existing databases already have the column.
}

try {
  db.query("ALTER TABLE documents ADD COLUMN content_data TEXT").run();
} catch {
  // Existing databases already have the column.
}

try {
  db.query("ALTER TABLE documents ADD COLUMN content_type TEXT").run();
} catch {
  // Existing databases already have the column.
}

try {
  db.query("ALTER TABLE document_pages ADD COLUMN source_path TEXT").run();
} catch {
  // Existing databases already have the column.
}

try {
  db.query("ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0").run();
} catch {
  // Existing databases already have the column.
}

try {
  db.query("ALTER TABLE chat_messages ADD COLUMN context_json TEXT NOT NULL DEFAULT '[]'").run();
} catch {
  // Existing databases already have the column.
}

const documentFromRow = (row: Row): ReaderDocument => ({
  id: String(row.id),
  title: String(row.title),
  type: row.type as ReaderDocument["type"],
  sourceName: stringOrNull(row.source_name),
  sourcePath: stringOrNull(row.source_path),
  language: stringOrNull(row.language),
  pageCount: numberValue(row.page_count),
  createdAt: numberValue(row.created_at),
  updatedAt: numberValue(row.updated_at)
});

const pageFromRow = (row: Row): DocumentPage => ({
  id: String(row.id),
  documentId: String(row.document_id),
  pageIndex: numberValue(row.page_index),
  kind: row.kind as DocumentPage["kind"],
  text: String(row.text ?? ""),
  imageData: stringOrNull(row.image_data),
  sourcePath: stringOrNull(row.source_path),
  width: numberOrNull(row.width),
  height: numberOrNull(row.height)
});

const selectionFromRow = (row: Row): SelectionRecord => ({
  id: String(row.id),
  documentId: String(row.document_id),
  pageId: stringOrNull(row.page_id),
  kind: row.kind as SelectionRecord["kind"],
  text: String(row.text ?? ""),
  imageData: stringOrNull(row.image_data),
  region: fromJson<SelectionRegion | null>(row.region_json, null),
  language: stringOrNull(row.language),
  tags: fromJson<string[]>(row.tags_json, []),
  createdAt: numberValue(row.created_at),
  updatedAt: numberValue(row.updated_at)
});

const noteFromRow = (row: Row): NoteRecord => ({
  id: String(row.id),
  documentId: String(row.document_id),
  selectionId: stringOrNull(row.selection_id),
  body: String(row.body ?? ""),
  createdAt: numberValue(row.created_at),
  updatedAt: numberValue(row.updated_at)
});

const chatFromRow = (row: Row): ChatRecord => ({
  id: String(row.id),
  documentId: stringOrNull(row.document_id),
  selectionId: stringOrNull(row.selection_id),
  title: String(row.title ?? "Chat"),
  pinned: Boolean(numberValue(row.pinned)),
  createdAt: numberValue(row.created_at),
  updatedAt: numberValue(row.updated_at)
});

const messageFromRow = (row: Row): ChatMessage => ({
  id: String(row.id),
  chatId: String(row.chat_id),
  role: row.role as ChatMessage["role"],
  content: String(row.content ?? ""),
  selectionContexts: fromJson<ChatMessage["selectionContexts"]>(row.context_json, []),
  createdAt: numberValue(row.created_at)
});

export const listDocuments = (): ReaderDocument[] =>
  db.query("SELECT * FROM documents ORDER BY updated_at DESC").all().map((row) => documentFromRow(row as Row));

export const getDocument = (documentId: string): DocumentWithPages | null => {
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(documentId) as Row | null;
  if (!row) return null;

  const document = documentFromRow(row);
  const pages = db
    .query("SELECT * FROM document_pages WHERE document_id = ? ORDER BY page_index ASC")
    .all(documentId)
    .map((page) => {
      const record = pageFromRow(page as Row);
      return {
        ...record,
        imageData: record.kind === "image" && record.sourcePath ? `/api/documents/${documentId}/pages/${record.pageIndex}/file` : record.imageData
      };
    });

  return {
    ...document,
    fileUrl:
      document.type === "pdf" && (document.sourcePath || stringOrNull(row.content_data))
        ? `/api/documents/${documentId}/file`
        : null,
    pages
  };
};

export const deleteDocument = (documentId: string): { deleted: boolean } => {
  const tx = db.transaction((id: string) => {
    const chatIds = db
      .query("SELECT id FROM chats WHERE document_id = ?")
      .all(id)
      .map((row) => String((row as Row).id));
    for (const chatId of chatIds) db.query("DELETE FROM chat_messages WHERE chat_id = ?").run(chatId);
    db.query("DELETE FROM notes WHERE document_id = ?").run(id);
    db.query("DELETE FROM chats WHERE document_id = ?").run(id);
    db.query("DELETE FROM selections WHERE document_id = ?").run(id);
    db.query("DELETE FROM reading_positions WHERE document_id = ?").run(id);
    db.query("DELETE FROM library_locations WHERE document_id = ?").run(id);
    db.query("DELETE FROM document_pages WHERE document_id = ?").run(id);
    return db.query("DELETE FROM documents WHERE id = ?").run(id).changes > 0;
  });

  return { deleted: tx(documentId) };
};

export const getDocumentSourcePath = (documentId: string): string | null => {
  const row = db.query("SELECT source_path FROM documents WHERE id = ?").get(documentId) as Row | null;
  return row ? stringOrNull(row.source_path) : null;
};

export const getDocumentFileContent = (documentId: string): { data: string; contentType: string | null } | null => {
  const row = db.query("SELECT content_data, content_type FROM documents WHERE id = ?").get(documentId) as Row | null;
  const data = row ? stringOrNull(row.content_data) : null;
  return data ? { data, contentType: stringOrNull(row?.content_type) } : null;
};

export const getPageSourcePath = (documentId: string, pageIndex: number): string | null => {
  const row = db
    .query("SELECT source_path FROM document_pages WHERE document_id = ? AND page_index = ?")
    .get(documentId, pageIndex) as Row | null;
  return row ? stringOrNull(row.source_path) : null;
};

export const getSelectionPage = (selection: SelectionRecord): DocumentPage | null => {
  const row = selection.pageId
    ? (db.query("SELECT * FROM document_pages WHERE id = ?").get(selection.pageId) as Row | null)
    : selection.region
      ? (db
          .query("SELECT * FROM document_pages WHERE document_id = ? AND page_index = ?")
          .get(selection.documentId, selection.region.pageIndex) as Row | null)
      : null;
  return row ? pageFromRow(row) : null;
};

export const createDocument = (input: CreateDocumentInput): DocumentWithPages => {
  const tx = db.transaction((documentInput: CreateDocumentInput) => {
    const timestamp = now();
    const documentId = id();
    const pages = documentInput.pages.length > 0 ? documentInput.pages : [{ kind: "text" as const, text: "" }];

    db.query(
      `INSERT INTO documents (id, title, type, source_name, source_path, content_data, content_type, language, page_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      documentId,
      documentInput.title.trim() || "Untitled",
      documentInput.type,
      documentInput.sourceName ?? null,
      documentInput.sourcePath ?? null,
      documentInput.contentData ?? null,
      documentInput.contentType ?? null,
      documentInput.language ?? null,
      pages.length,
      timestamp,
      timestamp
    );

    for (const [pageIndex, page] of pages.entries()) {
      db.query(
        `INSERT INTO document_pages (id, document_id, page_index, kind, text, image_data, source_path, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id(),
        documentId,
        pageIndex,
        page.kind,
        page.text ?? "",
        page.imageData ?? null,
        page.sourcePath ?? null,
        page.width ?? null,
        page.height ?? null
      );
    }

    db.query(
      `INSERT INTO reading_positions (document_id, page_index, scroll_y, zoom, view_mode, updated_at)
       VALUES (?, 0, 0, 1, 'continuous', ?)`
    ).run(documentId, timestamp);

    recordLibraryLocation({
      kind: documentInput.type === "manga" ? "folder" : "document",
      name: documentInput.sourceName ?? documentInput.title,
      pathHint: documentInput.sourcePath ?? documentInput.sourceName ?? null,
      documentId
    });

    return getDocument(documentId);
  });

  const created = tx(input);
  if (!created) throw new Error("Document was not created");
  return created;
};

export const listSelections = (documentId?: string): SelectionRecord[] => {
  const sql = documentId
    ? "SELECT * FROM selections WHERE document_id = ? ORDER BY updated_at DESC"
    : "SELECT * FROM selections ORDER BY updated_at DESC";
  const rows = documentId ? db.query(sql).all(documentId) : db.query(sql).all();
  return rows.map((row) => selectionFromRow(row as Row));
};

export const getSelection = (selectionId: string): SelectionRecord | null => {
  const row = db.query("SELECT * FROM selections WHERE id = ?").get(selectionId) as Row | null;
  return row ? selectionFromRow(row) : null;
};

export const createSelection = (input: CreateSelectionInput): SelectionRecord => {
  const timestamp = now();
  const selectionId = id();
  db.query(
    `INSERT INTO selections
      (id, document_id, page_id, kind, text, image_data, region_json, language, tags_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    selectionId,
    input.documentId,
    input.pageId ?? null,
    input.kind,
    input.text ?? "",
    input.imageData ?? null,
    input.region ? toJson(input.region) : null,
    input.language ?? null,
    toJson(input.tags ?? []),
    timestamp,
    timestamp
  );

  db.query("UPDATE documents SET updated_at = ? WHERE id = ?").run(timestamp, input.documentId);
  const created = getSelection(selectionId);
  if (!created) throw new Error("Selection was not created");
  return created;
};

export const deleteSelection = (selectionId: string): { deleted: boolean; notes: NoteRecord[]; chats: ChatRecord[] } => {
  const affectedNoteIds = db
    .query("SELECT id FROM notes WHERE selection_id = ?")
    .all(selectionId)
    .map((row) => String((row as Row).id));
  const affectedChatIds = db
    .query("SELECT id FROM chats WHERE selection_id = ?")
    .all(selectionId)
    .map((row) => String((row as Row).id));
  const result = db.query("DELETE FROM selections WHERE id = ?").run(selectionId);
  const notes = affectedNoteIds
    .map((noteId) => db.query("SELECT * FROM notes WHERE id = ?").get(noteId) as Row | null)
    .filter((row): row is Row => Boolean(row))
    .map(noteFromRow);
  const chats = affectedChatIds
    .map((chatId) => db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as Row | null)
    .filter((row): row is Row => Boolean(row))
    .map(chatFromRow);
  return { deleted: result.changes > 0, notes, chats };
};

export const listNotes = (documentId?: string): NoteRecord[] => {
  const sql = documentId
    ? "SELECT * FROM notes WHERE document_id = ? ORDER BY updated_at DESC"
    : "SELECT * FROM notes ORDER BY updated_at DESC";
  const rows = documentId ? db.query(sql).all(documentId) : db.query(sql).all();
  return rows.map((row) => noteFromRow(row as Row));
};

export const createNote = (input: CreateNoteInput): NoteRecord => {
  const timestamp = now();
  const noteId = id();
  db.query(
    `INSERT INTO notes (id, document_id, selection_id, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(noteId, input.documentId, input.selectionId ?? null, input.body, timestamp, timestamp);
  const row = db.query("SELECT * FROM notes WHERE id = ?").get(noteId) as Row | null;
  if (!row) throw new Error("Note was not created");
  return noteFromRow(row);
};

export const updateNote = (noteId: string, body: string): NoteRecord | null => {
  db.query("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?").run(body, now(), noteId);
  const row = db.query("SELECT * FROM notes WHERE id = ?").get(noteId) as Row | null;
  return row ? noteFromRow(row) : null;
};

export const deleteNote = (noteId: string): boolean => {
  const result = db.query("DELETE FROM notes WHERE id = ?").run(noteId);
  return result.changes > 0;
};

export const createChat = (input: CreateChatInput): ChatWithMessages => {
  const timestamp = now();
  const chatId = id();
  const selection = input.selectionId ? getSelection(input.selectionId) : null;
  const title = input.title ?? (selection?.text ? selection.text.slice(0, 60) : "Reading chat");

  db.query(
    `INSERT INTO chats (id, document_id, selection_id, title, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(chatId, input.documentId ?? selection?.documentId ?? null, input.selectionId ?? null, title, timestamp, timestamp);

  return getChat(chatId) as ChatWithMessages;
};

export const listChats = (filters: { documentId?: string; selectionId?: string } = {}): ChatRecord[] => {
  if (filters.selectionId) {
    return db
      .query("SELECT * FROM chats WHERE selection_id = ? ORDER BY pinned DESC, updated_at DESC")
      .all(filters.selectionId)
      .map((row) => chatFromRow(row as Row));
  }

  if (filters.documentId) {
    return db
      .query("SELECT * FROM chats WHERE document_id = ? ORDER BY pinned DESC, updated_at DESC")
      .all(filters.documentId)
      .map((row) => chatFromRow(row as Row));
  }

  return db.query("SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC").all().map((row) => chatFromRow(row as Row));
};

export const getChat = (chatId: string): ChatWithMessages | null => {
  const row = db.query("SELECT * FROM chats WHERE id = ?").get(chatId) as Row | null;
  if (!row) return null;
  const messages = db
    .query("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId)
    .map((message) => messageFromRow(message as Row));
  return { ...chatFromRow(row), messages };
};

export const deleteChat = (chatId: string): boolean => {
  const result = db.query("DELETE FROM chats WHERE id = ?").run(chatId);
  return result.changes > 0;
};

export const updateChat = (chatId: string, input: { title?: string; pinned?: boolean }): ChatWithMessages | null => {
  const current = getChat(chatId);
  if (!current) return null;
  const timestamp = now();
  const title = input.title?.trim() || current.title;
  const pinned = input.pinned ?? current.pinned;
  db.query("UPDATE chats SET title = ?, pinned = ?, updated_at = ? WHERE id = ?").run(title, pinned ? 1 : 0, timestamp, chatId);
  return getChat(chatId);
};

export const addChatMessage = (
  chatId: string,
  role: ChatMessage["role"],
  content: string,
  selectionContexts: ChatMessage["selectionContexts"] = []
): ChatMessage => {
  const timestamp = now();
  const messageId = id();
  db.query("INSERT INTO chat_messages (id, chat_id, role, content, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    messageId,
    chatId,
    role,
    content,
    toJson(selectionContexts),
    timestamp
  );
  db.query("UPDATE chats SET updated_at = ? WHERE id = ?").run(timestamp, chatId);
  const row = db.query("SELECT * FROM chat_messages WHERE id = ?").get(messageId) as Row | null;
  if (!row) throw new Error("Message was not created");
  return messageFromRow(row);
};

export const recordLibraryLocation = (input: {
  kind: LibraryLocation["kind"];
  name: string;
  pathHint?: string | null;
  documentId?: string | null;
}): LibraryLocation => {
  const timestamp = now();
  const locationId = id();
  db.query(
    `INSERT INTO library_locations (id, kind, name, path_hint, document_id, opened_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(locationId, input.kind, input.name, input.pathHint ?? null, input.documentId ?? null, timestamp);

  return {
    id: locationId,
    kind: input.kind,
    name: input.name,
    pathHint: input.pathHint ?? null,
    documentId: input.documentId ?? null,
    openedAt: timestamp
  };
};

export const listLibraryLocations = (): LibraryLocation[] =>
  db
    .query("SELECT * FROM library_locations ORDER BY opened_at DESC LIMIT 20")
    .all()
    .map((row) => {
      const record = row as Row;
      return {
        id: String(record.id),
        kind: record.kind as LibraryLocation["kind"],
        name: String(record.name),
        pathHint: stringOrNull(record.path_hint),
        documentId: stringOrNull(record.document_id),
        openedAt: numberValue(record.opened_at)
      };
    });

export const getReadingPosition = (documentId: string): ReadingPosition | null => {
  const row = db.query("SELECT * FROM reading_positions WHERE document_id = ?").get(documentId) as Row | null;
  if (!row) return null;
  return {
    documentId,
    pageIndex: numberValue(row.page_index),
    scrollY: numberValue(row.scroll_y),
    zoom: numberValue(row.zoom, 1),
    viewMode: row.view_mode === "page" ? "page" : "continuous",
    updatedAt: numberValue(row.updated_at)
  };
};

export const saveReadingPosition = (
  documentId: string,
  input: Partial<Omit<ReadingPosition, "documentId" | "updatedAt">>
): ReadingPosition => {
  const current = getReadingPosition(documentId);
  const next = {
    pageIndex: input.pageIndex ?? current?.pageIndex ?? 0,
    scrollY: input.scrollY ?? current?.scrollY ?? 0,
    zoom: input.zoom ?? current?.zoom ?? 1,
    viewMode: input.viewMode ?? current?.viewMode ?? "continuous"
  };
  const timestamp = now();

  db.query(
    `INSERT INTO reading_positions (document_id, page_index, scroll_y, zoom, view_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET
       page_index = excluded.page_index,
       scroll_y = excluded.scroll_y,
       zoom = excluded.zoom,
       view_mode = excluded.view_mode,
       updated_at = excluded.updated_at`
  ).run(documentId, next.pageIndex, next.scrollY, next.zoom, next.viewMode, timestamp);

  return {
    documentId,
    pageIndex: next.pageIndex,
    scrollY: next.scrollY,
    zoom: next.zoom,
    viewMode: next.viewMode,
    updatedAt: timestamp
  };
};

const snippet = (value: string, length = 180) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
};

export const search = (query: string): SearchResult[] => {
  const term = `%${query.toLowerCase()}%`;
  if (!query.trim()) return [];

  const documentRows = db
    .query("SELECT * FROM documents WHERE lower(title) LIKE ? OR lower(coalesce(language, '')) LIKE ? LIMIT 20")
    .all(term, term)
    .map((row) => {
      const document = documentFromRow(row as Row);
      return {
        id: document.id,
        type: "document" as const,
        title: document.title,
        snippet: `${document.pageCount} page${document.pageCount === 1 ? "" : "s"}`,
        documentId: document.id,
        selectionId: null,
        createdAt: document.createdAt
      };
    });

  const selectionRows = db
    .query(
      `SELECT s.*, d.title AS document_title
       FROM selections s
       JOIN documents d ON d.id = s.document_id
       WHERE lower(s.text) LIKE ? OR lower(coalesce(s.tags_json, '')) LIKE ?
       LIMIT 30`
    )
    .all(term, term)
    .map((row) => {
      const record = selectionFromRow(row as Row);
      return {
        id: record.id,
        type: "selection" as const,
        title: record.kind === "image" ? "Image selection" : "Saved text",
        snippet: snippet(record.text || `Image region on ${String((row as Row).document_title)}`),
        documentId: record.documentId,
        selectionId: record.id,
        createdAt: record.createdAt
      };
    });

  const noteRows = db
    .query("SELECT * FROM notes WHERE lower(body) LIKE ? LIMIT 30")
    .all(term)
    .map((row) => {
      const note = noteFromRow(row as Row);
      return {
        id: note.id,
        type: "note" as const,
        title: "Note",
        snippet: snippet(note.body),
        documentId: note.documentId,
        selectionId: note.selectionId,
        createdAt: note.createdAt
      };
    });

  const chatRows = db
    .query(
      `SELECT DISTINCT c.*
       FROM chats c
       LEFT JOIN chat_messages m ON m.chat_id = c.id
       WHERE lower(c.title) LIKE ? OR lower(coalesce(m.content, '')) LIKE ?
       LIMIT 30`
    )
    .all(term, term)
    .map((row) => {
      const chat = chatFromRow(row as Row);
      return {
        id: chat.id,
        type: "chat" as const,
        title: chat.title,
        snippet: "Saved AI conversation",
        documentId: chat.documentId,
        selectionId: chat.selectionId,
        createdAt: chat.createdAt
      };
    });

  return [...documentRows, ...selectionRows, ...noteRows, ...chatRows].sort((a, b) => b.createdAt - a.createdAt);
};

export const databaseFile = databasePath;
