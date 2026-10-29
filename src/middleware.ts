import { defineMiddleware } from "astro:middleware";
import { tieShortWords } from "./lib/tie-short-words";

// Applies typographic ties to every HTML page, in dev and in the static build.
export const onRequest = defineMiddleware(async (_, next) => {
  const response = await next();
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(tieShortWords(await response.text()), { status: response.status, headers });
});
