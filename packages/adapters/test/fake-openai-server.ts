import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** One scripted reply: streamed as OpenAI-style chat.completion.chunk events. */
export interface FakeReply {
  /** Text, split into chunks of this many characters to exercise streaming. */
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finish?: "stop" | "tool_calls" | "length" | "content_filter";
  status?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; cached?: number };
}

export interface FakeServer {
  url: string;
  requests: Array<Record<string, unknown>>;
  replies: FakeReply[];
  models: string[];
  close: () => Promise<void>;
}

export async function startFakeOpenAi(): Promise<FakeServer> {
  const state: Omit<FakeServer, "url" | "close"> = {
    requests: [],
    replies: [],
    models: ["qwen3.6-35b-a3b"],
  };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: state.models.map((id) => ({ id, object: "model" })),
          }),
        );
        return;
      }
      const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
      state.requests.push(parsed);
      const reply = state.replies.shift() ?? { content: "ok" };
      if (reply.status && reply.status >= 400) {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "boom", type: "server_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: Record<string, unknown>, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      if (reply.reasoning) send({ reasoning_content: reply.reasoning });
      for (let i = 0; i < (reply.content?.length ?? 0); i += 7) {
        send({ content: reply.content!.slice(i, i + 7) });
      }
      reply.toolCalls?.forEach((tc, index) => {
        send({
          tool_calls: [
            { index, id: tc.id, type: "function", function: { name: tc.name, arguments: "" } },
          ],
        });
        const half = Math.ceil(tc.arguments.length / 2);
        send({ tool_calls: [{ index, function: { arguments: tc.arguments.slice(0, half) } }] });
        send({ tool_calls: [{ index, function: { arguments: tc.arguments.slice(half) } }] });
      });
      send({}, reply.finish ?? (reply.toolCalls ? "tool_calls" : "stop"));
      const u = reply.usage ?? { prompt_tokens: 100, completion_tokens: 20 };
      res.write(
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.prompt_tokens + u.completion_tokens, prompt_tokens_details: { cached_tokens: u.cached ?? 0 } } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    ...state,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
