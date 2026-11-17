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

Novo teste adicionado: `motor atualizado para o Stockfish 19 lite single com
WDL capturado` — confere o nome do Worker, o `UCI_ShowWDL`, a existência de
`parseWdl`, a ausência do caminho antigo, a curva `0.00368208` (interface
inalterada) e o tamanho dos dois arquivos vendorizados.

## 4. Smoke real — análise completa

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
| Precisão | 84,1% (brancas) / 83,3% (pretas) |
| ACPL | 134 / 121 |
| Momentos-chave | 3 |
| Barra de avaliação | `51.5644%` |
| Gráfico SVG | presente |
| Lances com anotação | 33 |
| PDF | `Relatório` presente, `Stockfish` presente, 10.124 caracteres |
| Tempo total da análise | 418 ms |
| Erros de console | **0** |
| Exceções | **0** |

**Por que 33 de 34:** a última posição é mate. O motor responde com
`info depth 0`, que o parser ignora de propósito para não gravar avaliação
falsa. As 33 posições com linha real têm WDL completo.

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

**Conclusão:** neste build single-thread, `stop` interrompe a busca. O
`terminate()` do `Engine.stop()` continua no código como fallback de
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

| Item | Resultado |
|---|---|
| Tempo total | 1.072 ms |
| Profundidade máxima observada | 12 |
| Posições | 34 |
| Posições com WDL | 33 |
| Soma do WDL sempre 1000 | sim |
| Precisão | 88,2% / 84,4% |
| ACPL | 122 / 117 |
| Barra | `52.7588%` |
| Gráfico | presente |
| Erros de console | 0 |

## 9. O que esta tarefa não fez

- **Não** usou o WDL no cálculo: `winPctWhite`, precisão, ACPL, anotações,
  gráfico e relatório continuam exatamente como antes (curva sobre cp).
- **Não** gravou `version: 3`.
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
