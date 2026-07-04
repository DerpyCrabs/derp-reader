import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import { menuPositionForRect, type FloatingMenuPosition } from "../readerGeometry";
import type { DocumentPage, SelectionRecord, SelectionRegion } from "../../shared/types";

export type PdfDocumentProxy = any;

export interface RegionPayload {
  region: SelectionRegion;
  menu: FloatingMenuPosition;
}

export function ReaderPage(props: {
  page: DocumentPage;
  pageIndex: number;
  keepRendered: boolean;
  pdfDoc: PdfDocumentProxy | null;
  zoom: number;
  selectionMode: "text" | "image";
  currentSelection: SelectionRecord | null;
  highlightSelections: SelectionRecord[];
  onRegion: (payload: RegionPayload) => void;
}) {
  return (
    <article class="page-frame" data-page-id={props.page.id} data-page-index={props.pageIndex}>
      <div class="page-label">
        Page {props.pageIndex + 1}
      </div>
      <Show
        when={props.page.kind === "pdf" && props.pdfDoc}
        fallback={
          <Show
            when={props.page.imageData}
            fallback={
              props.page.kind === "pdf" ? (
                <MissingPdfPage />
              ) : (
                <TextPage
                  page={props.page}
                  pageIndex={props.pageIndex}
                  zoom={props.zoom}
                  currentSelection={props.currentSelection}
                  highlightSelections={props.highlightSelections}
                />
              )
            }
          >
            <ImagePage
              page={props.page}
              pageIndex={props.pageIndex}
              zoom={props.zoom}
              selectionMode={props.selectionMode}
              currentSelection={props.currentSelection}
              highlightSelections={props.highlightSelections}
              onRegion={props.onRegion}
            />
          </Show>
        }
      >
        <PdfPage
          pageIndex={props.pageIndex}
          page={props.page}
          keepRendered={props.keepRendered}
          pdfDoc={props.pdfDoc}
          zoom={props.zoom}
          selectionMode={props.selectionMode}
          currentSelection={props.currentSelection}
          highlightSelections={props.highlightSelections}
          onRegion={props.onRegion}
        />
      </Show>
    </article>
  );
}

function TextPage(props: {
  page: DocumentPage;
  pageIndex: number;
  zoom: number;
  currentSelection: SelectionRecord | null;
  highlightSelections: SelectionRecord[];
}) {
  let hostRef!: HTMLDivElement;
  return (
    <div
      ref={hostRef}
      class="text-page"
      data-testid="page-text"
      style={{ width: "min(760px, calc(100vw - 64px))", "font-size": `${18 * props.zoom}px` }}
    >
      <For each={props.highlightSelections}>
        {(selection) => <SavedSelectionHighlight pageIndex={props.pageIndex} selection={selection} source={() => hostRef} />}
      </For>
      {props.page.text}
    </div>
  );
}

function MissingPdfPage() {
  return (
    <div class="missing-pdf-page" data-testid="missing-pdf-page" style={{ width: "min(720px, calc(100vw - 64px))" }}>
      PDF file is not available from the backend. Reopen it by filesystem path.
    </div>
  );
}

function ImagePage(props: {
  page: DocumentPage;
  pageIndex: number;
  zoom: number;
  selectionMode: "text" | "image";
  currentSelection: SelectionRecord | null;
  highlightSelections: SelectionRecord[];
  onRegion: (payload: RegionPayload) => void;
}) {
  let imageRef!: HTMLImageElement;
  let hostRef!: HTMLDivElement;

  return (
    <div
      ref={hostRef}
      class="media-page"
      style={{
        width: `${Math.min((props.page.width ?? 900) * props.zoom, 1400)}px`
      }}
    >
      <img ref={imageRef} src={props.page.imageData ?? ""} data-testid="image-page" />
      <For each={props.highlightSelections}>
        {(selection) => <SavedSelectionHighlight pageIndex={props.pageIndex} selection={selection} source={() => imageRef} />}
      </For>
      <RegionSelector
        pageIndex={props.pageIndex}
        active={props.selectionMode === "image"}
        host={() => hostRef}
        source={() => imageRef}
        onRegion={props.onRegion}
      />
    </div>
  );
}

function PdfPage(props: {
  page: DocumentPage;
  pageIndex: number;
  keepRendered: boolean;
  pdfDoc: PdfDocumentProxy | null;
  zoom: number;
  selectionMode: "text" | "image";
  currentSelection: SelectionRecord | null;
  highlightSelections: SelectionRecord[];
  onRegion: (payload: RegionPayload) => void;
}) {
  let canvasRef!: HTMLCanvasElement;
  let hostRef!: HTMLDivElement;
  const [isNearViewport, setIsNearViewport] = createSignal(false);
  const estimatedSize = createMemo(() => ({
    width: (props.page.width ?? 612) * props.zoom,
    height: (props.page.height ?? 792) * props.zoom
  }));
  const [size, setSize] = createSignal(estimatedSize());

  onMount(() => {
    if (!hostRef) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = Boolean(entry?.isIntersecting);
        if (!next && props.keepRendered) return;
        setIsNearViewport(next);
      },
      { root: null, rootMargin: "1200px 0px" }
    );
    observer.observe(hostRef);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const next = estimatedSize();
    if (!isNearViewport()) setSize(next);
  });

  createEffect(() => {
    if (props.keepRendered && !isNearViewport()) setIsNearViewport(true);
  });

  createEffect(() => {
    const document = props.pdfDoc;
    const pageNumber = props.pageIndex + 1;
    const scale = props.zoom;
    const shouldRenderTextLayer = props.selectionMode === "text";
    if (!document || !canvasRef || !isNearViewport()) return;

    let cancelled = false;
    let renderTask: any = null;
    let textLayer: any = null;
    hostRef?.querySelectorAll(":scope > .textLayer").forEach((layer) => layer.remove());
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef;
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      renderTask = page.render({ canvasContext: context, viewport });
      try {
        await renderTask.promise;
      } catch (error) {
        if (cancelled || (error as { name?: string }).name === "RenderingCancelledException") return;
        throw error;
      }
      if (cancelled) return;

      if (!cancelled) {
        setSize({ width: viewport.width, height: viewport.height });
        if (shouldRenderTextLayer) {
          textLayer = new TextLayerBuilder({
            pdfPage: page,
            onAppend: (layer: HTMLDivElement) => {
              if (cancelled) return;
              layer.dataset.testid = "pdf-text-layer";
              hostRef.querySelectorAll(":scope > .textLayer").forEach((existingLayer) => existingLayer.remove());
              hostRef.append(layer);
            }
          });
          await textLayer.render({ viewport, images: null });
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      hostRef?.querySelectorAll(":scope > .textLayer").forEach((layer) => layer.remove());
    });
  });

  return (
    <div
      ref={hostRef}
      class="media-page pdf-page"
      style={{
        width: `${size().width}px`,
        height: `${size().height}px`,
        "--scale-factor": `${props.zoom}`,
        "--user-unit": "1",
        "--total-scale-factor": `${props.zoom}`
      }}
    >
      <canvas ref={canvasRef} data-testid="pdf-canvas" />
      <For each={props.highlightSelections}>
        {(selection) => <SavedSelectionHighlight pageIndex={props.pageIndex} selection={selection} source={() => canvasRef} />}
      </For>
      <RegionSelector
        pageIndex={props.pageIndex}
        active={props.selectionMode === "image"}
        host={() => hostRef}
        source={() => canvasRef}
        onRegion={props.onRegion}
      />
    </div>
  );
}

function SavedSelectionHighlight(props: {
  pageIndex: number;
  selection: SelectionRecord | null;
  source: () => HTMLElement;
}) {
  const box = createMemo(() => {
    const selection = props.selection;
    const region = selection?.region;
    const source = props.source();
    if (!selection || !region || region.pageIndex !== props.pageIndex || !source || region.width <= 0 || region.height <= 0) {
      return null;
    }

    if (selection.kind === "text") {
      return {
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height
      };
    }

    if (!(source instanceof HTMLImageElement) && !(source instanceof HTMLCanvasElement)) return null;

    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const visibleWidth = source.clientWidth;
    const visibleHeight = source.clientHeight;
    if (naturalWidth <= 0 || naturalHeight <= 0 || visibleWidth <= 0 || visibleHeight <= 0) return null;

    return {
      left: (region.x / naturalWidth) * visibleWidth,
      top: (region.y / naturalHeight) * visibleHeight,
      width: (region.width / naturalWidth) * visibleWidth,
      height: (region.height / naturalHeight) * visibleHeight
    };
  });

  return (
    <Show when={box()}>
      {(rect) => (
        <div
          class={
            props.selection?.kind === "text"
              ? "saved-text-box"
              : "saved-region-box"
          }
          data-testid={props.selection?.kind === "text" ? "saved-text-highlight" : "saved-region-highlight"}
          style={{
            left: `${rect().left}px`,
            top: `${rect().top}px`,
            width: `${rect().width}px`,
            height: `${rect().height}px`
          }}
        />
      )}
    </Show>
  );
}

function RegionSelector(props: {
  pageIndex: number;
  active: boolean;
  host: () => HTMLElement;
  source: () => HTMLCanvasElement | HTMLImageElement;
  onRegion: (payload: RegionPayload) => void;
}) {
  const [drag, setDrag] = createSignal<null | { startX: number; startY: number; x: number; y: number }>(null);
  const [committedRect, setCommittedRect] = createSignal<null | { left: number; top: number; width: number; height: number }>(null);
  const rect = createMemo(() => {
    const state = drag();
    if (!state) return null;
    const left = Math.min(state.startX, state.x);
    const top = Math.min(state.startY, state.y);
    return {
      left,
      top,
      width: Math.abs(state.x - state.startX),
      height: Math.abs(state.y - state.startY)
    };
  });

  const point = (event: PointerEvent) => {
    const box = props.host().getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(event.clientX - box.left, box.width)),
      y: Math.max(0, Math.min(event.clientY - box.top, box.height))
    };
  };

  const finish = () => {
    const box = props.host().getBoundingClientRect();
    const currentRect = rect();
    setDrag(null);
    if (!currentRect || currentRect.width < 12 || currentRect.height < 12) return;
    setCommittedRect(currentRect);

    const source = props.source();
    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const scaleX = naturalWidth / box.width;
    const scaleY = naturalHeight / box.height;
    const sx = currentRect.left * scaleX;
    const sy = currentRect.top * scaleY;
    const sw = currentRect.width * scaleX;
    const sh = currentRect.height * scaleY;

    props.onRegion({
      region: {
        pageIndex: props.pageIndex,
        x: Math.round(sx),
        y: Math.round(sy),
        width: Math.round(sw),
        height: Math.round(sh)
      },
      menu: menuPositionForRect(
        new DOMRect(box.left + currentRect.left, box.top + currentRect.top, currentRect.width, currentRect.height)
      )
    });
  };

  return (
    <div
      class="region-layer"
      classList={{ active: props.active }}
      data-testid="region-layer"
      onPointerDown={(event) => {
        if (!props.active) return;
        const next = point(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        setCommittedRect(null);
        setDrag({ startX: next.x, startY: next.y, x: next.x, y: next.y });
      }}
      onPointerMove={(event) => {
        if (!props.active) return;
        if (!drag()) return;
        const next = point(event);
        setDrag((state) => (state ? { ...state, x: next.x, y: next.y } : state));
      }}
      onPointerUp={(event) => {
        if (!props.active) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        finish();
      }}
    >
      <Show when={rect() ?? committedRect()}>
        {(box) => (
          <div
            class="region-box"
            style={{
              left: `${box().left}px`,
              top: `${box().top}px`,
              width: `${box().width}px`,
              height: `${box().height}px`
            }}
          />
        )}
      </Show>
    </div>
  );
}
