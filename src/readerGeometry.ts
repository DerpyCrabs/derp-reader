export interface FloatingMenuPosition {
  x: number;
  y: number;
  placement: "above" | "below";
  maxHeight: number;
}

const floatingBounds = () => {
  const reader = document.querySelector<HTMLElement>("[data-testid='reader-viewport']");
  const rect = reader?.getBoundingClientRect();
  return {
    left: rect?.left ?? 0,
    top: rect?.top ?? 0,
    right: rect?.right ?? window.innerWidth,
    bottom: rect?.bottom ?? window.innerHeight
  };
};

type Bounds = ReturnType<typeof floatingBounds>;

const isVisibleRect = (rect: DOMRect, bounds: Bounds) => {
  if (rect.width <= 1 || rect.height <= 1) return false;
  return rect.bottom >= bounds.top && rect.top <= bounds.bottom && rect.right >= bounds.left && rect.left <= bounds.right;
};

const visibleRects = (range: Range, bounds: Bounds) =>
  [...range.getClientRects()].filter((rect) => isVisibleRect(rect, bounds));

const textLineRects = (rects: DOMRect[]) => {
  const lineRects = rects.filter((rect) => rect.width >= 80 || rect.width >= rect.height * 2);
  return lineRects.length > 0 ? lineRects : rects;
};

const unionRect = (rects: DOMRect[]) => {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
};

const rectDistance = (a: DOMRect, b: DOMRect) => {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
};

const rectClusters = (rects: DOMRect[]) => {
  const clusters: DOMRect[][] = [];
  for (const rect of rects) {
    const last = clusters.at(-1);
    const previous = last?.at(-1);
    if (!last || !previous || rect.top - previous.bottom > 80) clusters.push([rect]);
    else last.push(rect);
  }
  return clusters;
};

const endpointRect = (node: Node | null, offset: number | undefined, bounds: Bounds) => {
  if (!node || offset === undefined) return null;
  const range = document.createRange();
  try {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (length === 0) return null;
      const end = Math.max(1, Math.min(offset, length));
      range.setStart(node, end - 1);
      range.setEnd(node, end);
    } else if (node.childNodes.length > 0) {
      const childIndex = Math.max(0, Math.min(offset, node.childNodes.length - 1));
      range.selectNode(node.childNodes[childIndex]);
    } else {
      range.selectNode(node);
    }

    const rects = textLineRects(visibleRects(range, bounds));
    return rects.at(-1) ?? null;
  } catch {
    return null;
  } finally {
    range.detach();
  }
};

export const visibleRectForRange = (range: Range, focusNode?: Node | null, focusOffset?: number): DOMRect | null => {
  const bounds = floatingBounds();
  const focusRect = endpointRect(focusNode ?? null, focusOffset, bounds);
  const rects = textLineRects(visibleRects(range, bounds));
  if (rects.length === 0) return null;
  const clusters = rectClusters(rects);
  if (clusters.length === 0) return null;
  if (!focusRect) return unionRect(clusters.at(-1) ?? rects);

  let bestCluster = clusters[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cluster of clusters) {
    const distance = Math.min(...cluster.map((rect) => rectDistance(rect, focusRect)));
    if (distance < bestDistance) {
      bestCluster = cluster;
      bestDistance = distance;
    }
  }
  return unionRect(bestCluster);
};

export const menuPositionForRect = (rect: DOMRect): FloatingMenuPosition => {
  const gap = 12;
  const bounds = floatingBounds();
  const inset = 8;
  const availableWidth = Math.max(280, bounds.right - bounds.left - inset * 2);
  const estimatedMenuWidth = Math.min(760, availableWidth);
  const minMenuHeight = 54;
  const preferredMenuHeight = 224;
  const halfWidth = estimatedMenuWidth / 2;
  const x = Math.max(bounds.left + inset + halfWidth, Math.min(rect.left + rect.width / 2, bounds.right - inset - halfWidth));
  const availableAbove = Math.max(0, rect.top - gap - bounds.top - inset);
  const availableBelow = Math.max(0, bounds.bottom - rect.bottom - gap - inset);
  const placeAbove = availableAbove >= preferredMenuHeight;
  const maxHeight = Math.max(minMenuHeight, placeAbove ? availableAbove : availableBelow);
  const y = placeAbove
    ? Math.max(bounds.top + inset, rect.top - gap)
    : Math.max(bounds.top + inset, Math.min(bounds.bottom - inset, rect.bottom + gap));

  return {
    x,
    y,
    maxHeight,
    placement: placeAbove ? "above" : "below"
  };
};
