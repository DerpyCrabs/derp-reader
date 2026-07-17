import { For, Show, createEffect, createSignal } from "solid-js";
import Check from "lucide-solid/icons/check";
import FileText from "lucide-solid/icons/file-text";
import Highlighter from "lucide-solid/icons/highlighter";
import Image from "lucide-solid/icons/image";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import type { NoteRecord, SelectionRecord } from "../../shared/types";

export type NoteSaveState = "idle" | "dirty" | "saving" | "saved" | "empty" | "error";

interface NotesPaneProps {
  notes: NoteRecord[];
  selections: SelectionRecord[];
  currentSelection: Pick<SelectionRecord, "kind" | "text" | "region"> | null;
  editingNoteId: string | null;
  noteDraft: string;
  saveState: NoteSaveState;
  focusRequest: number;
  onNoteDraft: (body: string) => void;
  onUseDocumentNote: () => void;
  onSelectNote: (note: NoteRecord, linkedSelection: SelectionRecord | null) => void;
  onDeleteNote: (noteId: string) => void;
}

const formatNoteDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));

export function NotesPane(props: NotesPaneProps) {
  let noteEditorRef!: HTMLTextAreaElement;
  const [pendingDeleteId, setPendingDeleteId] = createSignal<string | null>(null);

  const contextLabel = () =>
    props.currentSelection?.kind === "image" ? "Image note" : props.currentSelection ? "Selection note" : "Document note";

  const contextExcerpt = () => {
    const selection = props.currentSelection;
    if (!selection) return "Keep a thought about the whole document.";
    if (selection.kind === "image") return "Linked to the highlighted image region.";
    const text = selection.text.trim().replace(/\s+/g, " ");
    return text ? `“${text}”` : "Linked to the highlighted passage.";
  };

  const saveStatus = () => {
    if (props.saveState === "saving") return { label: "Saving…", icon: <LoaderCircle class="spin" size={13} /> };
    if (props.saveState === "saved") return { label: "Saved", icon: <Check size={13} /> };
    if (props.saveState === "dirty") return { label: "Unsaved changes", icon: null };
    if (props.saveState === "empty") return { label: "Empty notes aren’t saved", icon: null };
    if (props.saveState === "error") return { label: "Couldn’t save", icon: null };
    return null;
  };

  createEffect(() => {
    if (props.focusRequest <= 0) return;
    queueMicrotask(() => noteEditorRef?.focus());
  });

  createEffect(() => {
    props.editingNoteId;
    setPendingDeleteId(null);
  });

  return (
    <section class="notes-pane" aria-label="Notes">
      <div class="note-context-bar">
        <div class="note-context-copy">
          <span class="context-icon" aria-hidden="true">
            <Show when={props.currentSelection} fallback={<FileText size={16} />}>
              <Show when={props.currentSelection?.kind === "image"} fallback={<Highlighter size={16} />}>
                <Image size={16} />
              </Show>
            </Show>
          </span>
          <div>
            <strong>{contextLabel()}</strong>
            <span>{contextExcerpt()}</span>
          </div>
        </div>
        <Show when={props.currentSelection}>
          <button
            class="context-clear icon-button"
            data-testid="document-note-mode"
            type="button"
            title="Switch to document note"
            aria-label="Switch to document note"
            onClick={props.onUseDocumentNote}
          >
            <X size={15} />
          </button>
        </Show>
      </div>

      <div class="note-editor-card" classList={{ error: props.saveState === "error" }}>
        <label class="visually-hidden" for="note-editor">{contextLabel()}</label>
        <textarea
          ref={noteEditorRef}
          id="note-editor"
          class="note-editor"
          data-testid="note-editor"
          value={props.noteDraft}
          onInput={(event) => props.onNoteDraft(event.currentTarget.value)}
          placeholder={
            props.currentSelection?.kind === "image"
              ? "What do you notice in this image?"
              : props.currentSelection
                ? "Write a note about this passage…"
                : "Write a note about this document…"
          }
        />
        <div class="note-editor-footer" aria-live="polite">
          <span>{saveStatus()?.icon}{saveStatus()?.label ?? "Autosaves as you type"}</span>
          <span>{props.noteDraft.length > 0 ? `${props.noteDraft.length} characters` : ""}</span>
        </div>
      </div>

      <div class="note-list-heading">
        <h3>Saved notes</h3>
        <span>{props.notes.length}</span>
      </div>

      <div class="note-list app-scrollbar" role="list">
        <Show
          when={props.notes.length > 0}
          fallback={
            <div class="panel-empty-state" data-testid="empty-notes">
              <FileText size={22} />
              <strong>No notes yet</strong>
              <span>Your notes for this document will collect here.</span>
            </div>
          }
        >
          <For each={props.notes}>
            {(note) => {
              const linkedSelection = () => props.selections.find((selection) => selection.id === note.selectionId) ?? null;
              const noteKind = () => linkedSelection()?.kind === "image" ? "Image" : note.selectionId ? "Selection" : "Document";
              return (
                <div
                  class="note-row"
                  classList={{ active: props.editingNoteId === note.id, confirming: pendingDeleteId() === note.id }}
                  data-testid="note-row"
                  role="listitem"
                >
                  <button
                    class="note-select"
                    type="button"
                    aria-label={`Open ${noteKind().toLowerCase()} note: ${note.body}`}
                    onClick={() => props.onSelectNote(note, linkedSelection())}
                  >
                    <span class="note-row-meta">
                      <span>{noteKind()}</span>
                      <time datetime={new Date(note.updatedAt).toISOString()}>{formatNoteDate(note.updatedAt)}</time>
                    </span>
                    <span class="note-row-body">{note.body}</span>
                  </button>
                  <Show
                    when={pendingDeleteId() === note.id}
                    fallback={
                      <button
                        class="row-icon icon-button destructive-ghost"
                        data-testid="delete-note"
                        type="button"
                        title="Delete note"
                        aria-label="Delete note"
                        onClick={() => setPendingDeleteId(note.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    }
                  >
                    <div class="confirm-actions" data-testid="confirm-delete-note">
                      <button
                        ref={(element) => queueMicrotask(() => element.focus())}
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        class="danger-button"
                        type="button"
                        onClick={() => {
                          setPendingDeleteId(null);
                          props.onDeleteNote(note.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
}
