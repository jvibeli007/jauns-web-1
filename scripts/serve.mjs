import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "POST" && url.pathname === "/api/snapshot") {
      const payload = await readJson(request);
      const result = await updateSnapshot(payload);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) throw new Error("Invalid path");
    const body = await fs.readFile(filePath);
    response.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch (error) {
    const isApi = request.url?.startsWith("/api/");
    response.writeHead(isApi ? 400 : 404, { "content-type": isApi ? "application/json; charset=utf-8" : "text/plain; charset=utf-8" });
    response.end(isApi ? JSON.stringify({ ok: false, error: error.message }) : "Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Serving http://${host}:${port}`);
});

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 128_000) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function updateSnapshot(payload) {
  return new Promise((resolve, reject) => {
    const days = Math.min(30, Math.max(1, Number.parseInt(payload.days, 10) || 2));
    const celebrities = normalizeCelebrities(payload.celebrities);
    if (!celebrities.length) {
      reject(new Error("Please enter at least one tracking target."));
      return;
    }

    const child = spawn(process.execPath, ["scripts/update-snapshot.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        SNAPSHOT_DAYS: String(days),
        SNAPSHOT_CELEBRITIES: JSON.stringify(celebrities)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ ok: true, message: stdout.trim() || "Snapshot updated." });
      } else {
        reject(new Error(stderr.trim() || `Updater exited with ${code}`));
      }
    });
  });
}

function normalizeCelebrities(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map(row => ({
    name: String(row.name || "").trim(),
    localName: String(row.localName || "").trim(),
    company: String(row.company || "").trim()
  })).filter(row => row.name);
}
