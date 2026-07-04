import { Show } from "solid-js";
import Moon from "lucide-solid/icons/moon";
import Settings from "lucide-solid/icons/settings";
import Sun from "lucide-solid/icons/sun";
import ZoomIn from "lucide-solid/icons/zoom-in";
import ZoomOut from "lucide-solid/icons/zoom-out";

type ViewMode = "page" | "continuous";
type FitMode = "manual" | "width" | "height";
type ThemeMode = "light" | "dark";
type SelectionMode = "text" | "image";

interface ReaderSettingsMenuProps {
  visible: boolean;
  zoom: number;
  viewMode: ViewMode;
  fitMode: FitMode;
  themeMode: ThemeMode;
  selectionMode: SelectionMode;
  onToggle: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onFit: (mode: Exclude<FitMode, "manual">) => void;
  onZoom: (next: (value: number) => number) => void;
  onSetThemeMode: (mode: ThemeMode) => void;
  onSetSelectionMode: (mode: SelectionMode) => void;
}

export function ReaderSettingsMenu(props: ReaderSettingsMenuProps) {
  const runAndClose = (action: () => void) => {
    action();
    props.onToggle();
  };

  return (
    <>
      <button
        class="icon-button"
        data-testid="settings-menu-button"
        title="Reader settings"
        aria-haspopup="dialog"
        aria-expanded={props.visible}
        onClick={props.onToggle}
      >
        <Settings size={18} />
      </button>
      <Show when={props.visible}>
        <div
          class="settings-menu"
          data-testid="settings-menu"
          role="dialog"
          aria-label="Reader settings"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <section>
            <h2>View</h2>
            <div class="segmented" role="group" aria-label="View mode">
              <button
                classList={{ active: props.viewMode === "continuous" }}
                title="Continuous view"
                onClick={() => runAndClose(() => props.onSetViewMode("continuous"))}
              >
                Continuous
              </button>
              <button
                classList={{ active: props.viewMode === "page" }}
                title="Page view"
                onClick={() => runAndClose(() => props.onSetViewMode("page"))}
              >
                Page
              </button>
            </div>
          </section>
          <section>
            <h2>Fit</h2>
            <div class="settings-row">
              <button
                title="Fit width"
                data-testid="fit-width"
                classList={{ active: props.fitMode === "width" }}
                onClick={() => runAndClose(() => props.onFit("width"))}
              >
                Width
              </button>
              <button
                title="Fit height"
                data-testid="fit-height"
                classList={{ active: props.fitMode === "height" }}
                onClick={() => runAndClose(() => props.onFit("height"))}
              >
                Height
              </button>
            </div>
          </section>
          <section>
            <h2>Zoom</h2>
            <div class="zoom-controls">
              <button title="Zoom out" onClick={() => props.onZoom((value) => value - 0.1)}>
                <ZoomOut size={18} />
              </button>
              <span data-testid="zoom-value">{Math.round(props.zoom * 100)}%</span>
              <button title="Zoom in" onClick={() => props.onZoom((value) => value + 0.1)}>
                <ZoomIn size={18} />
              </button>
            </div>
          </section>
          <section>
            <h2>Theme</h2>
            <div class="settings-row" role="group" aria-label="Theme">
              <button
                title="Light theme"
                data-testid="theme-light"
                classList={{ active: props.themeMode === "light" }}
                onClick={() => runAndClose(() => props.onSetThemeMode("light"))}
              >
                <Sun size={16} />
                Light
              </button>
              <button
                title="Dark theme"
                data-testid="theme-dark"
                classList={{ active: props.themeMode === "dark" }}
                onClick={() => runAndClose(() => props.onSetThemeMode("dark"))}
              >
                <Moon size={16} />
                Dark
              </button>
            </div>
          </section>
          <section>
            <h2>Select</h2>
            <div class="settings-row" role="group" aria-label="Selection mode">
              <button
                title="Select text"
                data-testid="selection-mode-text"
                classList={{ active: props.selectionMode === "text" }}
                onClick={() => runAndClose(() => props.onSetSelectionMode("text"))}
              >
                Text
              </button>
              <button
                title="Select image region"
                data-testid="selection-mode-image"
                classList={{ active: props.selectionMode === "image" }}
                onClick={() => runAndClose(() => props.onSetSelectionMode("image"))}
              >
                Image
              </button>
            </div>
          </section>
        </div>
      </Show>
    </>
  );
}
