import { createStore } from "solid-js/store";
import type { FloatingMenu } from "../components/SelectionMenu";

export interface UiState {
  busy: string;
  error: string;
  dropActive: boolean;
  floatingMenu: FloatingMenu | null;
  noteFocusRequest: number;
  chatFocusRequest: number;
}

export const createUiStore = () =>
  createStore<UiState>({
    busy: "",
    error: "",
    dropActive: false,
    floatingMenu: null,
    noteFocusRequest: 0,
    chatFocusRequest: 0
  });
