import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true
});

export function MarkdownContent(props: { content: string }) {
  return <div class="markdown-content" innerHTML={markdown.render(props.content)} />;
}
