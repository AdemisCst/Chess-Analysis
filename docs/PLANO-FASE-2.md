# Plano da Fase 2 — Chess-Analysis

**Data:** 17/11/2026  
**Estado:** Tarefa 1 **executada e verificada**; Tarefa 2 **implementada,
verificada localmente e aprovada** (7 categorias validadas; 3 categorias
deferidas para a Fase 2.5/5); Tarefas 3-4 **não iniciadas**  
**Base:** diagnóstico da [§12 de `AUDITORIA-INICIAL.md`](AUDITORIA-INICIAL.md) e
contrato da [versão 3 em `MODELO-DE-DADOS.md`](MODELO-DE-DADOS.md)

> Nada aqui é declarado implementado antes de execução real com evidência em
> [`docs/TESTES-FASE-2.md`](TESTES-FASE-2.md).

---

## 1. Tarefa 1 — atualizar o Stockfish para o Stockfish 19

### 1.1. Diagnóstico que motiva a troca

| Item | Estado atual |
|---|---|
| Build | Stockfish 10 (nmrugg), compilado em 02/08/2019 |
| Execução | Web Worker single-thread |
| WDL | inexistente: só `score cp` / `score mate` |
| Win% | curva logística sobre cp, calculada no navegador |
| Rótulo | “Stockfish 10 (WASM)” — correto, mas desatualizado |

### 1.2. Build escolhido

Release oficial **`nmrugg/stockfish.js` v19.0.1** (10/10/2026). Arquivos
publicados nesse release:

| Sabor | Arquivos | Tamanho aproximado | Threads | COOP/COEP |
|---|---|---|---|---|
| Full | `stockfish-19.js` + `stockfish-19.wasm` | ~94 MB | sim | sim |
| Full single | `stockfish-19-single.js` + `stockfish-19-single.wasm` | 99.169.054 B (wasm) | não | não |
| Lite | `stockfish-19-lite.js` + `stockfish-19-lite.wasm` | ~1,7 MB | sim | sim |
| **Lite single** | **`stockfish-19-lite-single.js` + `stockfish-19-lite-single.wasm`** | **28.230 B + 1.845.971 B** | não | não |
| ASM | `stockfish-19-asm.js` | 3.155.627 B | não | não |

**Escolha:** `stockfish-19-lite-single`.

- `vercel.json` não envia `Cross-Origin-Opener-Policy` nem
  `Cross-Origin-Embedder-Policy`, então build com threads não roda.
- O README oficial recomenda o lite single por tamanho e simplicidade.
- 1,85 MB é compatível com celular; 99 MB não é.
- O lite é mais fraco que o full, mas continua acima de qualquer humano em
  profundidade 12–16.

### 1.3. Arquivos

**Remover de `vendor/stockfish/`:**

- `stockfish.js`
- `stockfish.wasm`
- `stockfish.asm.js` (nunca referenciado; peso morto)

**Adicionar:**

- `stockfish-19-lite-single.js`
- `stockfish-19-lite-single.wasm` (precisa ficar ao lado do `.js`)

**Manter:**

- `LICENSE-GPLv3.txt`

Nomes novos são obrigatórios: `/vendor/(.*)` usa `Cache-Control: immutable` por
um ano (`vercel.json`), e sobrescrever o nome antigo serviria o binário de 2019
para quem já visitou o site.

### 1.4. Integridade dos downloads

SHA-256 publicados no release:

```text
stockfish-19-lite-single.js    ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a
stockfish-19-lite-single.wasm  ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de
```

Se qualquer hash divergir, a tarefa para e o usuário é avisado.

### 1.5. Alterações em `js/engine.js` (Tarefa 1)

Escopo desta tarefa: **trocar o motor e capturar WDL como dado bruto**, sem
alterar nenhum número exibido na interface.

| Ponto | Alteração |
|---|---|
| `WORKER_URL` (linha 25) | passa a apontar para `vendor/stockfish/stockfish-19-lite-single.js` |
| `init()` (105-157) | capturar `id name` do handshake em `engineId` e enviar `setoption name UCI_ShowWDL value true` antes do `isready` |
| `parseInfo()` (66-78) | capturar `wdl <w> <d> <l>` de forma opcional, validando 0–1000 e soma 1000; regex de `score`/`pv` intocadas |
| `onLine()` (80-103) | aceitar apenas `depth > 0`; guardar `wdl` junto da mesma linha que atualizou `cp`/`mate` |
| `evaluate()` (159-211) | devolver `wdl` (`{w,d,l}` ou `null`) nos dois caminhos, inclusive no timeout de 45 s |
| `buildAnalysis()` (358-537) | manter `version: 2`; gravar `engineId` e o rótulo derivado do handshake |
| `whiteWinPct()` (257-267) | **não muda nesta tarefa** — a interface continua usando a curva sobre cp |
| `stop()` (213-221) | mantém `terminate()`; comportamento de `stop` no build single-thread será medido e documentado |

### 1.6. WDL nesta tarefa

- Habilitado no motor e capturado em `positions[i].wdl`.
- **Não usado** para win%, precisão, ACPL, cores ou relatório.
- `version: 3` (win% derivado do WDL) fica para a tarefa de classificação.
- Se o motor não devolver WDL, o campo fica ausente e tudo funciona como hoje.

### 1.7. Plano de teste

1. `node tools/check-syntax.cjs`.
2. `npm test` com novas asserções estáticas.
3. Smoke via CDP/Edge headless: analisar partida de exemplo, conferir barra,
   gráfico, seta, persistência e ausência de erro de console.
4. WDL: conferir presença, tipos, soma 1000 e que a UI não mudou.
5. Cancelamento: iniciar busca longa, cancelar, verificar recuperação e nova
   análise.
6. Responsividade: medir atraso de `requestAnimationFrame` durante a busca.
7. Distribuição: `Content-Type: application/wasm` local e em produção.

### 1.8. Critério de aceite

- Análise completa sem erro de console.
- `wdl` válido quando presente; ausência não quebra nada.
- Barra de avaliação, gráfico, lista, tags e PDF idênticos em comportamento.
- Cancelamento recupera o app.
- Tempos de inicialização e busca registrados.

### 1.9. Rollback

Reverter o commit devolve os três arquivos de 2019. Como os nomes novos não
colidem com cache, não há estado preso no navegador.

### 1.10. Estado da execução (17/11/2026)

| Etapa | Estado | Evidência |
|---|---|---|
| Download e SHA-256 | **Verificado** | hashes idênticos ao release |
| Substituição em `vendor/` | **Verificado** | 3 removidos, 2 adicionados |
| `js/engine.js` (Worker, WDL, `engineId`) | **Verificado** | smoke real com análise completa |
| Terminalidade (`depth 0`, mate/afogamento) | **Verificado** | `mate: 0`, `winPctWhite` 100, `Rd8#` sem perda |
| Interface inalterada | **Verificado** | `winPctWhite` na curva, barra/gráfico/PDF |
| `stop` no build single-thread | **Verificado** | `bestmove` em 47 ms |
| Cancelamento e recuperação | **Verificado** | 5 ms; nova análise concluída |
| Profundidade 12 (após correção) | **Verificado** | 2.115 ms, 34 posições, ACPL 40/120 |
| Groq em produção | **Verificado** | `/api/tags` + uma chamada fictícia de `/api/chat` |
| Consentimento v2 | **Verificado** | versão antiga reabre o modal; “Não enviar” bloqueia |
| Produção das correções locais | **Não executado** | Tarefa 2 resolvida localmente; deploy aguarda revisão e autorização |

Detalhes em [`docs/TESTES-FASE-2.md`](TESTES-FASE-2.md).

---

## 2. Tarefas seguintes da Fase 2

| # | Tarefa | Estado |
|---|---|---|
| 2 | Proveniência das análises + WDL no cálculo (versão 3) | **Aprovada**; 3 categorias deferidas para a Fase 2.5/5 |
| 3 | Central de Análises com fila e checkpoints | Não iniciada (depende da Tarefa 2) |
| 4 | `PlayerIdentity` | Não iniciada (depende da Fase 5) |

### 2.1. Tarefa 2 — o que foi entregue

Os seis requisitos que bloqueavam o deploy foram resolvidos juntos:

| # | Requisito | Implementação | Evidência |
|---|---|---|---|
| 1 | Identidade do build | `Engine.BUILD_ID = 'stockfish-19-lite-single'`; `BUILD_LABEL`, `LEGACY_BUILD_ID` | `tests/wdl.test.mjs` |
| 2 | Chave sem colisão | `gameId@depth@engineBuild`; forma legada `gameId@depth` preservada | `tests/storage.test.mjs` |
| 3 | Metadados originais | `enrichAnalysis` preserva `engine`, `engineId`, `engineBuild`, `scoreSource`, `version` e `key` | teste dedicado + smoke |
| 4 | Recuperação de análise antiga | `Engine.buildOf` + `isLegacyAnalysis`; aviso e botão “Reanalisar com o novo motor” | smoke CDP |
| 5 | Consistência de médias | `stats.otherEngine` exclui precisão/ACPL de outro build e informa a contagem | smoke: `otherEngine === 1` |
| 6 | Migração segura | `migrateAnalysisProvenance` grava `engineBuild` na mesma chave, sem tocar em `version`/posições/`createdAt`; marcador `analysisProvenanceMigration = 1` | smoke: `createdAt` e `version` idênticos |
| 7 | WDL no cálculo | `whiteWinPct(..., 'wdl')` = `(w + d/2)/10`; fonte por análise; `version: 3`; fallback íntegro para v2 | `tests/wdl.test.mjs` + smoke v3 |

**Decisão de escopo — 10 categorias adiadas.** A Seção 10.11 do Prompt Mestre
não existe no workspace e o repositório lista apenas os nomes. Além dos
limiares, "Grande Lance" exige **MultiPV 2** e "Livro" exige **integração com
banco de aberturas (ECO)** — ambos fora do escopo estrito da Fase 2 (motor e
precisão). Por decisão registrada em 17/11/2026, essas 3 categorias ficam
**deferidas para uma fase posterior** (Fase 2.5 ou Fase 5) e as **7 categorias
atuais estão aprovadas**. Nenhum limiar foi inventado. O Expected Score já é
calculado sobre WDL, então a futura troca não exigirá nova migração de dados.

**Deploy:** não executado, por decisão do usuário. O working tree está pronto
para revisão; o backup real da biblioteca depende de exportar/restaurar o JSON
no navegador com as partidas reais.

Detalhes e evidências em [`docs/TESTES-FASE-2.md`](TESTES-FASE-2.md) §13.

### 2.2. Itens deferidos para fase futura

| Item | Pré-requisito | Destino |
|---|---|---|
| **Grande Lance** | MultiPV 2 no worker (hoje `MultiPV=1`) e critério de sacrifício/qualidade do segundo lance | Fase 2.5 ou Fase 5 |
| **Livro** | Fonte de abertura (ECO/`vendor/eco/openings.json` como base de reconhecimento, não só de nome) | Fase 2.5 ou Fase 5 |
| **Bom** | Faixa intermediária entre "Excelente" e "Imprecisão" | Fase 2.5 ou Fase 5, junto com a revisão dos limiares |
| Seção 10.11 do Prompt Mestre | Texto com critérios versionados das 10 categorias | Precisa ser fornecido antes da implementação |

Enquanto isso, `Engine` mantém 7 anotações e `ANNOTATION_ORDER` não muda. A
`version: 3` da análise (**WDL no Expected Score**) é independente dessa
decisão e está implementada.
