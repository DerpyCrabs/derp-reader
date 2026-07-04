import { For, Show, createEffect } from "solid-js";
import ArrowUp from "lucide-solid/icons/arrow-up";
import MessageCircle from "lucide-solid/icons/message-circle";
import Trash2 from "lucide-solid/icons/trash-2";
import type { ChatRecord, ChatWithMessages, SelectionRecord } from "../../shared/types";

interface ChatPaneProps {
  chats: ChatRecord[];
  activeChat: ChatWithMessages | null;
  currentSelection: Pick<SelectionRecord, "kind" | "text" | "region"> | null;
  stagedContextCount: number;
  chatDraft: string;
  focusRequest: number;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onChatDraft: (body: string) => void;
  onSendChat: () => void;
}

export function ChatPane(props: ChatPaneProps) {
  let chatInputRef!: HTMLInputElement;
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
              <button class="chat-select" onClick={() => props.onSelectChat(chat.id)}>
                <MessageCircle size={16} />
                <span>{chat.title}</span>
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
                <p>{message.content}</p>
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
    </section>
  );
}
