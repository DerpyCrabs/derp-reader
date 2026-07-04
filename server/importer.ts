import { basename, extname, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { unzipSync } from "fflate";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createDocument } from "./db";
import {
  contentTypeForPath,
  dataUrlFromBytes,
  imageSizeFromBytes,
  isArchiveName,
  isImageName,
  makeArchiveSourceRef,
  parseDataUrl
} from "./media";
import type { CreateDocumentInput, ImportBlobFile, ImportBlobInput } from "../shared/types";

const titleFromPath = (path: string) => basename(path).replace(/\.[^.]+$/, "");
const normalizeEntryName = (name: string) => name.replace(/\\/g, "/").replace(/^\/+/, "");
const naturalSort = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true });

const dimensionsForPath = async (path: string) => {
  try {
    return imageSizeFromBytes(new Uint8Array(await Bun.file(path).arrayBuffer()), path);
  } catch {
    return { width: null, height: null };
  }
};

const importPdfBytes = async (input: {
  bytes: Uint8Array;
  title: string;
  sourceName: string;
  sourcePath?: string | null;
  contentData?: string | null;
  contentType?: string | null;
}) => {
  const pdf = await (pdfjsLib as any).getDocument({ data: input.bytes, disableWorker: true }).promise;
  const pages: CreateDocumentInput["pages"] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      kind: "pdf",
      text: "",
      width: viewport.width,
      height: viewport.height
    });
  }

  return createDocument({
    title: input.title,
    type: "pdf",
    sourceName: input.sourceName,
    sourcePath: input.sourcePath ?? null,
    contentData: input.contentData ?? null,
    contentType: input.contentType ?? "application/pdf",
    pages
  });
};

const importPdfFile = async (path: string) =>
  importPdfBytes({
    bytes: new Uint8Array(await Bun.file(path).arrayBuffer()),
    title: titleFromPath(path),
    sourceName: basename(path),
    sourcePath: path,
    contentType: "application/pdf"
  });

const importImagePaths = async (paths: string[], sourceName: string, sourcePath: string) => {
  const pages: CreateDocumentInput["pages"] = [];
  for (const path of paths) {
    const dimensions = await dimensionsForPath(path);
    pages.push({
      kind: "image",
      text: `${basename(path)} image page`,
      sourcePath: path,
      width: dimensions.width,
      height: dimensions.height
    });
  }

  return createDocument({
    title: sourceName,
    type: "manga",
    sourceName,
    sourcePath,
    pages
  });
};

const zipEntriesFromBytes = (bytes: Uint8Array) => {
  const entries = unzipSync(bytes);
  return Object.entries(entries)
    .map(([name, entryBytes]) => ({ name: normalizeEntryName(name), bytes: entryBytes }))
    .filter((entry) => entry.name && isImageName(entry.name))
    .sort((left, right) => naturalSort(left.name, right.name));
};

const importArchiveFile = async (path: string) => {
  const entries = zipEntriesFromBytes(new Uint8Array(await Bun.file(path).arrayBuffer()));
  if (entries.length === 0) throw new Error("Archive does not contain supported image files");

  return createDocument({
    title: titleFromPath(path),
    type: "manga",
    sourceName: basename(path),
    sourcePath: path,
    pages: entries.map((entry) => {
      const dimensions = imageSizeFromBytes(entry.bytes, entry.name);
      return {
        kind: "image",
        text: `${entry.name} image page`,
        sourcePath: makeArchiveSourceRef(path, entry.name),
        width: dimensions.width,
        height: dimensions.height
      };
    })
  });
};

const importImageDataFiles = async (files: ImportBlobFile[], sourceName: string) => {
  const imageFiles = files.filter((file) => isImageName(file.name)).sort((left, right) => naturalSort(left.name, right.name));
  if (imageFiles.length === 0) throw new Error("Selection does not contain supported image files");

  return createDocument({
    title: sourceName.replace(/\.[^.]+$/, "") || "Images",
    type: "manga",
    sourceName,
    sourcePath: null,
    pages: imageFiles.map((file) => {
      const parsed = parseDataUrl(file.data);
      const dimensions = imageSizeFromBytes(parsed.bytes, file.name);
      return {
        kind: "image",
        text: `${file.name} image page`,
        imageData: file.data,
        width: dimensions.width,
        height: dimensions.height
      };
    })
  });
};

const importArchiveData = async (input: { name: string; data: string }) => {
  const parsed = parseDataUrl(input.data);
  const entries = zipEntriesFromBytes(parsed.bytes);
  if (entries.length === 0) throw new Error("Archive does not contain supported image files");

  return createDocument({
    title: input.name.replace(/\.[^.]+$/, "") || "Manga archive",
    type: "manga",
    sourceName: input.name,
    sourcePath: null,
    pages: entries.map((entry) => {
      const mediaType = contentTypeForPath(entry.name);
      const dimensions = imageSizeFromBytes(entry.bytes, entry.name);
      return {
        kind: "image",
        text: `${entry.name} image page`,
        imageData: dataUrlFromBytes(entry.bytes, mediaType),
        width: dimensions.width,
        height: dimensions.height
      };
    })
  });
};

export const importBlob = async (input: ImportBlobInput) => {
  const name = input.name.trim() || "Picked document";
  if (input.files?.length) {
    return importImageDataFiles(input.files, name);
  }

  if (!input.data) throw new Error("Picked file data is required");
  const extension = extname(name).toLowerCase();
  const parsed = parseDataUrl(input.data);
  const mediaType = input.mimeType || parsed.mediaType || contentTypeForPath(name);

  if (extension === ".pdf" || mediaType === "application/pdf") {
    return importPdfBytes({
      bytes: parsed.bytes,
      title: name.replace(/\.[^.]+$/, "") || "PDF",
      sourceName: name,
      contentData: input.data,
      contentType: "application/pdf"
    });
  }

  if (isArchiveName(name) || mediaType === "application/zip") {
    return importArchiveData({ name, data: input.data });
  }

  if (isImageName(name) || mediaType.startsWith("image/")) {
    return importImageDataFiles([{ name, mimeType: mediaType, data: input.data }], name);
  }

  throw new Error("Unsupported file. Open a PDF, image, image folder, or CBZ/ZIP archive.");
};

export const importPath = async (rawPath: string) => {
  const path = resolve(rawPath.trim());
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    const imagePaths = entries
      .filter((entry) => entry.isFile() && isImageName(entry.name))
      .map((entry) => resolve(path, entry.name))
      .sort(naturalSort);

    if (imagePaths.length === 0) throw new Error("Folder does not contain supported image files");
    return importImagePaths(imagePaths, basename(path), path);
  }

  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") return importPdfFile(path);
  if (isArchiveName(path)) return importArchiveFile(path);
  if (isImageName(path)) return importImagePaths([path], titleFromPath(path), path);
  if (extension === ".rar" || extension === ".cbr") {
    throw new Error("RAR/CBR archives are not supported yet. Use CBZ/ZIP or extract the folder.");
  }
  throw new Error("Unsupported path. Open a PDF, image, image folder, or CBZ/ZIP archive.");
};
