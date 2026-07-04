interface EmptyReaderProps {
  onOpen: () => void;
}

export function EmptyReader(props: EmptyReaderProps) {
  return (
    <div class="empty-state" data-testid="empty-reader">
      <button
        class="empty-drop-surface"
        data-testid="empty-open-target"
        onClick={props.onOpen}
      >
        <strong>Drop files here</strong>
        <span>or click to open PDF, CBZ/ZIP, images. Use Open for folders.</span>
      </button>
    </div>
  );
}
