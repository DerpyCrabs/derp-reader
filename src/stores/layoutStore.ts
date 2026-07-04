import { createEffect, createMemo } from "solid-js";
import { createStore } from "solid-js/store";
import {
  migrateLayoutPreferences,
  storedFitMode,
  storedNumber,
  storedSelectionMode,
  storedThemeMode,
  storedViewMode,
  type FitMode,
  type SelectionMode,
  type ThemeMode,
  type ViewMode
} from "../readerPreferences";

export interface LayoutState {
  showLibrary: boolean;
  showAssistant: boolean;
  libraryWidth: number;
  assistantWidth: number;
  notesHeight: number;
  fitMode: FitMode;
  viewMode: ViewMode;
  themeMode: ThemeMode;
  selectionMode: SelectionMode;
  readerSize: { width: number; height: number };
  viewportWidth: number;
}

export const createLayoutStore = () => {
  migrateLayoutPreferences();

  const [layout, setLayout] = createStore<LayoutState>({
    showLibrary: localStorage.getItem("reader.showLibrary") === "1",
    showAssistant: localStorage.getItem("reader.showAssistant") === "1",
    libraryWidth: storedNumber("reader.libraryWidth", 204, 176, 520),
    assistantWidth: storedNumber("reader.assistantWidth", 360, 280, 520),
    notesHeight: storedNumber("reader.notesHeight", 190, 150, 620),
    fitMode: storedFitMode(),
    viewMode: storedViewMode(),
    themeMode: storedThemeMode(),
    selectionMode: storedSelectionMode(),
    readerSize: { width: 0, height: 0 },
    viewportWidth: window.innerWidth
  });

  const assistantStacked = createMemo(() => layout.viewportWidth <= 1180);

  createEffect(() => localStorage.setItem("reader.showLibrary", layout.showLibrary ? "1" : "0"));
  createEffect(() => localStorage.setItem("reader.showAssistant", layout.showAssistant ? "1" : "0"));
  createEffect(() => localStorage.setItem("reader.libraryWidth", String(layout.libraryWidth)));
  createEffect(() => localStorage.setItem("reader.assistantWidth", String(layout.assistantWidth)));
  createEffect(() => localStorage.setItem("reader.notesHeight", String(layout.notesHeight)));
  createEffect(() => localStorage.setItem("reader.fitMode", layout.fitMode));
  createEffect(() => localStorage.setItem("reader.viewMode", layout.viewMode));
  createEffect(() => localStorage.setItem("reader.theme", layout.themeMode));
  createEffect(() => localStorage.setItem("reader.selectionMode", layout.selectionMode));

  return { layout, setLayout, assistantStacked };
};
