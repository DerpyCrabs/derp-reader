import { For, Show, createEffect, createSignal } from "solid-js";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ArrowUp from "lucide-solid/icons/arrow-up";
import MessageCircle from "lucide-solid/icons/message-circle";
import Pin from "lucide-solid/icons/pin";
import PinOff from "lucide-solid/icons/pin-off";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { Portal } from "solid-js/web";
import type { ChatMessage, ChatRecord, ChatWithMessages, SelectionRecord } from "../../shared/types";
import { MarkdownContent } from "./MarkdownContent";

interface ChatPaneProps {
  chats: ChatRecord[];
  activeChat: ChatWithMessages | null;
  currentSelection: Pick<SelectionRecord, "kind" | "text" | "region"> | null;
  stagedContextCount: number;
  chatDraft: string;
  focusRequest: number;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onUpdateChat: (chatId: string, input: { title?: string; pinned?: boolean }) => void;
  onBackToChats: () => void;
  onChatDraft: (body: string) => void;
  onSendChat: () => void;
}

export function ChatPane(props: ChatPaneProps) {
  let chatInputRef!: HTMLInputElement;
  const [previewImage, setPreviewImage] = createSignal<string | null>(null);
  const messageContexts = (message: ChatMessage) => message.selectionContexts ?? [];
  const chatPlaceholder = () =>
    props.stagedContextCount > 0
      ? `Ask about ${props.stagedContextCount === 1 ? "this selection" : `${props.stagedContextCount} selections`}`
      : props.currentSelection?.kind === "image"
      ? "Ask about this image"
      : props.currentSelection
        ? "Ask about this selection"
        : "Ask about this document";

  createEffect(() => {
    if (props.focusRequest <= 0) return;
    queueMicrotask(() => chatInputRef?.focus());
  });

  return (
    <section
      class="chat-section"
      classList={{
        "empty-chat": !props.activeChat && props.chats.length === 0
      }}
    >
      <div class="panel-heading">
        <h2>Chat</h2>
        {props.activeChat ? <span class="muted-text">{props.activeChat.title}</span> : null}
      </div>
      <div class="chat-list app-scrollbar" classList={{ hidden: !props.activeChat && props.chats.length === 0 }}>
        <For each={props.chats}>
          {(chat) => (
            <div class="chat-chip" classList={{ active: props.activeChat?.id === chat.id }} data-testid="chat-chip">
              <Show when={props.activeChat?.id === chat.id}>
                <button class="chat-back icon-button" data-testid="back-to-chats" title="Back to chat list" onClick={props.onBackToChats}>
                  <ArrowLeft size={14} />
                </button>
              </Show>
              <button class="chat-select" onClick={() => props.onSelectChat(chat.id)}>
                <MessageCircle size={16} />
                <span>{chat.title}</span>
              </button>
              <button
                class="chat-pin icon-button"
                data-testid="pin-chat"
                title={chat.pinned ? "Unpin chat" : "Pin chat"}
                onClick={() => {
                  if (chat.pinned) {
                    props.onUpdateChat(chat.id, { pinned: false });
                    return;
                  }
                  const title = window.prompt("Chat title", chat.title)?.trim();
                  if (title !== undefined) props.onUpdateChat(chat.id, { pinned: true, title: title || chat.title });
                }}
              >
                {chat.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button class="chat-delete icon-button" data-testid="delete-chat" title="Delete chat" onClick={() => props.onDeleteChat(chat.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </For>
      </div>
      <div class="messages app-scrollbar" data-testid="chat-messages">
        <Show
          when={(props.activeChat?.messages.length ?? 0) > 0}
          fallback={<p class="empty-chat-copy" data-testid="empty-chat-copy">No messages</p>}
        >
          <For each={props.activeChat?.messages ?? []}>
            {(message) => (
              <div class={`message ${message.role}`}>
                <strong>{message.role}</strong>
                <Show when={messageContexts(message).length > 0}>
                  <div class="message-contexts" data-testid="message-selection-contexts">
                    <For each={messageContexts(message)}>
                      {(context) => (
                        <Show
                          when={context.kind === "image"}
                          fallback={
                            <span class="message-context text-context" data-testid="message-text-context">
                              Selection
                              <span class="context-popover" data-testid="message-text-context-popover">
                                {context.text || "Selected text"}
                              </span>
                            </span>
                          }
                        >
                          <button
                            class="message-context image-context"
                            data-testid="message-image-context"
                            title="Preview selected image"
                            onClick={() => context.imageData && setPreviewImage(context.imageData)}
                          >
                            Image
                          </button>
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>
                <MarkdownContent content={message.content} />
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="chat-composer">
        <Show when={props.stagedContextCount > 0} fallback={
          <Show when={props.currentSelection}>
            {(selection) => (
              <span class="composer-context" data-testid="chat-context-pill">
                {selection().kind === "image" ? "Image" : "Selection"}
              </span>
            )}
          </Show>
        }>
          <span class="composer-context" data-testid="chat-context-pill">
            {props.stagedContextCount === 1 ? "Selection" : `${props.stagedContextCount} selections`}
          </span>
        </Show>
        <input
          ref={chatInputRef}
          class="chat-input"
          data-testid="chat-input"
          value={props.chatDraft}
          onInput={(event) => props.onChatDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSendChat();
          }}
          placeholder={chatPlaceholder()}
        />
        <button class="send-chat" data-testid="send-chat" title="Send" onClick={props.onSendChat}>
          <ArrowUp size={17} strokeWidth={2.25} />
        </button>
      </div>
      <Show when={previewImage()}>
        {(image) => (
          <Portal>
            <div class="image-preview-backdrop" data-testid="image-preview" onClick={() => setPreviewImage(null)}>
              <button class="image-preview-close icon-button" title="Close preview" onClick={() => setPreviewImage(null)}>
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
