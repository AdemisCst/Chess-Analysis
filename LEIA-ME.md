# Acervo 64 — Organizador de partidas de xadrez

Aplicativo local para importar, organizar, revisar e analisar partidas em **PGN**, com
análise objetiva do **Stockfish** e comentários de um **modelo de linguagem rodando na
sua máquina** (Ollama). Nada é enviado para a internet.

---

## 1. Como abrir

1. Dê **duplo clique em `iniciar.bat`**.
2. O navegador abre em `http://localhost:8765/`.
3. Para encerrar, feche a janela preta do servidor.

> O `iniciar.bat` é necessário para a análise com Stockfish (Web Worker + WebAssembly).
> Se você abrir `index.html` diretamente, a biblioteca e a IA ainda funcionam, mas a
> análise de lances fica indisponível.

Requisitos: Windows, PowerShell (já vem no sistema) e um navegador atualizado
(Chrome, Edge ou Firefox).

---

## 2. Configurar a IA local (Ollama)

A IA é **opcional**: todas as funções de biblioteca, tabuleiro e Stockfish funcionam sem ela.

### 2.1 Instalar

1. Baixe o Ollama em <https://ollama.com/download> e instale.
2. Abra o terminal (Prompt de Comando) e baixe um modelo:

```bat
ollama pull qwen2.5:3b
```

`qwen2.5:3b` é a recomendação para máquinas com 8 GB de RAM e sem GPU. Se tiver mais
memória, `qwen2.5:7b` produz textos melhores (mais lento em CPU).

### 2.2 Liberar o acesso do navegador

O site roda em `http://localhost:8765`. Para o Ollama aceitar essa origem:

```bat
setx OLLAMA_ORIGINS "*"
```

Depois **feche completamente o Ollama** (inclusive o ícone na bandeja do Windows) e
abra de novo. Alternativamente, encerre o aplicativo e rode no terminal:

```bat
set OLLAMA_ORIGINS=*
ollama serve
```

### 2.3 Conectar no aplicativo

1. Abra **Ajustes** no menu lateral.
2. Confira o endereço `http://localhost:11434` e o modelo `qwen2.5:3b`.
3. Clique em **Testar conexão**.
4. O indicador no topo deve ficar verde: **IA pronta**.

Se o Ollama já estiver aberto quando você iniciar o aplicativo, ele aparece como
**IA pronta** automaticamente. A lista de modelos instalados é preenchida sozinha.

> Com `qwen2.5:3b` em CPU, um resumo de partida leva cerca de 40 a 90 segundos. O texto
> aparece aos poucos; o botão fica desabilitado até terminar.

---

## 3. O que dá para fazer

### Biblioteca
- Importar **um ou vários arquivos `.pgn`**, com várias partidas por arquivo.
- Arrastar e soltar arquivos na área de importação.
- Detectar e ignorar duplicatas automaticamente.
- Buscar por jogador, torneio, abertura, data, tags e favoritos.
- Filtros por sintaxe na busca: `white:Carlsen`, `black:Firouzja`, `result:1-0`,
  `eco:B20`, `tag:tático`, `date:2024`, `elo>2000`, `favoritos`.
- Exportar todo o acervo em PGN ou fazer backup completo em JSON.
- **Carregar exemplos** importa três partidas clássicas para você testar tudo.

### Partida
- Tabuleiro com peças SVG, coordenadas, destaque do último lance e do rei em xeque.
- Navegação por botões, clique na lista de lances ou teclado (`←`, `→`, `Home`, `End`).
- Girar o tabuleiro, copiar FEN e copiar o PGN.
- Etiquetas manuais e tags sugeridas pela IA.

### Análise com Stockfish
- Avaliação de todas as posições na profundidade escolhida (padrão 12).
- Gráfico de avaliação clicável, barra de avaliação ao lado do tabuleiro.
- Classificação de erros (imprecisão, erro, erro grave), precisão por jogador e
  momentos-chave que levam direto à posição.
- Resultado salvo no navegador; reabrir a partida não refaz a análise.
- **Ajustes → Analisar partidas pendentes** processa o acervo em lote, com progresso
  e botão de cancelar.

### IA local (Ollama)
- **Resumo comentado** da partida, em português, com base nas avaliações do Stockfish.
- **Tags automáticas** de um vocabulário controlado.
- **Leitura do acervo**: diagnóstico, pontos fortes, prioridades e plano de 4 semanas.
- **Repertório sugerido** a partir das aberturas que você realmente joga.
- **Chat com a biblioteca**: perguntas em linguagem natural, com citação das partidas.

Os números usados pela IA são sempre calculados localmente pelo aplicativo; o modelo
apenas interpreta os dados, o que reduz bastante as alucinações.

### Perfil (importante para as estatísticas)

Em **Ajustes → Perfil e tabuleiro**, informe como você aparece nos PGN. Use **ponto e
vírgula** para separar apelidos, por exemplo `Silva, Carlos; SilvaCarlos`. A vírgula é
mantida porque nomes de PGN costumam vir como “Sobrenome, Nome”.

Com o perfil preenchido, o aplicativo mostra aproveitamento por cor, evolução de rating
e repertório. Sem ele, tenta deduzir o jogador mais frequente do acervo.

---

## 4. Onde ficam meus dados

- **IndexedDB** do navegador: partidas, lances, análises, tags e textos da IA.
- **localStorage**: apenas preferências (tema, seu nome, endpoint e modelo).
- Nada é enviado para servidores externos. O único destino de rede é o Ollama em
  `localhost`.

Faça backups periódicos em **Ajustes → Backup completo (JSON)**. O JSON inclui tudo.
Limpar os dados do navegador apaga o acervo, então mantenha um backup.

---

## 5. Problemas comuns

| Sintoma | Solução |
|---|---|
| “A análise com Stockfish precisa do iniciar.bat” | Feche a aba e abra o projeto pelo `iniciar.bat`. |
| A porta 8765 está ocupada | Edite `iniciar.bat` e rode `powershell -File servidor.ps1 -Port 9000`, ou feche o outro servidor. |
| IA offline / erro de CORS | Confira se o Ollama está aberto, se o modelo foi baixado e se `OLLAMA_ORIGINS` foi configurado. |
| Modelo muito lento | Use `qwen2.5:3b`, feche outros programas e prefira resumos de partidas curtas. |
| Resposta cortada | Aumente o contexto nos Ajustes ou reduza o tamanho do texto (partidas longas são truncadas em 140 lances). |
| Importação com avisos | O PGN pode ter lance ilegal ou notação exótica; a partida é importada até o ponto válido e o aviso aparece na biblioteca. |

---

## 6. Estrutura do projeto

```
index.html          telas
style.css           tema claro/escuro e responsividade
servidor.ps1        servidor local (sem dependências)
iniciar.bat         atalho para abrir o aplicativo
js/pgn.js           leitura/validação/geração de PGN
js/storage.js       IndexedDB e preferências
js/board.js         tabuleiro e peças SVG
js/engine.js        Stockfish + classificação de lances
js/ai.js            cliente Ollama e prompts
js/stats.js         estatísticas locais
js/app.js           estado, navegação, modais e utilidades
js/library.js       importação, filtros, tabela e exportação
js/game.js          tabuleiro, lances, análise e IA da partida
js/analytics.js     estatísticas, insights, repertório e chat
js/settings.js      ajustes, backups e análise em lote
vendor/             chess.js, Stockfish e peças (funciona offline)
legacy-treino-finais/  versão anterior do projeto (treino por PDF)
```

---

## 7. Licenças e créditos

- **Stockfish** — GPLv3. Cópia da licença em `vendor/stockfish/LICENSE-GPLv3.txt`.
  Build WebAssembly de <https://github.com/nmrugg/stockfish.js>.
- **chess.js** 0.10.3 — licença BSD. Arquivo `vendor/chess.js`.
- **Peças cburnett** — CC BY-SA 3.0, de Colin M.L. Burnett, obtidas do repositório
  público do Lichess. Veja `vendor/pieces/LICENSE.txt`.
- **Ollama** e os modelos baixados seguem suas próprias licenças.

As peças e o Stockfish são distribuídos junto com o aplicativo para que ele funcione
sem internet.
