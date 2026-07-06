import type { ChatRecord, ChatWithMessages, NoteRecord, SelectionRecord, SelectionRegion } from "../../shared/types";
import { ChatPane } from "./ChatPane";
import { NotesPane } from "./NotesPane";

type SelectionContext = Pick<SelectionRecord, "kind" | "text" | "region"> | { kind: "text" | "image"; text: string; region: SelectionRegion | null };

interface AssistantPanelProps {
  notesHeight: number;
  notes: NoteRecord[];
  selections: SelectionRecord[];
  currentSelection: SelectionContext | null;
  editingNoteId: string | null;
  noteDraft: string;
  chats: ChatRecord[];
  activeChat: ChatWithMessages | null;
  stagedChatContextCount: number;
  chatDraft: string;
  noteFocusRequest: number;
  chatFocusRequest: number;
  onNoteDraft: (body: string) => void;
  onUseDocumentNote: () => void;
  onSelectNote: (note: NoteRecord, linkedSelection: SelectionRecord | null) => void;
  onDeleteNote: (noteId: string) => void;
  onStartNotesResize: (event: PointerEvent) => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onUpdateChat: (chatId: string, input: { title?: string; pinned?: boolean }) => void;
  onBackToChats: () => void;
  onChatDraft: (body: string) => void;
  onSendChat: () => void;
}

export function AssistantPanel(props: AssistantPanelProps) {
  return (
    <aside
      class="insight-panel app-scrollbar"
      style={{ "grid-template-rows": `${props.notesHeight}px 6px minmax(0, 1fr)` }}
    >
      <NotesPane
        notes={props.notes}
        selections={props.selections}
        currentSelection={props.currentSelection}
        editingNoteId={props.editingNoteId}
        noteDraft={props.noteDraft}
        focusRequest={props.noteFocusRequest}
        onNoteDraft={props.onNoteDraft}
        onUseDocumentNote={props.onUseDocumentNote}
        onSelectNote={props.onSelectNote}
        onDeleteNote={props.onDeleteNote}
      />

      <div class="notes-chat-resizer" data-testid="notes-chat-resizer" onPointerDown={props.onStartNotesResize} />

      <ChatPane
        chats={props.chats}
        activeChat={props.activeChat}
        currentSelection={props.currentSelection}
        stagedContextCount={props.stagedChatContextCount}
        chatDraft={props.chatDraft}
        focusRequest={props.chatFocusRequest}
        onSelectChat={props.onSelectChat}
        onDeleteChat={props.onDeleteChat}
        onUpdateChat={props.onUpdateChat}
        onBackToChats={props.onBackToChats}
        onChatDraft={props.onChatDraft}
        onSendChat={props.onSendChat}
      />
    </aside>
  );
}
