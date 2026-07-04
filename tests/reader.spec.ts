import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const apiBase = process.env.TEST_API_BASE ?? "http://127.0.0.1:3101";
const openSettings = async (page: Page) => {
  if (await page.getByTestId("settings-menu").isVisible().catch(() => false)) return;
  await page.getByTestId("settings-menu-button").click();
};
const zoomPercent = async (page: Page) => {
  await openSettings(page);
  return Number(((await page.getByTestId("zoom-value").textContent()) ?? "0").replace("%", ""));
};

const openLibrary = async (page: Page) => {
  if (await page.getByTestId("search-input").isVisible().catch(() => false)) return;
  await page.getByTestId("toggle-library").click();
  await expect(page.getByTestId("search-input")).toBeVisible();
};

const openAssistant = async (page: Page) => {
  if (await page.getByTestId("note-editor").isVisible().catch(() => false)) return;
  await page.getByTestId("toggle-assistant").click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
};

const goToPage = async (page: Page, pageNumber: number) => {
  await expect(page.getByTestId("page-input")).toHaveCount(0);
  await page.getByTestId("page-indicator").click();
  await expect(page.getByTestId("page-jump-popover")).toBeVisible();
  await page.getByTestId("page-input").fill(String(pageNumber));
  await page.getByTestId("page-input").press("Enter");
  await expect(page.getByTestId("page-jump-popover")).toHaveCount(0);
};

const expectPage = async (page: Page, current: number, total: number) => {
  await expect(page.getByTestId("page-input")).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText(`Page ${current} / ${total}`);
};

const selectTextIn = async (page: Page, testId: string, phrase: string) => {
  await page.getByTestId(testId).first().evaluate((node, selectedPhrase) => {
    const walker = globalThis.document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let source: Node | null = null;
    while ((source = walker.nextNode())) {
      if (source.textContent?.includes(selectedPhrase)) break;
    }
    if (!source) throw new Error(`Expected text node containing ${selectedPhrase}`);
    const text = source.textContent ?? "";
    const start = text.indexOf(selectedPhrase);
    const range = globalThis.document.createRange();
    range.setStart(source, start);
    range.setEnd(source, start + selectedPhrase.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, phrase);
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
};

const selectVisibleText = async (page: Page, phrase: string) => {
  await page.evaluate((selectedPhrase) => {
    const viewport = document.querySelector<HTMLElement>("[data-testid='reader-viewport']");
    const viewportRect = viewport?.getBoundingClientRect();
    if (!viewportRect) throw new Error("Expected reader viewport");
    for (const node of document.querySelectorAll<HTMLElement>("[data-testid='page-text']")) {
      const rect = node.getBoundingClientRect();
      if (rect.top < viewportRect.top || rect.top > viewportRect.bottom - 40) continue;
      const walker = globalThis.document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let source: Node | null = null;
      while ((source = walker.nextNode())) {
        if (source.textContent?.includes(selectedPhrase)) break;
      }
      if (!source) continue;
      const text = source.textContent ?? "";
      const start = text.indexOf(selectedPhrase);
      const range = globalThis.document.createRange();
      range.setStart(source, start);
      range.setEnd(source, start + selectedPhrase.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    throw new Error(`Expected visible text containing ${selectedPhrase}`);
  }, phrase);
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
};

const renderedPageNumbers = async (page: Page) =>
  page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>("[data-page-index]")]
      .map((element) => Number(element.dataset.pageIndex) + 1);
  });

const expectRenderedPages = async (page: Page) => {
  await expect.poll(async () => (await renderedPageNumbers(page)).length).toBeGreaterThan(0);
};

const deleteAllDocuments = async () => {
  const response = await fetch(`${apiBase}/api/documents`);
  expect(response.ok).toBeTruthy();
  const { documents } = (await response.json()) as { documents: Array<{ id: string }> };
  await Promise.all(
    documents.map(async (document) => {
      const deleteResponse = await fetch(`${apiBase}/api/documents/${document.id}`, { method: "DELETE" });
      expect(deleteResponse.ok).toBeTruthy();
    })
  );
};

const escapePdfText = (value: string) => value.replace(/[()\\]/g, (match) => `\\${match}`);

const makePdf = (text: string) => {
  const stream = `BT /F1 24 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  return makePdfFromStream(stream);
};

const makePdfLines = (lines: string[]) => {
  const stream = lines
    .map((line, index) => `BT /F1 24 Tf 72 ${720 - index * 34} Td (${escapePdfText(line)}) Tj ET`)
    .join("\n");
  return makePdfFromStream(stream);
};

const makePdfPages = (pages: string[]) => {
  return makePdfPageStreams(pages.map((text) => `BT /F1 24 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`));
};

const makePdfPageStreams = (streams: string[]) => {
  const fontObjectId = 3 + streams.length * 2;
  const pageObjects = streams.map((stream, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    return {
      page: `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj\n`,
      content: `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
      pageObjectId
    };
  });
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjects.map(({ pageObjectId }) => `${pageObjectId} 0 R`).join(" ")}] /Count ${streams.length} >>\nendobj\n`,
    ...pageObjects.flatMap(({ page, content }) => [page, content]),
    `${fontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
};

const makePdfFromStream = (stream: string) => {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
};

const mangaSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="340" viewBox="0 0 260 340">
    <rect width="260" height="340" fill="#fff7df"/>
    <rect x="18" y="18" width="224" height="304" fill="#d8efe9" stroke="#356f65" stroke-width="6"/>
    <text x="42" y="82" font-family="Arial" font-size="26" fill="#17211d">Texto dificil</text>
    <circle cx="190" cy="220" r="48" fill="#ffbd4a"/>
  </svg>`,
  "utf8"
);

const createTextDocument = async (title: string, pages?: Array<{ kind: "text"; text: string }>) => {
  const response = await fetch(`${apiBase}/api/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      type: "text",
      sourceName: title,
      language: "fr",
      pages: pages ?? [
        {
          kind: "text",
          text:
            "Le petit prince regarda la fleur. Elle toussa pour cacher son embarras. Il comprit qu'il devait apprendre a ecouter les silences autant que les mots."
        },
        {
          kind: "text",
          text:
            "Quand un texte resiste, on peut le traduire, definir les mots difficiles, garder une note, puis en discuter avec une IA patiente."
        }
      ]
    })
  });
  expect(response.ok).toBeTruthy();
  return (await response.json()) as { document: { id: string; title: string } };
};

const importBackendPath = async (path: string) => {
  const response = await fetch(`${apiBase}/api/import/path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
  expect(response.ok).toBeTruthy();
  return (await response.json()) as {
    document: {
      id: string;
      title: string;
      sourcePath: string | null;
      fileUrl: string | null;
      pages: Array<{ id: string; text: string; imageData: string | null; sourcePath: string | null }>;
    };
  };
};

test("product AI mode reports missing provider instead of returning mocks", async () => {
  const originalMock = process.env.AI_TEST_MOCK;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.AI_TEST_MOCK;
  delete process.env.OPENAI_API_KEY;
  try {
    const { generateAiResponse } = await import("../server/ai");
    const result = await generateAiResponse({
      task: "translate",
      text: "Bonjour"
    });
    expect(result.title).toBe("AI provider not configured");
    expect(result.content).toContain("Set OPENAI_API_KEY");
    expect(result.content).not.toContain("Test translation");
    expect(result.provider).toBe("none");
  } finally {
    if (originalMock === undefined) delete process.env.AI_TEST_MOCK;
    else process.env.AI_TEST_MOCK = originalMock;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("keeps the no-document reader focused on opening files", async ({ page }) => {
  await deleteAllDocuments();
  await page.goto("/");
  await expect(page.getByTestId("open-menu-button")).toHaveCount(0);
  await expect(page.getByTestId("library-open-file")).toHaveCount(0);
  await expect(page.getByTestId("file-picker")).toHaveCount(1);
  await expect(page.getByTestId("folder-picker")).toHaveCount(1);
  await expect(page.getByTestId("active-title")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("No file open");
  await expect(page.getByTestId("settings-menu-button")).toHaveCount(0);
  await expect(page.getByTestId("toggle-assistant")).toHaveCount(0);
  await expect(page.getByTestId("empty-open-target")).toContainText("Drop files here");
  await expect(page.getByTestId("empty-open-target")).toBeEnabled();
  await expect(page.getByTestId("empty-reader").locator("svg")).toHaveCount(0);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("empty-open-target").click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
});

test("shows a useful backend unavailable error", async ({ page }) => {
  await page.route("**/api/documents", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Backend unavailable");
  await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
});

test("deletes saved selections through the backend route", async ({}, testInfo) => {
  const title = `Backend delete selection ${testInfo.project.name}`;
  const { document } = await createTextDocument(title);
  const createResponse = await fetch(`${apiBase}/api/selections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      kind: "text",
      text: "delete me",
      tags: ["text"]
    })
  });
  expect(createResponse.ok).toBeTruthy();
  const { selection } = (await createResponse.json()) as { selection: { id: string } };

  const deleteResponse = await fetch(`${apiBase}/api/selections/${selection.id}`, { method: "DELETE" });
  expect(deleteResponse.ok).toBeTruthy();
  await expect(deleteResponse.json()).resolves.toMatchObject({ deleted: true });

  const listResponse = await fetch(`${apiBase}/api/selections?documentId=${document.id}`);
  const { selections } = (await listResponse.json()) as { selections: Array<{ id: string }> };
  expect(selections.some((item) => item.id === selection.id)).toBe(false);
});

test("deletes documents through the backend route", async ({}, testInfo) => {
  const title = `Backend delete document ${testInfo.project.name}`;
  const { document } = await createTextDocument(title);

  const deleteResponse = await fetch(`${apiBase}/api/documents/${document.id}`, { method: "DELETE" });
  expect(deleteResponse.ok).toBeTruthy();
  const result = (await deleteResponse.json()) as { deleted: boolean };
  expect(result.deleted).toBe(true);

  const listResponse = await fetch(`${apiBase}/api/documents`);
  expect(listResponse.ok).toBeTruthy();
  const { documents } = (await listResponse.json()) as { documents: Array<{ id: string }> };
  expect(documents.some((item) => item.id === document.id)).toBe(false);
});

test("saves selected text, translates, notes, chats, and searches", async ({ page }, testInfo) => {
  const title = `Reader workflow ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");
  await expect(page.getByTestId("open-menu-button")).toHaveCount(0);
  await expect(page.getByTestId("file-picker")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("Derp Reader");

  await openLibrary(page);
  await expect(page.getByTestId("library-open-file")).toBeVisible();
  await expect(page.getByTestId("library-open-folder")).toBeVisible();
  await expect(page.getByTestId("document-row").first()).not.toContainText(/pdf -|text -|manga -|\d+p/);
  const documentRow = page.getByTestId("document-row").filter({ hasText: title });
  await expect(documentRow).toBeVisible();
  if (!((await documentRow.getAttribute("class")) ?? "").includes("active")) {
    await documentRow.click();
    await expect(documentRow).toHaveClass(/active/);
  }
  const pageText = page.getByTestId("page-text").first();
  await expect(pageText).toContainText("Le petit prince");
  await expect(page.getByTestId("busy-status")).toHaveCount(0);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await selectTextIn(page, "page-text", "Le petit prince");
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  const menuGeometry = await page.getByTestId("selection-menu").evaluate((menu) => {
    const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
    const selectionRect = range?.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const overlaps =
      !!selectionRect &&
      menuRect.left < selectionRect.right &&
      menuRect.right > selectionRect.left &&
      menuRect.top < selectionRect.bottom &&
      menuRect.bottom > selectionRect.top;
    const rows = new Set(
      [...menu.querySelector(".selection-actions")!.children].map((child) =>
        Math.round((child as HTMLElement).getBoundingClientRect().top)
      )
    ).size;
    return { overlaps, rows, height: menuRect.height };
  });
  expect(menuGeometry.overlaps).toBe(false);
  expect(menuGeometry.rows).toBe(1);
  await expect(page.getByTestId("selection-preview-text")).toHaveValue(/Le petit prince/);
  await expect(page.getByTitle("Close selection menu")).toHaveCount(0);

  await page.mouse.click(12, 120);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await selectTextIn(page, "page-text", "Le petit prince");
  await expect(page.getByTestId("selection-menu")).toBeVisible();

  await page.getByTestId("menu-translate").click();
  await expect(page.getByTestId("ai-result")).toContainText("Test translation");
  await page.getByTestId("menu-define").click();
  await expect(page.getByTestId("ai-result")).toContainText("Test definitions");
  await expect(page.getByTestId("ai-result")).not.toContainText("Test translation");

  await page.getByTestId("menu-note").click();
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await expect(page.getByTestId("note-editor")).toBeFocused();
  await page.getByTestId("note-editor").fill("Selection note: silences matter in this passage.");
  await expect(page.getByTestId("note-row").filter({ hasText: "Selection note" })).toBeVisible();
  await goToPage(page, 2);
  await expectPage(page, 2, 2);
  await openAssistant(page);
  await page.getByTestId("note-row").filter({ hasText: "Selection note" }).click();
  await expectPage(page, 1, 2);
  await expect(page.getByTestId("saved-text-highlight")).toBeVisible();
  const savedTextBox = await page.getByTestId("saved-text-highlight").boundingBox();
  expect(savedTextBox?.width).toBeGreaterThan(30);
  expect(savedTextBox?.height).toBeGreaterThan(10);

  await openAssistant(page);
  await page.getByTestId("document-note-mode").click();
  await expect(page.getByTestId("note-editor")).toHaveValue("");
  await expect(page.getByTestId("chat-input")).toHaveAttribute("placeholder", "Ask about this document");
  await page.getByTestId("note-editor").fill("Document note: read this letter again tomorrow.");
  await expect(page.getByTestId("note-row").filter({ hasText: "Document note" })).toBeVisible();
  await page.getByTestId("note-row").filter({ hasText: "Document note" }).getByTestId("delete-note").click();
  await expect(page.getByTestId("note-row").filter({ hasText: "Document note" })).toHaveCount(0);
  await expect(page.getByTestId("note-editor")).toHaveValue("");
  await page.getByTestId("note-editor").fill("Document note: read this letter again tomorrow.");
  await expect(page.getByTestId("note-row").filter({ hasText: "Document note" })).toBeVisible();

  await page.getByTestId("chat-input").fill("What is the whole letter about?");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("chat-messages")).toContainText("What is the whole letter about?");
  await expect(page.getByRole("button", { name: "Document discussion" })).toBeVisible();

  await openAssistant(page);
  await page.getByTestId("note-row").filter({ hasText: "Selection note" }).click();
  await expect(page.getByTestId("note-editor")).toHaveValue("Selection note: silences matter in this passage.");
  await expect(page.getByTestId("chat-input")).toHaveAttribute("placeholder", "Ask about this selection");
  await expect(page.getByTestId("chat-context-pill")).toHaveText("Selection");

  await page.getByTestId("chat-input").fill("Explain the tone.");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("chat-messages")).toContainText("Test assistant");
  await expect(page.getByRole("button", { name: "Selection discussion" })).toBeVisible();

  const firstPageBox = await pageText.boundingBox();
  expect(firstPageBox).not.toBeNull();
  await page.mouse.move(firstPageBox!.x + 34, firstPageBox!.y + 56);
  await page.mouse.down();
  await page.mouse.move(firstPageBox!.x + Math.min(firstPageBox!.width - 34, 360), firstPageBox!.y + 56);
  await page.mouse.up();
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("menu-add-chat")).toBeVisible();
  await page.getByTestId("menu-add-chat").click();
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await expect(page.getByTestId("chat-input")).toBeFocused();
  await expect(page.getByTestId("chat-context-pill")).toHaveText("Selection");
  await expect(page.getByTestId("chat-messages")).not.toContainText("Additional selected passage");
  await page.getByTestId("chat-input").fill("Compare this added passage with the previous one.");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("chat-messages")).toContainText("Compare this added passage");

  await openLibrary(page);
  await page.getByTestId("search-input").fill("silences");
  const selectionNoteResult = page.getByTestId("search-result").filter({ hasText: "Selection note" }).first();
  await expect(selectionNoteResult).toBeVisible();
  await selectionNoteResult.click();
  await expect(page.getByTestId("note-editor")).toHaveValue("Selection note: silences matter in this passage.");
  await openLibrary(page);
  await page.getByTestId("search-input").fill("tomorrow");
  const documentNoteResult = page.getByTestId("search-result").filter({ hasText: "Document note" }).first();
  await expect(documentNoteResult).toBeVisible();
  await documentNoteResult.click();
  await expect(page.getByTestId("note-editor")).toHaveValue("Document note: read this letter again tomorrow.");
  await goToPage(page, 2);
  await expectPage(page, 2, 2);
  await openLibrary(page);
  await page.getByTestId("search-input").fill("tone");
  const chatResult = page.getByTestId("search-result").filter({ hasText: "Selection discussion" }).first();
  await expect(chatResult).toBeVisible();
  await chatResult.click();
  await expectPage(page, 1, 2);
  await expect(page.getByTestId("chat-messages")).toContainText("Explain the tone.");
  await openAssistant(page);

  const selectionChatChip = page.getByTestId("chat-chip").filter({ hasText: "Selection discussion" });
  await selectionChatChip.getByTestId("delete-chat").click();
  await expect(selectionChatChip).toHaveCount(0);
  await expect(page.getByTestId("empty-chat-copy")).toHaveText("No messages");

  await page.getByTestId("note-row").filter({ hasText: "Selection note" }).getByTestId("delete-note").click();
  await expect(page.getByTestId("saved-text-highlight")).toHaveCount(0);
  await openAssistant(page);
  await expect(page.getByTestId("chat-input")).toHaveAttribute("placeholder", "Ask about this document");
  await expect(page.getByTestId("chat-context-pill")).toHaveCount(0);
});

test("opens picked PDFs through the browser picker and reopens stored content", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfText = `Picked browser pdf ${suffix}`;
  const pdfPath = testInfo.outputPath(`picked-${suffix}.pdf`);
  await writeFile(pdfPath, makePdf(pdfText));

  await page.goto("/");
  await page.getByTestId("file-picker").setInputFiles(pdfPath);
  await expect(page.getByTestId("pdf-text-layer")).toContainText(pdfText);

  const documentsResponse = await fetch(`${apiBase}/api/documents`);
  const { documents } = (await documentsResponse.json()) as {
    documents: Array<{ id: string; title: string; sourcePath: string | null }>;
  };
  const document = documents.find((item) => item.title === `picked-${suffix}`);
  expect(document).toBeTruthy();
  expect(document!.sourcePath).toBeNull();

  const detailResponse = await fetch(`${apiBase}/api/documents/${document!.id}`);
  const { document: detail } = (await detailResponse.json()) as {
    document: { fileUrl: string | null; pages: Array<{ text: string }> };
  };
  expect(detail.fileUrl).toContain(`/api/documents/${document!.id}/file`);
  expect(detail.pages[0].text).toBe("");

  await page.reload();
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: `picked-${suffix}` }).click();
  await expect(page.getByTestId("pdf-text-layer")).toContainText(pdfText);
});

test("opens multiple picked documents as separate library entries", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfText = `Batch picked pdf ${suffix}`;
  const pdfPath = testInfo.outputPath(`batch-${suffix}.pdf`);
  const cbzPath = testInfo.outputPath(`batch-manga-${suffix}.cbz`);
  await writeFile(pdfPath, makePdf(pdfText));
  await writeFile(cbzPath, Buffer.from(zipSync({ "001.svg": mangaSvg, "002.svg": mangaSvg })));

  await page.goto("/");
  await page.getByTestId("file-picker").setInputFiles([pdfPath, cbzPath]);

  await expect(page.getByTestId("pdf-text-layer")).toContainText(pdfText);
  await openLibrary(page);
  await expect(page.getByTestId("document-row").filter({ hasText: `batch-${suffix}` })).toBeVisible();
  await expect(page.getByTestId("document-row").filter({ hasText: `batch-manga-${suffix}` })).toBeVisible();
  await page.getByTestId("document-row").filter({ hasText: `batch-manga-${suffix}` }).click();
  await expect(page.getByTestId("image-page")).toHaveCount(2);
});

test("opens dropped PDFs directly in the reader", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfText = `Dropped reader pdf ${suffix}`;
  const pdfBytes = makePdf(pdfText);

  await page.goto("/");
  await page.getByTestId("reader-viewport").dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(
      ({ name, bytes }) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
        return dataTransfer;
      },
      { name: `dropped-${suffix}.pdf`, bytes: Array.from(pdfBytes) }
    )
  });

  await expect(page.getByTestId("pdf-text-layer")).toContainText(pdfText);
  await openLibrary(page);
  await expect(page.getByTestId("document-row").filter({ hasText: `dropped-${suffix}` })).toBeVisible();
});

test("opens image folders while ignoring stray unsupported files", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const folderName = `folder-manga-${suffix}`;

  await page.goto("/");
  await page.getByTestId("reader-viewport").dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(
      ({ folder, svgText }) => {
        const dataTransfer = new DataTransfer();
        const files = [
          { file: new File([svgText], "001.svg", { type: "image/svg+xml" }), path: `${folder}/chapter-01/001.svg` },
          { file: new File([svgText], "002.svg", { type: "image/svg+xml" }), path: `${folder}/chapter-01/002.svg` },
          { file: new File(["metadata"], "notes.txt", { type: "text/plain" }), path: `${folder}/notes.txt` }
        ];
        for (const entry of files) {
          Object.defineProperty(entry.file, "webkitRelativePath", {
            value: entry.path,
            configurable: true
          });
          dataTransfer.items.add(entry.file);
        }
        return dataTransfer;
      },
      { folder: folderName, svgText: mangaSvg.toString("utf8") }
    )
  });

  await expect(page.getByTestId("image-page")).toHaveCount(2);
  await openLibrary(page);
  await expect(page.getByTestId("document-row").filter({ hasText: folderName })).toBeVisible();
  await expect(page.getByTestId("document-row").filter({ hasText: folderName })).not.toContainText("manga - 2p");
});

test("shows and dismisses unsupported folder import errors", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");

  await page.goto("/");
  await page.getByTestId("reader-viewport").dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(
      ({ folder }) => {
        const dataTransfer = new DataTransfer();
        const file = new File(["metadata"], "notes.txt", { type: "text/plain" });
        Object.defineProperty(file, "webkitRelativePath", {
          value: `${folder}/notes.txt`,
          configurable: true
        });
        dataTransfer.items.add(file);
        return dataTransfer;
      },
      { folder: `empty-folder-${suffix}` }
    )
  });

  await expect(page.getByRole("alert")).toContainText("Folder does not contain supported image files");
  await page.getByTestId("dismiss-error").click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("imports a PDF and exposes a selectable PDF.js text layer", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfText = "Seneca once remarked of Socrates tablet";
  const pdfPath = testInfo.outputPath(`bonjour-tablette-${suffix}.pdf`);
  await writeFile(pdfPath, makePdf(pdfText));
  const { document } = await importBackendPath(pdfPath);
  expect(document.fileUrl).toContain(`/api/documents/${document.id}/file`);
  expect(document.pages[0].text).toBe("");
  await page.goto("/");

  await openLibrary(page);
  await expect(page.getByTestId("document-row").filter({ hasText: `bonjour-tablette-${suffix}` })).toBeVisible();
  await expect(page.getByTestId("pdf-text-layer")).toContainText(pdfText);

  const pdfLayerBox = await page.getByTestId("pdf-text-layer").boundingBox();
  expect(pdfLayerBox).not.toBeNull();
  await page.mouse.click(pdfLayerBox!.x + 90, pdfLayerBox!.y + 70);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);

  await page.getByTestId("pdf-text-layer").selectText();
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveValue(new RegExp(pdfText));
  await expect(
    page.getByTestId("pdf-text-layer").evaluate((layer) => getComputedStyle(layer.querySelector("span")!, "::selection").backgroundColor)
  ).resolves.not.toBe("rgba(0, 0, 0, 0)");

  await page.mouse.click(12, 120);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await page.getByTestId("pdf-text-layer").evaluate((layer) => {
    const span = [...layer.querySelectorAll("span")].find((item) => item.textContent?.includes("tablet"));
    if (!span?.firstChild) throw new Error("Expected PDF text span");
    const text = span.textContent ?? "";
    const start = text.indexOf("tablet");
    const range = globalThis.document.createRange();
    range.setStart(span.firstChild, start);
    range.setEnd(span.firstChild, start + "tablet".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
  await expect(page.getByTestId("selection-preview-text")).toHaveValue("tablet");

  await page.mouse.click(12, 120);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await page.getByTestId("pdf-text-layer").evaluate((layer) => {
    const span = [...layer.querySelectorAll("span")].find((item) => item.textContent?.includes("remarked of"));
    if (!span?.firstChild) throw new Error("Expected PDF text span");
    const text = span.textContent ?? "";
    const start = text.indexOf("Seneca");
    const end = text.indexOf("of") + "of".length;
    const range = globalThis.document.createRange();
    range.setStart(span.firstChild, start);
    range.setEnd(span.firstChild, end);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
  await expect(page.getByTestId("selection-preview-text")).toHaveValue("Seneca once remarked of");

  await page.mouse.click(12, 120);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await page.getByTestId("pdf-text-layer").selectText();
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
  await expect(page.getByTestId("selection-preview-text")).toHaveValue(new RegExp(pdfText));

  await page.getByTestId("menu-note").click();
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await page.getByTestId("note-editor").fill("PDF selection note for tablet");
  await expect(page.getByTestId("note-row").filter({ hasText: "PDF selection note" })).toBeVisible();
  await openLibrary(page);
  await page.getByTestId("search-input").fill("tablet");
  await expect(page.getByTestId("search-result").filter({ hasText: "PDF selection note" }).first()).toBeVisible();

  await page.reload();
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: `bonjour-tablette-${suffix}` }).click();
  await expect(page.getByTestId("pdf-text-layer")).toContainText(pdfText);
});

test("keeps PDF selection editable across text-layer spans without rewriting it", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-span-selection-${suffix}.pdf`);
  await writeFile(pdfPath, makePdfLines(["Alpha beta", "Gamma delta"]));
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer")).toContainText("Alpha beta");
  await expect(page.getByTestId("pdf-text-layer")).toContainText("Gamma delta");
  await page.getByTestId("pdf-text-layer").evaluate((layer) => {
    const spans = [...layer.querySelectorAll("span")].filter((span) => span.textContent?.trim());
    const first = spans.find((span) => span.textContent?.includes("Alpha beta"));
    const second = spans.find((span) => span.textContent?.includes("Gamma delta"));
    if (!first?.firstChild || !second?.firstChild) throw new Error("Expected two PDF text spans");
    const range = globalThis.document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(second.firstChild, "Gamma delta".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");

  await expect(page.getByTestId("selection-preview-text")).toHaveValue(/Alpha beta.*Gamma delta/);
  await page.getByTestId("selection-preview-text").fill("Corrected alpha beta");
  await page.getByTestId("menu-note").click();
  await page.getByTestId("note-editor").fill("Corrected alpha beta note");
  await expect(page.getByTestId("note-row").filter({ hasText: "Corrected alpha beta note" })).toBeVisible();
  await openLibrary(page);
  await page.getByTestId("search-input").fill("corrected");
  await expect(page.getByTestId("search-result").filter({ hasText: "Corrected alpha beta note" }).first()).toBeVisible();
});

test("keeps the selected PDF page mounted while the selection menu is open", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-selection-scroll-${suffix}.pdf`);
  await writeFile(
    pdfPath,
    makePdfPages(
      Array.from({ length: 8 }, (_, index) => `Scroll remount page ${index + 1} selected phrase ${index + 1}`)
    )
  );
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer").first()).toContainText("Scroll remount page 1");
  await page.evaluate(() => {
    const layer = [...document.querySelectorAll<HTMLElement>("[data-testid='pdf-text-layer']")].find((element) =>
      element.textContent?.includes("selected phrase 1")
    );
    if (!layer) throw new Error("Expected first PDF text layer");
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let source: Node | null = null;
    while ((source = walker.nextNode())) {
      if (source.textContent?.includes("selected phrase 1")) break;
    }
    if (!source) throw new Error("Expected selected phrase text node");
    const text = source.textContent ?? "";
    const start = text.indexOf("selected phrase 1");
    const range = document.createRange();
    range.setStart(source, start);
    range.setEnd(source, start + "selected phrase 1".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (window as Window & { selectedPdfLayer?: HTMLElement }).selectedPdfLayer = layer;
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
  await expect(page.getByTestId("selection-preview-text")).toHaveValue("selected phrase 1");
  await expect(
    page.evaluate(() => ({
      layerConnected: Boolean((window as Window & { selectedPdfLayer?: HTMLElement }).selectedPdfLayer?.isConnected),
      selectionText: window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? ""
    }))
  ).resolves.toEqual({ layerConnected: true, selectionText: "selected phrase 1" });

  await page.getByTestId("reader-viewport").evaluate((viewport) => {
    viewport.scrollTop += viewport.clientHeight * 5;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        layerConnected: Boolean((window as Window & { selectedPdfLayer?: HTMLElement }).selectedPdfLayer?.isConnected),
        selectionText: window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? ""
      }))
    )
    .toEqual({ layerConnected: true, selectionText: "selected phrase 1" });
});

test("opens the floating menu for PDF selections spanning pages without scrolling", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-cross-page-selection-${suffix}.pdf`);
  await writeFile(
    pdfPath,
    makePdfPageStreams([
      `BT /F1 24 Tf 72 130 Td (Cross page start selection) Tj ET`,
      [
        `BT /F1 18 Tf 0 1 -1 0 54 220 Tm (LETTERS ON ETHICS) Tj ET`,
        `BT /F1 24 Tf 72 680 Td (Cross page end selection) Tj ET`
      ].join("\n")
    ])
  );
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer").first()).toContainText("Cross page start selection");
  await page.getByTestId("reader-viewport").evaluate((viewport) => {
    const secondPage = document.querySelector<HTMLElement>('[data-page-index="1"]');
    if (!secondPage) throw new Error("Expected second page");
    viewport.scrollTop = Math.max(0, secondPage.offsetTop - 320);
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByTestId("pdf-text-layer").nth(1)).toContainText("Cross page end selection");
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLSpanElement>("[data-testid='pdf-text-layer'] span")];
    const first = spans.find((span) => span.textContent?.includes("Cross page start"));
    const second = spans.find((span) => span.textContent?.includes("Cross page end"));
    if (!first?.firstChild || !second?.firstChild) throw new Error("Expected cross-page PDF text spans");
    const firstText = first.textContent ?? "";
    const secondText = second.textContent ?? "";
    const range = document.createRange();
    range.setStart(first.firstChild, firstText.indexOf("start"));
    range.setEnd(second.firstChild, secondText.indexOf("selection") + "selection".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveValue(/start selection.*Cross page end selection/);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>("[data-testid='selection-menu']");
    const reader = document.querySelector<HTMLElement>("[data-testid='reader-viewport']");
    const endSpan = [...document.querySelectorAll<HTMLSpanElement>("[data-testid='pdf-text-layer'] span")]
      .find((span) => span.textContent?.includes("Cross page end"));
    if (!menu || !reader || !endSpan) throw new Error("Expected menu, reader, and selected end span");
    const menuRect = menu.getBoundingClientRect();
    const readerRect = reader.getBoundingClientRect();
    const endRect = endSpan.getBoundingClientRect();
    return {
      distanceFromEndLine: Math.min(Math.abs(menuRect.top - endRect.bottom), Math.abs(menuRect.bottom - endRect.top)),
      menuBottomGap: readerRect.bottom - menuRect.bottom
    };
  });
  expect(geometry.distanceFromEndLine).toBeLessThan(220);
  expect(geometry.menuBottomGap).toBeGreaterThan(80);
});

test("keeps the floating menu outside ordinary multi-line PDF selections", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-multiline-selection-menu-${suffix}.pdf`);
  await writeFile(
    pdfPath,
    makePdfLines([
      "First selected line starts a normal passage",
      "Second selected line continues the passage",
      "Third selected line keeps the block compact",
      "Fourth selected line ends the selected block",
      "Unselected line below should stay clear"
    ])
  );
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer")).toContainText("First selected line");
  await page.getByTestId("pdf-text-layer").evaluate((layer) => {
    const spans = [...layer.querySelectorAll("span")];
    const first = spans.find((span) => span.textContent?.includes("First selected line"));
    const last = spans.find((span) => span.textContent?.includes("Fourth selected line"));
    if (!first?.firstChild || !last?.firstChild) throw new Error("Expected selected PDF spans");
    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(last.firstChild, last.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  await expect(page.getByTestId("selection-menu")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>("[data-testid='selection-menu']");
    const selection = window.getSelection();
    if (!menu || !selection?.rangeCount) throw new Error("Expected menu and native selection");
    const menuRect = menu.getBoundingClientRect();
    const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
    const overlaps =
      menuRect.left < selectionRect.right &&
      menuRect.right > selectionRect.left &&
      menuRect.top < selectionRect.bottom &&
      menuRect.bottom > selectionRect.top;
    return {
      overlaps,
      distance: Math.min(Math.abs(menuRect.top - selectionRect.bottom), Math.abs(menuRect.bottom - selectionRect.top))
    };
  });
  expect(geometry.overlaps).toBe(false);
  expect(geometry.distance).toBeLessThan(260);
});

test("does not expand PDF selections into barely touched next words", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-word-snap-${suffix}.pdf`);
  await writeFile(pdfPath, makePdf("A conversation about Plato"));
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer")).toContainText("A conversation about Plato");
  await page.getByTestId("pdf-text-layer").evaluate((layer) => {
    const span = [...layer.querySelectorAll("span")].find((item) => item.textContent?.includes("conversation about"));
    if (!span?.firstChild) throw new Error("Expected PDF text span");
    const text = span.textContent ?? "";
    const range = globalThis.document.createRange();
    range.setStart(span.firstChild, text.indexOf("A"));
    range.setEnd(span.firstChild, text.indexOf("about") + 1);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");

  await expect(page.getByTestId("selection-preview-text")).toHaveValue("A conversation a");
  await expect(page.getByTestId("selection-preview-text")).not.toHaveValue(/about/);
});

test("does not pull extra PDF lines when selection ends in a line gap", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-gap-end-${suffix}.pdf`);
  await writeFile(pdfPath, makePdfLines(["Alpha beta gamma", "Delta epsilon zeta"]));
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer")).toContainText("Alpha beta gamma");
  await page.getByTestId("pdf-text-layer").evaluate((layer) => {
    const first = [...layer.querySelectorAll("span")].find((span) => span.textContent?.includes("Alpha beta gamma"));
    if (!first?.firstChild) throw new Error("Expected PDF text line");
    const text = first.textContent ?? "";
    const range = globalThis.document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(first.firstChild, text.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");

  await expect(page.getByTestId("selection-preview-text")).toHaveValue(/Alpha beta gamma/);
  await expect(page.getByTestId("selection-preview-text")).not.toHaveValue(/Delta/);
});

test("PDF image selection mode removes the text layer and selects visual regions", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`visual-select-${suffix}.pdf`);
  await writeFile(pdfPath, makePdf("PDF text should not be selectable in image mode"));
  await importBackendPath(pdfPath);
  await page.goto("/");
  await expect(page.getByTestId("pdf-text-layer")).toBeVisible();

  await openSettings(page);
  await page.getByTestId("selection-mode-image").click();
  await expect(page.getByTestId("settings-menu")).toHaveCount(0);
  await expect(page.getByTestId("pdf-text-layer")).toHaveCount(0);

  const canvasBox = await page.getByTestId("pdf-canvas").first().boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + 80, canvasBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 240, canvasBox!.y + 180);
  await page.mouse.up();

  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveCount(0);
  await expect(page.evaluate(() => window.getSelection()?.toString() ?? "")).resolves.toBe("");
});

test("imports images, crops a region selection, and chats about it", async ({ page }) => {
  const svgPath = test.info().outputPath("page-001.svg");
  await writeFile(svgPath, mangaSvg);
  const { document } = await importBackendPath(svgPath);
  expect(document.sourcePath).toBeTruthy();
  expect(document.pages[0].sourcePath).toBeTruthy();
  expect(document.pages[0].imageData).toContain(`/api/documents/${document.id}/pages/0/file`);
  expect(document.pages[0].imageData).not.toContain("data:");
  await page.goto("/");

  await expect(page.getByTestId("image-page")).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId("selection-mode-image")).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-menu")).toHaveCount(0);

  const box = await page.getByTestId("image-page").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 40, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + 170, box!.y + 190);
  await page.mouse.up();

  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("region-layer").first().locator(".region-box")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveCount(0);

  await page.getByTestId("menu-define").click();
  await expect(page.getByTestId("ai-result")).toContainText("selected page-image");
  await expect(page.getByTestId("region-layer").first().locator(".region-box")).toBeVisible();
  await expect(page.getByTestId("saved-region-highlight")).toHaveCount(0);

  await page.getByTestId("menu-new-chat").click();
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await expect(page.getByTestId("chat-input")).toBeFocused();
  await expect(page.getByTestId("chat-context-pill")).toHaveText("Selection");

  await page.getByTestId("chat-input").fill("What should I notice in this panel?");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("chat-messages")).toContainText("selected page-image");
});

test("uses the source PDF as AI context for visual PDF regions", async ({}, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfText = `Visual pdf context ${suffix}`;
  const pdfPath = testInfo.outputPath(`visual-context-${suffix}.pdf`);
  await writeFile(pdfPath, makePdf(pdfText));
  const { document } = await importBackendPath(pdfPath);

  const selectionResponse = await fetch(`${apiBase}/api/selections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      pageId: document.pages[0].id,
      kind: "image",
      text: "PDF visual region",
      region: { pageIndex: 0, x: 72, y: 690, width: 240, height: 50 },
      tags: ["image", "region", "pdf"]
    })
  });
  expect(selectionResponse.ok).toBeTruthy();
  const { selection } = (await selectionResponse.json()) as { selection: { id: string } };

  const chatResponse = await fetch(`${apiBase}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: document.id, selectionId: selection.id, title: "PDF visual region" })
  });
  expect(chatResponse.ok).toBeTruthy();
  const { chat } = (await chatResponse.json()) as { chat: { id: string } };

  const messageResponse = await fetch(`${apiBase}/api/chats/${chat.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Use the selected region." })
  });
  expect(messageResponse.ok).toBeTruthy();
  const { chat: nextChat } = (await messageResponse.json()) as {
    chat: { messages: Array<{ role: string; content: string }> };
  };
  expect(nextChat.messages.some((message) => message.role === "assistant" && message.content.includes("selected document-pdf"))).toBe(
    true
  );
});

test("uses added visual selections as context for the next current-chat message", async ({}, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`added-visual-context-${suffix}.pdf`);
  await writeFile(pdfPath, makePdf(`Added visual context ${suffix}`));
  const { document } = await importBackendPath(pdfPath);

  const selectionResponse = await fetch(`${apiBase}/api/selections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      pageId: document.pages[0].id,
      kind: "image",
      text: "",
      region: { pageIndex: 0, x: 60, y: 680, width: 260, height: 70 },
      tags: ["image", "region", "pdf"]
    })
  });
  expect(selectionResponse.ok).toBeTruthy();
  const { selection } = (await selectionResponse.json()) as { selection: { id: string } };

  const chatResponse = await fetch(`${apiBase}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: document.id, title: "Document discussion" })
  });
  expect(chatResponse.ok).toBeTruthy();
  const { chat } = (await chatResponse.json()) as { chat: { id: string; selectionId: string | null } };
  expect(chat.selectionId).toBeNull();

  const messageResponse = await fetch(`${apiBase}/api/chats/${chat.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "What is inside this added region?", selectionId: selection.id })
  });
  expect(messageResponse.ok).toBeTruthy();
  const { chat: nextChat } = (await messageResponse.json()) as {
    chat: { selectionId: string | null; messages: Array<{ role: string; content: string }> };
  };
  expect(nextChat.selectionId).toBeNull();
  expect(nextChat.messages.some((message) => message.role === "assistant" && message.content.includes("selected document-pdf"))).toBe(
    true
  );
});

test("opens CBZ manga archives from the picker", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const cbzPath = testInfo.outputPath(`manga-${suffix}.cbz`);
  await writeFile(cbzPath, Buffer.from(zipSync({ "001.svg": mangaSvg, "002.svg": mangaSvg })));

  await page.goto("/");
  await page.getByTestId("file-picker").setInputFiles(cbzPath);
  await expect(page.getByTestId("image-page").first()).toBeVisible();
  await expect(page.getByTestId("image-page")).toHaveCount(2);
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 / 2");

  const documentsResponse = await fetch(`${apiBase}/api/documents`);
  const { documents } = (await documentsResponse.json()) as {
    documents: Array<{ id: string; title: string; sourcePath: string | null; type: string; pageCount: number }>;
  };
  const document = documents.find((item) => item.title === `manga-${suffix}`);
  expect(document).toMatchObject({ sourcePath: null, type: "manga", pageCount: 2 });
});

test("remembers opened entries and reading position", async ({ page }, testInfo) => {
  const title = `Position workflow ${testInfo.project.name}`;
  const { document } = await createTextDocument(title);
  await page.goto("/");

  await openLibrary(page);
  const documentRow = page.getByTestId("document-row").filter({ hasText: title });
  await documentRow.click();
  await expect(documentRow).toHaveClass(/active/);
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 / 2");
  await expectPage(page, 1, 2);
  await openSettings(page);
  await expect(page.getByTestId("settings-menu-button")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-menu")).toHaveCount(0);
  await expect(page.getByTestId("settings-menu-button")).toHaveAttribute("aria-expanded", "false");
  await openSettings(page);
  await page.mouse.click(900, 520);
  await expect(page.getByTestId("settings-menu")).toHaveCount(0);
  await openSettings(page);
  await page.getByTitle("Page view").click();
  await page.getByTestId("reader-viewport").click();
  await page.keyboard.press("ArrowRight");
  await expectPage(page, 2, 2);
  await page.keyboard.press("ArrowLeft");
  await expectPage(page, 1, 2);
  await page.keyboard.press("End");
  await expectPage(page, 2, 2);
  await page.keyboard.press("Home");
  await expectPage(page, 1, 2);
  await goToPage(page, 2);
  await expectPage(page, 2, 2);
  await openSettings(page);
  await page.getByTestId("fit-width").click();
  await openSettings(page);
  await expect(page.getByTestId("zoom-value")).not.toHaveText("100%");
  const widthFitBefore = await zoomPercent(page);
  await page.getByTestId("toggle-library").click();
  if ((page.viewportSize()?.width ?? 0) <= 1180) {
    await expect.poll(async () => zoomPercent(page)).toBe(widthFitBefore);
  } else {
    await expect.poll(async () => zoomPercent(page)).toBeGreaterThan(widthFitBefore);
  }
  await page.getByTestId("fit-height").click();
  await openSettings(page);
  await expect(page.getByTestId("zoom-value")).not.toHaveText("100%");
  const heightFitBefore = await zoomPercent(page);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await page.setViewportSize({ width: viewport!.width, height: viewport!.height + 80 });
  await expect.poll(async () => zoomPercent(page)).toBeGreaterThan(heightFitBefore);
  const zoomBefore = await zoomPercent(page);
  await page.getByTitle("Zoom in").click();
  await expectPage(page, 2, 2);
  await expect.poll(async () => zoomPercent(page)).toBeGreaterThan(zoomBefore);
  const zoomAfter = (await page.getByTestId("zoom-value").textContent()) ?? "";
  await expect
    .poll(async () => {
      const response = await fetch(`${apiBase}/api/documents/${document.id}/position`);
      const { position } = (await response.json()) as { position: { zoom?: number } | null };
      return Math.round((position?.zoom ?? 0) * 100);
    })
    .toBe(Number(zoomAfter.replace("%", "")));

  await page.reload();
  await page.getByTestId("toggle-library").click();
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await expectPage(page, 2, 2);
  await openSettings(page);
  await expect(page.getByTestId("zoom-value")).toHaveText(zoomAfter);
  await expect(page.getByTestId("location-row").filter({ hasText: title })).toHaveCount(0);
});

test("restores the exact saved scroll offset inside long PDF pages", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-position-offset-${suffix}.pdf`);
  await writeFile(pdfPath, makePdfPages(Array.from({ length: 64 }, (_, index) => `Position restore page ${index + 1}`)));
  const { document } = await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer").first()).toContainText("Position restore page 1");
  await openSettings(page);
  await page.getByTestId("fit-width").click();
  await goToPage(page, 51);
  await expectPage(page, 51, 64);

  const savedTop = await page.getByTestId("reader-viewport").evaluate((viewport) => {
    viewport.scrollTop += viewport.clientHeight / 2;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    return viewport.scrollTop;
  });
  await page.reload();
  await expect(page.getByTestId("active-title")).toContainText(`pdf-position-offset-${suffix}`);
  await expect
    .poll(async () => Math.round(await page.getByTestId("reader-viewport").evaluate((viewport) => viewport.scrollTop)))
    .toBe(Math.round(savedTop));
});

test("restores the same visible PDF content position after reload", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const pdfPath = testInfo.outputPath(`pdf-visual-position-${suffix}.pdf`);
  await writeFile(pdfPath, makePdfPages(Array.from({ length: 90 }, (_, index) => `Visual restore anchor page ${index + 1}`)));
  await importBackendPath(pdfPath);
  await page.goto("/");

  await expect(page.getByTestId("pdf-text-layer").first()).toContainText("Visual restore anchor page 1");
  await page.getByTestId("reader-viewport").evaluate((viewport) => {
    const targetPage = document.querySelector<HTMLElement>('[data-page-index="50"]');
    if (!targetPage) throw new Error("Missing target page");
    viewport.scrollTop = targetPage.offsetTop;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Boolean(
          [...document.querySelectorAll<HTMLElement>("[data-testid='pdf-text-layer'] span")].find((span) =>
            span.textContent?.includes("Visual restore anchor page 51")
          )
        )
      )
    )
    .toBe(true);
  const before = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>("[data-testid='reader-viewport']");
    if (!viewport) throw new Error("Missing reader viewport");
    viewport.scrollTop += 240;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    const anchor = [...document.querySelectorAll<HTMLElement>("[data-testid='pdf-text-layer'] span")].find((span) =>
      span.textContent?.includes("Visual restore anchor page 51")
    );
    if (!anchor) throw new Error("Missing visible PDF anchor");
    return {
      text: anchor.textContent,
      y: Math.round(anchor.getBoundingClientRect().top)
    };
  });

  await page.reload();
  await expect(page.getByTestId("active-title")).toContainText(`pdf-visual-position-${suffix}`);
  await expect
    .poll(async () =>
      page.evaluate((anchorText) => {
        const anchor = [...document.querySelectorAll<HTMLElement>("[data-testid='pdf-text-layer'] span")].find(
          (span) => span.textContent === anchorText
        );
        return anchor ? Math.round(anchor.getBoundingClientRect().top) : null;
      }, before.text)
    )
    .toBe(before.y);
});

test("page jump opens a floating input without turning the page label into a field", async ({ page }, testInfo) => {
  const title = `Page jump popover ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();

  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 / 2");
  await expect(page.getByTestId("page-input")).toHaveCount(0);
  const toolbarHeight = await page.locator(".topbar").evaluate((toolbar) => toolbar.getBoundingClientRect().height);

  await page.getByTestId("page-indicator").click();
  await expect(page.getByTestId("page-jump-popover")).toBeVisible();
  await expect(page.getByTestId("page-input")).toBeFocused();
  await expect(page.getByTestId("page-input")).toHaveValue("1");
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 / 2");
  await expect(page.getByTestId("page-indicator").locator("[data-testid='page-input']")).toHaveCount(0);
  await expect.poll(async () => page.locator(".topbar").evaluate((toolbar) => toolbar.getBoundingClientRect().height)).toBe(
    toolbarHeight
  );

  await page.getByTestId("page-input").fill("2");
  await page.getByTestId("page-input").press("Enter");
  await expect(page.getByTestId("page-jump-popover")).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 2 / 2");
  await expect(page.getByTestId("page-input")).toHaveCount(0);
});

test("keeps pages rendered when side panels open and close", async ({ page }, testInfo) => {
  const title = `Panel toggle page anchor ${testInfo.project.name}`;
  await createTextDocument(
    title,
    Array.from({ length: 30 }, (_, index) => ({
      kind: "text",
      text: `Page ${index + 1} anchor text. ${"A readable paragraph that makes the page take real vertical space. ".repeat(18)}`
    }))
  );
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await openAssistant(page);
  await openSettings(page);
  await page.getByTestId("fit-width").click();
  await goToPage(page, 13);
  await expectPage(page, 13, 30);
  await expectRenderedPages(page);

  await page.getByTestId("toggle-library").click();
  await expectPage(page, 13, 30);
  await expectRenderedPages(page);

  await page.getByTestId("toggle-library").click();
  await expectPage(page, 13, 30);
  await expectRenderedPages(page);

  await page.getByTestId("toggle-assistant").click();
  await expectPage(page, 13, 30);
  await expectRenderedPages(page);
});

test("persists dark chrome without changing document content", async ({ page }, testInfo) => {
  const title = `Theme workflow ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("theme-test-initialized")) return;
    localStorage.setItem("reader.theme", "light");
    sessionStorage.setItem("theme-test-initialized", "1");
  });
  await page.goto("/");

  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await expect(page.getByTestId("page-text").first()).toContainText("Le petit prince");
  const chromeBefore = await page.getByTestId("reader-viewport").evaluate((node) => getComputedStyle(node).backgroundColor);

  await openSettings(page);
  await page.getByTestId("theme-dark").click();
  await expect(page.locator(".app-shell")).toHaveClass(/theme-dark/);
  await expect(page.evaluate(() => localStorage.getItem("reader.theme"))).resolves.toBe("dark");

  const contentAfter = await page.getByTestId("page-text").first().evaluate((node) => getComputedStyle(node).backgroundColor);
  const chromeAfter = await page.getByTestId("reader-viewport").evaluate((node) => getComputedStyle(node).backgroundColor);
  const searchInputAfter = await page.locator(".search-box input").evaluate((node) => getComputedStyle(node).backgroundColor);
  const scrollbarAfter = await page.getByTestId("reader-viewport").evaluate((node) => getComputedStyle(node).scrollbarColor);
  expect(contentAfter).toBe("rgb(255, 253, 248)");
  expect(chromeAfter).not.toBe(chromeBefore);
  expect(searchInputAfter).toBe("rgba(0, 0, 0, 0)");
  expect(scrollbarAfter).toContain("rgb(85, 85, 85)");

  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/theme-dark/);
  await openSettings(page);
  await page.getByTestId("theme-light").click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/theme-dark/);
});

test("keeps the reader primary on tablet when panels are open", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  const title = `Tablet drawer layout ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.addInitScript(() => {
    localStorage.setItem("reader.showLibrary", "0");
    localStorage.setItem("reader.showAssistant", "0");
  });
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("search-input").fill(title);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await page.getByTestId("toggle-assistant").click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.getByTestId("search-input")).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const rectFor = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    return {
      reader: rectFor("[data-testid='reader-viewport']"),
      assistant: rectFor(".insight-panel")
    };
  });

  expect(layout.reader.height).toBeGreaterThan(650);
  expect(layout.reader.left).toBeLessThan(12);
  expect(layout.assistant.top).toBeGreaterThanOrEqual(36);
  expect(layout.assistant.height).toBeGreaterThan(650);
  expect(layout.assistant.width).toBeLessThanOrEqual(440);

  await openLibrary(page);
  await expect(page.getByTestId("search-input")).toBeVisible();
  await expect(page.getByTestId("note-editor")).toHaveCount(0);
});

test("floating popovers do not click through into the document", async ({ page }, testInfo) => {
  const title = `Floating window hit testing ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await expect(page.getByTestId("page-text").first()).toContainText("Le petit prince");

  await openSettings(page);
  await page.getByTestId("selection-mode-image").click();
  await expect(page.getByTestId("settings-menu")).toHaveCount(0);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await expect(page.getByTestId("page-input")).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 / 2");
  const pageCenterOffset = await page.getByTestId("page-indicator").evaluate((indicator) => {
    const rect = indicator.getBoundingClientRect();
    return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2);
  });
  expect(pageCenterOffset).toBeLessThanOrEqual(1);
  await openSettings(page);
  await page.getByTestId("selection-mode-text").click();
  await expect(page.getByTestId("settings-menu")).toHaveCount(0);

  const text = page.getByTestId("page-text").first();
  await text.evaluate((node) => {
    const walker = globalThis.document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let source: Node | null = null;
    while ((source = walker.nextNode())) {
      if (source.textContent?.includes("Le petit prince")) break;
    }
    if (!source) throw new Error("Expected text node");
    const fullText = source.textContent ?? "";
    const start = fullText.indexOf("Le petit prince");
    const range = globalThis.document.createRange();
    range.setStart(source, start);
    range.setEnd(source, start + "Le petit prince".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
  await expect(page.getByTestId("selection-menu")).toBeVisible();

  await page.getByTestId("menu-translate").hover();
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await page.getByTestId("selection-preview-text").click();
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("page-input")).toHaveCount(0);
});

test("keeps floating text selection context when scrolling clears the native range", async ({ page }, testInfo) => {
  const title = `Scroll selection context ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();

  await selectTextIn(page, "page-text", "Le petit prince");
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveValue("Le petit prince");

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByTestId("reader-viewport").evaluate((viewport) => {
    viewport.scrollTop += 80;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveValue("Le petit prince");
  await expect(page.getByTestId("selection-menu")).toBeVisible();
});

test("opening the floating selection menu does not scroll the reader", async ({ page }, testInfo) => {
  const title = `Selection menu no jump ${testInfo.project.name}`;
  await createTextDocument(
    title,
    Array.from({ length: 30 }, (_, index) => ({
      kind: "text",
      text: `Page ${index + 1} anchor text. ${"A readable paragraph that makes the page take real vertical space. ".repeat(18)}`
    }))
  );
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await goToPage(page, 13);
  await expectPage(page, 13, 30);
  await expectRenderedPages(page);

  const beforeScroll = await page.getByTestId("reader-viewport").evaluate((viewport) => viewport.scrollTop);
  await selectVisibleText(page, "anchor text");
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  await expect(page.getByTestId("selection-preview-text")).toHaveValue(/anchor text/);
  await expect.poll(async () => page.getByTestId("reader-viewport").evaluate((viewport) => viewport.scrollTop)).toBe(beforeScroll);
});

test("floating selection menu stays inside the reader viewport", async ({ page }, testInfo) => {
  const title = `Selection menu bounds ${testInfo.project.name}`;
  await createTextDocument(
    title,
    Array.from({ length: 20 }, (_, index) => ({
      kind: "text",
      text: `Page ${index + 1}. ${"This paragraph gives the selection menu enough text to preview without covering the browser toolbar. ".repeat(12)}`
    }))
  );
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await expectPage(page, 1, 20);
  await expectRenderedPages(page);

  await selectVisibleText(page, "This paragraph gives the selection menu");
  await expect(page.getByTestId("selection-menu")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>("[data-testid='selection-menu']");
    const reader = document.querySelector<HTMLElement>("[data-testid='reader-viewport']");
    if (!menu || !reader) throw new Error("Missing menu or reader viewport");
    const menuRect = menu.getBoundingClientRect();
    const readerRect = reader.getBoundingClientRect();
    return { menuTop: menuRect.top, menuBottom: menuRect.bottom, readerTop: readerRect.top, readerBottom: readerRect.bottom };
  });
  expect(geometry.menuTop).toBeGreaterThanOrEqual(geometry.readerTop);
  expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.readerBottom);
});

test("draft selections only replace notes and chat context after side-panel input", async ({ page }, testInfo) => {
  const title = `Draft side panel context ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await page.getByTestId("toggle-assistant").click();
  await expect(page.getByTestId("note-editor")).toBeVisible();

  await page.getByTestId("note-editor").fill("Document baseline note");
  await expect(page.getByTestId("note-row").filter({ hasText: "Document baseline note" })).toBeVisible();

  const selectPhrase = async (phrase: string) => {
    await page.getByTestId("page-text").first().evaluate((node, selectedPhrase) => {
      const walker = globalThis.document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let source: Node | null = null;
      while ((source = walker.nextNode())) {
        if (source.textContent?.includes(selectedPhrase)) break;
      }
      if (!source) throw new Error("Expected text node");
      const text = source.textContent ?? "";
      const start = text.indexOf(selectedPhrase);
      const range = globalThis.document.createRange();
      range.setStart(source, start);
      range.setEnd(source, start + selectedPhrase.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, phrase);
    await page.getByTestId("reader-viewport").dispatchEvent("pointerup");
    await expect(page.getByTestId("selection-menu")).toBeVisible();
  };

  await selectPhrase("Le petit prince");
  await expect(page.getByTestId("note-editor")).toHaveValue("Document baseline note");
  await expect(page.getByTestId("note-editor")).toHaveAttribute("placeholder", "Note on this selection");
  await expect(page.getByTestId("document-note-mode")).toHaveText("Selection");
  await expect(page.getByTestId("chat-input")).toHaveAttribute("placeholder", "Ask about this selection");
  await expect(page.getByTestId("chat-context-pill")).toHaveText("Selection");
  await page.mouse.click(12, 120);
  await expect(page.getByTestId("selection-menu")).toHaveCount(0);
  await expect(page.getByTestId("note-editor")).toHaveValue("Document baseline note");
  await expect(page.getByTestId("chat-input")).toHaveAttribute("placeholder", "Ask about this document");
  await expect(page.getByTestId("chat-context-pill")).toHaveCount(0);

  await selectPhrase("Le petit prince");
  await page.getByTestId("note-editor").fill("Selection note written directly");
  await expect(page.getByTestId("saved-text-highlight")).toBeVisible();
  await openAssistant(page);
  await expect(page.getByTestId("note-row").filter({ hasText: "Selection note written directly" })).toBeVisible();
  await expect(page.getByTestId("chat-input")).toHaveAttribute("placeholder", "Ask about this selection");
  await expect(page.getByTestId("chat-context-pill")).toHaveText("Selection");

  await selectPhrase("silences autant");
  await page.getByTestId("chat-input").fill("Discuss this direct draft selection");
  await page.getByTestId("send-chat").click();
  await expect(page.getByTestId("chat-messages")).toContainText("Discuss this direct draft selection");
  await expect(page.getByRole("button", { name: "Selection discussion" })).toBeVisible();
  await expect(page.getByTestId("chat-context-pill")).toHaveCount(0);
});

test("restores the last opened document on startup", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name;
  const olderTitle = `Restore older ${suffix}`;
  const newerTitle = `Restore newer ${suffix}`;
  await createTextDocument(olderTitle);
  await createTextDocument(newerTitle);

  await page.goto("/");
  await openLibrary(page);
  await expect(page.getByTestId("active-title")).toContainText(newerTitle);
  await page.getByTestId("document-row").filter({ hasText: olderTitle }).click();
  await expect(page.getByTestId("active-title")).toContainText(olderTitle);

  await page.reload();
  await expect(page.getByTestId("active-title")).toContainText(olderTitle);
});

test("resets stale assistant layout once but persists new panel choices", async ({ page }, testInfo) => {
  const title = `Layout migration ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("reader.layoutVersion", "1");
    localStorage.setItem("reader.showAssistant", "1");
    localStorage.setItem("reader.libraryWidth", "480");
  });
  await page.reload();

  await openLibrary(page);
  await expect(page.getByTestId("document-row").filter({ hasText: title })).toBeVisible();
  await expect(page.getByTestId("note-editor")).toHaveCount(0);
  await expect(page.evaluate(() => localStorage.getItem("reader.showAssistant"))).resolves.toBe("0");
  await expect(page.evaluate(() => localStorage.getItem("reader.libraryWidth"))).resolves.toBe("204");

  const readerWidthBeforeAssistant = (await page.getByTestId("reader-viewport").boundingBox())?.width ?? 0;
  await page.getByTestId("toggle-assistant").click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.getByTestId("empty-chat-copy")).toHaveText("No messages");
  await expect(page.locator(".note-context")).toHaveText("");
  await expect(page.locator(".chat-section .panel-heading")).toHaveText("Chat");
  await expect(page.locator(".chat-composer")).toHaveCSS("gap", "0px");
  await expect(page.getByTestId("send-chat")).toHaveCSS("min-height", "36px");
  await expect(page.getByTestId("send-chat")).toHaveCSS("width", "38px");
  const chatLayout = await page.locator(".chat-section").evaluate((section) => {
    const composer = section.querySelector(".chat-composer")!;
    const sectionRect = section.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return Math.round(sectionRect.bottom - composerRect.bottom);
  });
  expect(chatLayout).toBeLessThanOrEqual(8);
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 1180) {
    await expect(page.getByTestId("assistant-resizer")).toHaveCount(0);
    const readerBox = await page.getByTestId("reader-viewport").boundingBox();
    expect(readerBox?.width).toBeGreaterThanOrEqual(readerWidthBeforeAssistant - 8);
  }
  await page.reload();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.getByTestId("empty-chat-copy")).toHaveText("No messages");
  await expect(page.evaluate(() => localStorage.getItem("reader.showAssistant"))).resolves.toBe("1");
});

test("auto-deletes notes when the editor is cleared", async ({ page }, testInfo) => {
  const title = `Cleared note ${testInfo.project.name}`;
  await createTextDocument(title);
  await page.goto("/");

  await openLibrary(page);
  await expect(page.getByTestId("document-row").filter({ hasText: title })).toBeVisible();
  await page.getByTestId("toggle-assistant").click();
  await page.getByTestId("note-editor").fill("This note should disappear when cleared.");
  await expect(page.getByTestId("note-row").filter({ hasText: "should disappear" })).toBeVisible();

  await page.getByTestId("note-editor").fill("");
  await expect(page.getByTestId("note-row").filter({ hasText: "should disappear" })).toHaveCount(0);
  await page.reload();
  await openLibrary(page);
  await page.getByTestId("document-row").filter({ hasText: title }).click();
  await expect(page.getByTestId("note-row").filter({ hasText: "should disappear" })).toHaveCount(0);
});
