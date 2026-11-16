/* ========================================================================
   ARQUIVO: js/ai.js
   DESCRIÇÃO: Cliente do assistente de IA e construção dos prompts em
   português. O endereço é configurável: Ollama no próprio PC ou um serviço
   intermediário (proxy) publicado junto com o site.
   Recursos: teste de conexão, respostas em streaming, JSON estruturado,
   resumo de partida, tags por lado, leitura do acervo, repertório e chat
   (o chat está desligado na interface desta versão).
   ======================================================================== */

const AI = (() => {
    const TAG_VOCABULARY = [
        'tático', 'ataque ao rei', 'sacrifício', 'final de peões', 'final de peças',
        'posicional', 'abertura teórica', 'erro grave', 'virada', 'empate técnico',
        'brilhantismo', 'defesa', 'promoção', 'rei exposto', 'estrutura de peões',
        'coluna aberta', 'peça presa', 'iniciativa',
    ];

    const SYSTEM = `Você é um treinador de xadrez brasileiro, didático e direto. Responda sempre em português do Brasil.
Regras obrigatórias:
- Use apenas as informações fornecidas (cabeçalhos, lances e avaliações do Stockfish).
- Nunca invente lances, lances legais ou números de avaliação.
- Ao citar um lance, use a notação SAN exatamente como aparece nos dados.
- Se faltar informação, diga que não há dados suficientes.
- Seja conciso, evite clichês e não repita a lista completa de lances.`;

    function isLocalHost() {
        return ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname) || location.protocol === 'file:';
    }

    function config() {
        const stored = Settings.get().ai || {};
        return {
            mode: stored.mode || 'auto',
            baseUrl: String(stored.baseUrl || 'http://localhost:11434').replace(/\/+$/, ''),
            proxyUrl: String(stored.proxyUrl || '').replace(/\/+$/, ''),
            accessCode: String(stored.accessCode || '').trim(),
            model: stored.model || 'qwen2.5:3b',
            temperature: Number.isFinite(Number(stored.temperature)) ? Number(stored.temperature) : 0.3,
            numCtx: Number(stored.numCtx) || 4096,
        };
    }

    /**
     * Decide se a chamada vai para o Ollama local ou para o proxy do site.
     * "auto" usa o Ollama quando a página está no próprio PC e o proxy quando
     * está publicada. Quem quiser forçar um dos dois escolhe nos Ajustes.
     */
    function useProxy() {
        const cfg = config();
        if (cfg.mode === 'proxy') return true;
        if (cfg.mode === 'local') return false;
        return !isLocalHost();
    }

    function proxyBase() {
        return config().proxyUrl;
    }

    function authHeaders() {
        const code = config().accessCode;
        return code ? { 'X-Acervo-Code': code } : {};
    }

    function setConfig(patch) {
        Settings.save({ ai: patch });
    }

    function describeError(error) {
        if (!error) return 'Erro desconhecido.';
        const message = error.message || String(error);
        if (error.name === 'AbortError') return 'Operação cancelada.';
        if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
            const where = useProxy() ? (proxyBase() || location.origin) : config().baseUrl;
            return `Não consegui falar com o assistente em ${where}. Verifique a conexão e o código de acesso.`;
        }
        return message;
    }

    function withTimeout(ms, signal) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException('Tempo esgotado.', 'TimeoutError')), ms);
        function forward() { controller.abort(signal.reason); }
        if (signal) {
            if (signal.aborted) controller.abort(signal.reason);
            else signal.addEventListener('abort', forward, { once: true });
        }
        return {
            signal: controller.signal,
            cleanup: () => {
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', forward);
            },
        };
    }

    async function check() {
        const timeout = withTimeout(8000);
        try {
            const url = useProxy()
                ? `${proxyBase()}/api/tags`
                : config().baseUrl + '/api/tags';
            const response = await fetch(url, { signal: timeout.signal, headers: authHeaders() });
            if (!response.ok) {
                if (response.status === 401) throw new Error('Código de acesso inválido ou ausente.');
                if (response.status === 503) throw new Error('O assistente deste site ainda não foi configurado.');
                throw new Error(`O assistente respondeu HTTP ${response.status}.`);
            }
            const data = await response.json();
            const models = (data.models || []).map(model => ({
                name: model.name,
                size: model.size,
                family: model.details && model.details.family,
            })).sort((a, b) => a.name.localeCompare(b.name));
            return { online: true, models };
        } catch (error) {
            return { online: false, error: describeError(error), models: [] };
        } finally {
            timeout.cleanup();
        }
    }

    function parseNdjsonChunk(text) {
        const objects = [];
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try { objects.push(JSON.parse(trimmed)); } catch (e) { /* linha parcial */ }
        }
        return objects;
    }

    async function request(messages, options) {
        const opts = options || {};
        const cfg = config();
        const body = {
            model: cfg.model,
            messages,
            stream: opts.stream !== false,
            options: {
                temperature: opts.temperature != null ? opts.temperature : cfg.temperature,
                num_ctx: cfg.numCtx,
            },
        };
        if (opts.format) body.format = opts.format;

        const timeout = withTimeout(opts.timeoutMs || 180000, opts.signal);
        const url = useProxy() ? `${proxyBase()}/api/chat` : cfg.baseUrl + '/api/chat';
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(body),
                signal: timeout.signal,
            });
        } catch (error) {
            timeout.cleanup();
            throw new Error(describeError(error));
        }

        if (!response.ok) {
            timeout.cleanup();
            let detail = `HTTP ${response.status}`;
            try {
                const payload = await response.json();
                if (payload.error) detail = typeof payload.error === 'string' ? payload.error : (payload.error.message || detail);
            } catch (e) { /* resposta sem JSON */ }
            if (response.status === 401) detail = 'Código de acesso inválido ou ausente. Confira a configuração avançada.';
            if (response.status === 429) detail = detail || 'Limite diário do assistente atingido.';
            throw new Error(detail);
        }

        if (!body.stream) {
            try {
                const payload = await response.json();
                timeout.cleanup();
                return { text: (payload.message && payload.message.content) || '', raw: payload };
            } catch (error) {
                timeout.cleanup();
                throw new Error(describeError(error));
            }
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const object of parseNdjsonChunk(lines.join('\n'))) {
                    if (object.error) throw new Error(object.error);
                    const content = object.message && object.message.content ? object.message.content : '';
                    if (content) {
                        text += content;
                        if (opts.onToken) opts.onToken(content);
                    }
                    if (object.done) break;
                }
            }
            if (buffer.trim()) {
                for (const object of parseNdjsonChunk(buffer)) {
                    const content = object.message && object.message.content ? object.message.content : '';
                    if (content) {
                        text += content;
                        if (opts.onToken) opts.onToken(content);
                    }
                }
            }
        } finally {
            timeout.cleanup();
        }
        return { text };
    }

    /* ---------- montagem de contexto ---------- */
    function scoreText(score) {
        if (score == null) return '';
        return `precisão ${score}%`;
    }

    function gameMovesText(data, game) {
        const moves = data.moves || [];
        const max = 140;
        const parts = [];
        for (let i = 0; i < Math.min(moves.length, max); i += 2) {
            const white = moves[i] ? moves[i].san : '';
            const black = moves[i + 1] ? moves[i + 1].san : '';
            parts.push(`${i / 2 + 1}. ${white}${black ? ' ' + black : ''}`.trim());
        }
        if (moves.length > max) parts.push(`(mais ${moves.length - max} lances omitidos)`);
        return parts.join(' ');
    }

    /**
     * Lista as anotações de um lado em texto simples. Símbolos são mantidos
     * porque o modelo aprendeu a associá-los ao vocabulário enxadrístico:
     * !! brilhante, ★ melhor, × chance perdida, ?? capivarada, ? erro,
     * ! excelente, 👍 ótimo.
     */
    function annotationsText(counts) {
        if (!counts) return 'sem anotações';
        const labels = window.Engine && Engine.ANNOTATIONS
            ? Engine.ANNOTATION_ORDER
            : ['brilliant', 'best', 'missed', 'blunder', 'mistake', 'excellent', 'good'];
        const fallback = {
            brilliant: { symbol: '!!', label: 'brilhante' },
            best: { symbol: '★', label: 'melhor' },
            missed: { symbol: '×', label: 'chance perdida' },
            blunder: { symbol: '??', label: 'capivarada' },
            mistake: { symbol: '?', label: 'erro' },
            excellent: { symbol: '!', label: 'excelente' },
            good: { symbol: '👍', label: 'ótimo' },
        };
        const parts = labels
            .filter(key => Number(counts[key]) > 0)
            .map(key => {
                const info = window.Engine && Engine.annotationInfo ? Engine.annotationInfo(key) : fallback[key];
                return `${info.symbol} ${info.label.toLowerCase()} ${counts[key]}`;
            });
        return parts.length ? parts.join(', ') : 'sem anotações';
    }

    function gameContext(game, data, analysis) {
        const lines = [];
        lines.push(`Brancas: ${game.white}${game.whiteElo ? ' (' + game.whiteElo + ')' : ''}`);
        lines.push(`Pretas: ${game.black}${game.blackElo ? ' (' + game.blackElo + ')' : ''}`);
        lines.push(`Resultado: ${game.result} | Data: ${game.dateISO || game.headers.Date || '—'} | Evento: ${game.event || '—'}`);
        lines.push(`Abertura: ${game.opening || '—'}${game.eco ? ' (' + game.eco + ')' : ''} | Controle de tempo: ${game.timeControl || '—'}`);
        if (game.tags && game.tags.length) lines.push(`Tags do usuário: ${game.tags.join(', ')}`);
        lines.push('');
        lines.push('Lances: ' + gameMovesText(data, game));
        if (analysis) {
            lines.push('');
            lines.push(`Análise Stockfish (profundidade ${analysis.depth}): ${scoreText(analysis.accuracy.w)} nas brancas, ${scoreText(analysis.accuracy.b)} nas pretas.`);
            lines.push(`Anotações das brancas: ${annotationsText(analysis.counts.w)}.`);
            lines.push(`Anotações das pretas: ${annotationsText(analysis.counts.b)}.`);
            if (analysis.keyMoments && analysis.keyMoments.length) {
                lines.push('Momentos-chave (lance, jogador, anotação, melhor lance):');
                analysis.keyMoments.slice(0, 6).forEach(moment => {
                    const key = moment.annotation || (moment.cls === 'blunder' ? 'blunder' : 'mistake');
                    const info = window.Engine && Engine.annotationInfo
                        ? Engine.annotationInfo(key)
                        : { symbol: key === 'blunder' ? '??' : '?', label: key === 'blunder' ? 'Capivarada' : 'Erro' };
                    lines.push(`- ${Math.ceil(moment.ply / 2)}${moment.color === 'w' ? '.' : '...'} ${moment.san} (${moment.color === 'w' ? 'brancas' : 'pretas'}), ${info.symbol} ${info.label}${moment.bestSan ? ', melhor era ' + moment.bestSan : ''}`);
                });
            }
        } else {
            lines.push('');
            lines.push('Sem análise do Stockfish disponível. Não invente avaliações.');
        }
        return lines.join('\n');
    }

    function summaryMessages(game, data, analysis) {
        return [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: `Analise a partida abaixo e escreva um resumo comentado com estas seções, usando markdown simples:

## Visão geral
2 ou 3 frases sobre a abertura, o plano central e o caráter do jogo.

## Momentos decisivos
3 a 5 tópicos em lista com "-", cada um começando pelo número do lance exatamente como aparece nos dados (por exemplo, "4... g6"). Explique por que o lance mudou o jogo, usando as avaliações fornecidas.

## O que treinar
2 a 4 ações práticas e específicas para o jogador que você identificar como dono do acervo (se não for possível, fale para ambos os lados).

Limite de 320 palavras. Use somente lances que aparecem nos dados, com os números de lance fornecidos. Não invente lances, peças ou avaliações.

DADOS DA PARTIDA:
${gameContext(game, data, analysis)}`,
            },
        ];
    }

    function tagsMessages(game, data, analysis) {
        return [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: `Classifique a partida com 1 a 5 tags escolhidas SOMENTE da lista abaixo:
${TAG_VOCABULARY.join(', ')}

Responda apenas com JSON válido no formato {"tags": ["tag1", "tag2"]}. Sem explicações.

DADOS:
${gameContext(game, data, analysis)}`,
            },
        ];
    }

    function insightsMessages(brief) {
        return [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: `Abaixo estão estatísticas agregadas do meu acervo de partidas. Escreva uma leitura com estas seções, nesta ordem:

## Diagnóstico
Um parágrafo curto com o retrato geral (resultados, precisão, rating dos adversários e aberturas).

## Pontos fortes
3 a 5 tópicos iniciados por "-". Cada um deve citar um número dos dados.

## Pontos fracos
3 a 5 tópicos iniciados por "-". Priorize os padrões que mais custam pontos: capivaradas (??), erros (?), chances perdidas (×) e fases com pior precisão.

## Plano de Evolução
Divida em quatro semanas, com o título "### Semana 1" até "### Semana 4". Em cada semana, 2 ou 3 tarefas práticas e mensuráveis (o que estudar, quantas partidas jogar, o que revisar). Use as anotações !! (brilhante), ★ (melhor), × (chance perdida), ?? (capivarada), ? (erro), ! (excelente) e 👍 (ótimo) quando ajudarem a explicar.

Máximo de 500 palavras. Baseie cada afirmação nos números fornecidos. Não invente partidas, lances ou avaliações. Se algo não estiver nos dados, diga que não há dados suficientes.

ESTATÍSTICAS:
${JSON.stringify(brief, null, 2)}`,
            },
        ];
    }

    function repertoireMessages(brief) {
        return [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: `Com base nas aberturas que eu realmente jogo e nos meus resultados, sugira um repertório enxuto com estas seções, nesta ordem:

## Como brancas
## Como pretas
## Repertório em Alerta
Liste as aberturas com pior aproveitamento ou volume alto e resultado ruim. Para cada uma, diga em uma frase o que ajustar (linha, ideia ou simplesmente reduzir a frequência).

## Rating Médio dos Adversários
Comente o rating médio informado nos dados e o que ele implica para a escolha do repertório (por exemplo, evitar linhas que dependem de erros do adversário em ratings mais altos).

## Próximos passos
2 a 4 tarefas objetivas para as próximas duas semanas.

Cite apenas aberturas e linhas presentes nos dados. Se o rating médio não estiver nos dados, diga isso em vez de estimar. Máximo de 400 palavras.

DADOS:
${JSON.stringify(brief, null, 2)}`,
            },
        ];
    }

    function chatMessages(question, docs, brief) {
        return [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: `Responda à pergunta usando os trechos da minha biblioteca e as estatísticas abaixo. Cite os trechos com [número] quando forem relevantes. Se a resposta não estiver nos dados, diga o que falta. Máximo de 220 palavras.

PERGUNTA: ${question}

ESTATÍSTICAS GERAIS:
${JSON.stringify(brief)}

TRECHOS DA BIBLIOTECA:
${docs.length ? docs.join('\n') : 'Nenhum trecho recuperado.'}`,
            },
        ];
    }

    /* ---------- busca lexical no acervo ---------- */
    function normalizeText(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function tokensOf(text) {
        return normalizeText(text)
            .split(/[^a-z0-9]+/)
            .filter(token => token.length >= 3 && !['que', 'com', 'para', 'dos', 'das', 'por', 'uma', 'nas', 'nos', 'qual', 'quais', 'meus', 'minhas', 'sobre', 'onde', 'como'].includes(token));
    }

    function summaryText(record) {
        if (!record) return '';
        if (typeof record.text === 'string') return record.text;
        return '';
    }

    function retrieve(question, games, summaries, limit) {
        const tokens = tokensOf(question);
        const scored = games.map(game => {
            const summary = summaries[game.id] || '';
            const haystack = normalizeText([
                game.white, game.black, game.event, game.site, game.opening, game.eco,
                (game.tags || []).join(' '), (game.aiTags || []).join(' '), summary,
                game.result,
            ].join(' '));
            let score = 0;
            tokens.forEach(token => {
                if (haystack.includes(token)) score += 1;
                if (normalizeText(game.white).includes(token) || normalizeText(game.black).includes(token)) score += 2;
                if (normalizeText(game.opening).includes(token)) score += 2;
                if (normalizeText((game.aiTags || []).join(' ')).includes(token)) score += 2;
            });
            if (score > 0 && game.analysisSummary) score += 0.5;
            return { game, score, summary };
        });

        scored.sort((a, b) => b.score - a.score || (b.game.importedAt || 0) - (a.game.importedAt || 0));
        let chosen = scored.filter(item => item.score > 0).slice(0, limit || 6);
        if (!chosen.length) {
            chosen = scored
                .slice()
                .sort((a, b) => (b.game.dateISO || '').localeCompare(a.game.dateISO || ''))
                .slice(0, limit || 6);
        }
        return chosen;
    }

    function buildDocs(chosen) {
        return chosen.map((item, index) => {
            const game = item.game;
            const tags = [].concat(game.tags || [], game.aiTags || []).join(', ');
            const analysis = game.analysisSummary
                ? `Análise: precisão ${game.analysisSummary.accuracyW}% (brancas) e ${game.analysisSummary.accuracyB}% (pretas); erros graves ${game.analysisSummary.blundersW}/${game.analysisSummary.blundersB}.`
                : 'Sem análise de engine.';
            const summary = summaryText(item.summary).replace(/\s+/g, ' ').slice(0, 420);
            return `[${index + 1}] ${game.white} x ${game.black}, ${game.dateISO || 'sem data'}, resultado ${game.result}, ${game.opening || 'abertura não informada'}${game.eco ? ' (' + game.eco + ')' : ''}. Tags: ${tags || '—'}. ${analysis}${summary ? ' Resumo: ' + summary : ''}`;
        });
    }

    return {
        TAG_VOCABULARY,
        config,
        setConfig,
        useProxy,
        describeError,
        check,
        request,
        summaryMessages,
        tagsMessages,
        insightsMessages,
        repertoireMessages,
        chatMessages,
        retrieve,
        buildDocs,
        normalizeText,
        tokensOf,
        gameContext,
    };
})();

window.AI = AI;
