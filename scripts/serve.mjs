import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const allowed = new Set(["index.html", "404.html", "assets", "plans", "labs", "info"]);
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    const relative = file.slice(root.length + 1);
    if (!file.startsWith(`${root}${sep}`) || !allowed.has(relative.split(sep)[0]) || !types[extname(file)]) {
      response.writeHead(404).end("Not found");
      return;
    }
    if (!(await stat(file)).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(file)], "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      response.writeHead(404).end("Not found");
    } else {
      console.error("Request failed", error);
      response.writeHead(500).end("Unable to serve this page");
    }
  }
}).listen(port, "127.0.0.1", function () {
  console.log(`Personal Lab: http://127.0.0.1:${this.address().port}`);
});
