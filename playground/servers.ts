/**
 * Static file servers that play the role of "other origins" for the compat page.
 * Same files (playground/public), three CORS behaviours, all with Range support
 * like a real CDN:
 *   5200  no CORS headers at all
 *   5201  full CORS (Access-Control-Allow-Origin: *)
 *   5202  CORS on full responses only, missing on 206 partial responses
 *
 * Run with `bun run servers`. Set HOST=0.0.0.0 to reach them from another
 * device on the LAN (a phone, for Safari / iOS tests).
 */
import { join, normalize } from "node:path";
import { file as bunFile, serve } from "bun";

const ROOT = join(import.meta.dirname, "public");
const HOST = process.env.HOST ?? "127.0.0.1";

type CorsMode = "none" | "full" | "no-range";

const SERVERS: { mode: CorsMode; port: number }[] = [
  { mode: "none", port: 5200 },
  { mode: "full", port: 5201 },
  { mode: "no-range", port: 5202 },
];

const TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const RANGE_PATTERN = /^bytes=(?<from>\d*)-(?<to>\d*)$/u;

function corsHeaders(mode: CorsMode, partial: boolean): Record<string, string> {
  if (mode === "none" || (mode === "no-range" && partial)) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
  };
}

/** Resolve "bytes=a-b" (also "bytes=a-" and "bytes=-n") against a file size. */
function resolveRange(
  header: string,
  size: number
): { end: number; start: number } | undefined {
  const match = RANGE_PATTERN.exec(header);
  if (!match) {
    return;
  }
  const { from = "", to = "" } = match.groups ?? {};
  if (from === "" && to === "") {
    return;
  }
  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end =
    from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (start > end || start >= size) {
    return;
  }
  return { end, start };
}

async function handle(request: Request, mode: CorsMode): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...corsHeaders(mode, false),
        "Access-Control-Allow-Headers": "Range",
      },
      status: 204,
    });
  }

  const { pathname } = new URL(request.url);
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!path.startsWith(ROOT)) {
    return new Response("forbidden", { status: 403 });
  }
  const file = bunFile(path);
  if (!(await file.exists())) {
    return new Response("not found", { status: 404 });
  }

  const { size } = file;
  const base = {
    "Accept-Ranges": "bytes",
    "Content-Type": TYPES[path.slice(path.lastIndexOf("."))] ?? file.type,
  };

  const requested = request.headers.get("range");
  if (!requested) {
    return new Response(file, {
      headers: {
        ...base,
        ...corsHeaders(mode, false),
        "Content-Length": String(size),
      },
    });
  }

  const range = resolveRange(requested, size);
  if (!range) {
    return new Response("range not satisfiable", {
      headers: { "Content-Range": `bytes */${size}` },
      status: 416,
    });
  }
  return new Response(file.slice(range.start, range.end + 1), {
    headers: {
      ...base,
      ...corsHeaders(mode, true),
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    },
    status: 206,
  });
}

for (const { mode, port } of SERVERS) {
  serve({
    fetch: (request) => handle(request, mode),
    hostname: HOST,
    port,
  });
  process.stdout.write(`[${mode}] http://${HOST}:${port}\n`);
}
