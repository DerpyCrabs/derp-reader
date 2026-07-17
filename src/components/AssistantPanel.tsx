import { Show, createEffect, createSignal } from "solid-js";
import MessageCircle from "lucide-solid/icons/message-circle";
import NotebookPen from "lucide-solid/icons/notebook-pen";
import type { ChatRecord, ChatWithMessages, NoteRecord, SelectionRecord, SelectionRegion } from "../../shared/types";
import { ChatPane, type StagedChatContext } from "./ChatPane";
import { NotesPane, type NoteSaveState } from "./NotesPane";

type SelectionContext = Pick<SelectionRecord, "kind" | "text" | "region"> | { kind: "text" | "image"; text: string; region: SelectionRegion | null };
type AssistantTab = "notes" | "chat";

interface AssistantPanelProps {
  notes: NoteRecord[];
  selections: SelectionRecord[];
  noteSelection: SelectionContext | null;
  chatSelection: SelectionContext | null;
  editingNoteId: string | null;
  noteDraft: string;
  noteSaveState: NoteSaveState;
  chats: ChatRecord[];
  activeChat: ChatWithMessages | null;
  stagedChatContexts: StagedChatContext[];
  chatDraft: string;
  chatSending: boolean;
  chatSendError: string;
  noteFocusRequest: number;
  chatFocusRequest: number;
  onNoteDraft: (body: string) => void;
  onUseDocumentNote: () => void;
  onSelectNote: (note: NoteRecord, linkedSelection: SelectionRecord | null) => void;
  onDeleteNote: (noteId: string) => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onUpdateChat: (chatId: string, input: { title?: string; pinned?: boolean }) => void;
  onBackToChats: () => void;
  onNewChat: () => void;
  onRemoveChatContext: (contextId: string) => void;
  onClearCurrentChatContext: () => void;
  onDismissChatError: () => void;
  onChatDraft: (body: string) => void;
  onSendChat: () => void;
}

export function AssistantPanel(props: AssistantPanelProps) {
  const [activeTab, setActiveTab] = createSignal<AssistantTab>(props.activeChat ? "chat" : "notes");
  const [notesTabFocus, setNotesTabFocus] = createSignal(0);
  const [chatTabFocus, setChatTabFocus] = createSignal(0);
  let lastNoteFocusRequest = props.noteFocusRequest;
  let lastChatFocusRequest = props.chatFocusRequest;
  let lastActiveChatId = props.activeChat?.id ?? null;

  const openTab = (tab: AssistantTab, focusEditor = true) => {
    setActiveTab(tab);
    if (!focusEditor) return;
    if (tab === "notes") setNotesTabFocus((value) => value + 1);
    else setChatTabFocus((value) => value + 1);
  };

  const handleTabKeyDown = (event: KeyboardEvent, tab: AssistantTab) => {
    const nextTab = event.key === "ArrowLeft" || event.key === "Home"
      ? "notes"
      : event.key === "ArrowRight" || event.key === "End"
        ? "chat"
        : null;
    if (!nextTab || nextTab === tab) return;
    event.preventDefault();
    openTab(nextTab, false);
    queueMicrotask(() => document.getElementById(`assistant-${nextTab}-tab`)?.focus());
  };

  createEffect(() => {
    if (props.noteFocusRequest === lastNoteFocusRequest) return;
    lastNoteFocusRequest = props.noteFocusRequest;
    openTab("notes", false);
  });

  createEffect(() => {
    if (props.chatFocusRequest === lastChatFocusRequest) return;
    lastChatFocusRequest = props.chatFocusRequest;
    openTab("chat", false);
  });

  createEffect(() => {
    const nextActiveChatId = props.activeChat?.id ?? null;
    if (nextActiveChatId && nextActiveChatId !== lastActiveChatId) openTab("chat", false);
    lastActiveChatId = nextActiveChatId;
  });

  return (
    <aside class="insight-panel" aria-label="Notes and chat">
      <div class="assistant-tabs" role="tablist" aria-label="Assistant tools">
        <button
          id="assistant-notes-tab"
          class="assistant-tab"
          classList={{ active: activeTab() === "notes" }}
          data-testid="assistant-tab-notes"
          type="button"
          role="tab"
          tabIndex={activeTab() === "notes" ? 0 : -1}
          aria-selected={activeTab() === "notes"}
          aria-controls="assistant-notes-panel"
          onClick={() => openTab("notes")}
          onKeyDown={(event) => handleTabKeyDown(event, "notes")}
        >
          <NotebookPen size={16} />
          <span>Notes</span>
          <span class="assistant-tab-count">{props.notes.length}</span>
        </button>
        <button
          id="assistant-chat-tab"
          class="assistant-tab"
          classList={{ active: activeTab() === "chat" }}
          data-testid="assistant-tab-chat"
          type="button"
          role="tab"
          tabIndex={activeTab() === "chat" ? 0 : -1}
          aria-selected={activeTab() === "chat"}
          aria-controls="assistant-chat-panel"
          onClick={() => openTab("chat")}
          onKeyDown={(event) => handleTabKeyDown(event, "chat")}
        >
          <MessageCircle size={16} />
          <span>Chat</span>
          <Show when={props.chats.length > 0}>
            <span class="assistant-tab-count">{props.chats.length}</span>
          </Show>
        </button>
      </div>

      <Show when={activeTab() === "notes"}>
        <div
          id="assistant-notes-panel"
          class="assistant-tab-panel"
          role="tabpanel"
          aria-labelledby="assistant-notes-tab"
        >
          <NotesPane
            notes={props.notes}
            selections={props.selections}
            currentSelection={props.noteSelection}
            editingNoteId={props.editingNoteId}
            noteDraft={props.noteDraft}
            saveState={props.noteSaveState}
            focusRequest={props.noteFocusRequest + notesTabFocus()}
            onNoteDraft={props.onNoteDraft}
            onUseDocumentNote={props.onUseDocumentNote}
            onSelectNote={props.onSelectNote}
            onDeleteNote={props.onDeleteNote}
          />
        </div>
      </Show>

      <Show when={activeTab() === "chat"}>
        <div
          id="assistant-chat-panel"
          class="assistant-tab-panel"
          role="tabpanel"
          aria-labelledby="assistant-chat-tab"
        >
          <ChatPane
            chats={props.chats}
            activeChat={props.activeChat}
            currentSelection={props.chatSelection}
            stagedContexts={props.stagedChatContexts}
            chatDraft={props.chatDraft}
            focusRequest={props.chatFocusRequest + chatTabFocus()}
            sending={props.chatSending}
            sendError={props.chatSendError}
            onSelectChat={props.onSelectChat}
            onDeleteChat={props.onDeleteChat}
            onUpdateChat={props.onUpdateChat}
            onBackToChats={props.onBackToChats}
            onNewChat={props.onNewChat}
            onRemoveContext={props.onRemoveChatContext}
            onClearCurrentContext={props.onClearCurrentChatContext}
            onDismissSendError={props.onDismissChatError}
            onChatDraft={props.onChatDraft}
            onSendChat={props.onSendChat}
          />
        </div>
      </Show>
    </aside>
  );
}
