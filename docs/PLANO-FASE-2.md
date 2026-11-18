# Plano da Fase 2 — Chess-Analysis

**Data:** 17/11/2026  
**Estado:** Tarefa 1 **executada e verificada**; correção da terminalidade
(`depth 0`) e padronização Groq concluídas em 17/11/2026; Tarefas 2-4 **não
iniciadas**  
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
| Produção das correções locais | **Não executado** | bloqueado por proveniência; deploy manual |

Detalhes em [`docs/TESTES-FASE-2.md`](TESTES-FASE-2.md).

---

## 2. Tarefas seguintes da Fase 2 (não iniciadas)

| # | Tarefa | Depende de |
|---|---|---|
| 2 | Proveniência das análises + 10 categorias + WDL no cálculo (versão 3) | Tarefa 1 |
| 3 | Central de Análises com fila e checkpoints | Tarefa 2 |
| 4 | `PlayerIdentity` | Fase 5 |

### 2.1. Requisitos obrigatórios da Tarefa 2 (bloqueadores de deploy)

A Tarefa 2 precisa resolver, em conjunto:

1. **Identidade do build** do motor gravada na análise e no resumo.
2. **Chave de armazenamento** que não colida entre motores — `gameId@depth`
   sozinho não basta; um campo `build` adicional não resolve a colisão.
3. **Preservação dos metadados originais** (`engine`, `engineId`, build) no
   `enrichAnalysis`, sem carimbar o motor atual em análise antiga.
4. **Recuperação de análises antigas** com aviso claro de qual motor as gerou.
5. **Consistência de resumos e estatísticas**: não somar precisão/ACPL de
   motores diferentes como se fossem o mesmo.
6. **Migração segura** do IndexedDB, sem perda e sem reescrever `version: 2`
   antes de a v3 estar implementada.
7. **WDL no cálculo** e as 10 categorias só depois dos itens acima.

Enquanto isso, **não fazer deploy**.

Nenhuma delas é declarada pronta por este documento.
