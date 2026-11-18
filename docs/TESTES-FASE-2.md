# Testes da Fase 2 — Chess-Analysis

**Data:** 17/11/2026  
**Escopo:** Tarefa 1 — atualização do motor para o Stockfish 19 (lite single)  
**Ambiente:** Windows, Node v26.13.1, Edge headless 157.0.4341.60 (CDP 9333),
servidor local `127.0.0.1:8765`

> Todos os números abaixo vieram de execução real nesta máquina. Nada foi
> estimado. O que não foi executado está marcado como **não executado**.

---

## 1. Integridade dos arquivos

Origem: release oficial `nmrugg/stockfish.js` **v19.0.1** (publicado em
10/10/2026).

| Arquivo | Tamanho | SHA-256 esperado | SHA-256 obtido | Resultado |
|---|---|---|---|---|
| `stockfish-19-lite-single.js` | 28.230 B | `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a` | idêntico | **Verificado** |
| `stockfish-19-lite-single.wasm` | 1.845.971 B | `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de` | idêntico | **Verificado** |

O hash foi conferido duas vezes: no download e depois de copiar para
`vendor/stockfish/`.

## 2. Arquivos do motor

| Arquivo | Situação |
|---|---|
| `stockfish.js` | **removido** |
| `stockfish.wasm` | **removido** |
| `stockfish.asm.js` | **removido** (nunca era referenciado) |
| `stockfish-19-lite-single.js` | **adicionado** |
| `stockfish-19-lite-single.wasm` | **adicionado** |
| `LICENSE-GPLv3.txt` | mantido |

MIME local conferido por `curl -I`:

```text
/vendor/stockfish/stockfish-19-lite-single.wasm  → 200, Content-Type: application/wasm
/vendor/stockfish/stockfish-19-lite-single.js    → 200, Content-Type: text/javascript; charset=utf-8
```

## 3. Verificações estáticas

```text
node tools/check-syntax.cjs
Tudo certo: sintaxe e JSON válidos.

npm test
tests 16 · pass 16 · fail 0
```

> Medição da Tarefa 1, antes da correção do `depth 0`. Depois da correção e
> dos novos testes, a suíte passou a ter **30 testes, 30 aprovados** (§11).

Novo teste adicionado: `motor atualizado para o Stockfish 19 lite single com
WDL capturado` — confere o nome do Worker, o `UCI_ShowWDL`, a existência de
`parseWdl`, a ausência do caminho antigo, a curva `0.00368208` (interface
inalterada) e o tamanho dos dois arquivos vendorizados.

## 4. Smoke real — análise completa

> **Medição original, anterior à correção do `depth 0`.** Precisão, ACPL e a
> explicação de 33/34 estavam contaminados; os valores válidos estão no §11.
> O restante da tabela (motor, versão, WDL, tempos, PDF) continua válido.

Partida: Morphy × Duke Karl/Count Isouard, 33 lances, profundidade 6.

| Item | Resultado |
|---|---|
| `id name` do motor | `Stockfish 19 Lite WASM` |
| Rótulo gravado | `Stockfish 19 Lite WASM` |
| `engineId` gravado | `Stockfish 19 Lite WASM` |
| `version` | `2` (inalterada de propósito) |
| Posições avaliadas | 34 |
| Posições com `wdl` | 33 |
| `wdl` válido (0–1000, soma 1000) | **sim** |
| Exemplo de `wdl` | `{ w: 8, d: 948, l: 44 }` |
| `winPctWhite` ainda na curva sobre cp | **sim** (comparação exata, tolerância 1e-6) |
| Precisão | 84,1% (brancas) / 83,3% (pretas) — valor original; ver §11 |
| ACPL | 134 / 121 — valor original; ver §11 |
| Momentos-chave | 3 |
| Barra de avaliação | `51.5644%` |
| Gráfico SVG | presente |
| Lances com anotação | 33 |
| PDF | `Relatório` presente, `Stockfish` presente, 10.124 caracteres |
| Tempo total da análise | 418 ms |
| Erros de console | **0** |
| Exceções | **0** |

**Por que 33 de 34:** a última posição é terminal (mate) e o motor não envia
trio WDL nela — nem antes nem depois da correção. O que estava errado era
tratar `depth 0` como “posição inválida” e descartar a linha: com isso a
posição final ficava sem avaliação, `winPctWhite` caía de 100 para 50 e o lance
de mate era classificado como perda total. Agora a terminalidade é confirmada
pela chess.js (`terminalResult`) e o `mate: 0` é preservado (§11).

## 5. Comportamento bruto do motor (Worker isolado)

Teste direto, sem passar pelo `Engine`, para medir handshake e `stop`:

| Medida | Resultado |
|---|---|
| `uci` → `uciok` | 162 ms |
| `isready` → `readyok` | 40 ms |
| `go infinite` → `info depth 3` | 54 ms |
| Opção `UCI_ShowWDL` listada | **sim** |
| Linha `wdl` observada | **sim** |
| `stop` → `bestmove` | **47 ms** |

Prova bruta do que o `depth 0` significa (Worker isolado, aquecido,
profundidade 12):

| Posição | Linhas `info` | `bestmove` |
|---|---|---|
| Início | 12 linhas, até `depth 12 score cp 31 wdl 61 934 5` | `e2e4 ponder c7c5` |
| Mate (brancas já em mate) | 1 linha: `info depth 0 score mate 0` | `(none)` |
| Afogamento | 1 linha: `info depth 0 score cp 0` | `(none)` |
| FEN inválida | 1 linha: `info depth 0 score cp 0` | `(none)` |

**Conclusão:** `depth 0` é a resposta do SF19 tanto para posição terminal
quanto para FEN inválida. Sozinho, ele não identifica nada — por isso a
correção usa `chess.js` antes de concluir (§11).

**Conclusão do cancelamento:** neste build single-thread, `stop` interrompe a
busca. O `terminate()` do `Engine.stop()` continua no código como fallback de
cancelamento e não foi necessário para o `stop` funcionar.

## 6. Cancelamento e recuperação

| Passo | Resultado |
|---|---|
| Análise em profundidade 20 iniciada | sim |
| Clique em “Cancelar” | 5 ms até `State.analysisRun === null` |
| Botão “Analisar” reabilitado | sim |
| Barra de progresso oculta | sim |
| Estado limpo | sim |
| Nova análise depois do cancelamento | concluída em profundidade 5, 34 posições, 33 com WDL |

## 7. Responsividade da interface durante a busca

Medição de intervalos de `requestAnimationFrame` durante a análise:

| Métrica | Valor |
|---|---|
| Amostras | 24 |
| p50 | 17 ms |
| p95 | 17 ms |
| Máximo | 17 ms |

Ou seja: a busca não bloqueou a thread principal (o Worker cumpriu o papel).

## 8. Análise mais profunda (profundidade 12)

Reanálise feita **depois** da correção do `depth 0`, mesma partida:

| Item | Resultado |
|---|---|
| Tempo total | 2.115 ms |
| Profundidade máxima observada | 12 |
| Posições | 34 |
| Posições com WDL | 33 (a terminal não tem WDL) |
| Soma do WDL sempre 1000 | sim |
| Precisão | **93,0% / 82,9%** (antes: 88,2% / 84,4%) |
| ACPL | **40 / 120** (antes: 122 / 117) |
| Barra no início | `52,7588%` (inalterada — posição inicial não é terminal) |
| Barra no lance final | **100%** (antes: 50%) |
| Gráfico | presente (SVG, 34 posições) |
| Erros de console | 0 |

A precisão/ACPL das brancas melhorou porque o lance final `Rd8#` deixou de ser
contado como perda de 1400 cp. Os valores das pretas variam de forma indireta
(elas jogaram o lance anterior, cuja posição seguinte agora está correta).

## 9. O que esta tarefa não fez

- **Não** usou o WDL no cálculo: `winPctWhite`, precisão, ACPL, anotações,
  gráfico e relatório continuam exatamente como antes (curva sobre cp).
- **Não** gravou `version: 3`.
- **Não** resolveu a proveniência das análises antigas (SF10 × SF19). A chave
  `gameId@depth` não identifica o motor; isso é **bloqueador de deploy** e
  requisito da Tarefa 2 (§12.5).
- **Não** publicou em produção: o deploy continua manual e **não executado**
  nesta etapa. Por isso os testes de MIME e de análise no domínio público
  seguem **não executados**.
- **Não** testou Firefox/Safari manualmente.
- **Não** removeu as variáveis antigas da Vercel (fora do escopo).

## 10. Arquivos alterados nesta tarefa

| Arquivo | Mudança |
|---|---|
| `js/engine.js` | Worker novo, `id name`, `UCI_ShowWDL`, `parseWdl`, `wdl` em `evaluate`, rótulo/`engineId` na análise |
| `vendor/stockfish/*` | 3 arquivos removidos, 2 adicionados |
| `tests/static.test.mjs` | nova asserção do motor |
| `docs/*` | este relatório e atualizações de estado |

---

## 11. Correção do defeito terminal (`depth 0`) — 17/11/2026

### 11.1. O que mudou

`js/engine.js` passou a decidir terminalidade **antes** de consultar o motor:

- `terminalResult(fen)` valida a FEN com a chess.js (`validate_fen`), exige
  exatamente um rei de cada lado e classifica:
  - `in_checkmate()` → `{ cp: null, mate: 0, wdl: null, depth: 0, best: null, pv: [] }`;
  - `in_stalemate()` ou `insufficient_material()` → `{ cp: 0, mate: null, ... }`;
  - qualquer outra coisa (inclusive FEN inválida) → `null`.
- `evaluate(fen, …)` devolve o resultado terminal sem chamar o Worker.
- `usableInfo(info, terminal)` só aceita `depth 0` vindo do motor quando a
  terminalidade já foi confirmada. `depth 0` isolado continua descartado.
- `mate: 0` é preservado; `whiteWinPct` usa esse valor com a paridade correta
  (100% quando as brancas deram mate, 0% quando apanharam).
- WDL continua cru: `null` na posição terminal, sem invenção.
- Curva de cp (`0.00368208`), limiares, anotações, gráfico e barra não mudaram.

Nenhuma dependência nova: a chess.js já era vendorizada em `vendor/chess.js`,
carregada antes de `js/engine.js` no `index.html`. O `package.json` continua
sem dependências e **nada da chess.js entra nas Functions da Vercel** — a
validação é 100% no navegador.

### 11.2. Testes automatizados novos

Comando:

```text
node --test tests/engine.test.mjs
tests 7 · pass 7 · fail 0
```

Casos cobertos:

| Caso | Resultado |
|---|---|
| Mate com brancas vencedoras (Opera Game, final `Rd8#`) | `mate: 0`, `winPctWhite` 100 |
| Mate com pretas vencedoras (mate do louco, `Qh4#`) | `mate: 0`, `winPctWhite` 0 |
| Afogamento (`7k/5Q2/6K1/...`) | `cp: 0`, `mate: null`, 50% |
| FEN inválida (texto e tabuleiro sem reis) | `null`, sem avaliação inventada |
| `depth 0` sem terminal confirmado | descartado (`usableInfo` falso) |
| `depth 0` com terminal confirmado | aceito |
| `Rd8#` em `buildAnalysis` | `loss 0`, `cpLoss 0`, `missed false`, `best`, ACPL 0, precisão 100 |

### 11.3. Suíte completa e sintaxe

```text
node tools/check-syntax.cjs
Tudo certo: sintaxe e JSON válidos.

npm test
tests 30 · pass 30 · fail 0
```

### 11.4. Reanálise real (profundidade 12, via interface)

| Campo | Resultado |
|---|---|
| Posições | 34 |
| Posições com WDL | 33 |
| Penúltima posição | `{ cp: null, mate: 1, wdl: { w: 1000, d: 0, l: 0 }, depth: 12, best: "d1d8" }` |
| Última posição | `{ cp: null, mate: 0, wdl: null, depth: 0, best: null, pv: [] }` |
| `winPctWhite` final | `[100, 100, 100, 100]` |
| Lance final | `loss: 0`, `cpLoss: 0`, `missed: false`, `isBest: true`, `★ Melhor` |
| ACPL | **40 / 120** |
| Precisão | **93,0% / 82,9%** |
| Momentos-chave recentes | nenhum |
| Tempo | 2.115 ms |
| Erros de console | 0 |

Interface no lance final: barra `height: 100%`, legenda `#`, gráfico SVG
presente (34 pontos), lista de lances com `Rd8#`. Nenhuma mudança visual para
as análises v2 já salvas: a validação é silenciosa.

### 11.5. Arquivos desta correção

| Arquivo | Mudança |
|---|---|
| `js/engine.js` | `terminalResult`, `usableInfo`, curto-circuito em `evaluate`, guarda de `depth 0` |
| `tests/engine.test.mjs` | **novo** — 7 testes de terminalidade e do lance de mate |
| `docs/TESTES-FASE-2.md` | correção das conclusões e valores contaminados |

---

## 12. Integração Groq, consentimento e limites — 17/11/2026

### 12.1. Configuração oficial

| Item | Valor |
|---|---|
| Provedor | Groq |
| Base | `https://api.groq.com/openai/v1` |
| Modelo | `openai/gpt-oss-120b` |
| Chave | somente no servidor (`AI_API_KEY`) |
| Teto de saída | `AI_MAX_TOKENS`, padrão 4096, faixa 256–32768 |

A produção já respondia com esse provedor/modelo em `/api/tags` antes desta
correção; o que estava errado era o repositório (`.env.example`, textos,
testes e docs).

### 12.2. Chamada real única (produção)

Mensagem fictícia, sem dados pessoais ou PGN. Executada em **produção**
(`https://chessanalysis-murex.vercel.app/api/chat`), validando o deploy atual,
não as alterações locais ainda não publicadas.

| Verificação | Resultado |
|---|---|
| HTTP | **200** |
| `Content-Type` | `application/x-ndjson; charset=utf-8` |
| Streaming | `{"message":{"content":"OK"},"done":false}` → `{"done":true}` |
| Encerramento | `done: true`, 81 bytes |
| Cota | `X-AI-Quota-Used: 1` / `X-AI-Quota-Limit: 20` |
| Tempo | 569 ms |

Uma primeira tentativa devolveu HTTP 400 porque o arquivo de corpo foi gravado
com BOM; o proxy recusou antes da cota e **não houve chamada ao provedor**. A
segunda tentativa (sem BOM) é a chamada real registrada acima.

### 12.3. Consentimento

| Verificação | Resultado |
|---|---|
| Consentimento antigo (`2026-11-16-v1`) | `hasConsent() === false` |
| Modal aberto | sim, título “Autorizar envio à IA externa?” |
| Provedor exibido | `api.groq.com` |
| Modelo exibido | `openai/gpt-oss-120b` |
| Link | `https://groq.com/privacy-policy` |
| Botão “Não enviar” | presente |
| Após autorizar | `consentVersion = 2026-11-17-v2`, provedor `api.groq.com` |
| “Não enviar dados à IA” | `ensureConsent()` rejeita com `privacy_blocked` |

Correção associada: `providerInfo()` lia `window.State`, mas `State` é um
`const` de `app.js`; por isso o modal sempre mostrava “provedor externo”. Agora
lê `State.ai` e exibe provedor/modelo reais.

### 12.4. Tokens e logs

- `max_completion_tokens` é enviado **somente** pelo servidor, a partir de
  `AI_MAX_TOKENS`/`AI_FALLBACK_MAX_TOKENS`; valores do navegador são ignorados.
- Valores fora da faixa são limitados a 256–32768; inválidos caem no padrão.
- O log de falha de cota passou a ser fixo (`Falha na cota: seguindo sem cota
  rígida.`), sem `error.message`, para não carregar URL/chave do ambiente.

### 12.5. Bloqueador de deploy (proveniência) — **resolvido na Tarefa 2**

A chave `gameId@depth` não identificava o motor: `getAnalysis` escolhia a maior
profundidade de qualquer build, `enrichAnalysis` podia carimbar o `engineId`
atual e resumos/estatísticas misturavam motores. A Tarefa 2 resolveu os seis
pontos em conjunto — identidade do build, chave `gameId@depth@build`,
preservação de metadados, recuperação com aviso, consistência das médias e
migração segura. Evidências na §13. O deploy não foi executado.

---

## 13. Tarefa 2 — proveniência, migração e WDL no cálculo — 17/11/2026

### 13.1. O que mudou

| Arquivo | Mudança |
|---|---|
| `js/engine.js` | `BUILD_ID`/`BUILD_LABEL`/`LEGACY_BUILD_ID`; `buildOf`, `isLegacyAnalysis`, `isTerminalPosition`, `validWdl`, `wdlWinPct`, `wdlCoverage`; `whiteWinPct(position, index, source)`; `buildAnalysis(..., meta)` grava `version: 3` + proveniência; `enrichAnalysis` não promove histórico |
| `js/storage.js` | `analysisKey(gameId, depth, build)`; `getAnalysis(gameId, build)` prefere o build atual; `getAnalyses(gameId)`; `saveAnalysis` preserva `key` existente |
| `js/app.js` | `migrateAnalysisProvenance(force)` antes de `migrateAnalysisData`; marcador `analysisProvenanceMigration` |
| `js/game.js` | aviso `analysisEngineNote` + botão “Reanalisar com o novo motor”; aviso na aba Análise; `scoreSource` na barra; grava `analyzedBuild` |
| `index.html` / `style.css` | bloco do aviso de proveniência |
| `js/report.js` | nota de motor antigo no PDF |
| `js/settings.js` | lote considera `analyzedBuild !== Engine.BUILD_ID` |
| `js/stats.js` / `js/analytics.js` | médias de precisão/ACPL excluem outro build; `stats.otherEngine` e nota na interface |
| `js/pgn.js` | `analyzedBuild: null` no metadado novo |
| `tests/wdl.test.mjs` | 8 testes de WDL, v3, fallback, `buildOf`, enriquecimento |
| `tests/storage.test.mjs` | 4 testes de chave e não colisão |

### 13.2. Suíte completa e sintaxe

```text
node tools/check-syntax.cjs
→ 16 arquivos js ok, 1 worker ok, 3 api ok, 5 JSON ok
→ Tudo certo: sintaxe e JSON válidos.

npm test
→ tests 42 | suites 0 | pass 42 | fail 0 | cancelled 0 | skipped 0
```

Os 12 testes novos cobrem:

- chave legada `g_1@12` idêntica e chave nova `g_1@12@stockfish-19-lite-single`;
- SF10, SF19 e outra profundidade sem colisão;
- `wdlWinPct` = 75 e 35 em exemplos controlados; perspectiva de brancas
  75 e 65;
- WDL inválido (soma 950/1001, negativo, não inteiro) descartado sem correção;
- posição terminal isenta de WDL, com `mate` prioritário;
- `buildAnalysis` com WDL → `version: 3`, `scoreSource: 'wdl'`, perda 10,
  anotação `mistake`;
- sem WDL completo → análise inteira em `version: 2`/`cp` (50/50);
- `buildOf` reconhece SF19, SF10 e desconhecido;
- `isLegacyAnalysis` distingue o build atual;
- enriquecimento preserva `key`, `version`, `engine`, `engineId`, `engineBuild`
  e a fonte original (`cp`).

### 13.3. Smoke real com IndexedDB (Edge headless)

Harness CDP: analisa de verdade a Opera Game com o SF19 (profundidade 12),
clona o resultado como um registro legado do SF10 na chave `g_mig_task2@12`,
recarrega a página para a migração de inicialização rodar, confere o aviso,
reanalisa pela interface e verifica que o registro antigo continua intacto.

**Análise SF19 de origem (real, não simulada):**

```json
{ "key": "g_6f68937a_33@12@stockfish-19-lite-single", "version": 3,
  "engine": "Stockfish 19 Lite WASM", "engineBuild": "stockfish-19-lite-single",
  "scoreSource": "wdl", "positions": 34, "wdlPositions": 33,
  "firstWdl": { "w": 61, "d": 934, "l": 5 },
  "firstWinPct": 52.8, "firstCp": 31,
  "acpl": { "w": 40, "b": 120 }, "accuracy": { "w": 96.8, "b": 88.2 } }
```

O primeiro lance tem `cp 31` e `win% 52.8`; a curva logística sobre `cp 31`
daria ~52,6%, então os dois caminhos coincidem aqui. O que prova a fonte é o
`scoreSource: "wdl"` e a `wdlCoverage` abaixo.

**Registro legado inserido (chave antiga, sem `engineBuild`, sem WDL):**

```json
{ "key": "g_mig_task2@12", "version": 2, "engine": "Stockfish 10 (WASM)",
  "createdAt": 1794882647971, "positions": 34, "firstWdl": null }
```

**Depois da migração de inicialização:**

```json
{ "marker": 1, "records": 1, "keys": ["g_mig_task2@12"],
  "legacy": { "key": "g_mig_task2@12", "engineBuild": "stockfish-10-legacy",
              "engine": "Stockfish 10 (WASM)", "version": 2,
              "createdAt": 1794882647971, "positions": 34, "firstWdl": null },
  "game": { "analyzedDepth": 12, "analyzedBuild": "stockfish-10-legacy",
            "summaryBuild": "stockfish-10-legacy" },
  "otherEngineInStats": 1 }
```

A chave **não** mudou, `version`, `createdAt` e posições **não** foram tocados;
só `engineBuild` foi carimbado. A análise antiga não entrou nas médias de
precisão (`otherEngine === 1`) e o resumo da partida recebeu o mesmo build.

**Interface antes da reanálise:**

```json
{ "analysisKey": "g_mig_task2@12", "isLegacy": true, "noteVisible": true,
  "noteText": "Análise feita com motor antigo (Stockfish 10). O resultado original foi preservado. Reanalisar com o novo motor",
  "reanalyzeButton": true,
  "barHeight": "100%", "graph": true }
```

O aviso aparece no cabeçalho, o botão de reanálise existe e a aba Análise
mostra o texto explicativo. A análise antiga continua **navegável**: barra e
gráfico renderizam.

**Depois de “Reanalisar com o novo motor” (2.113 ms, profundidade 12):**

```json
{ "records": 2,
  "keys": ["g_mig_task2@12@stockfish-19-lite-single", "g_mig_task2@12"],
  "legacyPreserved": { "key": "g_mig_task2@12",
      "engineBuild": "stockfish-10-legacy", "version": 2,
      "createdAt": 1794882647971, "positions": 34, "firstWdl": null },
  "current": { "key": "g_mig_task2@12@stockfish-19-lite-single", "version": 3,
      "scoreSource": "wdl", "engineBuild": "stockfish-19-lite-single",
      "positions": 34, "wdlPositions": 33,
      "wdlCoverage": { "complete": true, "evaluated": 33, "present": 33,
                       "missing": 0, "invalid": 0 },
      "acpl": { "w": 40, "b": 120 },
      "accuracy": { "w": 96.8, "b": 88.2 } },
  "noteVisible": false, "analysisTabHintHidden": true, "barHeight": "100%" }
```

Provas centrais:

1. **Não sobrescreveu:** coexistem dois registros; o legado mantém
   `createdAt`, `version` e as 34 posições originais.
2. **WDL no cálculo:** a análise nova é `version: 3`, `scoreSource: "wdl"`,
   com `wdlCoverage.complete: true` (33 posições avaliadas, 33 com WDL, 1
   terminal isenta).
3. **UI coerente:** o aviso desaparece e a aba volta ao texto normal.
4. **Terminalidade preservada:** o último lance `Rd8#` fica com `loss: 0`,
   `cpLoss: 0` e anotação `best`.

**Limpeza e console:** `remaining: 0` após `DB.deleteGame('g_mig_task2')`;
`consoleErrors: []` durante todo o fluxo.

### 13.4. O que não foi feito

- **10 categorias:** **deferidas para a Fase 2.5/5** por decisão de 17/11/2026.
  “Grande Lance” exige MultiPV 2 (hoje `MultiPV=1`), “Livro” exige integração
  com o banco de aberturas (ECO) e “Bom” depende da revisão dos limiares da
  §10.11 do Prompt Mestre, que não existe no workspace. Nenhum limiar foi
  inventado; as **7 categorias atuais estão aprovadas** e já consomem o
  Expected Score por WDL.
- **Deploy e push:** não executados. O working tree está pronto para revisão.
- **Backup real da biblioteca:** depende de exportar/restaurar o JSON no
  navegador com as partidas reais; o smoke usa uma partida sintética removida
  ao final.
- **Groq local:** impossível ponta a ponta com a chave placebo do `.env` local.

### 13.5. Arquivos alterados nesta tarefa

Código: `js/engine.js`, `js/storage.js`, `js/app.js`, `js/game.js`,
`js/report.js`, `js/settings.js`, `js/stats.js`, `js/analytics.js`, `js/pgn.js`,
`index.html`, `style.css`.
Testes: `tests/wdl.test.mjs`, `tests/storage.test.mjs`.
Documentação: `docs/MODELO-DE-DADOS.md`, `docs/PLANO-FASE-2.md`,
`docs/ARQUITETURA-INTEGRACAO.md`, `docs/TESTES-FASE-2.md`.

