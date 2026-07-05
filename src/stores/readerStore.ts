import { createStore } from "solid-js/store";
import type {
  ChatRecord,
  ChatWithMessages,
  DocumentWithPages,
  LibraryLocation,
  NoteRecord,
  ReaderDocument,
  SearchResult,
  SelectionRecord,
  SelectionRegion
} from "../../shared/types";
import type { PdfDocumentProxy } from "../components/ReaderPage";

export interface DraftSelection {
  kind: "text" | "image";
  text: string;
  imageData?: string | null;
  pageId: string | null;
  region: SelectionRegion | null;
}

export interface ChatContextDraft extends DraftSelection {
  id: string;
  documentId: string;
}

export interface ReaderState {
  documents: ReaderDocument[];
  locations: LibraryLocation[];
  activeDoc: DocumentWithPages | null;
  pdfDoc: PdfDocumentProxy | null;
  selections: SelectionRecord[];
  currentSelection: SelectionRecord | null;
  draftSelection: DraftSelection | null;
  notes: NoteRecord[];
  chats: ChatRecord[];
  activeChat: ChatWithMessages | null;
  chatContexts: ChatContextDraft[];
  searchResults: SearchResult[];
  currentPage: number;
  zoom: number;
  scrollY: number;
  editingNoteId: string | null;
}

export const createReaderStore = () =>
  createStore<ReaderState>({
    documents: [],
    locations: [],
    activeDoc: null,
    pdfDoc: null,
    selections: [],
    currentSelection: null,
    draftSelection: null,
    notes: [],
    chats: [],
    activeChat: null,
    chatContexts: [],
    searchResults: [],
    currentPage: 0,
    zoom: 1,
    scrollY: 0,
    editingNoteId: null
  });
