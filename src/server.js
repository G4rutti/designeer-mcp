#!/usr/bin/env node
// designeer-mcp — servidor MCP (stdio) para o catálogo do Designeer (designeer.xyz).
// Usa só o que o ai.txt do site libera: /api/catalog, páginas .md e arquivos estáticos.
// Nada de favoritos, pastas ou login.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BASE, CDN, ChallengeError, getBinary, getBinaryHead, getJson, getText, isLiveBlocked } from "./http.js";
import { findEntry, getIndex } from "./offline.js";
import { blockedMessage, capture, extractComponent } from "./capture.js";
import {
  COLLECTIONS, canonical, kindOf, parseLinkList, parseNextCursor, parsePageMd, scoreEntry, slimItem, toPath,
} from "./parse.js";

const run = promisify(execFile);
const MEDIA_DIR = process.env.DESIGNEER_MEDIA_DIR || join(homedir(), "designeer-media");

const ATTRIBUTION =
  "Ao usar: cite o Designeer com link pra página canônica e credite o criador como a página nomeia (regras do designeer.xyz/ai.txt).";

const ok = (data, extra = []) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...extra],
});
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

/** Tenta o caminho live; se o Cloudflare barrar, roda o fallback offline. */
async function liveOr(liveFn, offlineFn) {
  try {
    return { mode: "live", ...(await liveFn()) };
  } catch (e) {
    if (!(e instanceof ChallengeError)) throw e;
    return { mode: "offline", note: e.message, ...(await offlineFn()) };
  }
}

const server = new McpServer({ name: "designeer", version: "0.1.0" });

// ───────────────────────────── search
server.registerTool(
  "designeer_search",
  {
    title: "Buscar no Designeer",
    description:
      "Busca no catálogo curado do Designeer (galerias de inspiração, componentes, fontes, cores, ferramentas, portfolios de designers/devs). " +
      "Use pra achar referência de design, lib de UI, fonte, ferramenta ou portfolio. Retorna nome, tagline, categoria, site e link do Designeer.",
    inputSchema: {
      query: z.string().min(1).describe("Termos de busca em inglês funcionam melhor (ex: 'font', 'motion react', 'landing page gallery')"),
      collection: z.enum(COLLECTIONS).optional().describe("Filtra por coleção"),
      limit: z.number().int().min(1).max(50).default(12),
    },
  },
  async ({ query, collection, limit }) => {
    try {
      const r = await liveOr(
        async () => {
          const j = await getJson(`/api/catalog?q=${encodeURIComponent(query)}`, { live: true });
          let items = (j.results || j.items || []).map(slimItem);
          if (collection) items = items.filter((i) => i.collection === collection);
          return { results: items.slice(0, limit) };
        },
        async () => {
          const idx = await getIndex();
          const results = idx.entries
            .filter((e) => e.kind === "listing" && (!collection || e.collection === collection))
            .map((e) => ({ e, s: scoreEntry(e, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, limit)
            .map(({ e }) => ({ name: e.name, tagline: e.tagline, collection: e.collection, designeer: BASE + e.path }));
          return {
            results,
            caveat: "Busca offline: só nome/tagline/slug, sem categoria nem site. Use designeer_get num resultado pra detalhes (se o live voltar).",
          };
        }
      );
      return ok({ query, ...r, attribution: ATTRIBUTION });
    } catch (e) {
      return fail(`Falhou: ${e.message}`);
    }
  }
);

// ───────────────────────────── browse
server.registerTool(
  "designeer_browse",
  {
    title: "Navegar uma coleção",
    description:
      "Lista os itens de uma coleção do Designeer na ordem curada, com paginação. Categorias conhecidas: " +
      "tools-development, tools-capture-media, tools-design-canvas, resources-type-color, resources-components, inspiration-galleries (há outras; os itens trazem category_slug).",
    inputSchema: {
      collection: z.enum(COLLECTIONS),
      category: z.string().optional().describe("Slug de categoria, ex: 'tools-design-canvas'"),
      cursor: z.string().optional().describe("next_cursor da página anterior"),
    },
  },
  async ({ collection, category, cursor }) => {
    try {
      const r = await liveOr(
        async () => {
          const qs = new URLSearchParams({ collection });
          if (category) qs.set("category", category);
          if (cursor) qs.set("cursor", cursor);
          const j = await getJson(`/api/catalog?${qs}`, { live: true });
          return {
            items: (j.items || j.results || []).map((i) => slimItem({ ...i, collectionSlug: i.collectionSlug || collection })),
            next_cursor: j.nextCursor || null,
          };
        },
        async () => {
          const idx = await getIndex();
          const all = idx.entries.filter((e) => e.collection === collection);
          const start = cursor ? Number(cursor) || 0 : 0;
          const page = all.slice(start, start + 40);
          return {
            items: page.map((e) => ({ name: e.name, tagline: e.tagline, designeer: BASE + e.path })),
            next_cursor: start + 40 < all.length ? String(start + 40) : null,
            total: all.length,
            caveat: category ? "Filtro de categoria não funciona offline." : undefined,
          };
        }
      );
      return ok({ collection, category: category || null, ...r });
    } catch (e) {
      return fail(`Falhou: ${e.message}`);
    }
  }
);

// ───────────────────────────── get
server.registerTool(
  "designeer_get",
  {
    title: "Detalhes de um listing ou find",
    description:
      "Detalhes de uma página do Designeer: site oficial, categoria, preço, PALETA DE CORES extraída (hex), data, relacionados; " +
      "em finds: criador, @handle, post original, tipos (Motion, Interface, 3D...). Aceita URL completa, path ('tools/cursor') ou slug de find.",
    inputSchema: {
      target: z.string().min(1).describe("URL do Designeer, path tipo 'resources/fontshare' ou slug de find"),
    },
  },
  async ({ target }) => {
    const path = toPath(target);
    if (kindOf(path) === "page" && path.split("/").length > 2) return fail(`Não reconheci "${target}" como listing ou find.`);
    try {
      const r = await liveOr(
        async () => ({ page: parsePageMd(await getText(path + ".md", { live: true }), path) }),
        async () => {
          const e = await findEntry(path);
          if (!e) throw new Error(`"${path}" não existe no sitemap do Designeer.`);
          return {
            page: { canonical: canonical(path), kind: e.kind, title: e.name, tagline: e.tagline },
            caveat: "Offline só tenho nome e tagline. Paleta, site e criador exigem o modo live.",
          };
        }
      );
      return ok({ ...r, attribution: ATTRIBUTION });
    } catch (e) {
      return fail(`Falhou: ${e.message}`);
    }
  }
);

// ───────────────────────────── finds
server.registerTool(
  "designeer_finds",
  {
    title: "Últimos finds",
    description:
      "Finds = trabalhos visuais recentes (motion, interface, 3D, tipografia, branding) garimpados do X e da web, creditados ao autor. " +
      "Ótimo pra referência de motion/microinteração. Use designeer_get pra criador/paleta e designeer_media pra ver o vídeo.",
    inputSchema: {
      cursor: z.string().optional(),
      query: z.string().optional().describe("Filtra pela descrição/autor (local, na página atual)"),
    },
  },
  async ({ cursor, query }) => {
    try {
      const r = await liveOr(
        async () => {
          const md = await getText(cursor ? `/index.md?cursor=${encodeURIComponent(cursor)}` : "/index.md", { live: true });
          const finds = parseLinkList(md).filter((i) => i.path.startsWith("/finds/"));
          return { finds: finds.map(({ name, tagline, url }) => ({ name, tagline, designeer: url })), next_cursor: parseNextCursor(md) };
        },
        async () => {
          const idx = await getIndex();
          const all = idx.entries.filter((e) => e.kind === "find");
          const start = cursor ? Number(cursor) || 0 : 0;
          return {
            finds: all.slice(start, start + 30).map((e) => ({ name: e.name, tagline: e.tagline, designeer: BASE + e.path })),
            next_cursor: start + 30 < all.length ? String(start + 30) : null,
          };
        }
      );
      if (query) {
        const q = query.toLowerCase();
        r.finds = r.finds.filter((f) => `${f.name} ${f.tagline || ""}`.toLowerCase().includes(q));
      }
      return ok({ ...r, attribution: ATTRIBUTION });
    } catch (e) {
      return fail(`Falhou: ${e.message}`);
    }
  }
);

// ───────────────────────────── media
async function hasFfmpeg() {
  try {
    await run("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function extractFrames(video, outDir, base, n) {
  // Pega n frames espalhados pelo vídeo, 720px de largura, jpg.
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]);
  const dur = parseFloat(stdout) || 1;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) * dur) / n;
    const out = join(outDir, `${base}-frame${i + 1}.jpg`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "4", out]);
    frames.push(out);
  }
  return frames;
}

server.registerTool(
  "designeer_media",
  {
    title: "Ver mídia de referência",
    description:
      "Puxa a mídia de um find ou listing do Designeer (imagens em alta, still do vídeo) e devolve as imagens pra você ENXERGAR " +
      "a referência — layout, dashboard, tipografia, cor. Por padrão nada fica no disco. Para motion, peça frames > 0 (precisa de ffmpeg). " +
      "Para ver a página de verdade de um site (ou uma tela dentro de uma galeria), use designeer_capture.",
    inputSchema: {
      target: z.string().min(1).describe("URL/path do find ou listing"),
      frames: z.number().int().min(0).max(8).default(0).describe("Frames extras de cada vídeo, pra entender o movimento (0 = só o still)"),
      save: z.boolean().default(false).describe("Guardar os arquivos em ~/designeer-media (padrão: não guarda nada)"),
      dir: z.string().optional().describe("Pasta destino quando save=true"),
    },
  },
  async ({ target, frames, save, dir }) => {
    const path = toPath(target);
    const kind = kindOf(path);
    const slug = path.split("/").pop();
    // Sem save: pasta temporária, apagada no fim (vídeo precisa de arquivo pro ffmpeg).
    const workDir = save ? resolve(dir || MEDIA_DIR, slug) : await mkdtemp(join(tmpdir(), "designeer-"));
    try {
      const groups = [];
      if (kind === "find") {
        for (let n = 1; n <= 6; n++) groups.push(["mp4", "webp", "jpg", "png"].map((ext) => `${CDN}/finds/${slug}/${n}.${ext}`));
      } else if (kind === "listing") {
        let item;
        try {
          const j = await getJson(`/api/catalog?collection=${path.split("/")[1]}&q=${encodeURIComponent(slug.replace(/-/g, " "))}`, { live: true });
          item = (j.results || j.items || []).find((i) => i.slug === slug);
          if (!item) {
            const j2 = await getJson(`/api/catalog?q=${encodeURIComponent(slug.replace(/-/g, " "))}`, { live: true });
            item = (j2.results || []).find((i) => i.slug === slug);
          }
        } catch (e) {
          if (e instanceof ChallengeError) return fail("Mídia de listing precisa do modo live (a API foi barrada pelo Cloudflare). Finds funcionam offline.");
          throw e;
        }
        if (!item) return fail(`Não achei "${slug}" na API pra pegar o id da mídia.`);
        if (item.poster?.url) groups.push([item.poster.url]);
        if (item.videoUrl && frames > 0) groups.push([item.videoUrl]);
      } else return fail(`"${target}" não é find nem listing.`);

      await mkdir(workDir, { recursive: true });
      const got = []; // { url, file?, buf }
      const fetchOne = async (url) => {
        // vídeo só é baixado se for virar frames (ou se for pra guardar)
        if (url.endsWith(".mp4") && frames === 0 && !save) {
          const head = await getBinaryHead(url);
          if (head) got.push({ url, skipped: true });
          return head;
        }
        const buf = await getBinary(url);
        if (!buf) return false;
        const item = { url, buf };
        if (save || url.endsWith(".mp4")) {
          item.file = join(workDir, url.split("/").slice(-2).join("-"));
          await writeFile(item.file, buf);
        }
        got.push(item);
        return true;
      };
      for (const group of groups) {
        let hit = null;
        for (const url of group) if (await fetchOne(url)) { hit = url; break; }
        if (!hit && kind === "find") break;
        // Vídeo de find tem um still em alta ao lado (n-poster.webp): é o "print" do design.
        if (hit && kind === "find" && hit.endsWith(".mp4")) await fetchOne(hit.replace(/(\d+)\.mp4$/, "$1-poster.webp"));
      }
      if (!got.length) return fail("Nenhuma mídia encontrada no CDN pra esse item.");

      const frameBufs = [];
      let ffmpegNote;
      const videos = got.filter((g) => g.file?.endsWith(".mp4"));
      if (frames > 0 && videos.length) {
        if (await hasFfmpeg()) {
          for (const [i, v] of videos.entries()) {
            for (const f of await extractFrames(v.file, workDir, `v${i + 1}`, frames)) frameBufs.push({ file: f, buf: await readFile(f) });
          }
        } else ffmpegNote = "ffmpeg não encontrado: instale pra extrair frames (winget install ffmpeg / brew install ffmpeg).";
      }

      const mimeOf = (u) => (u.endsWith(".png") ? "image/png" : u.endsWith(".webp") ? "image/webp" : "image/jpeg");
      const stills = got.filter((g) => g.buf && /\.(webp|jpg|png)$/.test(g.url)).map((g) => ({ buf: g.buf, mime: mimeOf(g.url) }));
      const images = [...stills, ...frameBufs.map((f) => ({ buf: f.buf, mime: "image/jpeg" }))]
        .slice(0, 8)
        .map((i) => ({ type: "image", data: i.buf.toString("base64"), mimeType: i.mime }));

      return ok(
        {
          designeer: canonical(path),
          media: got.map((g) => ({ url: g.url, kind: g.url.endsWith(".mp4") ? "video" : "imagem" })),
          frames: frameBufs.length || undefined,
          saved_to: save ? workDir : undefined,
          note: ffmpegNote,
          attribution: ATTRIBUTION,
        },
        images
      );
    } catch (e) {
      return fail(`Falhou: ${e.message}`);
    } finally {
      if (!save) await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

/** URL http(s) passa direto; path de listing do Designeer vira o site oficial. */
async function resolveSite(input) {
  const target = input.trim();
  if (/^https?:\/\//i.test(target) && !/designeer\.xyz/i.test(target)) return { target, via: null };
  const path = toPath(target);
  if (kindOf(path) !== "listing") throw new Error("Passe uma URL http(s) ou o path de um listing do Designeer.");
  const page = parsePageMd(await getText(path + ".md", { live: true }), path);
  const site = page.fields.website?.url;
  if (!site) throw new Error(`O listing ${path} não tem site oficial na página.`);
  return { target: site, via: canonical(path) };
}

const slugHost = (u) => new URL(u).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "_");

// ───────────────────────────── capture
server.registerTool(
  "designeer_capture",
  {
    title: "Capturar e entender o design de uma página",
    description:
      "Abre uma URL no Chrome/Edge instalado (headless), tira print da página inteira (em fatias, só na memória) e lê como ela é feita: " +
      "DESIGN (cores de fundo/texto/borda em hex, fontes+peso, escala de tamanhos, raios, sombras, CSS vars) e ESTRUTURA " +
      "(seções em ordem com altura/fundo/título/layout, largura do container, grids e flex com gap, escala de espaçamento, " +
      "e a receita dos componentes — botões, cards, inputs, badges — com seletor de cada um). " +
      "Use o 'selector' de um componente ou seção em designeer_component pra copiar o código dele. " +
      "Aceita path de listing do Designeer (resolve pro site oficial). Páginas atrás de login não funcionam.",
    inputSchema: {
      url: z.string().min(1).describe("URL a capturar, ou path de listing do Designeer (ex: 'tools/revone')"),
      mobile: z.boolean().default(false).describe("Captura em 390px (mobile) em vez de 1440px"),
      max_height: z.number().int().min(900).max(20000).default(6000).describe("Altura máxima do print em px"),
      save: z.boolean().default(false).describe("Guardar os prints em ~/designeer-media (padrão: só memória)"),
      dir: z.string().optional().describe("Pasta destino quando save=true"),
    },
  },
  async ({ url, mobile, max_height, save, dir }) => {
    try {
      const { target, via } = await resolveSite(url);
      const r = await capture({ url: target, mobile, maxHeight: max_height });
      if (r.blocked) {
        return ok(
          { url: r.url, via_designeer: via, blocked: true, error: blockedMessage(r.blocked) },
          r.tiles.map((buf) => ({ type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" }))
        );
      }
      let saved;
      if (save) {
        const outDir = resolve(dir || MEDIA_DIR, "capture-" + slugHost(target));
        await mkdir(outDir, { recursive: true });
        saved = [];
        for (const [i, buf] of r.tiles.entries()) {
          const f = join(outDir, `${mobile ? "mobile" : "desktop"}-${String(i + 1).padStart(2, "0")}.jpg`);
          await writeFile(f, buf);
          saved.push(f);
        }
      }
      const images = r.tiles.slice(0, 8).map((buf) => ({ type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" }));
      return ok(
        {
          url: r.url,
          via_designeer: via,
          viewport: `${r.width}px`,
          height: `${r.captured_height}px de ${r.full_height}px`,
          took: `${(r.ms / 1000).toFixed(1)}s`,
          saved: saved || "não (só memória)",
          warnings: r.notes.length ? r.notes : undefined,
          design: r.design,
          structure: r.structure,
          note:
            "Leitura amostral do CSS computado. Pra copiar um componente/seção, passe o 'selector' dele pro designeer_component. " +
            "Use como referência e credite a fonte; não clone marca, logo, imagem ou texto.",
        },
        images
      );
    } catch (e) {
      if (e instanceof ChallengeError) return fail("Resolver path do Designeer precisa do modo live. Passe a URL do site direto.");
      return fail(`Falhou: ${e.message}`);
    }
  }
);

// ───────────────────────────── component
server.registerTool(
  "designeer_component",
  {
    title: "Copiar um componente como código",
    description:
      "Extrai UM componente ou seção de uma página como HTML + CSS limpos (só o que difere do padrão do navegador, classes próprias, " +
      "sem script e sem depender do site) e devolve um print só dele, pra você comparar e adaptar. " +
      "Ache o alvo por 'selector' (vem do designeer_capture: structure.components[...].selector ou structure.sections[...].selector) " +
      "ou por 'text' (ex: 'Download now'), opcionalmente com 'kind' pra subir até o container certo (ex: text='Pro' + kind='card' = o card de preço inteiro). " +
      "Não captura :hover, animações nem ::before/::after. Use como base pra adaptar no projeto, não pra clonar marca.",
    inputSchema: {
      url: z.string().min(1).describe("URL da página, ou path de listing do Designeer"),
      selector: z.string().optional().describe("Seletor CSS do elemento (do designeer_capture)"),
      text: z.string().optional().describe("Texto visível dentro do componente"),
      kind: z.enum(["button", "card", "section", "nav", "input"]).optional().describe("Sobe a partir do texto até esse tipo de container"),
      mobile: z.boolean().default(false),
      max_nodes: z.number().int().min(10).max(800).default(300).describe("Limite de elementos copiados"),
      save: z.boolean().default(false).describe("Salvar o .html de prévia + print em ~/designeer-media"),
    },
  },
  async ({ url, selector, text, kind, mobile, max_nodes, save }) => {
    if (!selector && !text) return fail("Passe 'selector' (do designeer_capture) ou 'text'.");
    try {
      const { target, via } = await resolveSite(url);
      const r = await extractComponent({ url: target, selector, text, kind, mobile, maxNodes: max_nodes });
      if (r.error) return fail(r.error);
      let saved;
      if (save) {
        const outDir = resolve(MEDIA_DIR, "component-" + slugHost(target));
        await mkdir(outDir, { recursive: true });
        const base = (r.found.text || r.found.tag).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "componente";
        await writeFile(join(outDir, base + ".html"), r.preview);
        if (r.screenshot) await writeFile(join(outDir, base + ".png"), r.screenshot);
        saved = outDir;
      }
      return ok(
        {
          url: r.url,
          via_designeer: via,
          found: r.found,
          nodes: r.nodes,
          fonts: r.fonts,
          took: `${(r.ms / 1000).toFixed(1)}s`,
          saved: saved || "não (só memória)",
          warnings: r.notes.length ? r.notes : undefined,
          css: r.css,
          html: r.html,
          preview_html: r.preview,
          note: "Base pra adaptar: troque cores/fontes pelos tokens do teu projeto, e não reaproveite logo, imagem ou texto do autor.",
        },
        r.screenshot ? [{ type: "image", data: r.screenshot.toString("base64"), mimeType: "image/png" }] : []
      );
    } catch (e) {
      if (e instanceof ChallengeError) return fail("Resolver path do Designeer precisa do modo live. Passe a URL do site direto.");
      return fail(`Falhou: ${e.message}`);
    }
  }
);

// ───────────────────────────── status
server.registerTool(
  "designeer_status",
  {
    title: "Status da conexão",
    description: "Diz se o MCP está em modo live (API completa) ou offline (índice estático), e quantos itens o índice tem.",
    inputSchema: {},
  },
  async () => {
    let live = "ok";
    try {
      await getJson("/api/catalog?q=font", { live: true });
    } catch (e) {
      live = e instanceof ChallengeError ? "barrado pelo Cloudflare (usando offline)" : `erro: ${e.message}`;
    }
    const idx = await getIndex();
    const by = {};
    for (const e of idx.entries) by[e.collection || "finds"] = (by[e.collection || "finds"] || 0) + 1;
    return ok({ live, live_blocked: isLiveBlocked(), offline_index: { built_at: new Date(idx.builtAt).toISOString(), counts: by } });
  }
);

await server.connect(new StdioServerTransport());
