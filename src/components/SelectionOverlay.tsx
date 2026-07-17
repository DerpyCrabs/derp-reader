import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { queryOptions, useQueryClient } from "@tanstack/solid-query";
import { api } from "../api";
import type { ChatSelectionContext } from "../../shared/types";
import type { DraftSelection } from "../stores/readerStore";
import type { AiResponse, DefaultSelectionAction, DocumentWithPages, SelectionRecord } from "../../shared/types";
import { SelectionMenu, type FloatingMenu } from "./SelectionMenu";

type SelectionAiTask = "translate" | "define";

interface SelectionOverlayProps {
  menu: FloatingMenu | null;
  activeDocument: DocumentWithPages | null;
  draftSelection: DraftSelection | null;
  currentSelection: SelectionRecord | null;
  selectionText: string;
  canAddToCurrentChat: boolean;
  defaultAction: DefaultSelectionAction;
  onSelectionTextChange: (text: string) => void;
  onNote: () => void;
  onNewChat: () => void;
  onAddToCurrentChat: () => void;
  onError: (message: string) => void;
}

export function SelectionOverlay(props: SelectionOverlayProps) {
  let requestVersion = 0;
  let lastAutoSelectionKey = "";
  const queryClient = useQueryClient();
  const [busy, setBusy] = createSignal("");
  const [activeTask, setActiveTask] = createSignal<SelectionAiTask | null>(null);
  const [result, setResult] = createSignal<AiResponse | null>(null);

  const selectionInput = (task: SelectionAiTask) => {
    const draftContext: ChatSelectionContext | null = props.activeDocument && props.draftSelection
      ? {
          documentId: props.activeDocument.id,
          pageId: props.draftSelection.pageId,
          kind: props.draftSelection.kind,
          text: props.draftSelection.text,
          imageData: props.draftSelection.imageData ?? null,
          region: props.draftSelection.region
        }
      : null;
    if (draftContext?.kind === "text" && !draftContext.text?.trim()) return null;

    const selection = props.currentSelection;
    const text = draftContext?.kind === "text" ? draftContext.text ?? "" : selection ? "" : props.selectionText.trim();
    if (!text && !selection && !draftContext) return null;

    return {
      task,
      key: JSON.stringify({
        task,
        selectionId: selection?.id ?? null,
        documentId: props.activeDocument?.id ?? null,
        pageId: draftContext?.pageId ?? selection?.pageId ?? null,
        sourceLanguage: props.activeDocument?.language ?? null,
        kind: draftContext?.kind ?? selection?.kind ?? "text",
        text: draftContext?.text ?? selection?.text ?? text,
        imageData: draftContext?.imageData ?? selection?.imageData ?? null,
        region: draftContext?.region ?? selection?.region ?? null
      }),
      text,
      selection,
      draftContext,
      sourceLanguage: props.activeDocument?.language ?? null
    };
  };

  const activeSelectionKey = createMemo(() => {
    const draft = props.draftSelection;
    const selection = props.currentSelection;
    return JSON.stringify({
      documentId: props.activeDocument?.id ?? null,
      draft,
      selectionId: selection?.id ?? null,
      selectionText: selection?.text ?? props.selectionText
    });
  });

  createEffect(() => {
    activeSelectionKey();
    requestVersion += 1;
    void queryClient.cancelQueries({ queryKey: ["selection-ai"] });
    setBusy("");
    setActiveTask(null);
    setResult(null);
  });

  onCleanup(() => {
    requestVersion += 1;
    void queryClient.cancelQueries({ queryKey: ["selection-ai"] });
  });

  const runSelectionAi = async (task: SelectionAiTask, options: { regenerate?: boolean } = {}) => {
    const input = selectionInput(task);
    if (!input) return;
    requestVersion += 1;
    void queryClient.cancelQueries({ queryKey: ["selection-ai"] });
    setActiveTask(task);
    if (!options.regenerate) setResult(null);

    const selectionAiQuery = queryOptions({
      queryKey: ["selection-ai", input.key] as const,
      queryFn: async ({ signal }) => {
        if (input.task === "translate") {
          return (
            await api.translate(
              {
                text: input.selection ? undefined : input.text,
                selectionId: input.selection?.id,
                selectionContext: input.draftContext,
                sourceLanguage: input.sourceLanguage,
                targetLanguage: "English"
              },
              { signal }
            )
          ).result;
        }

        return (
          await api.define(
            {
              text: input.selection ? undefined : input.text,
              selectionId: input.selection?.id,
              selectionContext: input.draftContext,
              sourceLanguage: input.sourceLanguage
            },
            { signal }
          )
        ).result;
      },
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60
    });
    const cached = options.regenerate ? null : queryClient.getQueryData<NonNullable<ReturnType<typeof result>>>(selectionAiQuery.queryKey);
    if (cached) {
      setResult(cached);
      return;
    }

    if (options.regenerate) await queryClient.invalidateQueries({ queryKey: selectionAiQuery.queryKey });
    const version = ++requestVersion;
    setBusy(task === "translate" ? "Translating" : "Defining");
    props.onError("");

    try {
      const nextResult = await queryClient.fetchQuery(selectionAiQuery);
      if (requestVersion === version && selectionInput(task)?.key === input.key) {
        setResult(nextResult);
      }
    } catch (error) {
      if (requestVersion !== version) return;
      if (error instanceof Error && error.name === "AbortError") return;
      props.onError(error instanceof Error ? error.message : task === "translate" ? "Translation failed" : "Definition failed");
    } finally {
      if (requestVersion === version) setBusy("");
    }
  };

  const regenerate = async () => {
    const task = untrack(activeTask);
    if (!task) return;
    await runSelectionAi(task, { regenerate: true });
  };

  createEffect(() => {
    const menu = props.menu;
    const action = props.defaultAction;
    const draft = props.draftSelection;
    const selection = props.currentSelection;
    if (!menu) {
      lastAutoSelectionKey = "";
      return;
    }
    const key = selection?.id ?? (draft
      ? JSON.stringify([props.activeDocument?.id, draft.pageId, draft.kind, draft.region])
      : "");
    if (!key || key === lastAutoSelectionKey) return;
    lastAutoSelectionKey = key;
    if (action !== "none") void runSelectionAi(action);
  });

  return (
    <Show when={props.menu}>
      {(menu) => (
        <SelectionMenu
          menu={menu()}
          busy={busy()}
          activeTask={activeTask()}
          result={result()}
          selectionText={props.selectionText}
          canAddToCurrentChat={props.canAddToCurrentChat}
          onSelectionTextChange={props.onSelectionTextChange}
          onTranslate={() => void runSelectionAi("translate")}
          onDefine={() => void runSelectionAi("define")}
          onRegenerate={() => void regenerate()}
          onNote={props.onNote}
          onNewChat={props.onNewChat}
          onAddToCurrentChat={props.onAddToCurrentChat}
        />
      )}
    </Show>
  );
}
