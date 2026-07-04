import type { DocumentWithPages } from "../shared/types";

export const estimatedPageBlockHeight = (doc: DocumentWithPages | null, pageIndex: number, zoom: number) => {
  const page = doc?.pages[pageIndex];
  return (page?.height ?? 900) * zoom + 44;
};

export const estimateOffsetForPage = (doc: DocumentWithPages | null, pageIndex: number, zoom: number) => {
  if (!doc) return 0;
  let offset = 0;
  for (let index = 0; index < Math.min(pageIndex, doc.pages.length); index += 1) {
    offset += estimatedPageBlockHeight(doc, index, zoom);
  }
  return offset;
};

export const pageFromScroll = (doc: DocumentWithPages | null, scrollTop: number, zoom: number) => {
  if (!doc) return 0;
  let offset = 0;
  for (let index = 0; index < doc.pages.length; index += 1) {
    offset += estimatedPageBlockHeight(doc, index, zoom);
    if (scrollTop < offset) return index;
  }
  return Math.max(0, doc.pages.length - 1);
};
