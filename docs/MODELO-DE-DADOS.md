# Modelo de dados — Chess-Analysis

**Versão:** 1.1 — Fase 2 (contrato de WDL)  
**Atualizado em:** 17/11/2026  
**Estado:** contratos documentados; persistência de `PlayerIdentity` fica para a
Fase 5. O campo `wdl` e a `version: 3` da análise estão **documentados e ainda
não implementados**.

Este documento descreve as estruturas **realmente usadas** hoje e os contratos
previstos. Onde a estrutura ainda não existe no código, o texto indica isso.

---

## 1. Convenções

- Identificadores internos são strings estáveis e não dependem do nome exibido.
- Datas de calendário usam `YYYY-MM-DD` (`dateISO`).
- Datas de operação usam epoch em milissegundos (`createdAt`, `importedAt`).
- Campos ausentes são omitidos ou `null`; nunca preenchidos com dados inventados.
- O banco IndexedDB mantém o nome legado `acervo64` e a versão `1` para não
  apagar a biblioteca existente. O nome é um identificador de compatibilidade.

---

## 2. Entidades atuais

### 2.1. Partida (`games`)

Chave: `id`.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string | determinístico a partir de jogadores, resultado e lances; cópias recebem `_c2`, `_c3` |
| `white`, `black` | string | nomes originais do PGN, preservados |
| `whiteElo`, `blackElo` | number \| null | somente quando o PGN informa |
| `result` | `1-0` \| `0-1` \| `1/2-1/2` \| `*` | |
| `dateISO`, `year` | string \| number | |
| `event`, `site`, `round` | string | |
| `eco`, `opening` | string | abertura reconhecida pela base local |
| `timeControl` | string | |
| `plyCount` | number | meia-jogadas |
| `headers` | object | cabeçalhos PGN preservados |
| `sourceFile` | string | arquivo de origem |
| `importedAt` | number | epoch ms |
| `favorite` | boolean | |
| `tags` | string[] | tags livres do usuário |
| `aiTags` | string[] | tags sugeridas pela IA |
| `sideTags` | object | tags calculadas por lado |
| `analysisSummary` | object \| null | resumo numérico da análise salva |
| `analyzedDepth` | number | maior profundidade concluída |
| `copyOf` | string | presente apenas em cópias |

### 2.2. Dados da partida (`data`)

Chave: `id` (mesmo da partida).

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string | |
| `startFen` | string | posição inicial (FEN) |
| `moves` | array | `{san, from, to, promotion, fen}` por meia-jogada |
| `pgn` | string | PGN **normalizado** gerado pelo aplicativo |

**Limitação conhecida:** o parser atual ignora comentários `{ }`, `;`, NAGs e
variações `( )`. O campo `pgn` não é o texto original bruto. Por isso o
relatório e a IA não podem exibir variantes do PGN nesta versão.

### 2.3. Análise (`analysis`)

Chave: `key = gameId@depth`; índice `gameId`.

| Campo | Tipo | Observação |
|---|---|---|
| `gameId` | string | |
| `depth` | number | profundidade solicitada |
| `version` | number | `2` hoje, inclusive com `wdl` bruto; `3` quando o win% passar a derivar do WDL (§2.3.1) |
| `engine` | string | rótulo de exibição; o motor atual grava “Stockfish 19 Lite WASM” |
| `engineId` | string \| null | opcional; linha `id name` devolvida pelo UCI. Ausente nas análises antigas |
| `positions` | array | `{cp, mate, depth, best, pv, wdl?}` por posição |
| `moves` | array | classificação por meia-jogada |
| `winPctWhite` | number[] | 0–100 |
| `accuracy` | `{w,b}` | 0–100 |
| `acpl` | `{w,b}` | centipeões |
| `counts` | `{w,b}` | contagem por categoria |
| `phaseAccuracy` | object | abertura/meio-jogo/final |
| `phaseBlunders`, `phaseBrilliants` | object | |
| `keyMoments` | array | até 8 momentos críticos |
| `summary` | object | cópia compacta para a biblioteca |
| `createdAt` | number | |

Cada item de `moves` contém: `loss` (pontos percentuais), `cpLoss`,
`annotation`, `symbol`, `label`, `bestSan`, `before`, `after`, `phase`,
`sacrifice`, `isBest`, `missed`, `brilliant`.

#### 2.3.1. Item de `positions` e o campo aditivo `wdl` (versão 3)

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `cp` | number \| null | sim | centipeões do ponto de vista de quem joga; `null` quando a linha é de mate |
| `mate` | number \| null | sim | em lances para mate; positivo = quem joga dá mate |
| `depth` | number | sim | profundidade da última linha aceita |
| `best` | string \| null | sim | lance UCI (`e2e4`, `e7e8q`) ou `null` |
| `pv` | string[] | sim | linha principal em UCI; pode ser vazia |
| `wdl` | `{w,d,l}` \| ausente | **não** | probabilidades em **por-mil** (0–1000), do ponto de vista de quem joga naquela posição |

Regras do `wdl`:

1. Só existe quando o motor responde com `UCI_ShowWDL` ativo e a linha `info`
   trouxer o trio `wdl <w> <d> <l>`. Desde a Tarefa 1 da Fase 2 o campo é
   gravado nas análises **v2** como dado bruto, sem entrar no cálculo.
2. São inteiros; a soma é 1000 (`l = 1000 − w − d`).
3. A perspectiva é a **de quem joga** — a mesma de `cp` e `mate`. Não inverter
   duas vezes ao converter para brancas.
4. Nunca é inventado: análise antiga ou linha sem WDL fica **sem** o campo.
   `0 0 0` não é valor válido.
5. É aditivo: `cp`, `mate`, `best` e `pv` continuam obrigatórios e com o mesmo
   significado. Nada é removido nem renomeado.
6. Em posição terminal, a análise é gravada **sem consultar o motor**:
   xeque-mate → `{ cp: null, mate: 0, depth: 0, wdl: null }`; afogamento ou
   material insuficiente → `{ cp: 0, mate: null, depth: 0, wdl: null }`.
   `mate: 0` significa que o lado a jogar está em mate — não é ausência de
   avaliação. `depth 0` sozinho não identifica terminalidade.

Conversão canônica para a matriz já existente:

```text
esMover     = (w + d / 2) / 10           // 0–100, em %
whiteWinPct = índice par  ? esMover : 100 − esMover
```

`winPctWhite` continua sendo o array canônico consumido pelo gráfico e pelo
relatório. A `version: 3` indica que ele foi derivado do WDL; a `version: 2`
indica que veio da curva logística sobre `cp`.

#### 2.3.2. Compatibilidade entre versões de análise

| `version` | Conteúdo | Leitura |
|---|---|---|
| `1` | `positions` + `winPctWhite`, sem `moves` anotados | Reconstruída por `Engine.enrichAnalysis` |
| `2` | Acrescenta `moves`, `accuracy`, `acpl`, `counts`, fases e momentos; win% pela curva logística. Desde a Tarefa 1 pode carregar `positions[i].wdl` bruto | Estado atual |
| `3` | `version: 2` + `positions[i].wdl` e `engineId` | **Previsto**; ausência de `wdl` cai na curva da v2 |

Regras de migração:

- A ausência de `wdl` **não** é erro: significa “usar a curva logística”.
- Não regravar análises antigas apenas para preencher `wdl`.
- `enrichAnalysis` não pode inventar `wdl` nem elevar `version` sem executar o
  motor com WDL.
- Uma análise v3 pode ser lida por código que ignore `wdl` sem perder dados.

#### 2.3.3. Proveniência — bloqueador de deploy

A chave `key = gameId@depth` **não identifica o motor**. Consequências
verificadas no código atual:

- `DB.getAnalysis(gameId)` devolve a análise de maior profundidade, de
  qualquer motor;
- `enrichAnalysis` devolve a v2 intacta, então uma análise do SF10 continua
  válida e pode ser exibida como se fosse do SF19;
- ao reconstruir uma análise v1, `buildAnalysis` carimba o `engineId` **atual**
  do navegador, atribuindo SF19 a posições do SF10;
- `game.analysisSummary` (Desempenho, Aberturas e IA) não carrega motor, então
  as médias misturam builds.

Regra até a Tarefa 2: **não fazer deploy**. A solução precisa cobrir, junto:
identidade do build, chave de armazenamento (não apenas `gameId@depth`),
preservação de `engine`/`engineId` originais no enriquecimento, recuperação de
análises antigas, consistência dos resumos/estatísticas e migração segura.
Acrescentar um campo `build` sem mudar a chave **não** resolve a colisão.


### 2.4. Conteúdo de IA (`ai`)

Chave: `key = gameId:kind`; índice `gameId`.

| Campo | Tipo |
|---|---|
| `gameId` | string |
| `kind` | `summary` \| `tags` |
| `text` | string |
| `tags` | string[] |
| `model` | string |
| `depth` | number \| null |
| `createdAt` | number |

### 2.5. Chaves auxiliares (`meta`)

Chave: `key`.

Exemplos: `analysisMigration`, `insights`, `repertoire`. O valor é gravado em
`{ key, value, createdAt }`.

### 2.6. Preferências (`localStorage`)

Chave legada: `acervo64_settings_v1`.

| Campo | Tipo | Padrão |
|---|---|---|
| `theme` | `dark` \| `light` | `dark` |
| `playerNames` | string | vazio |
| `depth` | number | 12 |
| `pageSize` | number | 50 |
| `ai.mode` | `auto` \| `proxy` | `auto` |
| `ai.proxyUrl` | string | vazio |
| `ai.model` | string | vazio (vem do servidor) |
| `ai.temperature` | number | 0.3 |
| `ai.numCtx` | number | 4096 |
| `ai.privacy.blocked` | boolean | `false` |
| `ai.privacy.consentVersion` | string | vazio |
| `ai.privacy.consentAt` | number | 0 |
| `ai.privacy.provider` | string | vazio |

---

## 3. Classificações de movimento

Ordem visual oficial da Fase 1 (7 categorias):

1. Brilhante (`!!`)
2. Excelente (`!`)
3. Melhor (`★`)
4. Ótimo (`👍`)
5. Erro (`?`)
6. Chance Perdida (`×`)
7. Capivarada (`??`)

A ordem **não** é uma escala linear. O destino da Fase 2 tem 10 categorias
(Brilhante, Grande Lance, Melhor, Excelente, Bom, Livro, Imprecisão, Erro,
Chance Perdida, Erro Grosseiro), com critérios versionados, WDL e Expected
Score. Nada disso está implementado ainda: a atualização do motor (Tarefa 1 da
Fase 2) habilitará o **WDL**, mas os critérios abaixo continuam em pontos
percentuais até a Tarefa 2.

Critérios atuais (em pontos percentuais de vitória):

| Categoria | Critério resumido |
|---|---|
| Brilhante | sacrifício ≥ 2 peões ou virada, mantendo ≥ 60% e ≥ 55% dois lances depois |
| Melhor | igual ao melhor lance do Stockfish |
| Chance Perdida | antes ≥ 80% (ou mate), depois entre 45% e 70% |
| Capivarada | perda ≥ 30 pp |
| Erro | perda entre 10 e 29,9 pp |
| Excelente | perda ≤ 2 pp |
| Ótimo | perda entre 2 e 9,9 pp |

`Loss = ExpectedScoreBefore − ExpectedScoreAfter`, sempre pela perspectiva de
quem jogou. O ACPL usa centipeões e é apenas comparativo.

### 3.1. Fonte do Expected Score (contrato da versão 3)

**Estado:** documentado; não implementado. O código atual usa somente a curva
logística sobre `cp`.

| Fonte | Cálculo | Quando usar |
|---|---|---|
| `wdl` (v3) | `(w + d/2) / 10` → 0–100 | quando `positions[i].wdl` existe e é válido |
| curva sobre `cp` (v2) | `50 + 50*(2/(1+exp(-0.00368208*cp))-1)` | quando não há `wdl` |

Regras:

1. A fonte é escolhida **por análise**, não por posição: a `version: 3` usa WDL
   em todas as posições avaliadas; se alguma linha não trouxer WDL, a análise
   permanece na versão 2 e usa a curva.
2. `mate` continua tendo prioridade: 100% para quem dá mate, 0% para quem
   apanha, independentemente do `wdl`.
3. A perda continua em pontos percentuais e o ACPL continua em centipeões.
4. Se o `wdl` for inconsistente (fora de 0–1000 ou soma diferente de 1000),
   descartar o campo e usar a curva — registrando isso no item, sem inventar
   números.

**Estado após a Tarefa 1:** o motor já devolve `wdl` e o campo é gravado nas
análises **v2**, mas `winPctWhite`, perda e precisão continuam na curva sobre
`cp`. A `version: 3` é o trabalho da próxima tarefa.


---

## 4. `PlayerIdentity` — contrato para a Fase 5

**Estado:** documentado. Ainda não persistido. A identificação atual em
`js/stats.js` é provisória e pode deduzir um jogador pela frequência de nomes;
isso não é `PlayerIdentity`.

```json
{
  "id": "player-001",
  "displayName": "Jogador principal",
  "aliases": [
    { "source": "manual", "username": "JohnDoe" },
    { "source": "chesscom", "username": "johndoe_chess" },
    { "source": "lichess", "username": "john_doe" }
  ],
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

### 4.1. Campos

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | estável; não deriva do nome exibido |
| `displayName` | string | apenas apresentação |
| `aliases` | array | cada item tem `source` e `username` |
| `createdAt`, `updatedAt` | number | epoch ms |

`source` aceita `manual`, `chesscom`, `lichess` e futuras origens
documentadas.

### 4.2. Regras obrigatórias

1. Toda associação é configurada ou confirmada pelo usuário.
2. Nunca inferir que usernames parecidos são a mesma pessoa.
3. Considerar a origem ao comparar aliases.
4. Normalizar usernames conforme a origem (por exemplo, caixa e espaços).
5. Detectar conflitos: o mesmo alias em origens diferentes ou o mesmo usuário
   em duas identidades.
6. Permitir editar e remover aliases.
7. Preservar os nomes originais nos PGNs; a identidade é uma camada separada.
8. Alterar a identidade não altera avaliações objetivas do Stockfish.
9. Recalcular estatísticas dependentes da identidade quando ela mudar.
10. Sem correspondência confiável, a partida continua na biblioteca, mas não
    entra em estatísticas pessoais.

### 4.3. Associação partida ↔ jogador

Para cada partida, a futura camada deve registrar:

| Campo | Tipo | Observação |
|---|---|---|
| `gameId` | string | |
| `playerId` | string \| null | `null` quando não atribuído |
| `color` | `w` \| `b` \| null | cor do jogador naquela partida |
| `matchedBy` | `alias` \| `manual` \| `none` | como a associação foi feita |
| `confirmedAt` | number \| null | |

A cor, o resultado pessoal, o rating, os erros atribuídos e as aberturas
dependem dessa associação. Sem ela, esses campos permanecem indefinidos.

### 4.4. Migração prevista

- Criar store `players` e store `playerGames` em uma nova versão do banco.
- Não renomear nem recriar `games`, `data`, `analysis`, `ai` ou `meta`.
- Executar em transação com verificação de contagem.
- Exportar backup antes da migração.
- Nunca apagar partidas sem correspondência.

---

## 5. Fila e checkpoints (Fase 3)

Contrato previsto, ainda não implementado:

```json
{
  "id": "queue-001",
  "scope": ["gameId1", "gameId2"],
  "config": { "depth": 12, "multiPv": 1, "engineVersion": "a-validar" },
  "state": "pending|running|paused|interrupted|done|cancelled|error",
  "completed": ["gameId1"],
  "lastCheckpoint": { "gameId": "gameId2", "position": 17 },
  "createdAt": 0,
  "updatedAt": 0
}
```

Regras: gravar após unidades verificáveis; nunca marcar tarefa interrompida
como concluída; retomar apenas checkpoints consistentes. O campo
`config.engineVersion` deverá receber o `engineId` real devolvido pelo handshake
UCI, não um rótulo fixo.

---

## 6. Backup JSON

Formato atual:

```json
{
  "app": "chess-analysis",
  "version": 1,
  "exportedAt": "2026-11-16T00:00:00.000Z",
  "stores": { "games": [], "data": [], "analysis": [], "ai": [], "meta": [] }
}
```

A restauração aceita `app` antigo (`acervo64`) para compatibilidade. Antes de
mesclar, o aplicativo valida a estrutura e gera um backup do estado atual.
Autorizações de IA não são restauradas como consentimento válido.
