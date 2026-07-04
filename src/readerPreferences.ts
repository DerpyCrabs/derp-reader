export type ViewMode = "page" | "continuous";
export type FitMode = "manual" | "width" | "height";
export type ThemeMode = "light" | "dark";
export type SelectionMode = "text" | "image";

const layoutPreferencesVersion = "3";

export const migrateLayoutPreferences = () => {
  if (localStorage.getItem("reader.layoutVersion") === layoutPreferencesVersion) return;
  localStorage.setItem("reader.showLibrary", "0");
  localStorage.setItem("reader.showAssistant", "0");
  localStorage.setItem("reader.libraryWidth", "204");
  localStorage.setItem("reader.layoutVersion", layoutPreferencesVersion);
};

export const storedNumber = (key: string, fallback: number, min: number, max: number) => {
  const value = Number(localStorage.getItem(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

export const storedViewMode = (): ViewMode =>
  (localStorage.getItem("reader.viewMode") as ViewMode | null) ?? "continuous";

export const storedFitMode = (): FitMode => (localStorage.getItem("reader.fitMode") as FitMode | null) ?? "manual";

export const storedThemeMode = (): ThemeMode => (localStorage.getItem("reader.theme") as ThemeMode | null) ?? "light";

export const storedSelectionMode = (): SelectionMode =>
  (localStorage.getItem("reader.selectionMode") as SelectionMode | null) ?? "text";
