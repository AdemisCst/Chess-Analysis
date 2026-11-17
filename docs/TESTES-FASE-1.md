# Testes da Fase 1 — Chess-Analysis

**Executado em:** 16/11/2026  
**Ambiente:** Windows, Node.js v26.13.1, Edge headless, servidor local em
`http://127.0.0.1:8765/`.  
**Regra:** só entra aqui o que foi realmente executado. O que depende do usuário
ou de uma chave real aparece como pendência.

---

## 1. Sintaxe e JSON

Comando:

```powershell
node tools/check-syntax.cjs
```

Resultado: **aprovado**. Todos os arquivos de `js/` e `api/` passaram, além de
`vendor/eco/openings.json`, `opencode.json`, `package.json` e `vercel.json`.

---

## 2. Testes automatizados

Comando:

```powershell
npm test
```

Resultado: **15 testes aprovados, 0 falhas**.

Cobertura real:

- recusa de chaves de exemplo antes de chamar o provedor;
- `/api/tags` recusa chave de exemplo com HTTP 503 sem chamar a rede;
- `/api/chat` recusa configuração incompleta antes de gastar cota;
- validação de mensagens (corpo vazio, papel inválido, contexto grande);
- URL e corpo da API compatível com OpenAI/DeepSeek;
- rótulo público do provedor sem expor chave;
- mensagens seguras para 401, 404, 429 e 5xx;
- ausência de `dropZone`, “Código de acesso”, “Detalhes da conexão” e da frase
  sobre licenças;
- navegação com exatamente cinco áreas;
- presença do relatório, do aviso de privacidade e dos controles de consentimento;
- tema padrão escuro com alternativa `body.light`;
- ordem visual oficial das anotações;
- identidade nova nos exports e preservação do banco/chave legados;
- `.env.example` apontando para DeepSeek sem código de acesso.

Arquivos: `tests/api.test.mjs` e `tests/static.test.mjs`.

---

## 3. Fumaça no navegador (CDP)

Harness externo em `C:\Users\ademi\AppData\Local\Temp\opencode\cdp-test.mjs`,
executado contra o servidor local.

Resultado: **aprovado, sem erros de console e sem exceções**.

| Verificação | Resultado observado |
|---|---|
| Biblioteca limpa | 0 partidas |
| Importação de exemplos | 3 partidas, 0 duplicatas, 0 erros |
| Duplicatas | modal abriu; 3 cópias criadas e removidas |
| Aberturas | 4 linhas renderizadas |
| Partida | 33 botões de lance |
| Tags por lado | “A favor (brancas)” e “Contra (pretas)” preenchidas |
| Relatório | HTML contém “Relatório” e “Ficha da partida” |
| Teclado nas abas | seta direita ativou Análise com `aria-selected="true"` |
| Leitura local | diagnóstico e plano de evolução presentes |
| Repertório local | “Repertório em Alerta” e “Rating Médio” presentes |
| Seleção múltipla | 3 partidas marcadas, barra em lote visível |

---

## 4. Tema, navegação e privacidade

Harness: `C:\Users\ademi\AppData\Local\Temp\opencode\cdp-phase1.mjs`.

| Verificação | Resultado observado |
|---|---|
| Tema padrão | `theme: "dark"`, sem classe `light`, fundo `rgb(11, 18, 32)` |
| Ícone do tema | `☀` (ação disponível: clarear) |
| Áreas da navegação | `library`, `game`, `stats`, `ai`, `settings` |
| `aria-current` | Desempenho recebeu `page`; permaneceu ativo em Aberturas |
| IA bloqueada | `AI.check()` retornou `online: false`, `code: privacy_blocked` |
| Chamadas externas com bloqueio | **0** (`window.fetch` não foi chamado) |
| Aviso de privacidade | “IA externa desativada. Nenhum dado sai deste navegador…” |
| Leitura do acervo bloqueada | caiu no modo local, com “Diagnóstico” e “Plano de Evolução” |

O teste comprova que “Não enviar dados à IA” impede a chamada externa; não é
apenas um aviso visual.

---

## 5. Análise real com Stockfish

A mesma execução analisou uma partida real dos exemplos com profundidade 8.

| Métrica | Valor observado |
|---|---|
| Profundidade | 8 |
| Precisão das brancas | 84,3% |
| Precisão das pretas | 77,8% |
| ACPL das brancas | 61 |
| ACPL das pretas | 129 |
| Momentos críticos | 5 |
| Série para o gráfico | presente (`winPctWhite`) |

Ordem das anotações verificada na tabela do relatório:

1. Brilhante (`!!`)
2. Excelente (`!`)
3. Melhor (`★`)
4. Ótimo (`👍`)
5. Erro (`?`)
6. Chance perdida (`×`)
7. Capivarada (`??`)

---

## 6. Relatório / PDF

O HTML do relatório foi construído pelo módulo `js/report.js` com a análise real
acima e convertido pelo próprio navegador:

```powershell
msedge.exe --headless=new --disable-gpu --no-pdf-header-footer `
  --print-to-pdf="report-test.pdf" "file:///.../report-test.html"
```

Resultado observado:

| Verificação | Resultado |
|---|---|
| Cabeçalho do arquivo | `%PDF-` |
| Tamanho | 134.961 bytes |
| Páginas estimadas | 3 |
| Ficha da partida | presente |
| Gráfico de avaliação | presente |
| Classificação dos lances | presente |
| Momentos críticos | presente |
| Variante do Stockfish (PV em SAN) | presente |
| Recomendações de estudo | presente |
| Texto “Acervo 64” | ausente |
| Texto “localhost” | ausente |

O relatório inclui ainda precisão, ACPL, fases, explicação da perda em pontos
percentuais e, quando não há análise ou resumo, declara isso em vez de inventar
dados.

---

## 7. O que ainda não foi validado

Estas pendências dependem de ação externa e **não** foram marcadas como
aprovadas:

1. **Backup real do usuário**: a estrutura de exportação/restauração foi revisada
   no código e o teste automatizado confere os nomes, mas nenhum backup real da
   biblioteca do usuário foi exportado e restaurado nesta máquina.
2. **IA DeepSeek ponta a ponta**: o proxy valida a credencial em `/models`, mas a
   chave real precisa estar configurada na Vercel ou em `.env` local. Sem ela, o
   comportamento testado é justamente o modo indisponível, com mensagem clara.
3. **Produção na Vercel**: o deploy e a verificação HTTP das rotas `/api/tags` e
   `/api/chat` continuam pendentes de variável real e autorização de publicação.
4. **Stockfish 19/WDL**: a versão do arquivo em `vendor/` continua “a validar”; o
   código usa o rótulo “Stockfish 10 (WASM)” e não promete a versão 19.
