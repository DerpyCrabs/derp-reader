import { describe, expect, test } from "bun:test";
import { parseChatGptSse } from "./chatgpt";

describe("parseChatGptSse", () => {
  test("joins output text deltas", () => {
    const body = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello "}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"world"}',
      "data: [DONE]"
    ].join("\n\n");
    expect(parseChatGptSse(body)).toBe("Hello world");
  });

  test("falls back to completed output items", () => {
    const body = 'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"Final answer"}]}}\n\n';
    expect(parseChatGptSse(body)).toBe("Final answer");
  });

  test("surfaces failed responses", () => {
    const body = 'data: {"type":"response.failed","response":{"error":{"message":"Bad request"}}}\n\n';
    expect(() => parseChatGptSse(body)).toThrow("Bad request");
  });
});
