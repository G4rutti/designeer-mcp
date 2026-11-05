// Captura de página: print em fatias + leitura rápida do design (fontes,
// paleta, raios, sombras, CSS vars). Usa o Chrome/Edge já instalado na máquina
// via playwright-core, então não baixa navegador nenhum.


async function launch() {
  let pw;
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("playwright-core não instalado. Rode `npm install` na pasta do designeer-mcp.");
  }
  const tries = [{ channel: "chrome" }, { channel: "msedge" }, {}];
  let last;
  for (const opts of tries) {
    try {
      return await pw.chromium.launch({ headless: true, ...opts });
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    "Não achei Chrome nem Edge instalado (nem Chromium do Playwright). Instale o Chrome ou rode `npx playwright install chromium`. " +
      `Detalhe: ${last?.message?.split("\n")[0]}`
  );
}

// Roda dentro da página: amostra os elementos visíveis e agrega o "design".
function readDesign() {
  // Converte qualquer sintaxe de cor (rgb, oklch, lab, color()...) pra hex pintando 1px num canvas.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const memo = new Map();
  const hex = (c) => {
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
    if (memo.has(c)) return memo.get(c);
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    const out = a < 128 ? null : "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    memo.set(c, out);
    return out;
  };
  const radius = (v) => (parseFloat(v) > 999 ? "9999px (pill)" : v);
  const shadow = (v) => {
    // Tira camadas totalmente transparentes (Tailwind empilha ring/shadow zerados).
    const layers = v.split(/,(?![^(]*\))/).map((l) => l.trim()).filter((l) => !/rgba\(0, 0, 0, 0\)|transparent/.test(l));
    return layers.length ? layers.join(", ") : null;
  };
  const bump = (map, k, w = 1) => k && map.set(k, (map.get(k) || 0) + w);
  const text = new Map(), bg = new Map(), border = new Map(), fonts = new Map(), sizes = new Map(), radii = new Map(), shadows = new Map();
  const els = [...document.querySelectorAll("body *")].slice(0, 4000);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) continue;
    const area = Math.min(r.width * r.height, 400000);
    bump(bg, hex(s.backgroundColor), area);
    if (parseFloat(s.borderTopWidth) > 0) bump(border, hex(s.borderTopColor));
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasText) {
      const len = el.textContent.trim().length;
      bump(text, hex(s.color), len);
      bump(fonts, s.fontFamily.split(",")[0].replace(/["']/g, "").trim() + " " + s.fontWeight, len);
      bump(sizes, Math.round(parseFloat(s.fontSize)) + "px", len);
    }
    if (s.borderRadius && s.borderRadius !== "0px") bump(radii, radius(s.borderRadius));
    if (s.boxShadow && s.boxShadow !== "none") bump(shadows, shadow(s.boxShadow));
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const vars = {};
  for (const sheet of [...document.styleSheets]) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // CSS cross-origin
    for (const rule of rules || []) {
      if (rule.selectorText !== ":root" && rule.selectorText !== "html") continue;
      for (const prop of rule.style) if (prop.startsWith("--") && Object.keys(vars).length < 80) vars[prop] = rule.style.getPropertyValue(prop).trim();
    }
  }
  return {
    title: document.title,
    backgrounds: top(bg, 8),
    text_colors: top(text, 8),
    border_colors: top(border, 5),
    fonts: top(fonts, 8),
    font_sizes: top(sizes, 12).sort((a, b) => parseFloat(a) - parseFloat(b)),
    radii: top(radii, 6),
    shadows: top(shadows, 4),
    css_vars: vars,
  };
}

// Roda dentro da página: COMO a página é montada — seções, layout (container,
// grid, flex), escala de espaçamento e a "receita" de cada tipo de componente.
function readStructure() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const hex = (c) => {
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    if (a < 20) return null;
    const h = "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    return a < 250 ? `${h} @${Math.round((a / 255) * 100)}%` : h;
  };
  const px = (v) => Math.round(parseFloat(v) || 0);
  const bump = (m, k, w = 1) => k && m.set(k, (m.get(k) || 0) + w);
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const visible = (el, s, r) => r.width >= 2 && r.height >= 2 && s.display !== "none" && s.visibility !== "hidden" && +s.opacity !== 0;
  const pageY = (r) => Math.round(r.top + window.scrollY);
  const textOf = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();
  const box = (s) => {
    const p = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px);
    return p[0] === p[2] && p[1] === p[3] ? (p[0] === p[1] ? `${p[0]}` : `${p[0]} ${p[1]}`) : p.join(" ");
  };
  const els = [...document.querySelectorAll("body *")].slice(0, 5000);
  const W = document.documentElement.clientWidth;
  // Seletor CSS único e estável o bastante pra reencontrar o elemento depois.
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && document.querySelectorAll("#" + n.id).length === 1) {
        parts.unshift("#" + n.id);
        break;
      }
      let i = 1;
      for (let sib = n.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.tagName === n.tagName) i++;
      parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
    }
    return (parts[0]?.startsWith("#") ? "" : "body > ") + parts.join(" > ");
  };

  // ── espaçamento: paddings, margins e gaps usados de verdade
  const spacing = new Map();
  for (const el of els) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, s, r)) continue;
    for (const v of [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.marginTop, s.marginBottom, s.rowGap, s.columnGap]) {
      const n = px(v);
      if (n > 0 && n <= 320) bump(spacing, n);
    }
  }
  const spacing_scale = top(spacing, 14).map(([k]) => +k).sort((a, b) => a - b);

  // ── layout: largura de container, grids e flex com gap
  const containers = new Map(), grids = new Map(), flexes = new Map();
  for (const el of els) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, s, r)) continue;
    if (s.maxWidth !== "none" && px(s.maxWidth) >= 480 && r.width >= 480 && r.width < W - 24 && Math.abs(r.left - (W - r.right)) <= 2)
      bump(containers, `${px(s.maxWidth)}px`, r.height);
    if (s.display.includes("grid") && r.width >= 300) {
      const cols = s.gridTemplateColumns.split(" ").filter(Boolean).length;
      if (cols > 1) bump(grids, `${cols} colunas, gap ${px(s.columnGap)}/${px(s.rowGap)}px`);
    }
    if (s.display.includes("flex") && px(s.columnGap || s.gap) > 0 && el.children.length > 1)
      bump(flexes, `${s.flexDirection === "column" ? "coluna" : "linha"} gap ${px(s.flexDirection === "column" ? s.rowGap : s.columnGap)}px`);
  }

  // ── seções: blocos grandes empilhados no fluxo principal da página
  const sections = [];
  const isBand = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= W * 0.6 && r.height >= 80;
  };
  const inFlow = (el) => !/^(fixed|absolute|sticky)$/.test(getComputedStyle(el).position);
  // Cada h1/h2 sobe até o maior bloco largo que não contém outro título: essa é a seção dele.
  const heads = [...document.querySelectorAll("h1, h2")].filter((h) => h.getBoundingClientRect().height > 0);
  const found = new Set();
  for (const h of heads) {
    let best = null;
    for (let n = h.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const others = [...n.querySelectorAll("h1, h2")].filter((x) => x !== h && x.getBoundingClientRect().height > 0);
      if (others.length) break;
      if (isBand(n) && inFlow(n)) best = n;
    }
    if (best) found.add(best);
  }
  // o topo (nav/hero sem h2 próprio) e o rodapé entram também se forem bandas
  for (const el of document.querySelectorAll("header, footer, nav")) if (isBand(el) || el.getBoundingClientRect().width >= W * 0.8) found.add(el);
  const sectionEls = [...found].filter((el) => ![...found].some((o) => o !== el && o.contains(el)))
    .sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top);
  for (const el of sectionEls.slice(0, 20)) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const h = el.querySelector("h1,h2,h3");
    const inner = [...el.querySelectorAll("*")].slice(0, 400);
    const grid = inner.find((x) => {
      const cs = getComputedStyle(x);
      return cs.display.includes("grid") && cs.gridTemplateColumns.split(" ").filter(Boolean).length > 1;
    });
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : null;
    sections.push({
      y: pageY(r),
      height: Math.round(r.height),
      tag: el.tagName.toLowerCase(),
      background: hex(s.backgroundColor) || (s.backgroundImage !== "none" ? "imagem/gradiente" : null),
      padding_y: `${px(s.paddingTop)}/${px(s.paddingBottom)}`,
      heading: h ? textOf(h).slice(0, 70) : null,
      heading_size: h ? px(getComputedStyle(h).fontSize) : null,
      layout: cols ? `grid ${cols} col` : "fluxo",
      buttons: el.querySelectorAll("button, a[class*='btn'], a[class*='button'], [role=button]").length,
      images: el.querySelectorAll("img, picture, video, svg[width]").length,
      selector: cssPath(el),
    });
  }

  // ── componentes: assinatura de estilo mais comum por tipo
  const textStyle = (el, s) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 3) });
    const t = walker.nextNode();
    return t && t.parentElement ? getComputedStyle(t.parentElement) : s;
  };
  const sig = (el, s, r, kind) => {
    const ts = textStyle(el, s);
    const o = {
      bg: hex(s.backgroundColor) || (s.backgroundImage !== "none" ? "gradiente" : "transparente"),
      text: hex(ts.color),
      radius: px(s.borderTopLeftRadius) > 999 ? "pill" : `${px(s.borderTopLeftRadius)}px`,
      padding: box(s),
      border: px(s.borderTopWidth) ? `${px(s.borderTopWidth)}px ${hex(s.borderTopColor)}` : null,
      shadow: s.boxShadow !== "none" && !/^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,?\s*)+$/.test(s.boxShadow) ? "sim" : null,
    };
    if (kind !== "card")
      Object.assign(o, { font: `${ts.fontFamily.split(",")[0].replace(/["']/g, "").trim()} ${px(ts.fontSize)}px/${ts.fontWeight}`, height: `${Math.round(r.height)}px` });
    else Object.assign(o, { size: `~${Math.round(r.width / 10) * 10}x${Math.round(r.height / 10) * 10}` });
    return o;
  };
  const groups = { button: new Map(), input: new Map(), card: new Map(), badge: new Map() };
  const examples = {};
  const add = (kind, el, s, r) => {
    const o = sig(el, s, r, kind);
    const key = JSON.stringify({ ...o, size: undefined, height: undefined });
    bump(groups[kind], key);
    if (!examples[key]) examples[key] = { ...o, example: textOf(el).slice(0, 40) || null, selector: cssPath(el) };
  };
  for (const el of els) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, s, r)) continue;
    const tag = el.tagName;
    const hasBg = !!hex(s.backgroundColor) || s.backgroundImage !== "none";
    const hasBorder = px(s.borderTopWidth) > 0;
    const isClickable = tag === "BUTTON" || el.getAttribute("role") === "button" || (tag === "A" && (hasBg || hasBorder) && px(s.paddingLeft) >= 8);
    if (isClickable && r.height >= 24 && r.height <= 72 && r.width <= 420) add("button", el, s, r);
    else if ((tag === "INPUT" && !["checkbox", "radio", "hidden"].includes(el.type)) || tag === "TEXTAREA" || tag === "SELECT") add("input", el, s, r);
    else if ((hasBg || hasBorder || s.boxShadow !== "none") && r.height >= 14 && r.height <= 28 && r.width <= 160 && px(s.borderTopLeftRadius) >= 4 && textOf(el).length <= 20 && textOf(el).length > 0)
      add("badge", el, s, r);
    else if ((hasBg || hasBorder) && px(s.borderTopLeftRadius) >= 4 && r.width >= 140 && r.height >= 80 && r.width < W * 0.9 && px(s.paddingTop) >= 8) add("card", el, s, r);
  }
  const components = {};
  for (const [kind, m] of Object.entries(groups)) {
    const t = top(m, 3);
    if (t.length) components[kind] = t.map(([k, n]) => ({ count: n, ...examples[k] }));
  }

  return {
    sections,
    layout: {
      container_max_width: top(containers, 3).map(([k]) => k),
      grids: top(grids, 5).map(([k, n]) => `${k} (×${n})`),
      flex: top(flexes, 5).map(([k, n]) => `${k} (×${n})`),
    },
    spacing_scale_px: spacing_scale,
    components,
  };
}

// Roda dentro da página: serializa UM elemento (e filhos) em HTML + CSS limpos.
// Guarda só as propriedades que diferem do padrão do navegador pra aquela tag
// e não repete propriedade herdada igual à do pai. Sem script, sem :hover.
function serializeComponent({ selector, text, kind, maxNodes }) {
  const W = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && s.display !== "none" && s.visibility !== "hidden";
  };
  const textOf = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();

  // ── achar o elemento
  let el = null;
  if (selector) el = document.querySelector(selector);
  if (!el && text) {
    const t = text.toLowerCase();
    const hits = [...document.querySelectorAll("body *")].filter((e) => visible(e) && textOf(e).toLowerCase().includes(t));
    // o mais profundo que contém o texto
    el = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)))[0] || hits[0] || null;
    if (el && kind) {
      const isKind = (e) => {
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        const deco = (s.backgroundColor !== "rgba(0, 0, 0, 0)" || s.backgroundImage !== "none" || parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== "none");
        if (kind === "button") return e.tagName === "BUTTON" || e.tagName === "A" || e.getAttribute("role") === "button";
        if (kind === "card") return deco && parseFloat(s.borderTopLeftRadius) >= 4 && r.width >= 140 && r.height >= 80 && r.width < W * 0.95;
        if (kind === "section") return r.width >= W * 0.8 && r.height >= 200;
        if (kind === "nav") return e.tagName === "NAV" || e.tagName === "HEADER";
        if (kind === "input") return ["INPUT", "TEXTAREA", "SELECT", "FORM"].includes(e.tagName);
        return false;
      };
      let n = el;
      while (n && n !== document.body && !isKind(n)) n = n.parentElement;
      if (n && n !== document.body) el = n;
    }
  }
  if (!el) return { error: "Elemento não encontrado (seletor/texto não bateu nesta página)." };

  // ── defaults por tag, medidos num iframe limpo
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const fdoc = frame.contentDocument;
  fdoc.open();
  fdoc.write("<!doctype html><html><body></body></html>");
  fdoc.close();
  const defaults = new Map();
  const defaultFor = (tag) => {
    if (defaults.has(tag)) return defaults.get(tag);
    const d = fdoc.createElementNS(tag === "svg" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml", tag);
    if (tag === "a") d.setAttribute("href", "#"); // link de verdade (sublinhado/cor padrão)
    fdoc.body.appendChild(d);
    const cs = frame.contentWindow.getComputedStyle(d);
    const o = {};
    for (const p of PROPS) o[p] = cs.getPropertyValue(p);
    d.remove();
    defaults.set(tag, o);
    return o;
  };

  const PROPS = [
    "display", "position", "top", "right", "bottom", "left", "z-index", "inset",
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "align-self", "justify-self",
    "flex-grow", "flex-shrink", "flex-basis", "order", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-auto-flow",
    "box-sizing", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "min-width", "max-width", "min-height", "max-height", "overflow-x", "overflow-y", "aspect-ratio",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align",
    "text-transform", "text-decoration-line", "white-space", "font-feature-settings", "font-variant-numeric", "color",
    "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "outline-style", "outline-width", "outline-color", "outline-offset",
    "box-shadow", "opacity", "transform", "filter", "backdrop-filter", "mix-blend-mode",
    "object-fit", "object-position", "cursor", "transition", "fill", "stroke", "stroke-width",
  ];
  const INHERITED = new Set([
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align",
    "text-transform", "white-space", "color", "cursor", "font-feature-settings", "font-variant-numeric", "fill", "stroke", "stroke-width",
  ]);
  const SIZED = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "IFRAME", "INPUT", "TEXTAREA", "SELECT", "svg"]);
  const KEEP_ATTR = /^(href|src|srcset|alt|type|placeholder|value|role|aria-[\w-]+|name|for|checked|disabled|width|height|viewBox|d|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|points|transform|xmlns|fill-rule|clip-rule|opacity|preserveAspectRatio|offset|stop-color|stop-opacity|gradientUnits|id)$/i;

  // Qualquer função de cor (rgb, lab, oklch, color()...) → #hex, ou rgba() se tiver transparência.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const oneColor = (c) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    if (a === 255) return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(2)})`;
  };
  const toHex = (v) => v.replace(/\b(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\([^()]*\)/g, (m) => oneColor(m));
  const cleanShadow = (v) => {
    const layers = v.split(/,(?![^(]*\))/).map((l) => l.trim()).filter((l) => !/rgba\(0, 0, 0, 0\)|transparent/.test(l));
    return layers.length ? layers.join(", ") : null;
  };
  // Valor DECLARADO no CSS (ex: "1fr auto"), não o computado em px.
  const declared = (el, prop) => {
    let val = el.style.getPropertyValue(prop) || null;
    if (val) return val;
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) { visit(rule.cssRules); continue; } // @media/@layer/@supports
        if (!rule.selectorText || !rule.style) continue;
        let hit = false;
        try { hit = el.matches(rule.selectorText); } catch {}
        if (hit) { const v = rule.style.getPropertyValue(prop); if (v) val = v; }
      }
    };
    for (const sh of document.styleSheets) { try { visit(sh.cssRules); } catch {} }
    return val;
  };
  const compact = (decl, cs) => {
    const m = new Map(decl.map((d) => { const i = d.indexOf(": "); return [d.slice(0, i), d.slice(i + 2)]; }));
    if (m.has("font-family") && !/(sans-serif|serif|monospace|system-ui|cursive)\s*$/i.test(m.get("font-family")))
      m.set("font-family", m.get("font-family") + ", system-ui, sans-serif");
    if (m.has("box-shadow")) { const v = cleanShadow(m.get("box-shadow")); v ? m.set("box-shadow", v) : m.delete("box-shadow"); }
    for (const p of ["grid-template-columns", "grid-template-rows"]) {
      if (!m.has(p)) continue;
      const d = declared(cs.__el, p);
      if (d && !/var\(/.test(d)) m.set(p, d);
      else if (d) m.set(p, d + " /* var do site */");
      else m.set(p, m.get(p).replace(/(\d+\.\d+)px/g, (x, n) => Math.round(+n) + "px"));
    }
    const pos = cs.position;
    for (const p of ["top", "right", "bottom", "left"]) if (m.has(p) && (pos === "static" || (pos === "relative" && m.get(p) === "0px"))) m.delete(p);
    m.delete("inset");
    for (const side of ["top", "right", "bottom", "left"]) {
      if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) === 0) {
        m.delete(`border-${side}-width`); m.delete(`border-${side}-style`); m.delete(`border-${side}-color`);
      }
    }
    if (cs.outlineStyle === "none") { m.delete("outline-style"); m.delete("outline-width"); m.delete("outline-color"); m.delete("outline-offset"); }
    for (const p of ["min-width", "min-height"]) if (m.get(p) === "auto") m.delete(p);
    if (!/grid/.test(cs.display) && cs.flexWrap !== "wrap") m.delete("align-content");
    if (!/flex|grid/.test(cs.display)) { m.delete("row-gap"); m.delete("column-gap"); }
    if (m.get("overflow-x") === m.get("overflow-y") && m.has("overflow-x")) { m.set("overflow", m.get("overflow-x")); m.delete("overflow-x"); m.delete("overflow-y"); }
    // shorthands
    const four = (pre, suf = "") => {
      const k = ["top", "right", "bottom", "left"].map((s) => `${pre}-${s}${suf}`);
      if (!k.some((x) => m.has(x))) return;
      const v = k.map((x) => m.get(x) ?? cs.getPropertyValue(x));
      k.forEach((x) => m.delete(x));
      const [t, r, b, l] = v;
      m.set(pre + suf, t === b && r === l ? (t === r ? t : `${t} ${r}`) : `${t} ${r} ${b} ${l}`);
    };
    four("padding"); four("margin");
    const rk = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
    if (rk.some((x) => m.has(x))) {
      const v = rk.map((x) => cs.getPropertyValue(x));
      rk.forEach((x) => m.delete(x));
      const pill = (x) => (parseFloat(x) > 999 ? "9999px" : x);
      m.set("border-radius", v.every((x) => x === v[0]) ? pill(v[0]) : v.map(pill).join(" "));
    }
    const bw = ["top", "right", "bottom", "left"].map((s) => [cs.getPropertyValue(`border-${s}-width`), cs.getPropertyValue(`border-${s}-style`), cs.getPropertyValue(`border-${s}-color`)].join(" "));
    if (m.has("border-top-width") && bw.every((x) => x === bw[0])) {
      for (const s of ["top", "right", "bottom", "left"]) for (const t of ["width", "style", "color"]) m.delete(`border-${s}-${t}`);
      m.set("border", bw[0]);
    }
    if (m.has("row-gap") && m.get("row-gap") === m.get("column-gap")) { m.set("gap", m.get("row-gap")); m.delete("row-gap"); m.delete("column-gap"); }
    decl.length = 0;
    for (const [k, v] of m) decl.push(`${k}: ${toHex(v)}`);
  };

  const rules = [];
  const ruleIndex = new Map(); // declarações iguais reaproveitam a mesma classe
  let count = 0;
  let truncated = false;
  const fonts = new Set();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const walk = (node, parentCS, isRoot, inSvg) => {
    if (node.nodeType === 3) return esc(node.textContent);
    if (node.nodeType !== 1) return "";
    const tag = node.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/i.test(tag)) return "";
    if (count >= maxNodes) { truncated = true; return ""; }
    count++;
    const svg = inSvg || tag.toLowerCase() === "svg";
    const cs = getComputedStyle(node);
    if (cs.display === "none") return "";
    const r = node.getBoundingClientRect();

    // atributos
    const attrs = [];
    for (const a of node.attributes) {
      if (!(svg ? !/^(class|style|on\w+)$/i.test(a.name) : KEEP_ATTR.test(a.name))) continue;
      let v = a.value;
      if (a.name === "href") v = "#";
      if ((a.name === "src" || a.name === "srcset") && !svg) v = a.name === "src" ? node.src : v;
      attrs.push(`${a.name}="${v.replace(/"/g, "&quot;")}"`);
    }

    // estilo: só o que difere do default da tag e (se herdável) do pai
    const def = svg && tag.toLowerCase() !== "svg" ? null : defaultFor(tag.toLowerCase());
    const decl = [];
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (INHERITED.has(p)) {
        if (!isRoot && parentCS && parentCS.getPropertyValue(p) === v) continue;
        if (isRoot && def && def[p] === v && p !== "font-family" && p !== "color") continue;
      } else if (def && def[p] === v) continue;
      else if (!def && /^(auto|none|normal|0px|static|visible|1)$/.test(v)) continue;
      if (/^(margin-(left|right))$/.test(p) && isRoot) continue;
      decl.push(`${p}: ${v}`);
      if (p === "font-family") fonts.add(v.split(",")[0].replace(/["']/g, "").trim());
    }
    // tamanhos: fixos só em mídia/svg/input; a raiz ganha largura máxima pra não estourar
    const empty = !node.children.length && !node.textContent.trim();
    const pinned = /^(absolute|fixed)$/.test(cs.position);
    if (SIZED.has(tag) || tag.toLowerCase() === "svg" || ((empty || pinned) && !isRoot)) {
      decl.push(`width: ${Math.round(r.width)}px`, `height: ${Math.round(r.height)}px`);
    } else if (isRoot) {
      decl.push(`width: 100%`, `max-width: ${Math.round(r.width)}px`);
      if (cs.display === "inline") decl.push("display: inline-block");
    }

    cs.__el = node;
    compact(decl, cs);

    let cls = "";
    if (decl.length && !svg) {
      const key = decl.join(";");
      if (!ruleIndex.has(key)) {
        ruleIndex.set(key, `c${ruleIndex.size}`);
        rules.push(`.${ruleIndex.get(key)} {\n  ${decl.join(";\n  ")};\n}`);
      }
      cls = ruleIndex.get(key);
    } else if (decl.length && svg && tag.toLowerCase() === "svg") {
      attrs.push(`style="${decl.join("; ")}"`);
    }

    const t = tag.toLowerCase();
    const open = `<${t}${cls ? ` class="${cls}"` : ""}${attrs.length ? " " + attrs.join(" ") : ""}>`;
    if (/^(img|input|br|hr|source)$/.test(t)) return open;
    const kids = [...node.childNodes].map((c) => walk(c, cs, false, svg)).join("");
    return `${open}${kids}</${t}>`;
  };

  const html = walk(el, el.parentElement ? getComputedStyle(el.parentElement) : null, true, false);
  frame.remove();

  // ancestral com fundo, pra prévia não ficar "branco no branco"
  let backdrop = null;
  for (let n = el.parentElement; n && !backdrop; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.backgroundColor !== "rgba(0, 0, 0, 0)") backdrop = s.backgroundColor;
  }

  // seletor do elemento achado (pra screenshot)
  const marker = "data-designeer-pick";
  el.setAttribute(marker, "1");
  const r = el.getBoundingClientRect();
  return {
    html,
    css: rules.join("\n\n"),
    nodes: count,
    truncated,
    fonts: [...fonts],
    backdrop: backdrop || getComputedStyle(document.body).backgroundColor,
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    tag: el.tagName.toLowerCase(),
    text: textOf(el).slice(0, 80),
    pick: `[${marker}="1"]`,
  };
}

// Fatia um JPEG alto em pedaços de tileHeight usando canvas numa página em branco
// (rápido e sem dependência de lib de imagem).
async function sliceInBrowser(ctx, jpeg, width, height, tileHeight) {
  const p = await ctx.newPage();
  try {
    const parts = await p.evaluate(
      async ({ b64, width, height, tileHeight }) => {
        const img = new Image();
        img.src = "data:image/jpeg;base64," + b64;
        await img.decode();
        const out = [];
        for (let y = 0; y < height; y += tileHeight) {
          const h = Math.min(tileHeight, height - y);
          const c = document.createElement("canvas");
          c.width = width;
          c.height = h;
          c.getContext("2d").drawImage(img, 0, y, width, h, 0, 0, width, h);
          out.push(c.toDataURL("image/jpeg", 0.82).split(",")[1]);
        }
        return out;
      },
      { b64: jpeg.toString("base64"), width, height, tileHeight }
    );
    return parts.map((b) => Buffer.from(b, "base64"));
  } finally {
    await p.close();
  }
}

/** Abre a página com orçamento de tempo, rola pra disparar lazy-load e volta pro topo. */
async function openPage(browser, { url, mobile, maxHeight, left, notes }) {
  const width = mobile ? 390 : 1440;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(25000, left()) });
  } catch (e) {
    if (!/Timeout/i.test(e.message)) throw e;
    notes.push("Página demorou a carregar; usei o que tinha até ali.");
  }
  // networkidle é opcional: site com analytics/websocket nunca fica ocioso.
  await page.waitForLoadState("networkidle", { timeout: Math.min(6000, left()) }).catch(() => {});
  await page
    .evaluate(async (limit) => {
      for (let y = 0; y < document.body.scrollHeight && y < limit; y += 800) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
    }, maxHeight)
    .catch(() => {});
  await page.waitForTimeout(Math.min(700, left()));
  return { ctx, page, width };
}

const budget = (ms) => {
  const t0 = Date.now();
  return { t0, left: () => Math.max(1000, ms - (Date.now() - t0)) };
};

/**
 * Print da página (em memória, fatiado) + leitura do design + estrutura.
 * Orçamento total ~40s pra caber no timeout de 60s dos clientes MCP.
 */
export async function capture({ url, mobile = false, maxHeight = 6000, tileHeight = 1600, budgetMs = 40000 }) {
  const { t0, left } = budget(budgetMs);
  const notes = [];
  const browser = await launch();
  try {
    const { ctx, page, width } = await openPage(browser, { url, mobile, maxHeight, left, notes });
    const design = await page.evaluate(readDesign);
    const structure = await page.evaluate(readStructure).catch((e) => ({ error: e.message.split("\n")[0] }));
    const fullHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    const height = Math.min(fullHeight, maxHeight);
    const shot = await page.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 85,
      clip: { x: 0, y: 0, width, height },
      timeout: Math.min(20000, left() + 5000),
    });
    const tiles = height > tileHeight ? await sliceInBrowser(ctx, shot, width, height, tileHeight) : [shot];
    return { url: page.url(), width, full_height: fullHeight, captured_height: height, design, structure, tiles, notes, ms: Date.now() - t0 };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Copia UM componente: acha por seletor (vindo do capture) ou por texto,
 * opcionalmente sobe até o tipo pedido (button/card/section/nav/input),
 * devolve print só dele + HTML/CSS limpos + uma prévia standalone.
 */
export async function extractComponent({ url, selector, text, kind, mobile = false, maxNodes = 300, budgetMs = 40000 }) {
  const { t0, left } = budget(budgetMs);
  const notes = [];
  const browser = await launch();
  try {
    const { page } = await openPage(browser, { url, mobile, maxHeight: 6000, left, notes });
    const out = await page.evaluate(serializeComponent, { selector, text, kind, maxNodes });
    if (out.error) return { error: out.error, notes };
    const loc = page.locator(out.pick).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const shot = await loc.screenshot({ type: "png", timeout: Math.min(10000, left()) }).catch(() => null);
    if (out.truncated) notes.push(`Componente grande: parei em ${maxNodes} nós. Aponte um pedaço menor se precisar.`);
    const fontLinks = out.fonts.filter((f) => !/^(system-ui|-apple-system|ui-|sans-serif|serif|monospace|Arial|Helvetica|Times)/i.test(f));
    // Tenta Google Fonts e Fontshare pra cada família (a que não existir só falha calada).
    const links = fontLinks
      .flatMap((f) => [
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800&display=swap">`,
        `<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=${f.toLowerCase().replace(/\s+/g, "-")}@300,400,500,600,700,800&display=swap">`,
      ])
      .join("\n");
    const preview =
      `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n` +
      `<title>componente</title>\n<!-- fontes: ${fontLinks.join(", ") || "do sistema"} -->\n${links}\n` +
      `<style>\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 40px; background: ${out.backdrop}; box-sizing: border-box; font-family: system-ui, sans-serif; }\n\n${out.css}\n</style></head>\n<body>\n${out.html}\n</body></html>\n`;
    return {
      url: page.url(),
      found: { tag: out.tag, text: out.text, size: out.size },
      nodes: out.nodes,
      fonts: out.fonts,
      html: out.html,
      css: out.css,
      preview,
      screenshot: shot,
      notes,
      ms: Date.now() - t0,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
