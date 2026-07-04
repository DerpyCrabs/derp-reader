import { extname } from "node:path";
import { unzipSync } from "fflate";

export const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"]);
export const archiveExtensions = new Set([".zip", ".cbz"]);

export interface DataUrlParts {
  mediaType: string;
  bytes: Uint8Array;
}

export interface ImageSize {
  width: number | null;
  height: number | null;
}

export interface ArchiveSourceRef {
  archivePath: string;
  entryName: string;
}

export const isImageName = (name: string) => imageExtensions.has(extname(name).toLowerCase());
export const isArchiveName = (name: string) => archiveExtensions.has(extname(name).toLowerCase());

export const contentTypeForPath = (path: string) => {
  const archiveRef = parseArchiveSourceRef(path);
  const lower = (archiveRef?.entryName ?? path).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip") || lower.endsWith(".cbz")) return "application/zip";
  return "application/octet-stream";
};

export const dataUrlFromBytes = (bytes: Uint8Array, mediaType: string) =>
  `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;

export const parseDataUrl = (value: string): DataUrlParts => {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error("Expected a data URL");
  const mediaType = match[1] || "application/octet-stream";
  const payload = match[3] ?? "";
  const bytes =
    match[2] === ";base64"
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8"));
  return { mediaType, bytes };
};

export const makeArchiveSourceRef = (archivePath: string, entryName: string) =>
  `archive:${JSON.stringify([archivePath, entryName])}`;

export const parseArchiveSourceRef = (value: string | null | undefined): ArchiveSourceRef | null => {
  if (!value?.startsWith("archive:")) return null;
  try {
    const parsed = JSON.parse(value.slice("archive:".length)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [archivePath, entryName] = parsed;
    if (typeof archivePath !== "string" || typeof entryName !== "string") return null;
    return { archivePath, entryName };
  } catch {
    return null;
  }
};

export const readArchiveEntry = async (ref: ArchiveSourceRef) => {
  const entries = unzipSync(new Uint8Array(await Bun.file(ref.archivePath).arrayBuffer()));
  const entry = entries[ref.entryName];
  if (!entry) throw new Error("Archive entry not found");
  return entry;
};

const readU32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 24) |
  ((bytes[offset + 1] ?? 0) << 16) |
  ((bytes[offset + 2] ?? 0) << 8) |
  (bytes[offset + 3] ?? 0);

const readU16Le = (bytes: Uint8Array, offset: number) => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
const readU32Le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16) |
  ((bytes[offset + 3] ?? 0) << 24);

const parseSvgSize = (bytes: Uint8Array): ImageSize => {
  const text = new TextDecoder().decode(bytes.slice(0, 4096));
  const svg = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const width = svg.match(/\bwidth=["']?([\d.]+)/i)?.[1];
  const height = svg.match(/\bheight=["']?([\d.]+)/i)?.[1];
  if (width && height) return { width: Number(width), height: Number(height) };

  const viewBox = svg.match(/\bviewBox=["'][^"']*?([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (viewBox) return { width: Number(viewBox[3]), height: Number(viewBox[4]) };
  return { width: null, height: null };
};

export const imageSizeFromBytes = (bytes: Uint8Array, name = ""): ImageSize => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".svg") || new TextDecoder().decode(bytes.slice(0, 80)).includes("<svg")) {
    return parseSvgSize(bytes);
  }

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
  }

  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: readU16Le(bytes, 6), height: readU16Le(bytes, 8) };
  }

  if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57) {
    const signature = String.fromCharCode(...bytes.slice(12, 16));
    if (signature === "VP8X") {
      return {
        width: 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)),
        height: 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
      };
    }
    if (signature === "VP8 ") {
      return { width: readU16Le(bytes, 26) & 0x3fff, height: readU16Le(bytes, 28) & 0x3fff };
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
          width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
        };
      }
      offset += 2 + length;
    }
  }

  if (lower.endsWith(".bmp") && bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { width: readU32Le(bytes, 18), height: Math.abs(readU32Le(bytes, 22)) };
  }

  return { width: null, height: null };
};
