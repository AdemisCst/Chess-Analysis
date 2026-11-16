# Acervo 64 — Organizador de partidas de xadrez

Aplicativo para importar, organizar, revisar e analisar partidas em **PGN**. A análise
objetiva é feita pelo **Stockfish**, rodando no seu próprio navegador. Os números e as
estatísticas são calculados localmente; o assistente de linguagem é **opcional** e pode
rodar no seu PC (Ollama) ou atrás de um proxy publicado na Vercel.

Nada do seu acervo sai do navegador. O único tráfego de rede é:

- o download dos arquivos do próprio site;
- o Stockfish local (nenhuma rede);
- o assistente, **se você ativá-lo** — no PC, em `localhost`; no site publicado, pelo
  proxy do próprio site, que não guarda o conteúdo das conversas.

---

## 1. Como abrir no PC

1. Dê **duplo clique em `iniciar.bat`**.
2. O navegador abre em `http://localhost:8765/`.
3. Para encerrar, feche a janela preta do servidor.

> O `iniciar.bat` é necessário para a análise com Stockfish (Web Worker + WebAssembly).
> Se você abrir `index.html` diretamente (`file://`), a biblioteca, as estatísticas e o
> assistente continuam funcionando, mas a análise de lances fica indisponível.

Requisitos: Windows, PowerShell (já vem no sistema) e um navegador atualizado
(Chrome, Edge, Opera GX, Firefox; no celular, Chrome Android ou Safari iOS).

---

## 2. Primeiros passos

### 2.1 Importar partidas

- **＋ Importar PGN** aceita um ou vários arquivos `.pgn`, com várias partidas por arquivo.
- Você também pode **arrastar e soltar** os arquivos na área de importação, ou usar o
  teclado: foque a área e pressione `Enter` ou `Espaço`.
- A leitura roda em um **Web Worker** (`js/pgn-worker.js`): arquivos grandes não congelam
  a interface. Se o navegador não permitir worker, a leitura volta para a thread normal
  sem interromper a importação.
- **Carregar exemplos** importa três partidas clássicas para experimentar o aplicativo.
- Ao final, um relatório mostra quantas partidas entraram, quantas eram duplicadas e
  quais avisos o PGN gerou. O relatório pode ser fechado sem apagar nada.

### 2.2 Dizer quem é você

Em **Ajustes → Perfil e tabuleiro**, informe como você aparece nos PGN. Separe apelidos
com **ponto e vírgula**, por exemplo:

```
Silva, Carlos; SilvaCarlos; carlos_silva
```

A vírgula é preservada porque nomes de PGN costumam vir como “Sobrenome, Nome”. Sem esse
campo, o aplicativo tenta deduzir o jogador mais frequente do acervo — e avisa quando a
dedução é incerta.

O perfil é o que permite separar:

- aproveitamento com brancas e com pretas;
- precisão sua × precisão dos adversários;
- aberturas por cor;
- tags “a favor” × “contra”.

### 2.3 Analisar

Abra uma partida e clique em **⚡ Analisar**. O Stockfish avalia todas as posições na
profundidade escolhida (padrão 12) e o resultado fica salvo no navegador: reabrir a
partida **não refaz** a análise.

Para o acervo inteiro, use **Ajustes → Analisar partidas pendentes**, com barra de
progresso e botão de cancelar. Também é possível analisar apenas as partidas marcadas
na biblioteca (veja 3.2).

Máquinas modestas: profundidade 10 ou 12 é suficiente para as anotações e a precisão.
Profundidades altas em partidas longas podem levar vários minutos.

---

## 3. Biblioteca

### 3.1 Filtros e busca

A busca entende texto livre e filtros no formato `campo:valor`:

| Filtro | Exemplo | Observação |
|---|---|---|
| `white:` / `black:` | `white:Carlsen` | nome do jogador |
| `result:` | `result:1-0`, `result:win` | `win`/`loss` usam a sua cor |
| `eco:` | `eco:B20` | código da abertura |
| `opening:` | `opening:Siciliana` | nome da abertura |
| `tag:` | `tag:tática` | tags livres, da IA e por lado |
| `date:` | `date:2024` | ano ou data |
| `elo>` / `elo<` | `elo>2000` | maior elo da partida |
| `moves>` | `moves>40` | número de lances |
| `favoritos` / `fav` | `fav` | só favoritas |

Combinações funcionam: `white:Carlsen result:1-0 eco:B20`.

### 3.2 Duplicatas

Ao importar, o aplicativo compara **jogadores + data + resultado + sequência de lances**.
Se encontrar partidas que já existem, pergunta o que fazer:

- **Importar só as novas** (padrão): mantém a biblioteca limpa.
- **Importar todas, criando cópias**: importa de novo com um identificador próprio
  (`..._c2`, `..._c3`). Útil para comparar análises ou manter versões diferentes do
  mesmo PGN.
- **Cancelar**: não importa nada.

### 3.3 Seleção múltipla

Cada linha tem uma caixa de seleção; o cabeçalho seleciona **todas as partidas da
página**. Com uma ou mais selecionadas, aparece a barra de ações em lote:

- **Favoritar** (alterna: se todas já são favoritas, remove);
- **Adicionar tag** a todas;
- **Analisar** apenas as selecionadas que ainda não atingiram a profundidade;
- **Exportar PGN** apenas das selecionadas;
- **Excluir** (com confirmação);
- **Limpar seleção**.

### 3.4 Exportar e backup

- **⇩ Exportar → Acervo em PGN**: gera um arquivo com as partidas (todas ou selecionadas).
- **⇩ Exportar → Backup completo (JSON)**: inclui partidas, lances, análises, tags,
  textos do assistente e preferências.
- **Ajustes → Restaurar backup** lê o JSON e **migra** análises e tags antigas
  automaticamente.

---

## 4. Partida

- Tabuleiro com peças SVG, coordenadas, destaque do último lance e do rei em xeque.
- Navegação por botões, clique na lista de lances ou teclado (`←`, `→`, `Home`, `End`).
- Girar o tabuleiro, copiar FEN e copiar PGN.
- **Relatório PDF**: abre uma versão para impressão com ficha da partida, precisão,
  contagem de anotações, momentos-chave e resumo do assistente. Na janela de impressão,
  escolha “Salvar como PDF”. Nada é enviado a servidores.
- Abas **Lances**, **Análise** e **IA**, navegáveis por teclado (setas entre as abas).

### 4.1 Anotações dos lances

Cada lance recebe no máximo uma anotação, seguindo a prioridade abaixo. Os símbolos
aparecem na lista de lances; os “pontos” ficam no tooltip e no gráfico, não no texto.

| Símbolo | Nome | Critério resumido |
|---|---|---|
| `!!` | Brilhante | sacrifício de 2+ peões mantendo vantagem, ou virada de ≤35% para ≥60%, com confirmação 2 lances depois (a partir do lance 6) |
| `★` | Melhor | lance igual ao melhor da engine (ou perda ≤2pp) |
| `×` | Chance perdida | posição era ganha (≥80% ou mate) e deixou de ser (<70%), com piso de 45% e perda ≥10pp |
| `??` | Capivarada | perda de 30pp ou mais |
| `?` | Erro | perda entre 10pp e 29,9pp |
| `!` | Excelente | perda de até 2pp |
| `👍` | Ótimo | perda entre 2pp e 9,9pp |

Os limiares ficam em `Engine.THRESHOLDS` (`js/engine.js`). A anotação é determinística e
não depende do assistente.

### 4.2 Precisão e ACPL

- **Precisão** é derivada da perda média de avaliação em porcentagem de vitória.
- **ACPL** (Average Centipawn Loss) é a perda média em centipeões.
- Os cartões mostram **você × adversário**, com a sua cor identificada pelo perfil.
- Análises antigas são enriquecidas a partir das posições já salvas, sem reanalisar.

### 4.3 Tags por lado

Cinco tags fixas são calculadas por lado e exibidas como **“A favor”** e **“Contra”**
(ou “Brancas”/“Pretas” quando o perfil não está definido):

| Tag | Quando aparece |
|---|---|
| **Abertura** | a partida seguiu uma linha nomeada da base |
| **Tática** | houve sacrifício, combinação, brilhante ou chance perdida |
| **Finais** | a partida chegou a um final (60+ lances ou material reduzido) |
| **Brilhante** | o lado tem pelo menos um `!!` |
| **Capivarada** | o lado cometeu pelo menos um `??` |

As tags livres (manuais) continuam existindo, separadas das tags por lado. A IA pode
sugerir tags, mas **não decide** capivarada nem brilhante — isso é sempre da engine.

---

## 5. Estatísticas

A aba **Estatísticas** calcula tudo localmente:

- resultados por cor, controle de tempo e rating;
- **precisão do usuário × adversários** e ACPL;
- evolução da precisão ao longo do tempo (gráfico clicável: abre a partida);
- distribuição das anotações e **fase dos brilhantes** (abertura, meio-jogo, final);
- aberturas mais jogadas e mais fracas;
- rating médio dos adversários;
- **Leitura do Acervo**: Diagnóstico, Pontos fortes, Pontos fracos e Plano de Evolução
  com tarefas por semana;
- **Repertório Sugerido**: ideias por cor, **Repertório em Alerta** e rating médio.

### 5.1 Aberturas

A aba **Aberturas** usa a base aberta do Lichess (`lichess-org/chess-openings`, CC0),
embutida em `vendor/eco/openings.json` (cerca de 3.865 linhas). O reconhecimento usa o
**maior prefixo de lances** conhecido, então uma variante nomeada vence a abertura-mãe.

A tabela separa por cor e mostra: jogos, V/E/D, aproveitamento, precisão média, rating
médio e último jogo (clicável). A base é local: funciona offline e não envia nada.

### 5.2 Leitura sem assistente

Se o assistente estiver desligado, sem cota ou sem internet, a Leitura do Acervo e o
Repertório são gerados por um **modo local determinístico**: os mesmos números alimentam
um texto pronto, sem chamar modelo nenhum. O rodapé indica a origem (“leitura local”).

---

## 6. Assistente (opcional)

O assistente escreve resumos, comenta a leitura do acervo, monta repertório e sugere
tags. Ele **não calcula** estatísticas: recebe os números já calculados pelo aplicativo.

### 6.1 Modos

Em **Ajustes → Assistente de IA → Configuração avançada**:

| Modo | Quando usar |
|---|---|
| **Automático** | Ollama quando o site está no seu PC; proxy quando está publicado |
| **Somente no meu PC** | sempre `localhost:11434` (não funciona no site publicado) |
| **Somente pelo site (código)** | sempre o proxy, com código de acesso |

### 6.2 Ollama no PC

1. Instale o Ollama: <https://ollama.com/download>.
2. Baixe um modelo: `ollama pull qwen2.5:3b` (bom para 8 GB de RAM, sem GPU).
3. Libere a origem do aplicativo:

```bat
setx OLLAMA_ORIGINS "*"
```

4. Feche o Ollama por completo (inclusive o ícone da bandeja) e abra de novo.
5. Em **Ajustes**, confira `http://localhost:11434`, escolha o modelo e clique em
   **Testar assistente**.

> Com `qwen2.5:3b` em CPU, um resumo leva de 40 a 90 segundos. O texto aparece aos
> poucos e o botão fica desabilitado até terminar.

### 6.3 Site publicado (proxy na Vercel)

No site publicado, o navegador **nunca vê a chave** do provedor. Ele chama o proxy do
próprio site, que:

1. valida o código de acesso;
2. aplica cota diária por pessoa e global;
3. tenta o provedor principal e, se falhar, o de reserva;
4. repassa a resposta em streaming, sem guardar o conteúdo.

O contrato é o mesmo do Ollama (`/api/chat` em NDJSON), então o aplicativo não precisa
saber qual provedor está atrás.

---

## 7. Publicar na Vercel

O site é **estático + funções Edge**. Plano Hobby é suficiente para ~20 pessoas.

### 7.1 Enviar o projeto

1. Crie um repositório no GitHub e envie a pasta do projeto (sem `.env`).
2. Na Vercel, **Add New → Project** e importe o repositório.
3. Framework: **Other**. Build command: vazio. Output directory: raiz (`.`).
4. Cada `git push` gera um novo deploy; pull requests geram previews.

### 7.2 Variáveis de ambiente

Configure em **Settings → Environment Variables** (veja `.env.example`):

| Variável | Para que serve |
|---|---|
| `AI_ACCESS_MODE` | `code` (recomendado) ou `ip` |
| `AI_ACCESS_CODES` | códigos separados por vírgula, um por pessoa |
| `AI_DAILY_PER_USER` | ações por pessoa por dia (padrão 20) |
| `AI_DAILY_GLOBAL` | ações no site por dia (padrão 500) |
| `AI_PROVIDER` | `ollama` ou `openai` |
| `AI_BASE_URL` | endereço do provedor |
| `AI_API_KEY` | chave do provedor (nunca vai ao navegador) |
| `AI_MODEL` | modelo usado no servidor |
| `AI_FALLBACK_*` | provedor de reserva (opcional) |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | cotas e cache duráveis (opcional) |

Sem Redis, as cotas ficam na memória de cada instância: funcionam, mas reiniciam em
novos deploys e não são compartilhadas. O plano gratuito do Upstash resolve isso.

### 7.3 Distribuir

1. Abra o site publicado.
2. Em **Ajustes → Configuração avançada**, cole o **código de acesso**.
3. Compartilhe o endereço e o código com cada pessoa.

Para revogar um acesso, remova o código da variável `AI_ACCESS_CODES` e salve (a Vercel
refaz o deploy). Cotas são por código e por dia.

### 7.4 Custos e limites

- Vercel Hobby: gratuito para uso pessoal e projetos pequenos.
- Provedor de IA: use modelos pequenos e baratos; a cota diária limita o gasto.
- Ollama local: gratuito, mas exige o PC ligado e um túnel se quiser usar no site.
- O aplicativo **não sincroniza** dados entre dispositivos: cada navegador tem o seu
  acervo. Para levar partidas de um lugar a outro, exporte/importe o backup JSON.

---

## 8. Dados, backups e privacidade

- **IndexedDB**: partidas, lances, análises, tags e textos do assistente.
- **localStorage**: preferências (tema, perfil, modo do assistente, códigos).
- O proxy não guarda o conteúdo das conversas; usa cache apenas para respostas auxiliares
  e cotas.
- Limpar os dados do navegador **apaga o acervo**. Mantenha backups em
  **Ajustes → Backup completo (JSON)**.
- Ao trocar de domínio (por exemplo, do PC para a Vercel), exporte o JSON no antigo e
  importe no novo.

---

## 9. Acessibilidade e atalhos

- Navegação por teclado na biblioteca (linhas com `Enter`/`Espaço`), nas abas da partida
  (setas) e no modal (`Tab` preso ao diálogo, `Esc` fecha).
- Área de importação acessível por teclado.
- Textos alternativos, `aria-label`, foco visível e suporte a `prefers-reduced-motion`.
- Layout com `100dvh`, adequado à barra de endereço do celular.

---

## 10. Problemas comuns

| Sintoma | Solução |
|---|---|
| “A análise com Stockfish precisa do iniciar.bat” | Abra pelo `iniciar.bat`; `file://` bloqueia o Web Worker. |
| Porta 8765 ocupada | Rode `powershell -File servidor.ps1 -Port 9000` ou feche o outro servidor. |
| Assistente offline no PC | Confira o Ollama aberto, o modelo baixado e `OLLAMA_ORIGINS`. |
| “Código de acesso inválido” no site | Confira o código em **Configuração avançada** e se ele está em `AI_ACCESS_CODES`. |
| “Limite diário atingido” | Espere o próximo dia (a cota zera à meia-noite UTC) ou aumente a cota. |
| Resposta cortada | Aumente o contexto nos Ajustes ou reduza o texto (partidas longas são truncadas em 140 lances). |
| Importação com avisos | O PGN pode ter lance ilegal ou notação exótica; a partida entra até o ponto válido e o aviso aparece no relatório. |
| Abertura não reconhecida | A base cobre as linhas nomeadas mais comuns; o cabeçalho original do PGN é mantido. |
| Relatório PDF não abre | Libere pop-ups para o site; a janela de impressão é aberta como pop-up. |

---

## 11. Estrutura do projeto

```
index.html              telas e regiões acessíveis
style.css               tema claro/escuro e responsividade
servidor.ps1            servidor local (sem dependências)
iniciar.bat             atalho para abrir o aplicativo
package.json            metadados e script de verificação
vercel.json             cabeçalhos e configuração de deploy
.env.example            variáveis do assistente publicado
tools/check-syntax.cjs  verificação de sintaxe/JSON antes de publicar
api/_lib.js             utilidades do proxy (cota, cache, provedores)
api/chat.js             proxy de conversa em streaming
api/tags.js             status/modelos do assistente publicado
js/pgn.js               leitura/validação/geração de PGN
js/pgn-worker.js        leitura de PGN em segundo plano
js/storage.js           IndexedDB e preferências
js/board.js             tabuleiro e peças SVG
js/engine.js            Stockfish, anotações, precisão e brilhantes
js/openings.js          base de aberturas e reconhecimento por prefixo
js/tags.js              tags fixas por lado
js/ai.js                cliente do assistente (local/proxy) e prompts
js/stats.js             estatísticas locais e brief para a IA
js/app.js               estado, navegação, modais e migração
js/library.js           importação, duplicatas, seleção, filtros e exportação
js/game.js              tabuleiro, lances, análise, tags e relatório PDF
js/analytics.js         estatísticas, aberturas, leitura e repertório
js/settings.js          ajustes, backups e análise em lote
vendor/                 chess.js, Stockfish, peças e base de aberturas
legacy-treino-finais/   versão anterior do projeto (congelada)
```

Antes de publicar, rode:

```bat
node tools/check-syntax.cjs
```

O script confere a sintaxe de todos os arquivos de `js/` e `api/` e valida os JSON.

---

## 12. Roteiro de teste manual

| # | Cenário | Resultado esperado |
|---|---|---|
| 1 | Importar um PGN novo | partidas entram, relatório sem erros |
| 2 | Importar o mesmo PGN | modal “Partidas repetidas” |
| 3 | Escolher “só as novas” | nada é duplicado |
| 4 | Escolher “criar cópias” | entram com `_c2`, relatório conta cópias |
| 5 | Selecionar 2 partidas | barra em lote aparece com a contagem |
| 6 | Favoritar/tag/exportar em lote | ação aplicada só às selecionadas |
| 7 | Analisar uma partida | símbolos na lista, cartões de precisão, tags por lado |
| 8 | Abrir aba Aberturas | tabela com V/E/D, aproveitamento e último jogo |
| 9 | Gerar Leitura com assistente desligado | texto local com aviso de origem |
| 10 | Gerar Relatório PDF | janela de impressão com a ficha |
| 11 | Navegar só com teclado | foco visível, abas e modal funcionando |
| 12 | Abrir no celular | layout sem rolagem horizontal, toques confortáveis |

Navegadores verificados no roteiro: Chrome/Edge (desktop), Opera GX, Chrome Android e
Safari iOS.

---

## 13. Licenças e créditos

- **Stockfish** — GPLv3. Cópia da licença em `vendor/stockfish/LICENSE-GPLv3.txt`.
  Build WebAssembly de <https://github.com/nmrugg/stockfish.js>.
- **chess.js** 0.10.3 — licença BSD. Arquivo `vendor/chess.js`.
- **Peças cburnett** — CC BY-SA 3.0, de Colin M.L. Burnett, via repositório público do
  Lichess. Veja `vendor/pieces/LICENSE.txt`.
- **Base de aberturas** — `lichess-org/chess-openings`, domínio público (CC0). Texto da
  licença em `vendor/eco/COPYING.txt`; gerada por `vendor/eco/build.cjs` a partir dos
  TSV oficiais.
- **Ollama** e os modelos baixados seguem suas próprias licenças.
