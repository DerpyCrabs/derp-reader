import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Check from "lucide-solid/icons/check";
import Image from "lucide-solid/icons/image";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import MessageCircle from "lucide-solid/icons/message-circle";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import Pencil from "lucide-solid/icons/pencil";
import Pin from "lucide-solid/icons/pin";
import PinOff from "lucide-solid/icons/pin-off";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { Portal } from "solid-js/web";
import type { ChatMessage, ChatRecord, ChatWithMessages, SelectionRecord } from "../../shared/types";
import { MarkdownContent } from "./MarkdownContent";

export interface StagedChatContext {
  id: string;
  kind: "text" | "image";
  text: string;
}

interface ChatPaneProps {
  chats: ChatRecord[];
  activeChat: ChatWithMessages | null;
  currentSelection: Pick<SelectionRecord, "kind" | "text" | "region"> | null;
  stagedContexts: StagedChatContext[];
  chatDraft: string;
  focusRequest: number;
  sending: boolean;
  sendError: string;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onUpdateChat: (chatId: string, input: { title?: string; pinned?: boolean }) => void;
  onBackToChats: () => void;
  onNewChat: () => void;
  onRemoveContext: (contextId: string) => void;
  onClearCurrentContext: () => void;
  onDismissSendError: () => void;
  onChatDraft: (body: string) => void;
  onSendChat: () => void;
}

const formatChatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));

export function ChatPane(props: ChatPaneProps) {
  let chatInputRef!: HTMLTextAreaElement;
  let messagesRef!: HTMLDivElement;
  let previewCloseRef!: HTMLButtonElement;
  let keepMessagesPinned = true;
  let lastActiveChatId: string | null = null;
  const [previewImage, setPreviewImage] = createSignal<string | null>(null);
  const [editingTitleId, setEditingTitleId] = createSignal<string | null>(null);
  const [titleDraft, setTitleDraft] = createSignal("");
  const [pendingDeleteId, setPendingDeleteId] = createSignal<string | null>(null);

  const messageContexts = (message: ChatMessage) => message.selectionContexts ?? [];
  const hasComposerContext = () => props.stagedContexts.length > 0 || Boolean(props.currentSelection);
  const chatPlaceholder = () => {
    if (props.stagedContexts.length > 0) {
      return `Ask about ${props.stagedContexts.length === 1 ? "this selection" : `${props.stagedContexts.length} selections`}…`;
    }
    if (props.currentSelection?.kind === "image") return "Ask about this image…";
    if (props.currentSelection) return "Ask about this selection…";
    return props.activeChat ? "Reply to this conversation…" : "Ask about this document…";
  };

  const beginRename = (chat: ChatRecord) => {
    setPendingDeleteId(null);
    setEditingTitleId(chat.id);
    setTitleDraft(chat.title);
  };

  const commitRename = (chat: ChatRecord) => {
    const title = titleDraft().trim();
    setEditingTitleId(null);
    if (title && title !== chat.title) props.onUpdateChat(chat.id, { title });
  };

  const resizeComposer = (element: HTMLTextAreaElement) => {
    element.style.height = "0";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  };

  createEffect(() => {
    if (props.focusRequest <= 0) return;
    queueMicrotask(() => chatInputRef?.focus());
  });

  createEffect(() => {
    props.chatDraft;
    queueMicrotask(() => {
      if (chatInputRef) resizeComposer(chatInputRef);
    });
  });

  createEffect(() => {
    const activeChatId = props.activeChat?.id ?? null;
    if (activeChatId !== lastActiveChatId) {
      lastActiveChatId = activeChatId;
      keepMessagesPinned = true;
    }
    props.activeChat?.messages.length;
    props.sending;
    if (keepMessagesPinned) {
      queueMicrotask(() => messagesRef?.scrollTo({ top: messagesRef.scrollHeight, behavior: "smooth" }));
    }
  });

  createEffect(() => {
    if (!previewImage()) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    document.addEventListener("keydown", closeFromEscape);
    queueMicrotask(() => previewCloseRef?.focus());
    onCleanup(() => {
      document.removeEventListener("keydown", closeFromEscape);
      queueMicrotask(() => returnFocus?.focus());
    });
  });

  const chatActions = (chat: ChatRecord) => (
    <Show
      when={pendingDeleteId() === chat.id}
      fallback={
        <div class="chat-row-actions">
          <button
            class="icon-button"
            data-testid="rename-chat"
            type="button"
            title="Rename chat"
            aria-label={`Rename ${chat.title}`}
            onClick={() => beginRename(chat)}
          >
            <Pencil size={14} />
          </button>
          <button
            class="icon-button"
            data-testid="pin-chat"
            type="button"
            title={chat.pinned ? "Unpin chat" : "Pin chat"}
            aria-label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
            onClick={() => props.onUpdateChat(chat.id, { pinned: !chat.pinned })}
          >
            {chat.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            class="icon-button destructive-ghost"
            data-testid="delete-chat"
            type="button"
            title="Delete chat"
            aria-label={`Delete ${chat.title}`}
            onClick={() => {
              setEditingTitleId(null);
              setPendingDeleteId(chat.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      }
    >
      <div class="confirm-actions" data-testid="confirm-delete-chat">
        <span>Delete this chat?</span>
        <button
          ref={(element) => queueMicrotask(() => element.focus())}
          type="button"
          onClick={() => setPendingDeleteId(null)}
        >
          Cancel
        </button>
        <button
          class="danger-button"
          type="button"
          onClick={() => {
            setPendingDeleteId(null);
            props.onDeleteChat(chat.id);
          }}
        >
          Delete
        </button>
      </div>
    </Show>
  );

  return (
    <section class="chat-section" aria-label="Chat">
      <Show
        when={props.activeChat}
        fallback={
          <div class="chat-list-header">
            <div>
              <h3>Conversations</h3>
              <span>{props.chats.length === 1 ? "1 saved chat" : `${props.chats.length} saved chats`}</span>
            </div>
            <button class="new-chat-button" data-testid="new-chat" type="button" onClick={props.onNewChat}>
              <MessageSquarePlus size={16} />
              New
            </button>
          </div>
        }
      >
        {(chat) => (
          <div class="chat-view-header chat-chip active" data-testid="chat-chip">
            <button
              class="chat-back icon-button"
              data-testid="back-to-chats"
              type="button"
              title="Back to conversations"
              aria-label="Back to conversations"
              onClick={props.onBackToChats}
            >
              <ArrowLeft size={16} />
            </button>
            <Show
              when={editingTitleId() === chat().id}
              fallback={
                <div class="active-chat-title">
                  <strong>{chat().title}</strong>
                  <span>{chat().messages.length === 1 ? "1 message" : `${chat().messages.length} messages`}</span>
                </div>
              }
            >
              <input
                class="chat-title-input"
                data-testid="chat-title-input"
                aria-label="Chat title"
                value={titleDraft()}
                onInput={(event) => setTitleDraft(event.currentTarget.value)}
                onBlur={() => commitRename(chat())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setEditingTitleId(null);
                    event.currentTarget.blur();
                  }
                }}
                ref={(element) => queueMicrotask(() => element.select())}
              />
            </Show>
            {chatActions(chat())}
          </div>
        )}
      </Show>

      <Show
        when={props.activeChat}
        fallback={
          <div class="chat-list app-scrollbar" role="list">
            <Show
              when={props.chats.length > 0}
              fallback={
                <div class="panel-empty-state chat-empty-state" data-testid="empty-chat-copy">
                  <MessageCircle size={24} />
                  <strong>Start a conversation</strong>
                  <span>Ask about the document or highlight a passage for focused context.</span>
                </div>
              }
            >
              <For each={props.chats}>
                {(chat) => (
                  <div
                    class="chat-chip"
                    classList={{ pinned: chat.pinned, confirming: pendingDeleteId() === chat.id }}
                    data-testid="chat-chip"
                    role="listitem"
                  >
                    <Show
                      when={editingTitleId() === chat.id}
                      fallback={
                        <button class="chat-select" type="button" onClick={() => props.onSelectChat(chat.id)}>
                          <span class="chat-row-icon" aria-hidden="true">
                            {chat.pinned ? <Pin size={14} /> : <MessageCircle size={15} />}
                          </span>
                          <span class="chat-row-copy">
                            <strong>{chat.title}</strong>
                            <span>Updated {formatChatDate(chat.updatedAt)}</span>
                          </span>
                        </button>
                      }
                    >
                      <div class="chat-inline-rename">
                        <input
                          class="chat-title-input"
                          data-testid="chat-title-input"
                          aria-label="Chat title"
                          value={titleDraft()}
                          onInput={(event) => setTitleDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(chat);
                            if (event.key === "Escape") setEditingTitleId(null);
                          }}
                          ref={(element) => queueMicrotask(() => element.select())}
                        />
                        <button class="icon-button" type="button" title="Save title" aria-label="Save title" onClick={() => commitRename(chat)}>
                          <Check size={14} />
                        </button>
                      </div>
                    </Show>
                    {chatActions(chat)}
                  </div>
                )}
              </For>
            </Show>
          </div>
        }
      >
        {(chat) => (
          <div
            ref={messagesRef}
            class="messages app-scrollbar"
            data-testid="chat-messages"
            role="log"
            aria-live="polite"
            onScroll={(event) => {
              const element = event.currentTarget;
              keepMessagesPinned = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            }}
          >
            <Show
              when={chat().messages.length > 0}
              fallback={
                <div class="panel-empty-state conversation-empty">
                  <MessageCircle size={22} />
                  <strong>Ask the first question</strong>
                  <span>This conversation is ready when you are.</span>
                </div>
              }
            >
              <For each={chat().messages}>
                {(message) => (
                  <article class={`message ${message.role}`}>
                    <div class="message-author">
                      <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"}</strong>
                    </div>
                    <Show when={messageContexts(message).length > 0}>
                      <div class="message-contexts" data-testid="message-selection-contexts">
                        <For each={messageContexts(message)}>
                          {(context) => (
                            <Show
                              when={context.kind === "image"}
                              fallback={
                                <button class="message-context text-context" type="button" data-testid="message-text-context">
                                  Selection
                                  <span class="context-popover" data-testid="message-text-context-popover">
                                    {context.text || "Selected text"}
                                  </span>
                                </button>
                              }
                            >
                              <button
                                class="message-context image-context"
                                type="button"
                                data-testid="message-image-context"
                                title="Preview selected image"
                                onClick={() => context.imageData && setPreviewImage(context.imageData)}
                              >
                                <Image size={13} />
                                Image
                              </button>
                            </Show>
                          )}
                        </For>
                      </div>
                    </Show>
                    <MarkdownContent content={message.content} />
                  </article>
                )}
              </For>
            </Show>
            <Show when={props.sending}>
              <div class="message assistant pending-message" data-testid="chat-pending">
                <LoaderCircle class="spin" size={15} />
                <span>Thinking…</span>
              </div>
            </Show>
          </div>
        )}
      </Show>

      <div class="chat-composer" classList={{ "has-context": hasComposerContext(), error: Boolean(props.sendError) }}>
        <Show when={hasComposerContext()}>
          <div class="composer-contexts" aria-label="Context for next message">
            <Show
              when={props.stagedContexts.length > 0}
              fallback={
                <button
                  class="composer-context"
                  data-testid="chat-context-pill"
                  type="button"
                  title="Remove context"
                  aria-label="Remove current selection from the next message"
                  onClick={props.onClearCurrentContext}
                >
                  <span>{props.currentSelection?.kind === "image" ? "Image" : "Selection"}</span>
                  <X size={13} />
                </button>
              }
            >
              <For each={props.stagedContexts}>
                {(context, index) => (
                  <button
                    class="composer-context"
                    data-testid="chat-context-pill"
                    type="button"
                    title={context.text || (context.kind === "image" ? "Image selection" : "Text selection")}
                    aria-label={`Remove selection ${index() + 1} from the next message`}
                    onClick={() => props.onRemoveContext(context.id)}
                  >
                    <span>{props.stagedContexts.length === 1 ? (context.kind === "image" ? "Image" : "Selection") : `Selection ${index() + 1}`}</span>
                    <X size={13} />
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
        <div class="composer-input-row">
          <label class="visually-hidden" for="chat-input">Message</label>
          <textarea
            ref={chatInputRef}
            id="chat-input"
            class="chat-input"
            data-testid="chat-input"
            rows={1}
            value={props.chatDraft}
            onInput={(event) => {
              props.onChatDraft(event.currentTarget.value);
              resizeComposer(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
              event.preventDefault();
              if (!props.sending && props.chatDraft.trim()) props.onSendChat();
            }}
            placeholder={chatPlaceholder()}
          />
          <button
            class="send-chat"
            data-testid="send-chat"
            type="button"
            title={props.sending ? "Waiting for response" : "Send message"}
            aria-label={props.sending ? "Waiting for response" : "Send message"}
            disabled={props.sending || !props.chatDraft.trim()}
            onClick={props.onSendChat}
          >
            <Show when={props.sending} fallback={<ArrowUp size={18} strokeWidth={2.25} />}>
              <LoaderCircle class="spin" size={17} />
            </Show>
          </button>
        </div>
        <Show when={props.sendError}>
          <div class="composer-error" role="alert">
            <span>{props.sendError}</span>
            <button class="icon-button" type="button" title="Dismiss error" aria-label="Dismiss error" onClick={props.onDismissSendError}>
              <X size={13} />
            </button>
          </div>
        </Show>
        <div class="composer-hint">Enter to send · Shift + Enter for a new line</div>
      </div>

      <Show when={previewImage()}>
        {(image) => (
          <Portal>
            <div
              class="image-preview-backdrop"
              data-testid="image-preview"
              role="dialog"
              aria-modal="true"
              aria-label="Selected image preview"
              onClick={() => setPreviewImage(null)}
            >
              <button
                ref={previewCloseRef}
                class="image-preview-close icon-button"
                type="button"
                title="Close preview"
                aria-label="Close preview"
                onClick={() => setPreviewImage(null)}
              >
                <X size={18} strokeWidth={2.25} />
              </button>
              <img src={image()} alt="Selected image context" onClick={(event) => event.stopPropagation()} />
            </div>
          </Portal>
        )}
      </Show>
    </section>
  );
}
