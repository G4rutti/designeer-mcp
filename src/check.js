// npm run check — sobe o servidor via stdio como um cliente MCP de verdade
// e chama cada tool. Mostra se você está em modo live ou offline.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "designeer-check", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, "server.js")], env: process.env }));

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "), "\n");

const show = (label, res, max = 900) => {
  if (res instanceof Error) return console.log(`── ${label}  [FALHOU] ${res.message}\n`);
  const text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const imgs = res.content.filter((c) => c.type === "image").length;
  console.log(`── ${label}${res.isError ? "  [ERRO]" : ""}${imgs ? `  [+${imgs} imagens]` : ""}`);
  console.log(text.length > max ? text.slice(0, max) + "\n…" : text, "\n");
};

// Mostra o nome antes (pra saber qual travou), espera até 3 min e segue se falhar.
const call = async (name, args) => {
  process.stdout.write(`… ${name} ${JSON.stringify(args).slice(0, 80)}\n`);
  const t = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    process.stdout.write(`  (${((Date.now() - t) / 1000).toFixed(1)}s)\n`);
    return r;
  } catch (e) {
    return e;
  }
};

show("status", await call("designeer_status", {}));
show("search 'font' em resources", await call("designeer_search", { query: "font", collection: "resources", limit: 5 }));
show("browse tools", await call("designeer_browse", { collection: "tools" }), 600);
show("get tools/svgomg", await call("designeer_get", { target: "https://designeer.xyz/tools/svgomg" }));
show("get find (slug solto)", await call("designeer_get", { target: "kitasenjudesign-2114683411260694530" }));
show("finds", await call("designeer_finds", {}), 600);
show(
  "media do find (vídeo + still + 2 frames)",
  await call("designeer_media", { target: "finds/kitasenjudesign-2114683411260694530", dir: join(tmpdir(), "designeer-check"), frames: 2 })
);
show(
  "media do find estático (3 imagens)",
  await call("designeer_media", { target: "finds/aarzooaly-2111503257722089973", dir: join(tmpdir(), "designeer-check") })
);
const cap = await call("designeer_capture", { url: "https://ui.shadcn.com/examples/dashboard", max_height: 3000 });
show("capture de um dashboard (só memória)", cap, 700);
if (!(cap instanceof Error) && !cap.isError) {
  const st = JSON.parse(cap.content[0].text).structure || {};
  console.log("   seções:", (st.sections || []).map((x) => x.heading || x.tag).join(" | "));
  console.log("   container:", st.layout?.container_max_width, " espaçamento:", st.spacing_scale_px?.join(","));
  console.log("   componentes:", Object.entries(st.components || {}).map(([k, v]) => `${k}×${v.length}`).join(", "), "\n");
}
show(
  "component: card 'Total Revenue' como código",
  await call("designeer_component", { url: "https://ui.shadcn.com/examples/dashboard", text: "Total Revenue", kind: "card" }),
  700
);

await client.close();
