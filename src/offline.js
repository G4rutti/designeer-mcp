// Índice offline: sitemap.xml (todas as URLs) + llms-full.txt (nomes e taglines
// de boa parte). Esses arquivos estáticos não passam pelo desafio do Cloudflare.
// Fica em cache no disco por 12h.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getText } from "./http.js";
import { kindOf, parseLinkList, parseSitemap, prettySlug, toPath } from "./parse.js";

const DIR = process.env.DESIGNEER_CACHE_DIR || join(homedir(), ".cache", "designeer-mcp");
const FILE = join(DIR, "index.json");
const MAX_AGE = 12 * 60 * 60 * 1000;

let mem = null;

export async function buildIndex() {
  const [sitemap, full] = await Promise.all([getText("/sitemap.xml"), getText("/llms-full.txt")]);
  const known = new Map();
  for (const it of parseLinkList(full)) {
    if (!known.has(it.path) || (!known.get(it.path).tagline && it.tagline)) known.set(it.path, it);
  }
  const entries = parseSitemap(sitemap).map((path) => {
    const k = known.get(path);
    const collection = path.split("/")[1];
    return {
      path,
      kind: kindOf(path),
      collection: collection === "finds" ? null : collection,
      name: k?.name && !/^Find by /.test(k.name) ? k.name : k?.name || prettySlug(path),
      tagline: k?.tagline || null,
      named: Boolean(k),
    };
  });
  return { builtAt: Date.now(), entries };
}

export async function getIndex({ refresh = false } = {}) {
  if (mem && !refresh && Date.now() - mem.builtAt < MAX_AGE) return mem;
  if (!refresh) {
    try {
      const disk = JSON.parse(await readFile(FILE, "utf8"));
      if (Date.now() - disk.builtAt < MAX_AGE) return (mem = disk);
    } catch {}
  }
  mem = await buildIndex();
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(mem));
  } catch {}
  return mem;
}

export async function findEntry(path) {
  const idx = await getIndex();
  const p = toPath(path);
  return idx.entries.find((e) => e.path === p) || null;
}
