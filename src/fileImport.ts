interface DroppedFileEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedFileEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
}

const extensionOf = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export const isPickedImage = (file: { name: string; mimeType: string | null }) =>
  file.mimeType?.startsWith("image/") ||
  ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(extensionOf(file.name));

export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

const fileFromEntry = (entry: DroppedFileEntry) =>
  new Promise<File>((resolve, reject) => {
    entry.file?.((file) => {
      const relativePath = entry.fullPath?.replace(/^\/+/, "");
      if (relativePath && relativePath !== file.name) {
        Object.defineProperty(file, "webkitRelativePath", {
          value: relativePath,
          configurable: true
        });
      }
      resolve(file);
    }, reject);
  });

const entriesFromReader = (reader: ReturnType<NonNullable<DroppedFileEntry["createReader"]>>) =>
  new Promise<DroppedFileEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

const filesFromEntry = async (entry: DroppedFileEntry): Promise<File[]> => {
  if (entry.isFile) return [await fileFromEntry(entry)];
  if (!entry.isDirectory || !entry.createReader) return [];

  const reader = entry.createReader();
  const files: File[] = [];
  while (true) {
    const entries = await entriesFromReader(reader);
    if (entries.length === 0) break;
    for (const child of entries) files.push(...(await filesFromEntry(child)));
  }
  return files;
};

export const filesFromDrop = async (dataTransfer: DataTransfer) => {
  const itemFiles: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry = item.webkitGetAsEntry?.() as DroppedFileEntry | null | undefined;
    if (entry) itemFiles.push(...(await filesFromEntry(entry)));
  }
  return itemFiles.length > 0 ? itemFiles : Array.from(dataTransfer.files ?? []);
};
