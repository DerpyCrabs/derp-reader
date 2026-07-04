import { Show } from "solid-js";
import Languages from "lucide-solid/icons/languages";
import MessageCircle from "lucide-solid/icons/message-circle";
import Pencil from "lucide-solid/icons/pencil";
import Sparkles from "lucide-solid/icons/sparkles";
import type { AiResponse } from "../../shared/types";
import type { FloatingMenuPosition } from "../readerGeometry";

export interface FloatingMenu extends FloatingMenuPosition {
  kind: "text" | "image";
}

interface SelectionMenuProps {
  menu: FloatingMenu;
  busy: string;
  result: AiResponse | null;
  selectionText: string;
  canAddToCurrentChat: boolean;
  onSelectionTextChange: (text: string) => void;
  onTranslate: () => void;
  onDefine: () => void;
  onNote: () => void;
  onNewChat: () => void;
  onAddToCurrentChat: () => void;
}

export function SelectionMenu(props: SelectionMenuProps) {
  const actionBusy = () => Boolean(props.busy);
  const previewRows = () => {
    const availableRows = Math.max(1, Math.floor((props.menu.maxHeight - 62) / 28));
    const desiredRows = Math.max(1, Math.ceil(props.selectionText.length / 72), props.selectionText.split("\n").length);
    return Math.min(10, availableRows, desiredRows);
  };
  const runAction = (event: Event, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    if (!actionBusy()) action();
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

  return (
    <div
      class="selection-menu"
      data-testid="selection-menu"
      style={menuStyle()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div class="selection-actions">
        <button
          data-testid="menu-translate"
          title="Translate"
          disabled={actionBusy()}
          onPointerDown={(event) => runAction(event, props.onTranslate)}
          onKeyDown={(event) => runActionFromKey(event, props.onTranslate)}
        >
          <Languages size={16} />
          Translate
        </button>
        <button
          data-testid="menu-define"
          title="Define"
          disabled={actionBusy()}
          onPointerDown={(event) => runAction(event, props.onDefine)}
          onKeyDown={(event) => runActionFromKey(event, props.onDefine)}
        >
          <Sparkles size={16} />
          Define
        </button>
        <button
          data-testid="menu-note"
          title="Add note"
          disabled={actionBusy()}
          onPointerDown={(event) => runAction(event, props.onNote)}
          onKeyDown={(event) => runActionFromKey(event, props.onNote)}
        >
          <Pencil size={16} />
          Note
        </button>
        <button
          data-testid="menu-new-chat"
          title="Start new chat"
          disabled={actionBusy()}
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
            disabled={actionBusy()}
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
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.focus({ preventScroll: true });
          }}
          onClick={(event) => event.stopPropagation()}
        />
      </Show>
      <Show when={props.busy === "Translating" || props.busy === "Defining"}>
        <div class="selection-result">Working...</div>
      </Show>
      <Show when={props.result}>
        {(result) => (
          <div class="selection-result" data-testid="ai-result">
            <strong>{result().title}</strong>
            <p>{result().content}</p>
          </div>
        )}
      </Show>
    </div>
  );
}
