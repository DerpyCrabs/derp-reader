import { For, Show } from "solid-js";
import { EmptyReader } from "./EmptyReader";
import { ReaderPage, type PdfDocumentProxy, type RegionPayload } from "./ReaderPage";
import type { DocumentPage, DocumentWithPages, SelectionRecord } from "../../shared/types";

interface ReaderViewportProps {
  readerRef: (element: HTMLDivElement) => void;
  activeDocument: DocumentWithPages | null;
  renderedPageIndexes: number[];
  retainedPageIndex: number | null;
  continuous: boolean;
  dropActive: boolean;
  pdfDoc: PdfDocumentProxy | null;
  zoom: number;
  selectionMode: "text" | "image";
  currentSelection: SelectionRecord | null;
  highlightSelections: SelectionRecord[];
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onScroll: (scrollTop: number) => void;
  onRegion: (page: DocumentPage, pageIndex: number, payload: RegionPayload) => void;
}

export function ReaderViewport(props: ReaderViewportProps) {
  let hostRef!: HTMLDivElement;

  return (
    <div
      ref={(element) => {
        hostRef = element;
        props.readerRef(element);
      }}
      class="reader-viewport app-scrollbar"
      classList={{ "drop-active": props.dropActive }}
      data-testid="reader-viewport"
      tabIndex={0}
      onKeyDown={props.onKeyDown}
      onDragEnter={props.onDragEnter}
      onDragOver={props.onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onDragLeave();
      }}
      onDrop={props.onDrop}
      onScroll={(event) => props.onScroll(event.currentTarget.scrollTop)}
    >
      <Show when={props.activeDocument} fallback={<EmptyReader onOpen={props.onOpen} />}>
        <For each={props.renderedPageIndexes}>
          {(pageIndex) => {
            const page = () => props.activeDocument?.pages[pageIndex] ?? null;
            return (
              <Show when={page()}>
                {(currentPage) => (
                  <ReaderPage
                    page={currentPage()}
                    pageIndex={pageIndex}
                    keepRendered={pageIndex === props.retainedPageIndex}
                    pdfDoc={props.pdfDoc}
                    zoom={props.zoom}
                    selectionMode={props.selectionMode}
                    currentSelection={props.currentSelection}
                    highlightSelections={props.highlightSelections}
                    onRegion={(payload) => props.onRegion(currentPage(), pageIndex, payload)}
                  />
                )}
              </Show>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
