// Camada HTTP: fetch com UA de navegador, cache em memória e detecção do
// desafio do Cloudflare ("Just a moment..."), que aparece em IP de datacenter.

export const BASE = "https://designeer.xyz";
export const CDN = "https://cdn.designeer.xyz";

const UA =
  process.env.DESIGNEER_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

const TTL = 10 * 60 * 1000; // 10 min
const cache = new Map();

export class ChallengeError extends Error {
  constructor(url) {
    super(
      `O Cloudflare do Designeer barrou a requisição (${url}). ` +
        "Acontece com IP de datacenter/VPN. Usando o índice offline."
    );
    this.name = "ChallengeError";
  }
}

export class HttpError extends Error {
  constructor(url, status) {
    super(`HTTP ${status} em ${url}`);
    this.name = "HttpError";
    this.status = status;
  }
}

// Depois do primeiro desafio, para de tentar o live nesta sessão
// (evita esperar timeout em toda chamada). DESIGNEER_OFFLINE=1 força offline.
let liveBlocked = process.env.DESIGNEER_OFFLINE === "1";
export const isLiveBlocked = () => liveBlocked;

function isChallenge(status, text) {
  return (status === 403 || status === 503) && /Just a moment|challenges\.cloudflare\.com|cf-chl/i.test(text);
}

async function raw(url, { accept = "*/*", timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
      signal: ctrl.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(t);
  }
}

/** Texto de uma URL do Designeer. `live: true` = endpoint que pode ter desafio. */
export async function getText(path, { live = false, accept } = {}) {
  const url = path.startsWith("http") ? path : BASE + path;
  if (live && liveBlocked) throw new ChallengeError(url);

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.body;

  const res = await raw(url, { accept });
  const body = await res.text();
  if (isChallenge(res.status, body)) {
    if (live) liveBlocked = true;
    throw new ChallengeError(url);
  }
  if (!res.ok) throw new HttpError(url, res.status);
  cache.set(url, { at: Date.now(), body });
  return body;
}

export async function getJson(path, opts = {}) {
  const body = await getText(path, { ...opts, accept: "application/json" });
  return JSON.parse(body);
}

/** HEAD no CDN: true se o arquivo existe (sem baixar). */
export async function getBinaryHead(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, signal: ctrl.signal });
    return res.ok;
  } finally {
    clearTimeout(t);
  }
}

/** Baixa binário (CDN não tem desafio). Retorna Buffer ou null se 404. */
export async function getBinary(url) {
  const res = await raw(url, { timeout: 120000 });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(url, res.status);
  return Buffer.from(await res.arrayBuffer());
}
