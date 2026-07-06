export type DocumentType = "pdf" | "manga" | "text";
export type PageKind = "pdf" | "image" | "text";
export type SelectionKind = "text" | "image";
export type ChatRole = "user" | "assistant" | "system";

export interface ReaderDocument {
  id: string;
  title: string;
  type: DocumentType;
  sourceName: string | null;
  sourcePath: string | null;
  language: string | null;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentPage {
  id: string;
  documentId: string;
  pageIndex: number;
  kind: PageKind;
  text: string;
  imageData: string | null;
  sourcePath: string | null;
  width: number | null;
  height: number | null;
}

export interface DocumentWithPages extends ReaderDocument {
  fileUrl: string | null;
  pages: DocumentPage[];
}

export interface SelectionRegion {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionRecord {
  id: string;
  documentId: string;
  pageId: string | null;
  kind: SelectionKind;
  text: string;
  imageData: string | null;
  region: SelectionRegion | null;
  language: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface NoteRecord {
  id: string;
  documentId: string;
  selectionId: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRecord {
  id: string;
  documentId: string | null;
  selectionId: string | null;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  selectionContexts: ChatSelectionContext[];
  createdAt: number;
}

export interface ChatWithMessages extends ChatRecord {
  messages: ChatMessage[];
}

export interface LibraryLocation {
  id: string;
  kind: "document" | "folder";
  name: string;
  pathHint: string | null;
  documentId: string | null;
  openedAt: number;
}

export interface ReadingPosition {
  documentId: string;
  pageIndex: number;
  scrollY: number;
  zoom: number;
  viewMode: "page" | "continuous";
  updatedAt: number;
}

export interface AiResponse {
  title: string;
  content: string;
  provider: "none" | "ai-sdk" | "lm-studio";
}

export interface SearchResult {
  id: string;
  type: "document" | "selection" | "note" | "chat";
  title: string;
  snippet: string;
  documentId: string | null;
  selectionId: string | null;
  createdAt: number;
}

export interface CreateDocumentInput {
  title: string;
  type: DocumentType;
  sourceName?: string | null;
  sourcePath?: string | null;
  contentData?: string | null;
  contentType?: string | null;
  language?: string | null;
  pages: Array<{
    kind: PageKind;
    text?: string;
    imageData?: string | null;
    sourcePath?: string | null;
    width?: number | null;
    height?: number | null;
  }>;
}

export interface ImportBlobFile {
  name: string;
  mimeType?: string | null;
  data: string;
}

export interface ImportBlobInput {
  name: string;
  mimeType?: string | null;
  data?: string | null;
  files?: ImportBlobFile[];
}

export interface CreateSelectionInput {
  documentId: string;
  pageId?: string | null;
  kind: SelectionKind;
  text?: string;
  imageData?: string | null;
  region?: SelectionRegion | null;
  language?: string | null;
  tags?: string[];
}

export interface CreateNoteInput {
  documentId: string;
  selectionId?: string | null;
  body: string;
}

export interface CreateChatInput {
  documentId?: string | null;
  selectionId?: string | null;
  title?: string;
}

export interface ChatSelectionContext {
  documentId: string;
  pageId?: string | null;
  kind: SelectionKind;
  text?: string;
  imageData?: string | null;
  region?: SelectionRegion | null;
}
