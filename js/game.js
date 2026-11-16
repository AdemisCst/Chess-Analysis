/* ========================================================================
   ARQUIVO: js/game.js
   DESCRIÇÃO: Tela da partida: tabuleiro, navegação por lances, análise
   Stockfish, resumo e tags da IA.
   ======================================================================== */

/* ===================== ABERTURA DA PARTIDA ===================== */
async function openGame(id) {
    const meta = State.games.find(game => game.id === id);
    if (!meta) return;
    const data = await DB.get('data', id);
    if (!data) {
        toast('Os lances desta partida não foram encontrados no banco local.', 'error');
        return;
    }

    State.current = meta;
    State.data = data;
    State.ply = 0;
    State.analysis = null;
    State.currentSummary = null;
    State.currentTagsRecord = null;

    try {
        const [analysis, summary, tagRecord] = await Promise.all([
            DB.getAnalysis(id),
            DB.getAI(id, 'summary'),
            DB.getAI(id, 'tags'),
        ]);
        // Análises antigas não têm anotações (!!, ★, ×, ??, ?, !, 👍).
        // O enriquecimento reaproveita as posições salvas, sem reanalisar.
        State.analysis = analysis ? Engine.enrichAnalysis(analysis, data) : null;
        if (State.analysis && State.analysis !== analysis) {
            DB.saveAnalysis(State.analysis).catch(error => {
                console.warn('Não foi possível salvar a análise enriquecida:', error);
            });
        }
        State.currentSummary = summary;
        State.currentTagsRecord = tagRecord;
        if (tagRecord && Array.isArray(tagRecord.tags) && tagRecord.tags.length) {
            const merged = new Set([].concat(meta.aiTags || [], tagRecord.tags));
            meta.aiTags = Array.from(merged);
        }
        // Tags por lado dependem da análise e das aberturas: recalcula ao abrir.
        if (window.Tags && Tags.apply(meta, State.analysis, data ? data.moves : null)) {
            DB.put('games', meta).catch(error => {
                console.warn('Não foi possível salvar as tags por lado:', error);
            });
        }
    } catch (error) {
        console.warn('Falha ao carregar dados da partida:', error);
    }

    const ident = identity();
    State.orientation = ident.name && Stats.userColor(meta, ident) === 'b' ? 'black' : 'white';
    switchGameTab('moves');
    renderGame();
    setView('game');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===================== CABEÇALHO E METADADOS ===================== */
function renderGameHeader() {
    const game = State.current;
    if (!game) return;
    const date = formatDate(game.dateISO, game.headers && game.headers.Date);
    $('gameTitle').textContent = `${game.white} × ${game.black}`;
    const parts = [date];
    if (game.event) parts.push(game.event);
    if (game.round && game.round !== '?') parts.push('Rodada ' + game.round);
    parts.push(openingLabel(game));
    $('gameSubtitle').textContent = parts.join(' · ');

    const color = userColorOf(game);
    const label = PGN.resultLabel(game.result, color);
    const banner = $('gameResult');
    let description = 'Sem resultado';
    if (game.result === '1/2-1/2') description = 'Empate';
    else if (game.result === '1-0') description = 'Vitória das brancas';
    else if (game.result === '0-1') description = 'Vitória das pretas';
    banner.textContent = `${label.text} · ${description}`;
    banner.className = 'result-banner ' + (
        game.result === '1/2-1/2' ? 'draw' :
        game.result === '*' ? '' :
        color ? label.cls : 'draw'
    );

    $('favBtn').textContent = game.favorite ? '★' : '☆';
    $('favBtn').title = game.favorite ? 'Remover dos favoritos' : 'Favoritar';
    $('analyzeBtn').textContent = State.analysis ? '⚡ Reanalisar' : '⚡ Analisar';

    const rows = [
        ['Evento', game.event || '—'],
        ['Local', game.site || '—'],
        ['Data', date],
        ['Rodada', game.round || '—'],
        ['Abertura', openingLabel(game)],
        ['Controle', game.timeControl || '—'],
        ['Elos', [game.whiteElo, game.blackElo].filter(Boolean).join(' / ') || '—'],
        ['Lances', String(game.plyCount || 0)],
        ['Arquivo', game.sourceFile || '—'],
    ];
    $('metaTable').innerHTML = rows
        .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
        .join('');
}

/** Chips das cinco tags fixas, separadas pelo lado a que pertencem. */
function renderSideTags() {
    const game = State.current;
    const box = $('gameSideTags');
    if (!game || !box || !window.Tags) return;
    Tags.ensure(game);
    const color = userColorOf(game);
    const groups = color
        ? [
            { label: `A favor (${color === 'w' ? 'brancas' : 'pretas'})`, color },
            { label: `Contra (${color === 'w' ? 'pretas' : 'brancas'})`, color: color === 'w' ? 'b' : 'w' },
        ]
        : [
            { label: 'Brancas', color: 'w' },
            { label: 'Pretas', color: 'b' },
        ];
    box.innerHTML = groups.map(group => {
        const list = Tags.forSide(game, group.color);
        const chips = list.length
            ? list.map(tag => `<span class="chip side-tag" title="${escapeHtml(Tags.DESCRIPTIONS[tag] || '')}">${escapeHtml(tag)}</span>`).join('')
            : '<span class="muted small">Nenhuma.</span>';
        return `<div class="side-tag-group"><span class="side-tag-label">${escapeHtml(group.label)}</span><div class="chips">${chips}</div></div>`;
    }).join('');
}

function renderTags() {
    const game = State.current;
    if (!game) return;
    renderSideTags();
    $('gameTags').innerHTML = (game.tags || []).length
        ? game.tags.map(tag => `<span class="chip">${escapeHtml(tag)} <button data-remove-tag="${escapeHtml(tag)}" title="Remover">✕</button></span>`).join('')
        : '<span class="muted small">Nenhuma tag.</span>';

    $('gameAiTags').innerHTML = (game.aiTags || []).length
        ? game.aiTags.map(tag => `<span class="chip accent">${escapeHtml(tag)} <button data-remove-aitag="${escapeHtml(tag)}" title="Remover">✕</button></span>`).join('')
        : '';

    $('aiTagsBox').innerHTML = (game.aiTags || []).length
        ? game.aiTags.map(tag => `<span class="chip success">${escapeHtml(tag)}</span>`).join('')
        : '<span class="muted small">Clique em “Tags IA” para classificar a partida.</span>';
}

function renderSummary() {
    const box = $('aiSummaryBox');
    const record = State.currentSummary;
    if (record && record.text) {
        box.innerHTML = renderMarkdown(record.text) +
            `<p class="muted small" style="margin-top:10px">${escapeHtml(aiRecordMeta(record))}</p>`;
    } else {
        box.innerHTML = '<p class="muted small">Gere um resumo comentado da partida com o assistente.</p>';
    }
}

/* ===================== POSIÇÃO E NAVEGAÇÃO ===================== */
function evalTextFor(position, index) {
    if (!position) return '—';
    if (position.mate != null) {
        const mate = index % 2 === 0 ? position.mate : -position.mate;
        if (mate === 0) return '#'; // lado a jogar está em xeque-mate
        return (mate > 0 ? '+M' : '−M') + Math.abs(mate);
    }
    let cp = position.cp == null ? 0 : position.cp;
    if (index % 2 === 1) cp = -cp;
    return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
}

function updateEvalBar() {
    const fill = $('evalFill');
    const top = $('evalTop');
    const bottom = $('evalBottom');
    if (!State.analysis || !State.analysis.positions || !State.analysis.positions[State.ply]) {
        fill.style.height = '50%';
        top.textContent = '—';
        bottom.textContent = '';
        return;
    }
    const position = State.analysis.positions[State.ply];
    const win = Engine.whiteWinPct(position, State.ply);
    fill.style.height = win + '%';
    const text = evalTextFor(position, State.ply);
    top.textContent = text;
    bottom.textContent = '';
}

function renderPosition() {
    const data = State.data;
    if (!data) return;
    const ply = State.ply;
    const fen = PGN.fenAt(data, ply);
    const last = ply > 0 ? data.moves[ply - 1] : null;
    let arrow = null;
    if (State.analysis && State.analysis.positions && State.analysis.positions[ply]) {
        const best = State.analysis.positions[ply].best;
        if (best && best.length >= 4) arrow = { from: best.slice(0, 2), to: best.slice(2, 4) };
    }

    Board.render(fen, {
        orientation: State.orientation,
        lastFrom: last ? last.from : null,
        lastTo: last ? last.to : null,
        check: true,
        arrow,
    });

    $('fenText').textContent = fen;
    if (ply === 0) $('plyLabel').textContent = 'Início';
    else if (ply >= data.moves.length) $('plyLabel').textContent = 'Final';
    else $('plyLabel').textContent = `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'} ${data.moves[ply - 1].san}`;

    updateEvalBar();
    renderEvalGraph();

    $$('#moveList .move-btn').forEach(button => {
        const active = Number(button.dataset.ply) === ply;
        button.classList.toggle('active', active);
        if (active) button.scrollIntoView({ block: 'nearest' });
    });
}

function setPly(ply) {
    if (!State.data) return;
    const max = State.data.moves.length;
    State.ply = Math.max(0, Math.min(max, Number(ply) || 0));
    renderPosition();
}

/**
 * Texto do tooltip de um lance anotado. Os pontos percentuais ficam aqui,
 * fora da lista visível, para não poluir a leitura da partida.
 */
function annotationTitle(record) {
    if (!record || !record.annotation) return '';
    const info = Engine.annotationInfo(record.annotation);
    const parts = [info.label];
    if (record.loss != null) parts.push(`perda de ${record.loss}pp`);
    if (record.bestSan) parts.push(`melhor era ${record.bestSan}`);
    if (record.sacrifice) parts.push(`material entregue: ${record.sacrifice}`);
    return parts.join(' · ');
}

/** Símbolo acessível (nunca só cor) de um lance anotado. */
function annotationBadge(record) {
    if (!record || !record.annotation) return '';
    const info = Engine.annotationInfo(record.annotation);
    const title = annotationTitle(record);
    return `<span class="ann-symbol ann-${record.annotation}" title="${escapeHtml(title)}" aria-hidden="true">${info.symbol}</span>`;
}

function moveButtonHtml(move, index, ply, analysis) {
    const record = analysis && Array.isArray(analysis.moves) ? analysis.moves[index] : null;
    const decorated = record && record.annotation;
    const info = decorated ? Engine.annotationInfo(record.annotation) : null;
    const title = decorated ? annotationTitle(record) : move.san;
    const aria = decorated ? `${move.san}, ${title}` : move.san;
    const className = decorated ? `ann-${record.annotation}` : '';
    return `<button class="move-btn ${className}" data-ply="${ply}" data-annotation="${decorated ? record.annotation : ''}"
                title="${escapeHtml(title)}" aria-label="${escapeHtml(aria)}">${escapeHtml(move.san)}${decorated ? ' ' + annotationBadge(record) : ''}</button>`;
}

function renderMoveList() {
    const data = State.data;
    if (!data) return;
    const moves = data.moves;
    if (!moves.length) {
        $('moveList').innerHTML = '<p class="no-moves">Esta partida não tem lances válidos.</p>';
        return;
    }
    const analysis = State.analysis;
    const rows = [];
    for (let index = 0; index < moves.length; index += 2) {
        const whitePly = index + 1;
        const blackPly = index + 2;
        const white = moves[index];
        const black = moves[index + 1];
        rows.push(`
            <div class="move-row">
                <span class="move-num">${index / 2 + 1}.</span>
                ${moveButtonHtml(white, index, whitePly, analysis)}
                ${black ? moveButtonHtml(black, index + 1, blackPly, analysis) : '<span></span>'}
            </div>`);
    }
    $('moveList').innerHTML = rows.join('');
    renderPosition();
}

/* ===================== ANÁLISE ===================== */
function updateAnalysisBar(percent, text) {
    $('analysisFill').style.width = Math.max(0, Math.min(100, percent * 100)) + '%';
    if (text) $('analysisText').textContent = text;
}

function renderEvalGraph() {
    const box = $('evalGraph');
    if (!box) return;
    if (!State.analysis || !State.analysis.winPctWhite || State.analysis.winPctWhite.length < 2) {
        box.innerHTML = '';
        return;
    }
    const values = State.analysis.winPctWhite;
    const count = values.length;
    const width = 320;
    const height = 108;
    const pad = 5;
    const x = index => pad + (index / (count - 1)) * (width - pad * 2);
    const y = value => pad + ((100 - value) / 100) * (height - pad * 2);
    const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
    const markerIndex = Math.min(State.ply, count - 1);
    const markerX = x(markerIndex);
    const markerY = y(values[markerIndex]);
    box.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Gráfico de avaliação">
            <line x1="${pad}" y1="${y(50)}" x2="${width - pad}" y2="${y(50)}" stroke="var(--border-strong)" stroke-dasharray="3 3" stroke-width="1"/>
            <polygon points="${area}" fill="var(--accent)" opacity="0.12"/>
            <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linejoin="round"/>
            <line x1="${markerX}" y1="${pad}" x2="${markerX}" y2="${height - pad}" stroke="var(--warning)" stroke-width="1" stroke-dasharray="2 2"/>
            <circle cx="${markerX}" cy="${markerY}" r="3.2" fill="var(--warning)"/>
        </svg>
        <div class="graph-caption"><span>Início</span><span>${count - 1} posições</span><span>Fim</span></div>`;
}

/** Contagem compacta de anotações por lado (só as que apareceram). */
function annotationCountsHtml(color) {
    const counts = State.analysis && State.analysis.counts ? State.analysis.counts[color] : null;
    if (!counts) return '';
    const parts = Engine.ANNOTATION_ORDER
        .filter(key => counts[key] > 0)
        .map(key => {
            const info = Engine.annotationInfo(key);
            return `<span class="ann-count ann-${key}" title="${info.label}: ${counts[key]}">
                        <span class="ann-symbol">${info.symbol}</span>${counts[key]}
                    </span>`;
        });
    return parts.length ? parts.join('') : '<span class="muted small">Sem anotações.</span>';
}

/** Legenda fixa dos sete símbolos, usada na análise e no relatório. */
function renderAnnotationLegend() {
    const box = $('annotationLegend');
    if (!box) return;
    box.innerHTML = Engine.ANNOTATION_ORDER.map(key => {
        const info = Engine.annotationInfo(key);
        return `<span class="ann-legend-item"><span class="ann-symbol ann-${key}" aria-hidden="true">${info.symbol}</span> ${info.label}</span>`;
    }).join('');
}

function renderAnalysisTab() {
    const analysis = State.analysis;
    const hint = $('analysisHint');
    renderAnnotationLegend();
    if (!analysis) {
        $('accuracyBox').innerHTML = '';
        $('keyMoments').innerHTML = '';
        renderEvalGraph();
        hint.classList.remove('hidden');
        hint.textContent = 'Clique em “Analisar” para gerar a análise com Stockfish.';
        return;
    }
    hint.classList.add('hidden');

    const accuracy = analysis.accuracy || {};
    const acpl = analysis.acpl || {};
    const card = (color, name) => {
        const value = accuracy[color] == null ? '—' : accuracy[color].toFixed(1).replace('.', ',') + '%';
        const acplValue = acpl[color] == null ? '—' : String(acpl[color]);
        return `<div class="accuracy-card">
            <span>${name}</span><strong>${value}</strong>
            <span>ACPL ${acplValue}</span>
            <div class="ann-counts">${annotationCountsHtml(color)}</div>
        </div>`;
    };
    $('accuracyBox').innerHTML = card('w', 'Brancas') + card('b', 'Pretas');

    if (!analysis.keyMoments || !analysis.keyMoments.length) {
        $('keyMoments').innerHTML = '<p class="muted small">Nenhuma capivarada, erro, chance perdida ou brilhante encontrado.</p>';
    } else {
        $('keyMoments').innerHTML = analysis.keyMoments.map(moment => {
            const key = moment.annotation || (moment.cls === 'blunder' ? 'blunder' : 'mistake');
            const info = Engine.annotationInfo(key);
            const mover = moment.color === 'w' ? 'brancas' : 'pretas';
            const moveNumber = Math.ceil(moment.ply / 2) + (moment.color === 'w' ? '.' : '...');
            const title = [info.label];
            if (moment.loss != null) title.push(`perda de ${moment.loss}pp`);
            if (moment.bestSan) title.push(`melhor era ${moment.bestSan}`);
            return `<button class="km-item ann-${key}" data-ply="${moment.ply}" title="${escapeHtml(title.join(' · '))}">
                        <span class="km-ply">${moveNumber}</span>
                        <span class="km-move"><span class="san">${escapeHtml(moment.san)}</span> · ${info.label} (${mover})</span>
                        <span class="km-symbol ann-${key}" aria-hidden="true">${info.symbol}</span>
                    </button>`;
        }).join('');
    }
    renderEvalGraph();
}

async function analyzeCurrent() {
    if (!State.current || !State.data) return;
    if (!Engine.supported()) {
        toast('A análise com Stockfish precisa que você abra o projeto com iniciar.bat.', 'warning');
        return;
    }
    if (State.analysisRun) {
        toast('Já existe uma análise em andamento.', 'info');
        return;
    }
    const controller = new AbortController();
    State.analysisRun = controller;
    const depth = Settings.get().depth;
    // Guarda a partida analisada: o usuário pode abrir outra enquanto o Stockfish trabalha.
    const game = State.current;
    const data = State.data;
    $('analysisBar').classList.remove('hidden');
    $('analyzeBtn').disabled = true;
    updateAnalysisBar(0, `Preparando Stockfish (profundidade ${depth})…`);

    try {
        const result = await Engine.analyzeGame(game, data, {
            depth,
            signal: controller.signal,
            onProgress: ({ done, total }) => {
                updateAnalysisBar(done / total, `Analisando posição ${done} de ${total}… (${Math.round((done / total) * 100)}%)`);
            },
        });
        await DB.saveAnalysis(result);
        game.analysisSummary = result.summary;
        game.analyzedDepth = Math.max(game.analyzedDepth || 0, depth);
        if (window.Tags) Tags.apply(game, result, State.data ? State.data.moves : null);
        await DB.put('games', game);
        if (State.current && State.current.id === game.id) {
            State.analysis = result;
            renderGameHeader();
            renderTags();
            renderAnalysisTab();
            renderMoveList();
            renderPosition();
        }
        renderLibrary();
        toast('Análise concluída e salva.', 'success');
    } catch (error) {
        if (error.name !== 'AbortError') {
            toast('Falha na análise: ' + error.message, 'error');
        }
    } finally {
        State.analysisRun = null;
        $('analyzeBtn').disabled = false;
        $('analysisBar').classList.add('hidden');
        updateAnalysisBar(0, '');
    }
}

/* ===================== IA NA PARTIDA ===================== */
async function generateSummary() {
    if (!State.current || !State.data) return;
    if (State.aiBusy) return;
    if (!(await requireAI())) return;

    const game = State.current;
    const data = State.data;
    const analysis = State.analysis;
    State.aiBusy = true;
    setAIBusy(true);
    switchGameTab('ai');
    const box = $('aiSummaryBox');
    const stream = streamTarget(box);
    const controller = new AbortController();
    State.aiController = controller;

    try {
        const response = await AI.request(
            AI.summaryMessages(game, data, analysis),
            { onToken: stream.push, signal: controller.signal }
        );
        stream.finish();
        const record = await DB.saveAI(game.id, 'summary', {
            text: response.text,
            model: AI.config().model,
            depth: analysis ? analysis.depth : null,
        });
        State.aiSummaries[game.id] = record;
        if (State.current && State.current.id === game.id) {
            State.currentSummary = record;
            box.innerHTML = renderMarkdown(record.text) +
                `<p class="muted small" style="margin-top:10px">${escapeHtml(aiRecordMeta(record))}</p>`;
        }
        toast('Resumo salvo.', 'success');
    } catch (error) {
        const message = error.name === 'AbortError' ? 'Geração cancelada.' : AI.describeError(error);
        stream.fail(message);
        toast(message, 'error');
    } finally {
        State.aiBusy = false;
        State.aiController = null;
        setAIBusy(false);
    }
}

function parseTagsReply(text) {
    let data = null;
    try { data = JSON.parse(text); } catch (error) { data = null; }
    if (!data) {
        const match = text.match(/\[[\s\S]*?\]/);
        if (match) { try { data = JSON.parse(match[0]); } catch (error) { data = null; } }
    }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.tags) ? data.tags : []);
    const normalized = [];
    list.forEach(tag => {
        const match = AI.TAG_VOCABULARY.find(item => Stats.normalize(item) === Stats.normalize(tag));
        if (match && !normalized.includes(match)) normalized.push(match);
    });
    return normalized.slice(0, 5);
}

async function generateTags() {
    if (!State.current || !State.data) return;
    if (State.aiBusy) return;
    if (!(await requireAI())) return;

    const game = State.current;
    const data = State.data;
    const analysis = State.analysis;
    State.aiBusy = true;
    setAIBusy(true);
    const controller = new AbortController();
    State.aiController = controller;
    try {
        const response = await AI.request(
            AI.tagsMessages(game, data, analysis),
            { format: 'json', onToken: () => {}, signal: controller.signal }
        );
        const tags = parseTagsReply(response.text);
        if (!tags.length) {
            toast('A IA não retornou tags válidas. Tente novamente.', 'warning');
            return;
        }
        game.aiTags = tags;
        await DB.put('games', game);
        await DB.saveAI(game.id, 'tags', { tags, model: AI.config().model });
        if (State.current && State.current.id === game.id) renderTags();
        renderLibrary();
        toast('Tags da IA salvas.', 'success');
    } catch (error) {
        const message = error.name === 'AbortError' ? 'Geração cancelada.' : AI.describeError(error);
        toast(message, 'error');
    } finally {
        State.aiBusy = false;
        State.aiController = null;
        setAIBusy(false);
    }
}

async function addTag(value) {
    const tag = String(value || '').trim();
    if (!tag || !State.current) return;
    if (!(State.current.tags || []).includes(tag)) {
        State.current.tags = [].concat(State.current.tags || [], [tag]);
        await DB.put('games', State.current);
        renderTags();
        renderLibrary();
    }
    $('tagInput').value = '';
}

async function removeTag(tag) {
    if (!State.current) return;
    State.current.tags = (State.current.tags || []).filter(item => item !== tag);
    await DB.put('games', State.current);
    renderTags();
    renderLibrary();
}

async function removeAITag(tag) {
    if (!State.current) return;
    State.current.aiTags = (State.current.aiTags || []).filter(item => item !== tag);
    await DB.put('games', State.current);
    await DB.saveAI(State.current.id, 'tags', { tags: State.current.aiTags, model: AI.config().model });
    renderTags();
    renderLibrary();
}

/* ===================== ABAS E RENDER GERAL ===================== */
function switchGameTab(tab) {
    $$('.tab-sm').forEach(button => {
        const active = button.dataset.gameTab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
    });
    $('gameTabMoves').classList.toggle('hidden', tab !== 'moves');
    $('gameTabAnalysis').classList.toggle('hidden', tab !== 'analysis');
    $('gameTabAi').classList.toggle('hidden', tab !== 'ai');
}

function renderGame() {
    if (!State.current || !State.data) return;
    $('noGame').classList.add('hidden');
    $('gameContent').classList.remove('hidden');
    renderGameHeader();
    renderTags();
    renderSummary();
    renderAnalysisTab();
    renderMoveList();
    renderPosition();
}

/* ===================== EVENTOS ===================== */
/**
 * Abre uma versão para impressão do relatório da partida. O navegador oferece
 * "Salvar como PDF" na janela de impressão; nada é enviado a servidores.
 */
function printGameReport() {
    const game = State.current;
    if (!game) return;
    const analysis = State.analysis;
    const summary = State.currentSummary && State.currentSummary.text;
    const counts = analysis && analysis.counts ? analysis.counts : { w: {}, b: {} };
    const rows = [
        ['Evento', game.event || '—'],
        ['Local', game.site || '—'],
        ['Data', formatDate(game.dateISO, game.headers && game.headers.Date)],
        ['Abertura', openingLabel(game)],
        ['Controle', game.timeControl || '—'],
        ['Resultado', game.result || '*'],
        ['Elos', [game.whiteElo, game.blackElo].filter(Boolean).join(' / ') || '—'],
    ];
    const annotationRows = analysis ? Engine.ANNOTATION_ORDER.map(key => {
        const info = Engine.annotationInfo(key);
        return `<tr><td>${info.symbol} ${info.label}</td><td>${counts.w[key] || 0}</td><td>${counts.b[key] || 0}</td></tr>`;
    }).join('') : '';
    const keyRows = analysis && analysis.keyMoments ? analysis.keyMoments.map(moment => {
        const info = Engine.annotationInfo(moment.annotation || 'mistake');
        return `<tr><td>${Math.ceil(moment.ply / 2)}${moment.color === 'w' ? '.' : '...'}</td>
            <td>${escapeHtml(moment.san)}</td><td>${info.symbol} ${info.label}</td>
            <td>${escapeHtml(moment.bestSan || '—')}</td></tr>`;
    }).join('') : '';
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
        <title>Relatório — ${escapeHtml(game.white)} × ${escapeHtml(game.black)}</title>
        <style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1b2432;max-width:820px;margin:28px auto;padding:0 20px;line-height:1.5}
            h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #d8dee8;padding-bottom:4px}
            table{width:100%;border-collapse:collapse;font-size:13px} td,th{border-bottom:1px solid #e4e9f1;padding:5px 6px;text-align:left}
            th{color:#667085;font-size:11px;text-transform:uppercase} .muted{color:#667085} .sym{font-weight:700}
            .cards{display:flex;gap:12px;margin:10px 0} .card{flex:1;border:1px solid #d8dee8;border-radius:8px;padding:10px}
            .card strong{font-size:20px;display:block} ul{margin:4px 0 10px 20px} @media print{body{margin:0}}
        </style></head><body>
        <h1>${escapeHtml(game.white)} × ${escapeHtml(game.black)}</h1>
        <p class="muted">${escapeHtml(formatDate(game.dateISO, game.headers && game.headers.Date))} · ${escapeHtml(openingLabel(game))} · ${escapeHtml(game.result || '*')}</p>
        <h2>Ficha da partida</h2>
        <table>${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}</table>
        ${analysis ? `<h2>Precisão e anotações</h2>
            <div class="cards">
                <div class="card"><span class="muted">Brancas</span><strong>${analysis.accuracy.w == null ? '—' : analysis.accuracy.w + '%'}</strong><span class="muted">ACPL ${analysis.acpl.w == null ? '—' : analysis.acpl.w}</span></div>
                <div class="card"><span class="muted">Pretas</span><strong>${analysis.accuracy.b == null ? '—' : analysis.accuracy.b + '%'}</strong><span class="muted">ACPL ${analysis.acpl.b == null ? '—' : analysis.acpl.b}</span></div>
            </div>
            <table><thead><tr><th>Anotação</th><th>Brancas</th><th>Pretas</th></tr></thead><tbody>${annotationRows}</tbody></table>
            ${keyRows ? `<h2>Momentos-chave</h2><table><thead><tr><th>Lance</th><th>Jogada</th><th>Anotação</th><th>Melhor</th></tr></thead><tbody>${keyRows}</tbody></table>` : ''}`
        : '<p class="muted">Partida ainda não analisada pelo Stockfish.</p>'}
        ${summary ? `<h2>Resumo do assistente</h2>${renderMarkdown(summary)}` : ''}
        <hr><p class="muted">Gerado pelo Acervo 64 em ${new Date().toLocaleString('pt-BR')}.</p>
        </body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
        toast('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', 'warning');
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch (error) { /* usuário pode imprimir manualmente */ } }, 350);
}

function bindGameEvents() {
    $('backToLibrary').addEventListener('click', () => setView('library'));
    $('firstBtn').addEventListener('click', () => setPly(0));
    $('prevBtn').addEventListener('click', () => setPly(State.ply - 1));
    $('nextBtn').addEventListener('click', () => setPly(State.ply + 1));
    $('lastBtn').addEventListener('click', () => setPly(State.data ? State.data.moves.length : 0));
    $('flipBtn').addEventListener('click', () => {
        Board.flip();
        State.orientation = Board.getOrientation();
        renderPosition();
    });

    $('analyzeBtn').addEventListener('click', analyzeCurrent);
    $('cancelAnalysisBtn').addEventListener('click', () => {
        $('analysisText').textContent = 'Cancelando…';
        if (State.analysisRun) State.analysisRun.abort();
        Engine.stop();
    });
    $('aiSummaryBtn').addEventListener('click', generateSummary);
    $('aiTagsBtn').addEventListener('click', generateTags);

    $('favBtn').addEventListener('click', () => {
        if (State.current) toggleFavorite(State.current.id);
    });
    $('deleteGameBtn').addEventListener('click', () => {
        if (State.current) deleteGame(State.current.id);
    });
    $('gamePdfBtn').addEventListener('click', printGameReport);
    $('copyPgnBtn').addEventListener('click', async () => {
        if (!State.data) return;
        try {
            await copyText(State.data.pgn);
            toast('PGN copiado.', 'success');
        } catch (error) {
            toast('Não foi possível copiar.', 'error');
        }
    });
    $('copyFenBtn').addEventListener('click', async () => {
        try {
            await copyText($('fenText').textContent);
            toast('FEN copiado.', 'success');
        } catch (error) {
            toast('Não foi possível copiar.', 'error');
        }
    });

    $('tagInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addTag(event.target.value);
        }
    });
    $('gameTags').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-tag]');
        if (button) removeTag(button.dataset.removeTag);
    });
    $('gameAiTags').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-aitag]');
        if (button) removeAITag(button.dataset.removeAitag);
    });

    $('moveList').addEventListener('click', event => {
        const button = event.target.closest('[data-ply]');
        if (button) setPly(Number(button.dataset.ply));
    });
    $('keyMoments').addEventListener('click', event => {
        const button = event.target.closest('[data-ply]');
        if (button) setPly(Number(button.dataset.ply));
    });
    $('evalGraph').addEventListener('click', event => {
        if (!State.analysis) return;
        const svg = $('evalGraph').querySelector('svg');
        if (!svg) return;
        const count = State.analysis.winPctWhite.length;
        const rect = svg.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        setPly(Math.round(ratio * (count - 1)));
    });

    $$('.tab-sm').forEach(button => {
        button.addEventListener('click', () => switchGameTab(button.dataset.gameTab));
    });

    // Navegação por teclado entre as abas, seguindo o padrão ARIA de tablist:
    // setas movem o foco e ativam a aba; Home/End vão para as pontas.
    const tabList = document.querySelector('.tabs-sm');
    if (tabList) {
        tabList.addEventListener('keydown', event => {
            const tabs = $$('.tab-sm');
            const current = tabs.findIndex(tab => tab.dataset.gameTab === (event.target.dataset && event.target.dataset.gameTab));
            if (current < 0) return;
            let next = current;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            const target = tabs[next];
            switchGameTab(target.dataset.gameTab);
            target.focus();
        });
    }
}
