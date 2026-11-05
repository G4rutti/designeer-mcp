// Parsers puros (sem rede) — testáveis com fixtures.

import { BASE } from "./http.js";

/** Tira caracteres invisíveis (marcas de direção, zero-width, \p{Cf}) e espaços repetidos. */
export function cleanText(v) {
  if (v == null) return v;
  const t = String(v).replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
  return t || null;
}

export const COLLECTIONS = ["inspiration", "resources", "tools", "portfolios"];

/** Normaliza o que o usuário passar (URL completa, path, "tools/cursor", slug de find) num path canônico. */
export function toPath(input) {
  let s = String(input).trim();
  s = s.replace(/^https?:\/\/(www\.)?designeer\.xyz/i, "");
  s = s.split("#")[0].split("?")[0].replace(/\.md$/, "").replace(/\/+$/, "");
  if (!s.startsWith("/")) s = "/" + s;
  const parts = s.split("/").filter(Boolean);
  if (parts.length === 1 && /-\d{15,}$/.test(parts[0])) return "/finds/" + parts[0]; // slug de find solto
  return "/" + parts.join("/");
}

export const canonical = (path) => BASE + toPath(path);

export function kindOf(path) {
  const top = toPath(path).split("/")[1];
  if (top === "finds") return "find";
  if (COLLECTIONS.includes(top)) return "listing";
  return "page";
}

/** Parse do .md de um listing ou find: título, resumo, tabela de campos, relacionados. */
export function parsePageMd(md, path) {
  const out = { canonical: canonical(path), kind: kindOf(path), fields: {}, related: [] };
  const title = md.match(/^#\s+(.+)$/m);
  if (title) out.title = cleanText(title[1]);
  // Blockquote inteiro (pode ter várias linhas) = resumo / legenda do post
  const quote = md.match(/^(?:>[^\n]*(?:\n|$))+/m);
  if (quote) {
    const text = quote[0].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean).join("\n");
    if (text) out.summary = text;
  }

  // Primeiro parágrafo solto depois do "Last updated" = tagline do listing
  // Só olha até a primeira seção "## " (Related etc.) e ignora listas/tabelas/citações;
  // finds não têm tagline, então ficam com null.
  const after = md.split(/^Last updated:.*$/m)[1]?.split(/^##\s/m)[0];
  out.tagline = null;
  if (after && out.kind !== "find") {
    const para = after.split(/\n\s*\n/).map((p) => p.trim())
      .find((p) => p && !/^[|#>]/.test(p) && !/^[-*]\s/.test(p));
    if (para) out.tagline = para;
  }

  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$/);
    if (!m || /^-+$/.test(m[1]) || m[1] === "Field") continue;
    const key = m[1].toLowerCase().replace(/\s+/g, "_");
    const rawVal = m[2];
    const link = rawVal.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
    out.fields[key] = link ? { text: cleanText(link[1]), url: link[2] } : cleanText(rawVal);
  }

  const colours = out.fields.colours;
  if (typeof colours === "string") out.colours = colours.split(/,\s*/).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));

  const rel = md.split(/^## Related\s*$/m)[1];
  if (rel) {
    for (const m of rel.matchAll(/^- \[([^\]]+)\]\(([^)\s]+)\)(?:[ \t]+-[ \t]+(.+))?$/gm)) {
      out.related.push({ name: cleanText(m[1]), url: m[2].replace(/\.md$/, ""), tagline: cleanText(m[3]) });
    }
  }
  return out;
}

/** Linhas "- [Nome](url) - tagline" de qualquer markdown do site. */
export function parseLinkList(md) {
  const items = [];
  for (const m of md.matchAll(/^- \[([^\]]+)\]\((https:\/\/designeer\.xyz\/[^)\s]+)\)(?:[ \t]+-[ \t]+(.+))?$/gm)) {
    const url = m[2].replace(/\.md$/, "");
    items.push({ name: cleanText(m[1]), url, path: toPath(url), tagline: cleanText(m[3]) });
  }
  return items;
}

/** Cursor de "Next page" num .md paginado. */
export function parseNextCursor(md) {
  const m = md.match(/\[Next page\]\([^)]*[?&]cursor=([^)&\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Item da API JSON → formato enxuto. */
export function slimItem(it) {
  const col = it.collectionSlug || null;
  return {
    name: cleanText(it.name),
    tagline: cleanText(it.tagline),
    collection: col,
    category: it.category?.name || null,
    category_slug: it.category?.slug || null,
    website: it.url,
    pricing: it.pricing || null,
    designeer: col ? `${BASE}/${col}/${it.slug}` : null,
    slug: it.slug,
    poster: it.poster?.url || null,
    video: it.videoUrl || null,
  };
}

/** sitemap.xml → paths de listings e finds. */
export function parseSitemap(xml) {
  const paths = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const p = toPath(m[1]);
    const k = kindOf(p);
    if (k === "find" || (k === "listing" && p.split("/").length === 3)) paths.push(p);
  }
  return [...new Set(paths)];
}

/** Nome legível a partir do slug quando o índice offline não tem o nome. */
export function prettySlug(path) {
  const slug = toPath(path).split("/").pop();
  if (kindOf(path) === "find") return "Find by @" + slug.replace(/-\d{15,}$/, "");
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Busca simples por tokens com peso (nome > tagline > slug). */
export function scoreEntry(entry, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const name = (entry.name || "").toLowerCase();
  const tag = (entry.tagline || "").toLowerCase();
  const slug = entry.path.toLowerCase();
  let score = 0;
  for (const t of terms) {
    let s = 0;
    if (name === t) s = 10;
    else if (name.includes(t)) s = 6;
    else if (tag.includes(t)) s = 3;
    else if (slug.includes(t)) s = 2;
    if (!s) return 0; // AND entre termos
    score += s;
  }
  return score;
}
