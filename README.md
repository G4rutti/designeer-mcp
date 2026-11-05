<div align="center">

# designeer-mcp

**O catálogo do [Designeer](https://designeer.xyz) direto no teu Claude.**
Busca referência, puxa a paleta em hex, assiste o motion frame a frame e copia componente como HTML + CSS, sem sair da conversa.

[![MCP](https://img.shields.io/badge/MCP-server-1f1f1f?style=flat-square)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-b5b5b5?style=flat-square)](LICENSE)

</div>

---

O Designeer é o catálogo curado do Dhruv Jaradi: galerias de inspiração, componentes, fontes, ferramentas, portfolios e os **finds**, trabalhos de motion e interface garimpados do X. Esse servidor MCP transforma tudo isso em ferramentas que o Claude (ou qualquer cliente MCP) chama sozinho.

Ele usa só o que o [`ai.txt`](https://designeer.xyz/ai.txt) do site libera pra IA: `/api/catalog`, as páginas `.md` e os arquivos estáticos. Não mexe em favoritos, pastas nem login.

## Como fica na prática

Tu manda um link de find:

> o que é isso? https://designeer.xyz/finds/andreaskruszaki-2115308820687950002

E o Claude responde com o que o `designeer_get` e o `designeer_media` trouxeram:

```jsonc
{
  "title": "Motion by Andreas Kruszakin-Liboska: it's just…",
  "summary": "it's just matcha...",
  "fields": {
    "handle": "@andreaskruszaki",
    "types": "Motion",
    "posted": "2026-10-28"
  },
  "colours": ["#E9EDEA", "#02541C", "#177A35", "#379953", "#6C8A75"],
  "related": [ /* 8 finds parecidos */ ]
}
```

Junto vêm o still do vídeo e, com `frames: 4`, a sequência do movimento como imagem, então o Claude **vê** a animação e consegue explicar ou recriar a técnica.

## Tools

| Tool | O que faz |
|---|---|
| `designeer_search` | Busca no catálogo inteiro, com filtro opcional por coleção |
| `designeer_browse` | Lista uma coleção na ordem curada, com categoria e paginação |
| `designeer_get` | Detalhes de um listing ou find: site, categoria, preço, **paleta em hex**, criador, post original, relacionados |
| `designeer_finds` | Últimos finds, com filtro por texto |
| `designeer_media` | Imagens em alta e still de vídeo, devolvidas pro Claude **ver**. Com `frames > 0` + ffmpeg, extrai frames do motion |
| `designeer_capture` | Abre **qualquer URL** no teu Chrome/Edge, tira print da página inteira e lê como ela é feita: cores, fontes, escala, raios, sombras, CSS vars, seções, grids e a receita de botões, cards, inputs e badges |
| `designeer_component` | **Copia um componente ou seção como código**: HTML + CSS limpos, print do original e uma prévia `.html` standalone. Acha por seletor ou por texto + tipo (`text: "Pro", kind: "card"`) |
| `designeer_status` | Diz se está em modo live ou offline e quantos itens tem no índice |

**Nada fica salvo por padrão.** Prints e imagens vão direto pro Claude. Vídeo, que precisa de arquivo pro ffmpeg, vai pra uma pasta temporária apagada no fim. Pra guardar, peça com `save: true`, que salva em `~/designeer-media`.

## Instalar

Requer **Node 18+** e **Chrome ou Edge** instalado (pro `designeer_capture`). O ffmpeg é opcional, só pra extrair frames de motion.

```bash
git clone https://github.com/G4rutti/designeer-mcp.git
cd designeer-mcp
npm install
npm run check   # testa tudo e mostra se tá live ou offline
```

### Claude Code

```bash
claude mcp add designeer --scope user -- node "/caminho/para/designeer-mcp/src/server.js"
```

### Claude Desktop

Em `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "designeer": {
      "command": "node",
      "args": ["/caminho/para/designeer-mcp/src/server.js"]
    }
  }
}
```

No Windows, use `/` ou `\\` no caminho. Reinicie o Desktop depois de salvar.

### Variáveis opcionais

| Variável | Pra quê |
|---|---|
| `DESIGNEER_OFFLINE=1` | Força o modo offline |
| `DESIGNEER_CACHE_DIR` | Muda a pasta do cache do índice |
| `DESIGNEER_MEDIA_DIR` | Muda onde prints e mídias são salvos (padrão `~/designeer-media`) |
| `DESIGNEER_UA` | Troca o User-Agent |

## Live × offline

O site fica atrás do Cloudflare, e os endpoints dinâmicos (API e `.md`) mostram desafio pra IP de datacenter ou VPN. Por isso o servidor tem dois modos:

- **live**: API + markdown completos. É o que roda na tua máquina com internet de casa.
- **offline**: quando o Cloudflare barra, ele cai sozinho num índice montado do `sitemap.xml` + `llms-full.txt`, que são estáticos e sempre passam. Tem todas as URLs e finds, mas nome e tagline só de parte deles, sem paleta nem site. Fica em cache em `~/.cache/designeer-mcp` por 12h.

A mídia vem do `cdn.designeer.xyz`, que não tem desafio. `designeer_media` em finds funciona até offline; em listings precisa do live.

## Da referência ao código

O Designeer não guarda o design dos sites, ele **aponta** pra eles. O fluxo que funciona pra motion, print estático e tela de produto:

1. **Achar**: `designeer_search "dashboard"`, `designeer_browse inspiration` ou `designeer_finds`
2. **Ler**: `designeer_get` devolve o site oficial e a paleta em hex
3. **Ver**: `designeer_media` pra finds (com `frames: 4` no motion), `designeer_capture` pra um site ou tela específica
4. **Copiar**: o `capture` lista componentes com seletor; passa um deles pro `designeer_component` e recebe HTML + CSS

O que a cópia não pega: `:hover`/`:focus`, animações e `::before`/`::after`. Use como base: troque cores e fontes pelos tokens do teu projeto e não reaproveite logo, imagem ou texto do autor. Página atrás de login (Mobbin logado, por exemplo) não funciona.

## Atribuição

Os trabalhos são de quem fez. Toda resposta traz o lembrete do `ai.txt`: citar o Designeer com link pra página canônica e creditar o criador como a página nomeia. Use como **referência**, não como cópia.

## Licença

[MIT](LICENSE) © 2026 Davi Garutti Diniz. Projeto independente, sem vínculo com o Designeer.
