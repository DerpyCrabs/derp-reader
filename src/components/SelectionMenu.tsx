import { Show } from "solid-js";
import Languages from "lucide-solid/icons/languages";
import MessageCircle from "lucide-solid/icons/message-circle";
import Pencil from "lucide-solid/icons/pencil";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Sparkles from "lucide-solid/icons/sparkles";
import type { AiResponse } from "../../shared/types";
import type { FloatingMenuPosition } from "../readerGeometry";
import { MarkdownContent } from "./MarkdownContent";

export interface FloatingMenu extends FloatingMenuPosition {
  kind: "text" | "image";
}

interface SelectionMenuProps {
  menu: FloatingMenu;
  busy: string;
  activeTask: "translate" | "define" | null;
  result: AiResponse | null;
  selectionText: string;
  canAddToCurrentChat: boolean;
  onSelectionTextChange: (text: string) => void;
  onTranslate: () => void;
  onDefine: () => void;
  onRegenerate: () => void;
  onNote: () => void;
  onNewChat: () => void;
  onAddToCurrentChat: () => void;
}

export function SelectionMenu(props: SelectionMenuProps) {
  const isTranslateBusy = () => props.busy && props.activeTask === "translate";
  const isDefineBusy = () => props.busy && props.activeTask === "define";
  const shouldRegenerate = (task: "translate" | "define") => props.result && props.activeTask === task;
  const runAiAction = (task: "translate" | "define") => {
    if (shouldRegenerate(task)) {
      props.onRegenerate();
      return;
    }
    if (task === "translate") props.onTranslate();
    else props.onDefine();
  };
  const previewRows = () => {
    const availableRows = Math.max(1, Math.floor((props.menu.maxHeight - 62) / 28));
    const desiredRows = Math.max(1, Math.ceil(props.selectionText.length / 72), props.selectionText.split("\n").length);
    return Math.min(10, availableRows, desiredRows);
  };
  const runAction = (event: Event, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  const runActionFromKey = (event: KeyboardEvent, action: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    runAction(event, action);
  };
  const menuStyle = () => ({
    left: `${Math.max(12, Math.min(props.menu.x, window.innerWidth - 12))}px`,
    top: `${Math.max(12, Math.min(props.menu.y, window.innerHeight - 12))}px`,
    "max-height": `${props.menu.maxHeight}px`,
    transform: props.menu.placement === "above" ? "translate(-50%, -100%)" : "translateX(-50%)"
  });
  const stopShellPointerDown = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest(".selection-copyable")) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      class="selection-menu"
      data-testid="selection-menu"
      style={menuStyle()}
      onPointerDown={stopShellPointerDown}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div class="selection-actions">
        <button
          data-testid="menu-translate"
          title={shouldRegenerate("translate") ? "Regenerate translation" : "Translate"}
          disabled={Boolean(isTranslateBusy())}
          onPointerDown={(event) => runAction(event, () => runAiAction("translate"))}
          onKeyDown={(event) => runActionFromKey(event, () => runAiAction("translate"))}
        >
          {shouldRegenerate("translate") ? <RefreshCw size={16} /> : <Languages size={16} />}
          Translate
        </button>
        <button
          data-testid="menu-define"
          title={shouldRegenerate("define") ? "Regenerate definition" : "Define"}
          disabled={Boolean(isDefineBusy())}
          onPointerDown={(event) => runAction(event, () => runAiAction("define"))}
          onKeyDown={(event) => runActionFromKey(event, () => runAiAction("define"))}
        >
          {shouldRegenerate("define") ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          Define
        </button>
        <button
          data-testid="menu-note"
          title="Add note"
          onPointerDown={(event) => runAction(event, props.onNote)}
          onKeyDown={(event) => runActionFromKey(event, props.onNote)}
        >
          <Pencil size={16} />
          Note
        </button>
        <button
          data-testid="menu-new-chat"
          title="Start new chat"
          onPointerDown={(event) => runAction(event, props.onNewChat)}
          onKeyDown={(event) => runActionFromKey(event, props.onNewChat)}
        >
          <MessageCircle size={16} />
          New chat
        </button>
        <Show when={props.canAddToCurrentChat}>
          <button
            data-testid="menu-add-chat"
            title="Add to current chat"
            onPointerDown={(event) => runAction(event, props.onAddToCurrentChat)}
            onKeyDown={(event) => runActionFromKey(event, props.onAddToCurrentChat)}
          >
            <MessageCircle size={16} />
            Add
          </button>
        </Show>
      </div>
      <Show when={props.selectionText.trim()}>
        <textarea
          class="selection-preview-text"
          data-testid="selection-preview-text"
          spellcheck={false}
          rows={previewRows()}
          value={props.selectionText}
          onInput={(event) => props.onSelectionTextChange(event.currentTarget.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      </Show>
      <Show when={props.busy === "Translating" || props.busy === "Defining"}>
        <div class="selection-loading" data-testid="selection-loading">
          <span class="loader-dot" />
          {props.busy}...
        </div>
      </Show>
      <Show when={props.result}>
        {(result) => (
          <div class="selection-result selection-copyable" data-testid="ai-result">
            <MarkdownContent content={result().content} />
          </div>
        )}
      </Show>
    </div>
  );
}
