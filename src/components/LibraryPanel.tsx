import { For, Show } from "solid-js";
import FolderOpen from "lucide-solid/icons/folder-open";
import Upload from "lucide-solid/icons/upload";
import Search from "lucide-solid/icons/search";
import type { DocumentWithPages, ReaderDocument, SearchResult } from "../../shared/types";

interface LibraryPanelProps {
  documents: ReaderDocument[];
  searchQuery: string;
  searchResults: SearchResult[];
  activeDocument: DocumentWithPages | null;
  onSearch: (query: string) => void;
  onOpenPicker: () => void;
  onOpenFolderPicker: () => void;
  onOpenDocument: (documentId: string) => void;
  onOpenSearchResult: (result: SearchResult) => void;
}
export function LibraryPanel(props: LibraryPanelProps) {
  return (
    <aside class="library-panel app-scrollbar">
      <div class="library-open-actions">
        <button data-testid="library-open-file" title="Open PDF, image, or archive" onClick={props.onOpenPicker}>
          <Upload size={16} />
          Open
        </button>
        <button class="icon-button" data-testid="library-open-folder" title="Open folder" onClick={props.onOpenFolderPicker}>
          <FolderOpen size={16} />
        </button>
      </div>

      <label class="search-box">
        <Search size={18} />
        <input
          data-testid="search-input"
          value={props.searchQuery}
          onInput={(event) => props.onSearch(event.currentTarget.value)}
          placeholder="Search"
        />
      </label>

      <Show when={props.searchResults.length > 0}>
        <section>
          <h2>{props.searchResults.length} found</h2>
          <For each={props.searchResults}>
            {(result) => (
              <button
                class="list-row"
                data-testid="search-result"
                onClick={() => props.onOpenSearchResult(result)}
              >
                <span>{result.title}</span>
                <small>{result.snippet}</small>
              </button>
            )}
          </For>
        </section>
      </Show>

      <section>
        <Show when={props.documents.length > 0} fallback={<p class="empty-copy" data-testid="empty-library">No files open</p>}>
          <For each={props.documents}>
            {(document) => (
              <button
                class="list-row"
                classList={{ active: props.activeDocument?.id === document.id }}
                data-testid="document-row"
                onClick={() => props.onOpenDocument(document.id)}
              >
                <span>{document.title}</span>
              </button>
            )}
          </For>
        </Show>
      </section>
    </aside>
  );
}
