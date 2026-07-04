interface FilePickersProps {
  onFiles: (files: File[]) => void;
  onFilePickerReady: (element: HTMLInputElement) => void;
  onFolderPickerReady: (element: HTMLInputElement) => void;
}

export function FilePickers(props: FilePickersProps) {
  const handleFiles = (event: Event) => {
    props.onFiles(Array.from((event.currentTarget as HTMLInputElement).files ?? []));
  };

  return (
    <>
      <input
        ref={props.onFilePickerReady}
        class="visually-hidden"
        data-testid="file-picker"
        type="file"
        accept=".pdf,.cbz,.zip,image/*"
        multiple
        onChange={handleFiles}
      />
      <input
        ref={(element) => {
          props.onFolderPickerReady(element);
          element.setAttribute("webkitdirectory", "");
        }}
        class="visually-hidden"
        data-testid="folder-picker"
        type="file"
        multiple
        onChange={handleFiles}
      />
    </>
  );
}
