import { basename } from "node:path";
import { getDocumentFileContent, getDocumentSourcePath, getSelectionPage } from "./db";
import { contentTypeForPath, parseArchiveSourceRef, parseDataUrl, readArchiveEntry } from "./media";
import type { SelectionRecord, SelectionRegion } from "../shared/types";

export interface AiFileContext {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
  region: SelectionRegion | null;
  source: "page-image" | "document-pdf";
}

export const resolveSelectionFileContext = async (selection: SelectionRecord | null): Promise<AiFileContext | null> => {
  if (!selection || selection.kind !== "image") return null;

  if (selection.imageData) {
    const parsed = parseDataUrl(selection.imageData);
    return {
      bytes: parsed.bytes,
      mediaType: parsed.mediaType,
      filename: "selection.png",
      region: selection.region,
      source: "page-image"
    };
  }

  const page = getSelectionPage(selection);
  if (page?.kind === "image") {
    if (page.sourcePath) {
      const archiveRef = parseArchiveSourceRef(page.sourcePath);
      const bytes = archiveRef ? await readArchiveEntry(archiveRef) : new Uint8Array(await Bun.file(page.sourcePath).arrayBuffer());
      const filename = archiveRef?.entryName ?? basename(page.sourcePath);
      return {
        bytes,
        mediaType: contentTypeForPath(filename),
        filename,
        region: selection.region,
        source: "page-image"
      };
    }

    if (page.imageData) {
      const parsed = parseDataUrl(page.imageData);
      return {
        bytes: parsed.bytes,
        mediaType: parsed.mediaType,
        filename: `page-${page.pageIndex + 1}`,
        region: selection.region,
        source: "page-image"
      };
    }
  }

  const sourcePath = getDocumentSourcePath(selection.documentId);
  if (sourcePath?.toLowerCase().endsWith(".pdf")) {
    return {
      bytes: new Uint8Array(await Bun.file(sourcePath).arrayBuffer()),
      mediaType: "application/pdf",
      filename: basename(sourcePath),
      region: selection.region,
      source: "document-pdf"
    };
  }

  const content = getDocumentFileContent(selection.documentId);
  if (content?.contentType === "application/pdf") {
    const parsed = parseDataUrl(content.data);
    return {
      bytes: parsed.bytes,
      mediaType: "application/pdf",
      filename: "document.pdf",
      region: selection.region,
      source: "document-pdf"
    };
  }

  return null;
};
