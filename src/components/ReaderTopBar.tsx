import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import PanelLeftOpen from "lucide-solid/icons/panel-left-open";
import PanelRightClose from "lucide-solid/icons/panel-right-close";
import PanelRightOpen from "lucide-solid/icons/panel-right-open";
import { ReaderSettingsMenu } from "./ReaderSettingsMenu";

type ViewMode = "page" | "continuous";
type FitMode = "manual" | "width" | "height";
type ThemeMode = "light" | "dark";
type SelectionMode = "text" | "image";

interface ReaderTopBarProps {
  title: string;
  hasDocument: boolean;
  busy: string;
  currentPage: number;
  pageCount: number;
  zoom: number;
  viewMode: ViewMode;
  fitMode: FitMode;
  showLibrary: boolean;
  showAssistant: boolean;
  themeMode: ThemeMode;
  selectionMode: SelectionMode;
  onGoToPage: (pageIndex: number) => void;
  onSetViewMode: (mode: ViewMode) => void;
  onFit: (mode: Exclude<FitMode, "manual">) => void;
  onZoom: (next: (value: number) => number) => void;
  onToggleLibrary: () => void;
  onToggleAssistant: () => void;
  onSetThemeMode: (mode: ThemeMode) => void;
  onSetSelectionMode: (mode: SelectionMode) => void;
}

export function ReaderTopBar(props: ReaderTopBarProps) {
  let settingsControlRef!: HTMLDivElement;
  let pageControlRef!: HTMLDivElement;
  let pageInputRef!: HTMLInputElement;

  const [settingsMenuVisible, setSettingsMenuVisible] = createSignal(false);
  const [editingPage, setEditingPage] = createSignal(false);
  const [pageInput, setPageInput] = createSignal("");
  const commitPageEdit = () => {
    const target = Number.parseInt(pageInput(), 10);
    setEditingPage(false);
    if (Number.isFinite(target)) props.onGoToPage(target - 1);
  };

  const pageTotal = () => Math.max(props.pageCount, 1);
  const pageNumber = () => Math.min(props.currentPage + 1, pageTotal());
  const pageLabel = () => `Page ${pageNumber()} / ${pageTotal()}`;

  createEffect(() => {
    if (!editingPage()) setPageInput(String(pageNumber()));
  });

  createEffect(() => {
    if (!editingPage()) return;
    pageInputRef?.focus({ preventScroll: true });
    pageInputRef?.select();
  });

  const closeMenus = () => {
    setSettingsMenuVisible(false);
    setEditingPage(false);
  };

  const handleDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (settingsMenuVisible() && !settingsControlRef?.contains(target)) setSettingsMenuVisible(false);
    if (editingPage() && !pageControlRef?.contains(target)) commitPageEdit();
  };

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    closeMenus();
  };

  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  onCleanup(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  });

  return (
    <header class="topbar">
      <button
        class="icon-button panel-toggle panel-toggle-left"
        classList={{ active: props.showLibrary }}
        data-testid="toggle-library"
        title={props.showLibrary ? "Hide library" : "Show library"}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onToggleLibrary();
        }}
      >
        <Show when={props.showLibrary} fallback={<PanelLeftOpen size={18} />}>
          <PanelLeftClose size={18} />
        </Show>
      </button>

      <div class="topbar-title-zone">
        <Show when={props.hasDocument}>
          <div class="document-title" data-testid="active-title">
            {props.title}
          </div>
        </Show>
      </div>

      <div class="topbar-center-zone">
        <Show when={props.hasDocument}>
          <div class="reader-center-controls">
            <div ref={pageControlRef} class="page-jump">
              <div
                class="page-indicator"
                data-testid="page-indicator"
                title="Go to page"
                onClick={() => {
                  setEditingPage(true);
                  setPageInput(String(pageNumber()));
                }}
              >
                {pageLabel()}
                </div>
              <Show when={editingPage()}>
                <div
                  class="page-popover"
                  data-testid="page-jump-popover"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <input
                    ref={pageInputRef}
                    class="page-input"
                    data-testid="page-input"
                    value={pageInput()}
                    inputMode="numeric"
                    onInput={(event) => setPageInput(event.currentTarget.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={commitPageEdit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        setPageInput(String(pageNumber()));
                        setEditingPage(false);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
              </Show>
            </div>

            <div ref={settingsControlRef} class="settings-control">
              <ReaderSettingsMenu
                visible={settingsMenuVisible()}
                zoom={props.zoom}
                viewMode={props.viewMode}
                fitMode={props.fitMode}
                themeMode={props.themeMode}
                selectionMode={props.selectionMode}
                onToggle={() => {
                  setSettingsMenuVisible((value) => !value);
                }}
                onSetViewMode={props.onSetViewMode}
                onFit={props.onFit}
                onZoom={props.onZoom}
                onSetThemeMode={props.onSetThemeMode}
                onSetSelectionMode={props.onSetSelectionMode}
              />
            </div>
          </div>
        </Show>
      </div>

      <div class="topbar-right-zone">
        <Show when={props.hasDocument}>
          <button
            class="icon-button panel-toggle panel-toggle-right"
            classList={{ active: props.showAssistant }}
            data-testid="toggle-assistant"
            title={props.showAssistant ? "Hide notes and chat" : "Show notes and chat"}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onToggleAssistant();
            }}
          >
            <Show when={props.showAssistant} fallback={<PanelRightOpen size={18} />}>
              <PanelRightClose size={18} />
            </Show>
          </button>
        </Show>
      </div>
    </header>
  );
}
