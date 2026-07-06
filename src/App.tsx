import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { api } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { ErrorBanner } from "./components/ErrorBanner";
import { FilePickers } from "./components/FilePickers";
import { LibraryPanel } from "./components/LibraryPanel";
import type { PdfDocumentProxy, RegionPayload } from "./components/ReaderPage";
import { ReaderTopBar } from "./components/ReaderTopBar";
import { ReaderViewport } from "./components/ReaderViewport";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { filesFromDrop, fileToDataUrl, isPickedImage } from "./fileImport";
import type { FitMode } from "./readerPreferences";
import { menuPositionForRect, visibleRectForRange } from "./readerGeometry";
import { estimateOffsetForPage, pageFromScroll } from "./readerPagination";
import { rangeExpandedToWords } from "./readerSelection";
import { createLayoutStore } from "./stores/layoutStore";
import { createReaderStore, type ChatContextDraft, type DraftSelection } from "./stores/readerStore";
import { createUiStore } from "./stores/uiStore";
import type {
  ChatMessage,
  ChatSelectionContext,
  DocumentPage,
  ReadingPosition,
  SearchResult,
  SelectionRecord,
} from "../shared/types";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const dataUrlToBytes = async (dataUrl: string) => new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());

const contextAsHighlight = (documentId: string, context: DraftSelection | ChatContextDraft, id = "draft"): SelectionRecord => ({
  id,
  documentId,
  pageId: context.pageId,
  kind: context.kind,
  text: context.text,
  imageData: context.imageData ?? null,
  region: context.region,
  language: null,
  tags: [],
  createdAt: 0,
  updatedAt: 0
});

export default function App() {
  let fileInputRef!: HTMLInputElement;
  let folderInputRef!: HTMLInputElement;
  let readerRef!: HTMLDivElement;
  let anchorFrame = 0;
  let anchoringScroll = false;
  let draftSavePromise: Promise<SelectionRecord | null> | null = null;
  let latestReadingPosition: {
    documentId: string;
    payload: Pick<ReadingPosition, "pageIndex" | "zoom" | "viewMode" | "scrollY">;
  } | null = null;

  const [noteDraft, setNoteDraft] = createSignal("");
  const [chatDraft, setChatDraft] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const { layout, setLayout, assistantStacked } = createLayoutStore();
  const [reader, setReader] = createReaderStore();
  const [ui, setUi] = createUiStore();

  const pageCount = createMemo(() => reader.activeDoc?.pages.length ?? 0);
  const activeSelectionText = createMemo(() => reader.draftSelection?.text || reader.currentSelection?.text || "");
  const panelSelectionContext = createMemo<SelectionRecord | DraftSelection | null>(() => reader.draftSelection ?? reader.currentSelection);
  const activeFloatingMenu = createMemo(() => {
    const menu = ui.floatingMenu;
    if (!menu) return null;
    if (menu.kind === "text" && !activeSelectionText().trim()) return null;
    if (menu.kind === "image" && reader.draftSelection?.kind !== "image" && reader.currentSelection?.kind !== "image") return null;
    return menu;
  });
  const highlightSelections = createMemo(() => {
    const doc = reader.activeDoc;
    const highlights: SelectionRecord[] = [];
    if (reader.currentSelection) highlights.push(reader.currentSelection);
    for (const context of reader.chatContexts) highlights.push(contextAsHighlight(context.documentId, context, context.id));
    return highlights;
  });
  const updateFloatingSelectionText = (text: string) => {
    const draft = reader.draftSelection;
    if (draft) {
      setReader("draftSelection", { ...draft, text });
      return;
    }
    setReader("currentSelection", (selection) => (selection ? { ...selection, text } : selection));
  };
  const currentChatContextDraft = (): ChatContextDraft | null => {
    const doc = reader.activeDoc;
    const draft = reader.draftSelection;
    if (doc && draft) {
      if (draft.kind === "text" && !draft.text.trim()) return null;
      return {
        id: crypto.randomUUID(),
        documentId: doc.id,
        ...draft
      };
    }

    const selection = reader.currentSelection;
    if (selection) {
      if (selection.kind === "text" && !selection.text.trim()) return null;
      return {
        id: crypto.randomUUID(),
        documentId: selection.documentId,
        pageId: selection.pageId,
        kind: selection.kind,
        text: selection.text,
        imageData: selection.imageData,
        region: selection.region
      };
    }

    return null;
  };
  const addCurrentContextToChatInput = () => {
    const context = currentChatContextDraft();
    if (!context) return;
    setReader("chatContexts", (contexts) => [...contexts, context]);
  };
  const effectiveChatContexts = () => {
    if (reader.chatContexts.length > 0) return reader.chatContexts;
    const context = currentChatContextDraft();
    return context ? [context] : [];
  };
  const pinnedSelectionPage = createMemo(() => {
    const selectionPageId = reader.draftSelection?.pageId ?? reader.currentSelection?.pageId ?? null;
    if (!ui.floatingMenu || !selectionPageId || !reader.activeDoc) return null;
    const pageIndex = reader.activeDoc.pages.findIndex((page) => page.id === selectionPageId);
    return pageIndex >= 0 ? pageIndex : null;
  });
  const renderedPageIndexes = createMemo(() => {
    const doc = reader.activeDoc;
    if (!doc) return [];
    if (layout.viewMode === "page") return [Math.max(0, Math.min(reader.currentPage, doc.pages.length - 1))];
    const indexes: number[] = [];
    for (let index = 0; index < doc.pages.length; index += 1) indexes.push(index);
    return indexes;
  });
  const workspaceColumns = createMemo(() => {
    const columns = [];
    if (layout.showLibrary) columns.push(`${layout.libraryWidth}px`, "4px");
    columns.push("minmax(0, 1fr)");
    if (reader.activeDoc && layout.showAssistant && !assistantStacked()) columns.push("4px", `${layout.assistantWidth}px`);
    return columns.join(" ");
  });
  const clampZoom = (value: number) => Math.max(0.35, Math.min(3, Number(value.toFixed(2))));
  const pageSizeForFit = () => {
    const page = reader.activeDoc?.pages[reader.currentPage];
    return {
      width: page?.width ?? 760,
      height: page?.height ?? 980
    };
  };

  const fitZoomFor = (mode: "width" | "height") => {
    const viewport = readerRef;
    if (!viewport) return null;
    if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return null;
    const page = pageSizeForFit();
    const availableWidth = Math.max(320, viewport.clientWidth - 24);
    const availableHeight = Math.max(320, viewport.clientHeight - 28);
    const widthScale = availableWidth / page.width;
    const heightScale = availableHeight / page.height;
    return clampZoom(mode === "width" ? widthScale : heightScale);
  };

  const refit = () => {
    const mode = layout.fitMode;
    if (mode === "manual") return false;
    const nextZoom = fitZoomFor(mode);
    if (nextZoom === null || nextZoom === reader.zoom) return false;
    setReader("zoom", nextZoom);
    return true;
  };

  const anchorContinuousPage = (pageIndex: number, nextZoom = reader.zoom) => {
    if (layout.viewMode !== "continuous" || !reader.activeDoc || !readerRef) return;
    window.cancelAnimationFrame(anchorFrame);
    anchoringScroll = true;
    anchorFrame = window.requestAnimationFrame(() => {
      anchorFrame = window.requestAnimationFrame(() => {
        const top = estimateOffsetForPage(reader.activeDoc, pageIndex, nextZoom);
        readerRef.scrollTo({ top });
        setReader("scrollY", top);
        setReader("currentPage", pageIndex);
        window.requestAnimationFrame(() => {
          anchoringScroll = false;
        });
      });
    });
  };

  const applyFit = (mode: "width" | "height") => {
    const page = untrack(() => reader.currentPage);
    setLayout("fitMode", mode);
    const nextZoom = fitZoomFor(mode);
    if (nextZoom !== null) {
      setReader("zoom", nextZoom);
      anchorContinuousPage(page, nextZoom);
    }
  };

  const preserveCurrentPageAfterLayoutChange = (page = untrack(() => reader.currentPage)) => {
    window.requestAnimationFrame(() => {
      if (layout.fitMode !== "manual") refit();
      anchorContinuousPage(page);
    });
  };

  const toggleLibrary = () => {
    const page = untrack(() => reader.currentPage);
    setLayout("showLibrary", (visible) => {
      const next = !visible;
      if (next && assistantStacked()) setLayout("showAssistant", false);
      return next;
    });
    preserveCurrentPageAfterLayoutChange(page);
  };

  const toggleAssistant = () => {
    const page = untrack(() => reader.currentPage);
    setLayout("showAssistant", (visible) => {
      const next = !visible;
      if (next && assistantStacked()) setLayout("showLibrary", false);
      return next;
    });
    preserveCurrentPageAfterLayoutChange(page);
  };

  const showAssistantDrawer = () => {
    if (assistantStacked()) setLayout("showLibrary", false);
    setLayout("showAssistant", true);
  };

  const setManualZoom = (next: (value: number) => number) => {
    const page = untrack(() => reader.currentPage);
    setLayout("fitMode", "manual");
    setReader("zoom", (value) => {
      const nextZoom = clampZoom(next(value));
      anchorContinuousPage(page, nextZoom);
      return nextZoom;
    });
  };

  const setViewMode = (mode: typeof layout.viewMode) => setLayout("viewMode", mode);
  const setThemeMode = (mode: typeof layout.themeMode) => setLayout("themeMode", mode);
  const setSelectionMode = (mode: typeof layout.selectionMode) => setLayout("selectionMode", mode);
  const flushReadingPosition = (keepalive = false) => {
    if (!latestReadingPosition) return;
    const { documentId, payload } = latestReadingPosition;
    void api.savePosition(documentId, payload, { keepalive }).catch((positionError) => {
      if (!keepalive) {
        setUi("error", positionError instanceof Error ? positionError.message : "Could not save reading position");
      }
    });
  };

  const refreshLibrary = async () => {
    const [{ documents: nextDocuments }, { locations: nextLocations }] = await Promise.all([
      api.listDocuments(),
      api.listLocations()
    ]);
    setReader("documents", nextDocuments);
    setReader("locations", nextLocations);
    return { documents: nextDocuments, locations: nextLocations };
  };

  const loadSideData = async (documentId: string) => {
    const [{ selections: nextSelections }, { notes: nextNotes }, { chats: nextChats }] = await Promise.all([
      api.listSelections(documentId),
      api.listNotes(documentId),
      api.listChats({ documentId })
    ]);
    setReader("selections", nextSelections);
    setReader("notes", nextNotes);
    setReader("chats", nextChats);
    setReader("currentSelection", null);
    setReader("activeChat", null);
    setReader("editingNoteId", null);
    setNoteDraft("");
  };

  const openDocument = async (documentId: string, remember = true) => {
    setUi("busy", "Opening");
    setUi("error", "");
    setReader("activeDoc", null);
    setReader("pdfDoc", null);
    setReader("draftSelection", null);
    setReader("currentSelection", null);
    setUi("floatingMenu", null);
    try {
      const [{ document }, { position }] = await Promise.all([api.getDocument(documentId), api.getPosition(documentId)]);
      const restoredPdf =
        document.type === "pdf" && document.fileUrl
          ? await (pdfjsLib as any).getDocument({ data: await dataUrlToBytes(document.fileUrl) }).promise
          : null;
      setReader("activeDoc", document);
      setReader("pdfDoc", restoredPdf);
      setReader("draftSelection", null);
      setReader("currentPage", Math.min(position?.pageIndex ?? 0, Math.max(document.pages.length - 1, 0)));
      setReader("zoom", position?.zoom ?? 1);
      setLayout("viewMode", position?.viewMode ?? layout.viewMode);
      setLayout("selectionMode", document.type === "manga" ? "image" : "text");
      setReader("scrollY", position?.scrollY ?? 0);
      await loadSideData(document.id);
      if (remember) {
        await api.recordLocation({ kind: "document", name: document.title, documentId: document.id });
        setReader("locations", (await api.listLocations()).locations);
      }
      window.requestAnimationFrame(() => {
        readerRef?.scrollTo({ top: position?.scrollY ?? 0 });
      });
    } catch (openError) {
      setUi("error", openError instanceof Error ? openError.message : "Could not open document");
    } finally {
      setUi("busy", "");
    }
  };

  onMount(async () => {
    let measureFrame = 0;
    const measureReader = () => {
      if (!readerRef) return;
      window.cancelAnimationFrame(measureFrame);
      measureFrame = window.requestAnimationFrame(() => {
        const width = readerRef.clientWidth;
        const height = readerRef.clientHeight;
        if (width <= 0 || height <= 0) return;
        if (layout.readerSize.width !== width || layout.readerSize.height !== height) setLayout("readerSize", { width, height });
      });
    };
    const resizeObserver = new ResizeObserver(measureReader);
    if (readerRef) resizeObserver.observe(readerRef);
    window.addEventListener("resize", measureReader);
    const measureViewport = () => setLayout("viewportWidth", window.innerWidth);
    const flushOnPageHide = () => flushReadingPosition(true);
    window.addEventListener("resize", measureViewport);
    window.addEventListener("pagehide", flushOnPageHide);
    measureViewport();
    measureReader();
    onCleanup(() => {
      window.cancelAnimationFrame(measureFrame);
      window.cancelAnimationFrame(anchorFrame);
      window.removeEventListener("resize", measureReader);
      window.removeEventListener("resize", measureViewport);
      window.removeEventListener("pagehide", flushOnPageHide);
      resizeObserver.disconnect();
    });

    try {
      const { documents: nextDocuments, locations: nextLocations } = await refreshLibrary();
      const lastDocumentId = nextLocations.find((location) => location.documentId)?.documentId;
      const startupDocument = lastDocumentId
        ? nextDocuments.find((document) => document.id === lastDocumentId)
        : nextDocuments[0];
      if (startupDocument) await openDocument(startupDocument.id, false);
    } catch (loadError) {
      setUi("error", loadError instanceof Error ? loadError.message : "Could not load library");
    }
  });

  createEffect(() => {
    if (assistantStacked() && layout.showLibrary && layout.showAssistant) setLayout("showLibrary", false);
  });

  createEffect(() => {
    const mode = layout.fitMode;
    reader.activeDoc;
    layout.readerSize.width;
    layout.readerSize.height;
    layout.viewMode;
    layout.libraryWidth;
    layout.assistantWidth;
    layout.notesHeight;
    if (mode !== "manual") {
      const page = untrack(() => reader.currentPage);
      window.requestAnimationFrame(() => {
        if (refit()) anchorContinuousPage(page);
      });
    }
  });

  createEffect(() => {
    const query = searchQuery().trim();
    if (query.length < 2) {
      setReader("searchResults", []);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setReader("searchResults", (await api.search(query)).results);
      } catch (searchError) {
        setUi("error", searchError instanceof Error ? searchError.message : "Search failed");
      }
    }, 180);

    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    if (!ui.floatingMenu) return;

    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".selection-menu")) return;
      if (target && readerRef?.contains(target)) {
        setReader("draftSelection", null);
        setUi("floatingMenu", null);
        return;
      }
      if (target?.closest(".insight-panel")) {
        setUi("floatingMenu", null);
        return;
      }
      setReader("draftSelection", null);
      setUi("floatingMenu", null);
    };

    document.addEventListener("pointerdown", closeFromPointer);
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeFromPointer);
    });
  });

  let textSelectionCaptureFrame = 0;

  createEffect(() => {
    const captureFromPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".selection-menu")) return;
      const readerBounds = readerRef?.getBoundingClientRect();
      const pointer =
        readerBounds &&
        event.clientX >= readerBounds.left &&
        event.clientX <= readerBounds.right &&
        event.clientY >= readerBounds.top &&
        event.clientY <= readerBounds.bottom
          ? { x: event.clientX, y: event.clientY }
          : null;
      window.cancelAnimationFrame(textSelectionCaptureFrame);
      textSelectionCaptureFrame = window.requestAnimationFrame(() => {
        textSelectionCaptureFrame = 0;
        captureTextSelection(pointer);
      });
    };
    document.addEventListener("pointerup", captureFromPointer);
    onCleanup(() => {
      window.cancelAnimationFrame(textSelectionCaptureFrame);
      document.removeEventListener("pointerup", captureFromPointer);
    });
  });

  createEffect(() => {
    const doc = reader.activeDoc;
    const body = noteDraft().trim();
    const selectionId = reader.currentSelection?.id ?? null;
    const noteId = reader.editingNoteId;
    if (!doc || (!body && !noteId)) return;

    const timer = window.setTimeout(async () => {
      try {
        if (noteId && !body) {
          const existingNote = reader.notes.find((item) => item.id === noteId);
          await api.deleteNote(noteId);
          if (existingNote?.selectionId) {
            await api.deleteSelection(existingNote.selectionId);
            setReader("selections", (items) => items.filter((selection) => selection.id !== existingNote.selectionId));
            if (reader.currentSelection?.id === existingNote.selectionId) setReader("currentSelection", null);
          }
          setReader("notes", (items) => items.filter((item) => item.id !== noteId));
          setReader("editingNoteId", (current) => (current === noteId ? null : current));
        } else if (noteId) {
          const { note } = await api.updateNote(noteId, body);
          setReader("notes", (items) => items.map((item) => (item.id === note.id ? note : item)));
        } else {
          const { note } = await api.createNote({ documentId: doc.id, selectionId, body });
          setReader("editingNoteId", note.id);
          setReader("notes", (items) => [note, ...items]);
        }
      } catch (noteError) {
        setUi("error", noteError instanceof Error ? noteError.message : "Could not save note");
      }
    }, 250);

    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    const selectionId = reader.currentSelection?.id ?? null;
    const existing = untrack(() => reader.notes.find((note) => (note.selectionId ?? null) === selectionId));
    setReader("editingNoteId", existing?.id ?? null);
    setNoteDraft(existing?.body ?? "");
  });

  createEffect(() => {
    const doc = reader.activeDoc;
    if (!doc) return;
    const payload = {
      pageIndex: reader.currentPage,
      zoom: reader.zoom,
      viewMode: layout.viewMode,
      scrollY: reader.scrollY
    };
    latestReadingPosition = { documentId: doc.id, payload };
    const timer = window.setTimeout(() => {
      flushReadingPosition();
    }, 350);
    onCleanup(() => window.clearTimeout(timer));
  });

  const importPickedFiles = async (pickedFiles: File[]) => {
    if (pickedFiles.length === 0) return;
    setUi("busy", "Opening");
    setUi("error", "");
    try {
      const rawNamedFiles = await Promise.all(
        pickedFiles.map(async (file) => ({
          name: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          mimeType: file.type || null,
          data: await fileToDataUrl(file)
        }))
      );
      const isFolderImport = rawNamedFiles.some((file) => file.name.includes("/"));
      const namedFiles = isFolderImport ? rawNamedFiles.filter(isPickedImage) : rawNamedFiles;
      if (namedFiles.length === 0) {
        throw new Error("Folder does not contain supported image files");
      }

      let sourceName = `${pickedFiles.length} images`;
      if (isFolderImport) {
        sourceName = rawNamedFiles[0].name.split("/")[0];
      } else if (namedFiles[0]?.name.includes("/")) {
        sourceName = namedFiles[0].name.split("/")[0];
      } else if (pickedFiles.length === 1) {
        sourceName = pickedFiles[0].name;
      }

      const importedDocuments =
        namedFiles.length > 1 && !namedFiles.every(isPickedImage)
          ? await Promise.all(
              namedFiles.map((file) =>
                api.importBlob({
                  name: file.name,
                  mimeType: file.mimeType,
                  data: file.data
                })
              )
            )
          : [
              await api.importBlob(
                namedFiles.length === 1
                  ? {
                      name: namedFiles[0].name,
                      mimeType: namedFiles[0].mimeType,
                      data: namedFiles[0].data
                    }
                  : {
                      name: sourceName,
                      files: namedFiles
                    }
              )
            ];
      if (importedDocuments[0]) await openDocument(importedDocuments[0].document.id);
      await refreshLibrary();
    } catch (pickError) {
      setUi("error", pickError instanceof Error ? pickError.message : "Could not open file");
    } finally {
      setUi("busy", "");
    }
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    setUi("dropActive", false);
    if (!event.dataTransfer) return;
    const files = await filesFromDrop(event.dataTransfer);
    await importPickedFiles(files);
  };

  const openFilePicker = () => {
    fileInputRef.value = "";
    fileInputRef.click();
  };

  const openFolderPicker = () => {
    folderInputRef.value = "";
    folderInputRef.click();
  };

  function captureTextSelection(pointer: { x: number; y: number } | null = null) {
    if (layout.selectionMode !== "text") return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) return;

    const anchorNode = selection.anchorNode;
    const element =
      anchorNode instanceof HTMLElement
        ? anchorNode
        : anchorNode?.parentElement ?? null;
    if (!element || !readerRef.contains(element)) return;
    const pageElement = element.closest<HTMLElement>("[data-page-id]");
    if (!pageElement) return;
    const pageId = pageElement.dataset.pageId ?? null;
    const pageIndex = Number(pageElement.dataset.pageIndex ?? reader.currentPage);
    const isPdfTextLayer = Boolean(pageElement.querySelector(".textLayer"));
    const nativeRange = selection.getRangeAt(0);
    const range = isPdfTextLayer ? nativeRange : rangeExpandedToWords(nativeRange);
    const menuRect = visibleRectForRange(range, selection.focusNode, selection.focusOffset, pointer);
    if (!menuRect) return;
    if (!range.collapsed && !isPdfTextLayer) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const rect = range.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return;
    const pageContent = pageElement.querySelector<HTMLElement>(".text-page, .media-page");
    const contentRect = pageContent?.getBoundingClientRect();
    const region =
      contentRect
        ? {
            pageIndex,
            x: Math.max(0, Math.round(rect.left - contentRect.left)),
            y: Math.max(0, Math.round(rect.top - contentRect.top)),
            width: Math.round(Math.min(rect.width, contentRect.right - rect.left)),
            height: Math.round(Math.min(rect.height, contentRect.bottom - rect.top))
          }
        : {
            pageIndex,
            x: 0,
            y: 0,
            width: 0,
            height: 0
          };
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) return;
    setReader("draftSelection", {
      kind: "text",
      text,
      pageId,
      region
    });
    setUi("floatingMenu", {
      kind: "text",
      ...menuPositionForRect(menuRect)
    });
  }

  const clearContextSelection = () => {
    setReader("draftSelection", null);
    setUi("floatingMenu", null);
    window.getSelection()?.removeAllRanges();
  };

  const rectForDraftRegion = () => {
    const draft = reader.draftSelection;
    if (!draft?.region || !draft.pageId) return null;
    const pageElement = [...document.querySelectorAll<HTMLElement>("[data-page-id]")]
      .find((element) => element.dataset.pageId === draft.pageId);
    const pageContent = pageElement?.querySelector<HTMLElement>(".text-page, .media-page");
    if (!pageContent) return null;
    const contentRect = pageContent.getBoundingClientRect();
    return new DOMRect(
      contentRect.left + draft.region.x,
      contentRect.top + draft.region.y,
      draft.region.width,
      draft.region.height
    );
  };

  const syncFloatingMenuWithReader = () => {
    const menu = ui.floatingMenu;
    if (!menu) return;

    if (menu.kind === "text") {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed && selection.toString().trim()) {
        const rect = visibleRectForRange(selection.getRangeAt(0), selection.focusNode, selection.focusOffset);
        if (rect) setUi("floatingMenu", { kind: "text", ...menuPositionForRect(rect) });
        return;
      }
      const rect = rectForDraftRegion();
      if (rect) setUi("floatingMenu", { kind: "text", ...menuPositionForRect(rect) });
      return;
    }

    const rect = rectForDraftRegion();
    if (!rect) {
      setUi("floatingMenu", null);
      return;
    }
    setUi("floatingMenu", { kind: "image", ...menuPositionForRect(rect) });
  };

  const saveDraftSelection = async (
    options: { keepMenu?: boolean; silent?: boolean; preserveUserSelection?: boolean } = {}
  ) => {
    if (draftSavePromise) return await draftSavePromise;
    const doc = reader.activeDoc;
    const draft = reader.draftSelection;
    if (!doc || !draft) return null;

    draftSavePromise = (async () => {
      if (!options.silent) setUi("busy", "Saving selection");
      setUi("error", "");
      if (!options.keepMenu) {
        setUi("floatingMenu", null);
        if (!options.preserveUserSelection) window.getSelection()?.removeAllRanges();
      }
      try {
        const { selection } = await api.createSelection({
          documentId: doc.id,
          pageId: draft.pageId,
          kind: draft.kind,
          text: draft.text,
          imageData: draft.imageData ?? null,
          region: draft.region,
          tags: draft.kind === "image" ? ["image", "region"] : ["text"]
        });
        setReader("selections", (items) => [selection, ...items]);
        setReader("currentSelection", selection);
        setReader("draftSelection", null);
        return selection;
      } catch (saveError) {
        setUi("error", saveError instanceof Error ? saveError.message : "Could not save selection");
        return null;
      } finally {
        if (!options.silent) setUi("busy", "");
        draftSavePromise = null;
      }
    })();

    return await draftSavePromise;
  };

  const handleRegion = (page: DocumentPage, pageIndex: number, payload: RegionPayload) => {
    if (layout.selectionMode !== "image") return;
    setReader("draftSelection", {
      kind: "image",
      text: "",
      imageData: payload.imageData,
      pageId: page.id,
      region: payload.region
    });
    setUi("floatingMenu", { kind: "image", ...payload.menu });
  };

  const findSelectionById = async (selectionId: string) => {
    const existing = reader.selections.find((selection) => selection.id === selectionId);
    if (existing) return existing;
    const { selections } = await api.listSelections(reader.activeDoc?.id);
    setReader("selections", selections);
    return selections.find((selection) => selection.id === selectionId) ?? null;
  };

  const selectSavedSelection = async (selection: SelectionRecord) => {
    setReader("currentSelection", selection);
    setReader("draftSelection", null);
    const pageIndex =
      selection.region?.pageIndex ??
      reader.activeDoc?.pages.findIndex((page) => page.id === selection.pageId) ??
      -1;
    if (pageIndex >= 0) goToPage(pageIndex);
    const { chats: nextChats } = await api.listChats({ selectionId: selection.id });
    setReader("chats", (existing) => {
      const merged = [...nextChats, ...existing.filter((chat) => chat.selectionId !== selection.id)];
      return merged;
    });
    setReader("activeChat", nextChats[0] ? (await api.getChat(nextChats[0].id)).chat : null);
  };

  const openSearchResult = async (result: SearchResult) => {
    if (result.documentId) await openDocument(result.documentId);

    if (result.selectionId) {
      const selection = await findSelectionById(result.selectionId);
      if (selection) await selectSavedSelection(selection);
    }

    if (result.type === "note") {
      const note = reader.notes.find((item) => item.id === result.id);
      if (note) {
        const linkedSelection = note.selectionId ? await findSelectionById(note.selectionId) : null;
        showAssistantDrawer();
        if (linkedSelection) await selectSavedSelection(linkedSelection);
        else setReader("currentSelection", null);
        setReader("editingNoteId", note.id);
        setNoteDraft(note.body);
        setUi("noteFocusRequest", (value) => value + 1);
      }
    }

    if (result.type === "chat") {
      await activateChat(result.id);
    }
  };

  const activateChat = async (chatId: string) => {
    const { chat } = await api.getChat(chatId);
    const linkedSelection = chat.selectionId ? await findSelectionById(chat.selectionId) : null;
    if (linkedSelection) {
      const pageIndex =
        linkedSelection.region?.pageIndex ??
        reader.activeDoc?.pages.findIndex((page) => page.id === linkedSelection.pageId) ??
        -1;
      setReader("currentSelection", linkedSelection);
      setReader("draftSelection", null);
      if (pageIndex >= 0) goToPage(pageIndex);
    } else {
      setReader("currentSelection", null);
    }
    showAssistantDrawer();
    setReader("activeChat", chat);
    setReader("chats", (items) => [chat, ...items.filter((item) => item.id !== chat.id)]);
  };

  const useDocumentNote = () => {
    setReader("currentSelection", null);
    setReader("draftSelection", null);
  };

  const deleteSavedSelection = async (selection: SelectionRecord) => {
    const result = await api.deleteSelection(selection.id);
    setReader("selections", (items) => items.filter((item) => item.id !== selection.id));
    setReader("notes", (items) => items.map((note) => result.notes.find((updated) => updated.id === note.id) ?? note));
    setReader("chats", (items) => items.map((chat) => result.chats.find((updated) => updated.id === chat.id) ?? chat));
    if (reader.currentSelection?.id === selection.id) {
      setReader("currentSelection", null);
      setReader("draftSelection", null);
    }
    if (reader.activeChat?.selectionId === selection.id) {
      setReader("activeChat", (chat) => {
        if (!chat) return chat;
        const updated = result.chats.find((item) => item.id === chat.id);
        return updated ? { ...chat, ...updated } : chat;
      });
    }
  };

  const deleteSavedChat = async (chatId: string) => {
    await api.deleteChat(chatId);
    setReader("chats", (items) => items.filter((item) => item.id !== chatId));
    if (reader.activeChat?.id === chatId) setReader("activeChat", null);
  };

  const updateSavedChat = async (chatId: string, input: { title?: string; pinned?: boolean }) => {
    const { chat } = await api.updateChat(chatId, input);
    setReader("chats", (items) =>
      [chat, ...items.filter((item) => item.id !== chat.id)].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt
      )
    );
    if (reader.activeChat?.id === chat.id) setReader("activeChat", chat);
  };

  const commitDraftForSidePanel = async () => {
    if (!reader.draftSelection) return reader.currentSelection;
    return await saveDraftSelection({ silent: true, preserveUserSelection: true });
  };

  const handleNoteDraft = (body: string) => {
    if (!reader.draftSelection) {
      setNoteDraft(body);
      return;
    }

    if (!body.trim()) {
      setNoteDraft(body);
      return;
    }

    void (async () => {
      await commitDraftForSidePanel();
      setNoteDraft(body);
    })();
  };

  const handleChatDraft = (body: string) => {
    setChatDraft(body);
  };

  const createNoteFromSelection = async () => {
    const doc = reader.activeDoc;
    if (!doc) return;
    showAssistantDrawer();
    setUi("floatingMenu", null);
    setUi("noteFocusRequest", (value) => value + 1);
  };

  const removeNote = async (noteId: string) => {
    const existingNote = reader.notes.find((note) => note.id === noteId);
    await api.deleteNote(noteId);
    if (existingNote?.selectionId) {
      await api.deleteSelection(existingNote.selectionId);
      setReader("selections", (items) => items.filter((selection) => selection.id !== existingNote.selectionId));
      if (reader.currentSelection?.id === existingNote.selectionId) setReader("currentSelection", null);
    }
    setReader("notes", (items) => items.filter((note) => note.id !== noteId));
    if (reader.editingNoteId === noteId) {
      setReader("editingNoteId", null);
      setNoteDraft("");
    }
  };

  const createChatForSelection = async () => {
    const doc = reader.activeDoc;
    if (!doc) throw new Error("Open a document before chatting");
    const contexts = effectiveChatContexts();
    const { chat } = await api.createChat({
      documentId: doc.id,
      selectionId: null,
      title: contexts.length > 0 ? "Selection discussion" : "Document discussion"
    });
    setReader("activeChat", chat);
    setReader("chats", (items) => [chat, ...items]);
    return chat;
  };

  const ensureChat = async () => {
    const existing = reader.activeChat;
    if (existing) return existing;
    return await createChatForSelection();
  };

  const startNewChatFromSelection = async () => {
    showAssistantDrawer();
    setReader("activeChat", null);
    addCurrentContextToChatInput();
    setUi("floatingMenu", null);
    setUi("chatFocusRequest", (value) => value + 1);
  };

  const addSelectionToCurrentChat = async () => {
    const chat = reader.activeChat;
    if (!chat) return;
    showAssistantDrawer();
    addCurrentContextToChatInput();
    setUi("floatingMenu", null);
    setUi("chatFocusRequest", (value) => value + 1);
  };

  const sendChat = async () => {
    const message = chatDraft().trim();
    if (!message) return;
    setUi("busy", "Chatting");
    setUi("error", "");
    try {
      const consumedDraftSelection = reader.draftSelection;
      const chat = await ensureChat();
      const contexts = effectiveChatContexts().map((context) => ({
        documentId: context.documentId,
        pageId: context.pageId,
        kind: context.kind,
        text: context.text,
        imageData: context.imageData ?? null,
        region: context.region
      }));
      const optimisticUserMessage: ChatMessage = {
        id: `pending-${Date.now()}`,
        chatId: chat.id,
        role: "user",
        content: message,
        selectionContexts: contexts,
        createdAt: Date.now()
      };
      const optimisticChat = {
        ...chat,
        messages: [...chat.messages, optimisticUserMessage]
      };
      setReader("activeChat", optimisticChat);
      setReader("chats", (items) => [optimisticChat, ...items.filter((item) => item.id !== optimisticChat.id)]);
      setChatDraft("");
      const { chat: nextChat } = await api.sendMessage(chat.id, message, reader.currentSelection?.id, contexts);
      setReader("activeChat", nextChat);
      setReader("chatContexts", []);
      setReader("chats", (items) => [nextChat, ...items.filter((item) => item.id !== nextChat.id)]);
      if (consumedDraftSelection) {
        setReader("draftSelection", null);
        setReader("currentSelection", null);
        setUi("floatingMenu", null);
      }
    } catch (chatError) {
      setUi("error", chatError instanceof Error ? chatError.message : "Chat failed");
    } finally {
      setUi("busy", "");
    }
  };

  const goToPage = (index: number) => {
    const bounded = Math.max(0, Math.min(index, Math.max(pageCount() - 1, 0)));
    setReader("currentPage", bounded);
    window.requestAnimationFrame(() => {
      if (layout.viewMode === "continuous") {
        readerRef?.scrollTo({ top: estimateOffsetForPage(reader.activeDoc, bounded, reader.zoom), behavior: "smooth" });
      } else {
        readerRef
          ?.querySelector<HTMLElement>(`[data-page-index="${bounded}"]`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });
  };

  const handleReaderKeyDown = (event: KeyboardEvent) => {
    if (!reader.activeDoc) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest("input, textarea, select, button") ||
      target?.isContentEditable
    ) {
      return;
    }

    const keyTargets: Record<string, number> = {
      ArrowRight: reader.currentPage + 1,
      PageDown: reader.currentPage + 1,
      ArrowLeft: reader.currentPage - 1,
      PageUp: reader.currentPage - 1,
      Home: 0,
      End: pageCount() - 1
    };
    const nextPage = keyTargets[event.key];
    if (nextPage === undefined) return;
    event.preventDefault();
    goToPage(nextPage);
  };

  const startPaneResize = (pane: "library" | "assistant", event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = pane === "library" ? layout.libraryWidth : layout.assistantWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = pane === "library" ? startWidth + delta : startWidth - delta;
      const bounded = Math.max(176, Math.min(520, Math.round(next)));
      setLayout(pane === "library" ? "libraryWidth" : "assistantWidth", bounded);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startNotesResize = (event: PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = layout.notesHeight;
    const onMove = (moveEvent: PointerEvent) => {
      const next = startHeight + (moveEvent.clientY - startY);
      setLayout("notesHeight", Math.max(150, Math.min(620, Math.round(next))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      class="app-shell"
      classList={{ "theme-dark": layout.themeMode === "dark" }}
    >
      <FilePickers
        onFiles={(files) => void importPickedFiles(files)}
        onFilePickerReady={(element) => {
          fileInputRef = element;
        }}
        onFolderPickerReady={(element) => {
          folderInputRef = element;
        }}
      />
      <ReaderTopBar
        title={reader.activeDoc?.title ?? ""}
        hasDocument={Boolean(reader.activeDoc)}
        busy={ui.busy}
        currentPage={reader.currentPage}
        pageCount={pageCount()}
        zoom={reader.zoom}
        viewMode={layout.viewMode}
        fitMode={layout.fitMode}
        showLibrary={layout.showLibrary}
        showAssistant={layout.showAssistant}
        themeMode={layout.themeMode}
        selectionMode={layout.selectionMode}
        onGoToPage={goToPage}
        onSetViewMode={setViewMode}
        onFit={applyFit}
        onZoom={setManualZoom}
        onToggleLibrary={toggleLibrary}
        onToggleAssistant={toggleAssistant}
        onSetThemeMode={setThemeMode}
        onSetSelectionMode={setSelectionMode}
      />
      <div
        class="workspace"
        classList={{
          "no-document": !reader.activeDoc,
          "library-hidden": !layout.showLibrary,
          "assistant-stacked": Boolean(reader.activeDoc && layout.showAssistant && assistantStacked())
        }}
        style={{ "grid-template-columns": workspaceColumns() }}
      >
        <Show when={layout.showLibrary}>
          <LibraryPanel
            documents={reader.documents}
            searchQuery={searchQuery()}
            searchResults={reader.searchResults}
            activeDocument={reader.activeDoc}
            onSearch={setSearchQuery}
            onOpenPicker={openFilePicker}
            onOpenFolderPicker={openFolderPicker}
            onOpenDocument={(documentId) => void openDocument(documentId)}
            onOpenSearchResult={(result) => void openSearchResult(result)}
          />
          <div class="resize-handle" data-testid="library-resizer" onPointerDown={(event) => startPaneResize("library", event)} />
        </Show>

        <main class="reader-panel">
          <Show when={ui.error}>
            <ErrorBanner message={ui.error} onDismiss={() => setUi("error", "")} />
          </Show>

          <ReaderViewport
            readerRef={(element) => {
              readerRef = element;
            }}
            activeDocument={reader.activeDoc}
            renderedPageIndexes={renderedPageIndexes()}
            retainedPageIndex={pinnedSelectionPage()}
            continuous={layout.viewMode === "continuous"}
            dropActive={ui.dropActive}
            pdfDoc={reader.pdfDoc}
            zoom={reader.zoom}
            selectionMode={layout.selectionMode}
            currentSelection={reader.currentSelection}
            highlightSelections={highlightSelections()}
            onOpen={openFilePicker}
            onKeyDown={handleReaderKeyDown}
            onDragEnter={(event) => {
              event.preventDefault();
              setUi("dropActive", true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              setUi("dropActive", true);
            }}
            onDragLeave={() => setUi("dropActive", false)}
            onDrop={(event) => void handleDrop(event)}
            onScroll={(nextScroll) => {
              setReader("scrollY", nextScroll);
              syncFloatingMenuWithReader();
              if (layout.viewMode === "continuous" && !anchoringScroll) setReader("currentPage", pageFromScroll(reader.activeDoc, nextScroll, reader.zoom));
            }}
            onRegion={handleRegion}
          />
        </main>

        <Show when={reader.activeDoc && layout.showAssistant}>
          <Show when={!assistantStacked()}>
            <div class="resize-handle right" data-testid="assistant-resizer" onPointerDown={(event) => startPaneResize("assistant", event)} />
          </Show>
          <AssistantPanel
            notesHeight={layout.notesHeight}
            notes={reader.notes}
            selections={reader.selections}
            currentSelection={panelSelectionContext()}
            editingNoteId={reader.editingNoteId}
            noteDraft={noteDraft()}
            chats={reader.chats}
            activeChat={reader.activeChat}
            stagedChatContextCount={reader.chatContexts.length}
            chatDraft={chatDraft()}
            noteFocusRequest={ui.noteFocusRequest}
            chatFocusRequest={ui.chatFocusRequest}
            onNoteDraft={handleNoteDraft}
            onUseDocumentNote={useDocumentNote}
            onSelectNote={(note, linkedSelection) => {
              if (linkedSelection) void selectSavedSelection(linkedSelection);
              else setReader("currentSelection", null);
              setReader("editingNoteId", note.id);
              setNoteDraft(note.body);
            }}
            onDeleteNote={(noteId) => void removeNote(noteId)}
            onStartNotesResize={startNotesResize}
            onSelectChat={(chatId) => void activateChat(chatId)}
            onDeleteChat={(chatId) => void deleteSavedChat(chatId)}
            onUpdateChat={(chatId, input) => void updateSavedChat(chatId, input)}
            onBackToChats={() => setReader("activeChat", null)}
            onChatDraft={handleChatDraft}
            onSendChat={() => void sendChat()}
          />
        </Show>
        <SelectionOverlay
          menu={activeFloatingMenu()}
          activeDocument={reader.activeDoc}
          draftSelection={reader.draftSelection}
          currentSelection={reader.currentSelection}
          selectionText={activeSelectionText()}
          canAddToCurrentChat={Boolean(reader.activeChat)}
          onSelectionTextChange={updateFloatingSelectionText}
          onNote={() => void createNoteFromSelection()}
          onNewChat={() => void startNewChatFromSelection()}
          onAddToCurrentChat={() => void addSelectionToCurrentChat()}
          onError={(message) => setUi("error", message)}
        />
      </div>
    </div>
  );
}

