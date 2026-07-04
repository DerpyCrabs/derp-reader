import { For, createEffect } from "solid-js";
import Highlighter from "lucide-solid/icons/highlighter";
import Trash2 from "lucide-solid/icons/trash-2";
import type { NoteRecord, SelectionRecord } from "../../shared/types";

interface NotesPaneProps {
  notes: NoteRecord[];
  selections: SelectionRecord[];
  currentSelection: Pick<SelectionRecord, "kind" | "text" | "region"> | null;
  editingNoteId: string | null;
  noteDraft: string;
  focusRequest: number;
  onNoteDraft: (body: string) => void;
  onUseDocumentNote: () => void;
  onSelectNote: (note: NoteRecord, linkedSelection: SelectionRecord | null) => void;
  onDeleteNote: (noteId: string) => void;
}

export function NotesPane(props: NotesPaneProps) {
  let noteEditorRef!: HTMLTextAreaElement;

  createEffect(() => {
    if (props.focusRequest <= 0) return;
    queueMicrotask(() => noteEditorRef?.focus());
  });

  return (
    <section class="notes-pane">
      <div class="panel-heading">
        <h2>Notes</h2>
        <div class="note-context">
          {props.currentSelection ? (
            <button class="document-note-mode" data-testid="document-note-mode" title="Use document note" onClick={props.onUseDocumentNote}>
              <Highlighter size={15} />
              {props.currentSelection.kind === "image" ? "Image" : "Selection"}
            </button>
          ) : null}
        </div>
      </div>
      <textarea
        ref={noteEditorRef}
        class="note-editor"
        data-testid="note-editor"
        value={props.noteDraft}
        onInput={(event) => props.onNoteDraft(event.currentTarget.value)}
        placeholder={
          props.currentSelection?.kind === "image"
            ? "Note on this image"
            : props.currentSelection
              ? "Note on this selection"
              : "Note on this document"
        }
      />
      <div class="note-list app-scrollbar">
        <For each={props.notes}>
          {(note) => {
            const linkedSelection = () => props.selections.find((selection) => selection.id === note.selectionId) ?? null;
            return (
              <article
                class="note-row"
                classList={{ active: props.editingNoteId === note.id }}
                data-testid="note-row"
                onClick={() => props.onSelectNote(note, linkedSelection())}
              >
                <div>
                  <small>{note.selectionId ? "Selection" : "Document"}</small>
                  <p>{note.body}</p>
                </div>
                <button
                  class="row-icon icon-button"
                  data-testid="delete-note"
                  title="Delete note"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDeleteNote(note.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </article>
            );
          }}
        </For>
      </div>
    </section>
  );
}
