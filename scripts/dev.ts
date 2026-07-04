import Fastify, { type FastifyReply } from "fastify";
import middie from "@fastify/middie";
import { createServer as createViteServer } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleApiRequest } from "../server/index";

const port = Number(process.env.PORT ?? process.env.VITE_DEV_PORT ?? 5173);
const host = process.env.HOST ?? "0.0.0.0";
const app = Fastify({ logger: false });

app.removeAllContentTypeParsers();
app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
  done(null, body);
});

const headersFromFastify = (headers: Record<string, string | string[] | number | undefined>) => {
  const next = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) next.append(name, item);
    } else if (value !== undefined) {
      next.set(name, String(value));
    }
  }
  return next;
};

const sendFetchResponse = async (reply: FastifyReply, response: Response) => {
  reply.status(response.status);
  response.headers.forEach((value, name) => reply.header(name, value));
  if (response.status === 204) return reply.send();
  return reply.send(Buffer.from(await response.arrayBuffer()));
};

app.all("/api/*", async (request, reply) => {
  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" || request.body === undefined
      ? undefined
      : typeof request.body === "string"
        ? request.body
        : request.body instanceof Uint8Array
          ? new Blob([request.body as BlobPart])
          : JSON.stringify(request.body);
  const url = new URL(request.url, `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
  const response = await handleApiRequest(
    new Request(url, {
      method,
      headers: headersFromFastify(request.headers),
      body
    })
  );
  return sendFetchResponse(reply, response);
});

await app.register(middie);

const vite = await createViteServer({
  appType: "custom",
  server: {
    middlewareMode: true,
    hmr: { server: app.server },
    watch: {
      ignored: ["**/data/**", "**/test-results/**", "**/playwright-report/**"]
    }
  }
});

app.use(vite.middlewares);

const indexPath = resolve("index.html");
app.get("*", async (request, reply) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
    const template = readFileSync(indexPath, "utf8");
    const html = await vite.transformIndexHtml(url.pathname, template);
    return reply.type("text/html").send(html);
  } catch (error) {
    vite.ssrFixStacktrace(error as Error);
    console.error(error);
    return reply.status(500).send("Internal Server Error");
  }
});

await app.listen({ port, host });
console.log(`Derp Reader dev server listening on http://localhost:${port}`);
