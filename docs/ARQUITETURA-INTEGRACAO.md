# Arquitetura e integração — Chess-Analysis

**Versão do documento:** 1.0 — Fase 1  
**Atualizado em:** 16/11/2026  
**Estado:** implementação incremental; o shell atual ainda é uma única página HTML.

---

## 1. Decisão arquitetural

**Decisão aprovada:** arquitetura multipágina com arquivos HTML convencionais,
módulos JavaScript compartilhados, checkpoints persistentes e retomada
confiável.

Regras:

- Não transformar o aplicativo em SPA.
- Não depender da sobrevivência de Web Workers entre páginas.
- Persistir progresso no IndexedDB após unidades verificáveis de trabalho.
- A navegação usa URLs convencionais e é compatível com a Vercel.
- A Fase 1 estabiliza o shell atual; a separação física das páginas é feita em
  etapa controlada, com testes entre cada extração.

### 1.1. O que acontece ao trocar de página

1. A página atual pode solicitar parada organizada do Worker.
2. O último checkpoint consistente já está no IndexedDB.
3. A nova página abre um novo contexto e não herda o Worker anterior.
4. A fila persistida é carregada e tarefas interrompidas são identificadas.
5. O processamento só é retomado quando o usuário confirma ou quando a política
   da tarefa permitir.

### 1.2. Limitações assumidas

- O navegador não continua processando depois de fechado.
- Um Worker não sobrevive a recarregamento, navegação ou fechamento da aba.
- Um pequeno trecho ainda não confirmado no checkpoint pode ser recalculado.
- Tarefas interrompidas nunca são marcadas como concluídas.

---

## 2. Arquitetura atual (Fase 1)

```mermaid
flowchart TB
    subgraph Navegador
        HTML[index.html<br/>shell único]
        APP[js/app.js<br/>estado, navegação, tema]
        LIB[js/library.js<br/>importação e biblioteca]
        GAME[js/game.js<br/>tabuleiro, abas, IA da partida]
        REPORT[js/report.js<br/>relatório e PDF]
        ANA[js/analytics.js<br/>desempenho e aberturas]
        SET[js/settings.js<br/>configurações, backup, lote]
        ENGINE[js/engine.js<br/>Stockfish Worker]
        AIJS[js/ai.js<br/>cliente de IA]
        DB[(IndexedDB<br/>acervo64)]
        LS[(localStorage<br/>preferências)]
        W1[js/pgn-worker.js]
        W2[vendor/stockfish/stockfish.js]
    end

    HTML --> APP
    APP --> LIB
    APP --> GAME
    GAME --> REPORT
    APP --> ANA
    APP --> SET
    GAME --> ENGINE
    LIB --> W1
    ENGINE --> W2
    APP --> AIJS
    LIB --> DB
    GAME --> DB
    ANA --> DB
    SET --> DB
    APP --> LS
    AIJS -->|sempre no site publicado| PROXY[api/chat.js e api/tags.js]
    PROXY --> PROVIDER[Provedor DeepSeek]
```

### 2.1. Módulos atuais

| Módulo | Responsabilidade | Dependências principais |
|---|---|---|
| `js/app.js` | estado global, utilidades, navegação, tema, modais, inicialização | todos os módulos de página |
| `js/storage.js` | IndexedDB e preferências | navegador |
| `js/pgn.js` | parser e serializador PGN | chess.js |
| `js/pgn-worker.js` | leitura de PGN fora da thread principal | chess.js, pgn.js |
| `js/engine.js` | Stockfish, avaliações, anotações e precisão | Worker, chess.js |
| `js/board.js` | renderização do tabuleiro | SVGs de peças |
| `js/library.js` | importação, filtros, tabela, exportação | DB, PGN, Openings, Tags |
| `js/game.js` | partida, abas, análise, tags, entrada do relatório | DB, Engine, AI, Board |
| `js/report.js` | relatório detalhado e PDF via impressão | Engine (rótulos), chess.js (PV em SAN) |
| `js/analytics.js` | estatísticas, aberturas, leitura, repertório | DB, Stats, AI |
| `js/settings.js` | configurações, backup, restauração, lote | DB, Settings, AI |
| `js/openings.js` | reconhecimento de aberturas | base ECO local |
| `js/tags.js` | tags fixas por lado | análise e partida |
| `js/stats.js` | identidade provisória e cálculos | partidas |
| `js/ai.js` | cliente de IA, privacidade e prompts | proxy `/api/*` |

### 2.2. Módulos previstos para a separação multipágina

| Página | Responsabilidade | Estado |
|---|---|---|
| `index.html` | dashboard inicial | Planejada |
| `biblioteca.html` | bibliotecas e importação | Planejada |
| `lances.html` | tabuleiro e histórico | Planejada |
| `analise.html` | Stockfish e classificações | Planejada |
| `desempenho.html` | estatísticas | Planejada |
| `central-analises.html` | fila e processamento | Planejada (Fase 3) |
| `assistente-ia.html` | Treinador IA | Planejada |
| `configuracoes.html` | preferências e privacidade | Planejada |

A separação só avança depois que a Fase 1 estiver estável e testada.

---

## 3. Navegação principal

A interface deve expor cinco áreas:

1. **Biblioteca** — importação, lista, filtros, exportação e entrada para análise
   em lote.
2. **Análise** — tabuleiro, lances, avaliação, classificações e IA da partida.
3. **Desempenho** — estatísticas; Aberturas é uma página auxiliar acessível por
   botão, sem ocupar o menu principal.
4. **Treinador IA** — leitura do acervo, repertório e privacidade.
5. **Configurações** — perfil, motor, IA, backup e dados.

Regras de navegação:

- Avançar ou retroceder lances **não altera** a aba Lances/Análise/IA.
- Abrir uma partida pode selecionar a aba Lances (comportamento esperado).
- O botão ativo usa `aria-current="page"`.
- A central de análises será acessível pela Biblioteca e pelo indicador de
  processamento.

---

## 4. Armazenamento

### 4.1. IndexedDB

- Banco legado: `acervo64` (preservado para não perder dados).
- Versão: `1`.
- Repositório central: `js/storage.js`.

```mermaid
erDiagram
    GAMES ||--|| DATA : "id"
    GAMES ||--o{ ANALYSIS : "gameId"
    GAMES ||--o{ AI : "gameId"
    GAMES {
        string id PK
        string white
        string black
        string result
        string dateISO
        number analyzedDepth
        boolean favorite
    }
    DATA {
        string id PK
        string startFen
        array moves
        string pgn
    }
    ANALYSIS {
        string key PK
        string gameId FK
        number depth
        array positions
        array moves
        object accuracy
        object counts
    }
    AI {
        string key PK
        string gameId FK
        string kind
        string text
        array tags
    }
```

### 4.2. Preferências

- Chave: `acervo64_settings_v1`.
- Mantida para compatibilidade.
- Novas opções de privacidade serão adicionadas com valores padrão seguros.

### 4.3. Migrações

- Nenhuma migração destrutiva na Fase 1.
- `DB.VERSION` continua `1`.
- Se uma versão futura exigir mudança de schema, será criada migração
  transacional com backup prévio e verificação de contagem.

---

## 5. Workers

| Worker | Entrada | Saída | Fallback |
|---|---|---|---|
| `js/pgn-worker.js` | texto PGN + nome do arquivo | partidas validadas + erros | leitura na thread principal |
| Stockfish | comandos UCI | linhas `info` e `bestmove` | nenhum; análise exige HTTP(S) |

### 5.1. Regras

- O Worker de PGN é reaproveitado entre arquivos.
- Uma falha isolada não invalida o Worker para os próximos arquivos.
- O Stockfish tem timeout de inicialização e de busca.
- `Engine.stop()` encerra o Worker e limpa a promessa de inicialização.

---

## 6. Stockfish e classificação

### 6.1. Integração

- Distribuição atual: `vendor/stockfish/stockfish.js` + `.wasm`.
- Versão real: **não confirmada**; o rótulo do código é “Stockfish 10 (WASM)”.
- Protocolo UCI, `Hash=32`, `MultiPV=1`.
- Análise por profundidade, com progresso por posição.
- Avaliações convertidas em Win% e perda em pontos percentuais.

### 6.2. Classificações

**Estado atual (7 categorias):** Brilhante, Excelente, Melhor, Ótimo, Erro,
Chance perdida, Capivarada — nesta ordem visual.

**Ordem visual exigida na Fase 1:** Brilhante, Excelente, Melhor, Ótimo, Erro,
Chance Perdida, Capivarada.

**Destino (10 categorias, Fase 2):** Brilhante, Grande Lance, Melhor, Excelente,
Bom, Livro, Imprecisão, Erro, Chance Perdida, Erro Grosseiro.

Critérios serão versionados e documentados no modelo de dados antes da
implementação. A ordem visual não implica escala linear.

---

## 7. IA e privacidade

### 7.1. Fluxo

```mermaid
sequenceDiagram
    participant U as Usuário
    participant F as Frontend
    participant P as Proxy Vercel
    participant D as DeepSeek
    U->>F: solicita resumo/leitura
    F->>F: verifica se envio está habilitado
    F->>F: verifica consentimento
    alt sem consentimento
        F-->>U: modal de autorização
    end
    F->>F: minimiza dados (Brancas/Pretas, sem URLs)
    F->>P: POST /api/chat
    P->>P: cota por IP
    P->>D: requisição com chave do servidor
    D-->>P: streaming
    P-->>F: NDJSON
    F-->>U: resposta + indicador de provedor
```

### 7.2. Regras

- A chave nunca vai ao navegador.
- O consentimento é solicitado antes do primeiro envio externo.
- “Não enviar dados à IA” bloqueia chamadas e mantém biblioteca, Stockfish e
  estatísticas funcionando.
- Nomes reais, usernames, URLs e localização não são enviados quando
  desnecessários.
- O proxy registra apenas provedor, modelo e status HTTP; não registra prompts,
  respostas ou chaves.
- Erros 401, 429, 503, timeout e rede têm mensagens próprias.
- `/api/tags` valida a credencial do provedor antes de dizer “online”.

### 7.3. Provedor implementado

- Provedor: DeepSeek.
- Base: `https://api.deepseek.com/v1`.
- Modelo: `deepseek-chat`.
- Variáveis: `AI_PROVIDER=openai`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`.
- `AI_ACCESS_MODE` e `AI_ACCESS_CODES` não fazem parte do fluxo.
- Sem chave real configurada, a interface informa que o Treinador IA está
  indisponível; não simula resposta.

---

## 8. APIs da Vercel

| Rota | Método | Função | Estado |
|---|---|---|---|
| `/api/chat` | POST | conversa em streaming | Implementada; validação de corpo, cota por IP e tradução de erros |
| `/api/tags` | GET | status e modelos | Implementada; valida a credencial real em `/models` |

Headers de segurança atuais: `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, `Permissions-Policy`. CSP será avaliada somente depois de
teste local e em produção.

---

## 9. Central de Análises (Fase 3)

Planejado:

- fila persistente por partida;
- estados: pendente, processando, pausada, interrompida, concluída, cancelada,
  erro;
- checkpoint após cada posição ou grupo verificável;
- retomada após recarregar/navegar;
- um motor simultâneo por padrão;
- indicador real de progresso;
- coordenação entre abas.

Não implementar antecipadamente na Fase 1. O botão de análise em lote existente
é apenas o ponto de entrada provisório.

---

## 10. Testes

| Tipo | Ferramenta | Estado |
|---|---|---|
| Sintaxe | `tools/check-syntax.cjs` | Executado: todos os arquivos válidos |
| API/regras | `node --test tests/` | Executado: 15 testes aprovados |
| Fumaça no navegador | Edge headless + CDP | Executado: importação, partida, abas, relatório |
| Análise real | Edge headless + Stockfish | Executado em profundidade 8 |
| PDF | Edge `--print-to-pdf` | Executado: PDF de 3 páginas |
| Backups | Edge headless + CDP | Executado com exemplos: exportar → limpar → restaurar → backup prévio |
| Deploy | Vercel CLI + HTTP | Pendente de variável real e autorização |

Evidências em `docs/TESTES-FASE-1.md`. Nenhum teste é declarado aprovado sem
execução.

---

## 11. Estados de implementação

| Item | Estado |
|---|---|
| Auditoria inicial | Implementada e documentada |
| Linha de base e cópia do código | Implementada e verificada |
| Identidade “Chess-Analysis” | Implementada na Fase 1 |
| Remoção do dropzone | Implementada na Fase 1 |
| Remoção do código de acesso | Implementada na Fase 1 |
| Cinco áreas de navegação | Implementada na Fase 1 |
| Correção da IA/DeepSeek | Implementada no código; validação ponta a ponta depende de chave real |
| Consentimento e minimização | Implementados na Fase 1 |
| PDF robusto | Implementado e testado com análise real |
| `PlayerIdentity` | Contrato documentado; implementação na Fase 5 |
| Stockfish 19/WDL | Planejado para a Fase 2 |
| Central de Análises | Planejada para a Fase 3 |
| Chess.com/Lichess | Planejado para a Fase 4 |

---

## 12. Riscos arquiteturais

1. O shell único atual concentra estado global; a extração multipágina exige
   cuidado com dependências circulares.
2. A ausência de módulos ES na base atual dificulta testes unitários puros.
3. O parser não preserva variantes/comentários; relatórios e IA não podem
   exibi-los sem mudança de modelo.
4. A identidade provisória pode atribuir partidas incorretamente; a Fase 5 deve
   corrigir com `PlayerIdentity`.
5. Sem chave real da DeepSeek, a IA não pode ser validada ponta a ponta.
6. Sem backup real exportado, nenhuma migração de dados pode avançar.
