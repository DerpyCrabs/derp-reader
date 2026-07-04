const isWordBoundary = (character: string) => /\s/.test(character);

const expandOffsetBackward = (text: string, offset: number) => {
  let nextOffset = Math.max(0, Math.min(offset, text.length));
  while (nextOffset > 0 && !isWordBoundary(text[nextOffset - 1])) nextOffset -= 1;
  return nextOffset;
};

const expandOffsetForward = (text: string, offset: number) => {
  let nextOffset = Math.max(0, Math.min(offset, text.length));
  if (nextOffset === 0 || nextOffset >= text.length || isWordBoundary(text[nextOffset])) return nextOffset;

  let wordStart = nextOffset;
  while (wordStart > 0 && !isWordBoundary(text[wordStart - 1])) wordStart -= 1;

  let wordEnd = nextOffset;
  while (wordEnd < text.length && !isWordBoundary(text[wordEnd])) wordEnd += 1;

  const wordLength = Math.max(1, wordEnd - wordStart);
  const selectedIntoWord = nextOffset - wordStart;
  return selectedIntoWord / wordLength >= 0.5 ? wordEnd : wordStart;
};

export const rangeExpandedToWords = (range: Range) => {
  const expanded = range.cloneRange();
  if (expanded.startContainer.nodeType === Node.TEXT_NODE) {
    expanded.setStart(
      expanded.startContainer,
      expandOffsetBackward(expanded.startContainer.textContent ?? "", expanded.startOffset)
    );
  }
  if (expanded.endContainer.nodeType === Node.TEXT_NODE) {
    expanded.setEnd(
      expanded.endContainer,
      expandOffsetForward(expanded.endContainer.textContent ?? "", expanded.endOffset)
    );
  }
  return expanded;
};
