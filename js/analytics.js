/* ========================================================================
   ARQUIVO: js/analytics.js
   DESCRIÇÃO: Tela de estatísticas (cálculo local) e tela de IA
   (leitura do acervo, repertório e chat com a biblioteca).
   ======================================================================== */

/* ===================== ESTATÍSTICAS ===================== */
function statCard(label, value, sub) {
    return `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div>
            <div class="stat-value">${escapeHtml(value)}</div>
            <div class="stat-sub">${escapeHtml(sub || '')}</div></div>`;
}

function pctText(value) {
    return value == null ? '—' : value.toFixed(1).replace('.', ',') + '%';
}

function renderStatsView() {
    const stats = Stats.compute(State.games, Settings.playerNameList());
    State.stats = stats;

    const identityBox = $('statsIdentity');
    if (stats.identity.name) {
        identityBox.className = stats.identity.inferred ? 'notice' : 'notice accent';
        identityBox.innerHTML = stats.identity.inferred
            ? `Identifiquei você como <strong>${escapeHtml(stats.identity.name)}</strong> (${stats.identity.games || ''} partidas). Se estiver errado, <button class="link-btn" data-open-settings>corrija seu nome</button>.`
            : `Perfil: <strong>${escapeHtml(stats.identity.name)}</strong>.`;
        identityBox.classList.remove('hidden');
    } else if (stats.total) {
        identityBox.className = 'notice';
        identityBox.innerHTML = `Ainda não sei qual jogador é você. <button class="link-btn" data-open-settings>Defina seu nome nos Ajustes</button> para ver aproveitamento por cor, rating e repertório.`;
        identityBox.classList.remove('hidden');
    } else {
        identityBox.classList.add('hidden');
    }

    if (!stats.total) {
        $('statsCards').innerHTML = '<div class="notice accent">Importe partidas para ver as estatísticas.</div>';
        $('openingsTable').innerHTML = '';
        $('colorTable').innerHTML = '';
        $('timeControlTable').innerHTML = '';
        $('phaseChart').innerHTML = '';
        $('ratingChart').innerHTML = '<div class="chart-empty">Sem dados.</div>';
        $('precisionPanel').innerHTML = '';
        $('annotationDistribution').innerHTML = '';
        $('phaseAccuracy').innerHTML = '';
        $('brilliantPhase').innerHTML = '';
        $('accuracyChart').innerHTML = '<div class="chart-empty">Sem dados.</div>';
        return;
    }

    const hasIdentity = !!stats.identity.name;
    const accuracyList = [stats.accuracy.w, stats.accuracy.b].filter(value => value != null);
    const avgAccuracy = accuracyList.length
        ? (accuracyList.reduce((sum, value) => sum + value, 0) / accuracyList.length).toFixed(1).replace('.', ',') + '%'
        : '—';

    if (hasIdentity) {
        $('statsCards').innerHTML = [
            statCard('Partidas', String(stats.total), `${stats.resultCounts['1/2-1/2']} empates`),
            statCard('Aproveitamento', pctText(stats.overall.pct), `${stats.overall.win}V · ${stats.overall.draw}E · ${stats.overall.loss}D`),
            statCard('Como brancas', pctText(stats.byColor.w.pct), `${stats.byColor.w.games} partidas`),
            statCard('Como pretas', pctText(stats.byColor.b.pct), `${stats.byColor.b.games} partidas`),
            statCard('Precisão média', avgAccuracy, `${stats.analyzed} partida(s) analisada(s)`),
            statCard('Rating', stats.eloSeries.length ? String(stats.eloSeries[stats.eloSeries.length - 1].elo) : '—', 'último registrado'),
        ].join('');
    } else {
        $('statsCards').innerHTML = [
            statCard('Partidas', String(stats.total), `${stats.resultCounts['*']} sem resultado`),
            statCard('Brancas venceram', String(stats.resultCounts['1-0']), 'resultado 1–0'),
            statCard('Empates', String(stats.resultCounts['1/2-1/2']), 'resultado ½–½'),
            statCard('Pretas venceram', String(stats.resultCounts['0-1']), 'resultado 0–1'),
            statCard('Analisadas', String(stats.analyzed), 'com Stockfish'),
            statCard('Precisão média', avgAccuracy, 'quando analisadas'),
        ].join('');
    }

    const openingRows = stats.openings.slice(0, 12).map(item => {
        if (hasIdentity) {
            return `<tr><td>${escapeHtml(item.name)}${item.eco ? ` <span class="muted small">${escapeHtml(item.eco)}</span>` : ''}</td>
                <td class="num">${item.games}</td><td class="num">${item.win}</td><td class="num">${item.draw}</td>
                <td class="num">${item.loss}</td><td class="num">${pctText(item.pct)}</td></tr>`;
        }
        return `<tr><td>${escapeHtml(item.name)}${item.eco ? ` <span class="muted small">${escapeHtml(item.eco)}</span>` : ''}</td>
            <td class="num">${item.games}</td><td class="num">${item.resultCounts['1-0'] || 0}</td>
            <td class="num">${item.resultCounts['1/2-1/2'] || 0}</td><td class="num">${item.resultCounts['0-1'] || 0}</td></tr>`;
    }).join('');
    $('openingsTable').innerHTML = `
        <table class="mini-table">
            <thead><tr><th>Abertura</th><th class="num">Jogos</th>${hasIdentity
                ? '<th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">%</th>'
                : '<th class="num">1–0</th><th class="num">½</th><th class="num">0–1</th>'}</tr></thead>
            <tbody>${openingRows || '<tr><td colspan="6" class="muted">Sem dados.</td></tr>'}</tbody>
        </table>`;

    if (hasIdentity) {
        const colorRow = (label, record) => `<tr><td>${label}</td><td class="num">${record.games}</td>
            <td class="num">${record.win}</td><td class="num">${record.draw}</td><td class="num">${record.loss}</td>
            <td class="num">${pctText(record.pct)}</td></tr>`;
        $('colorTable').innerHTML = `<table class="mini-table">
            <thead><tr><th>Cor</th><th class="num">Jogos</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">%</th></tr></thead>
            <tbody>${colorRow('Brancas', stats.byColor.w)}${colorRow('Pretas', stats.byColor.b)}</tbody></table>`;
    } else {
        $('colorTable').innerHTML = `<table class="mini-table">
            <thead><tr><th>Resultado</th><th class="num">Partidas</th></tr></thead>
            <tbody>
                <tr><td>Brancas venceram</td><td class="num">${stats.resultCounts['1-0']}</td></tr>
                <tr><td>Empates</td><td class="num">${stats.resultCounts['1/2-1/2']}</td></tr>
                <tr><td>Pretas venceram</td><td class="num">${stats.resultCounts['0-1']}</td></tr>
                <tr><td>Sem resultado</td><td class="num">${stats.resultCounts['*']}</td></tr>
            </tbody></table>`;
    }

    $('timeControlTable').innerHTML = `<table class="mini-table">
        <thead><tr><th>Tipo</th><th class="num">Jogos</th>${hasIdentity ? '<th class="num">%</th>' : ''}</tr></thead>
        <tbody>${stats.timeControls.map(item => `<tr><td>${escapeHtml(item.name)}</td>
            <td class="num">${item.games}</td>${hasIdentity ? `<td class="num">${pctText(item.pct)}</td>` : ''}</tr>`).join('') ||
            '<tr><td colspan="3" class="muted">Sem dados.</td></tr>'}</tbody></table>`;

    const phaseTotal = stats.phases.opening + stats.phases.middlegame + stats.phases.endgame;
    if (!phaseTotal) {
        $('phaseChart').innerHTML = '<p class="muted small">Analise partidas com Stockfish para ver em que fase os erros graves acontecem.</p>';
    } else {
        const maxPhase = Math.max(stats.phases.opening, stats.phases.middlegame, stats.phases.endgame, 1);
        const rows = [
            ['Abertura', stats.phases.opening],
            ['Meio-jogo', stats.phases.middlegame],
            ['Final', stats.phases.endgame],
        ];
        $('phaseChart').innerHTML = rows.map(([label, value]) => `
            <div class="phase-row">
                <div class="phase-top"><span>${label}</span><span>${Math.round(value)}</span></div>
                <div class="phase-bar"><span style="width:${Math.round((value / maxPhase) * 100)}%"></span></div>
            </div>`).join('');
    }

    renderPrecisionPanel(stats);
    renderAnnotationDistribution(stats);
    renderPhaseAccuracy(stats);
    renderBrilliantPhase(stats);
    renderAccuracyChart(stats);
    renderRatingChart(stats);
}

/* ---------- precisão, ACPL, anotações e brilhantes ---------- */
function renderPrecisionPanel(stats) {
    const box = $('precisionPanel');
    if (!box) return;
    const precision = stats.precision;
    if (!precision || !precision.user.games) {
        box.innerHTML = '<p class="muted small">Analise pelo menos uma partida com Stockfish para comparar sua precisão com a dos adversários.</p>';
        return;
    }
    const card = (label, data) => `<div class="precision-card">
        <span>${label}</span>
        <strong>${pctText(data.accuracy)}</strong>
        <span>ACPL ${data.acpl == null ? '—' : data.acpl} · ${data.games} partida(s)</span>
    </div>`;
    box.innerHTML = `<div class="precision-grid">${card('Você', precision.user)}${card('Adversários', precision.opponent)}</div>`;
}

function renderAnnotationDistribution(stats) {
    const box = $('annotationDistribution');
    if (!box) return;
    const user = stats.annotations.user;
    const opponent = stats.annotations.opponent;
    const total = Engine.ANNOTATION_ORDER.reduce((sum, key) => sum + user[key] + opponent[key], 0);
    if (!total) {
        box.innerHTML = '<p class="muted small">As anotações aparecem depois de analisar partidas com Stockfish.</p>';
        return;
    }
    const rows = Engine.ANNOTATION_ORDER.map(key => {
        const info = Engine.annotationInfo(key);
        return `<tr>
            <td><span class="ann-symbol ann-${key}">${info.symbol}</span> ${info.label}</td>
            <td class="num">${user[key]}</td>
            <td class="num">${opponent[key]}</td>
        </tr>`;
    }).join('');
    box.innerHTML = `<table class="mini-table">
        <thead><tr><th>Anotação</th><th class="num">Você</th><th class="num">Adversário</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function renderPhaseAccuracy(stats) {
    const box = $('phaseAccuracy');
    if (!box) return;
    const phase = stats.precision.phase;
    const rows = [
        ['Abertura', phase.opening],
        ['Meio-jogo', phase.middlegame],
        ['Final', phase.endgame],
    ];
    if (!rows.some(([, data]) => data.user != null || data.opponent != null)) {
        box.innerHTML = '<p class="muted small">Sem precisão por fase. Analise partidas com Stockfish.</p>';
        return;
    }
    box.innerHTML = `<table class="mini-table">
        <thead><tr><th>Fase</th><th class="num">Você</th><th class="num">Adversário</th></tr></thead>
        <tbody>${rows.map(([label, data]) => `<tr>
            <td>${label}</td><td class="num">${pctText(data.user)}</td><td class="num">${pctText(data.opponent)}</td>
        </tr>`).join('')}</tbody></table>`;
}

function renderBrilliantPhase(stats) {
    const box = $('brilliantPhase');
    if (!box) return;
    const phases = stats.brilliantPhases;
    const total = phases.opening.total + phases.middlegame.total + phases.endgame.total;
    if (!total) {
        box.innerHTML = '<p class="muted small">Nenhum lance brilhante detectado ainda. A marcação exige sacrifício correto ou grande virada.</p>';
        return;
    }
    const rows = [
        ['Abertura', phases.opening],
        ['Meio-jogo', phases.middlegame],
        ['Final', phases.endgame],
    ];
    const max = Math.max(...rows.map(([, data]) => data.total), 1);
    box.innerHTML = rows.map(([label, data]) => `
        <div class="phase-row">
            <div class="phase-top"><span>${label}</span><span>${data.total}${data.user ? ` · ${data.user} seu(s)` : ''}</span></div>
            <div class="phase-bar brilliant"><span style="width:${Math.round((data.total / max) * 100)}%"></span></div>
        </div>`).join('');
}

function renderAccuracyChart(stats) {
    const box = $('accuracyChart');
    if (!box) return;
    const series = stats.precision.series || [];
    if (series.length < 2) {
        box.innerHTML = '<div class="chart-empty">São necessárias pelo menos duas partidas analisadas com data para ver a evolução da precisão.</div>';
        return;
    }
    const width = 720;
    const height = 220;
    const padX = 42;
    const padY = 24;
    const x = index => padX + (index / (series.length - 1)) * (width - padX * 2);
    const y = value => padY + ((100 - value) / 100) * (height - padY * 2);
    const points = series.map((point, index) => `${x(index).toFixed(1)},${y(point.accuracy).toFixed(1)}`).join(' ');
    const grid = [0, 25, 50, 75, 100].map(value => {
        const gy = y(value);
        return `<line x1="${padX}" y1="${gy}" x2="${width - padX}" y2="${gy}" stroke="var(--border)" stroke-width="1"/>
                <text x="${padX - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${value}%</text>`;
    }).join('');
    const dots = series.map((point, index) => `
        <circle cx="${x(index).toFixed(1)}" cy="${y(point.accuracy).toFixed(1)}" r="3.2" fill="var(--accent)" data-game="${escapeHtml(point.gameId)}">
            <title>${escapeHtml(`${formatDate(point.date)} · ${point.accuracy.toFixed(1).replace('.', ',')}% · ${point.opponent}`)}</title>
        </circle>`).join('');
    box.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Precisão ao longo do tempo">
            ${grid}
            <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
            ${dots}
        </svg>
        <p class="muted small">${series.length} partida(s) analisada(s) · de ${formatDate(series[0].date)} a ${formatDate(series[series.length - 1].date)}. Clique em um ponto para abrir a partida.</p>`;
}

function renderRatingChart(stats) {
    const box = $('ratingChart');
    if (!stats.identity.name) {
        box.innerHTML = '<div class="chart-empty">Defina seu nome para acompanhar a evolução do rating.</div>';
        return;
    }
    const series = stats.eloSeries;
    if (series.length < 2) {
        box.innerHTML = '<div class="chart-empty">São necessárias pelo menos duas partidas com rating e data.</div>';
        return;
    }
    const width = 720;
    const height = 220;
    const padX = 46;
    const padY = 26;
    const values = series.map(point => point.elo);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 20; max += 20; }
    const range = max - min;
    const x = index => padX + (index / (series.length - 1)) * (width - padX * 2);
    const y = elo => padY + ((max - elo) / range) * (height - padY * 2);
    const points = series.map((point, index) => `${x(index).toFixed(1)},${y(point.elo).toFixed(1)}`).join(' ');
    const area = `${padX},${height - padY} ${points} ${width - padX},${height - padY}`;
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
        const gy = padY + ratio * (height - padY * 2);
        const value = Math.round(max - ratio * range);
        return `<line x1="${padX}" y1="${gy}" x2="${width - padX}" y2="${gy}" stroke="var(--border)" stroke-width="1"/>
                <text x="${padX - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${value}</text>`;
    }).join('');
    const dots = series.map((point, index) =>
        `<circle cx="${x(index).toFixed(1)}" cy="${y(point.elo).toFixed(1)}" r="3.2" fill="var(--accent)" data-game="${escapeHtml(point.gameId)}">
            <title>${escapeHtml(`${formatDate(point.date)} · ${point.elo} · ${point.opponent} · ${point.result}`)}</title>
        </circle>`).join('');

    box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Evolução de rating">
        ${gridLines}
        <polygon points="${area}" fill="var(--accent)" opacity="0.10"/>
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        ${dots}
    </svg>
    <p class="muted small">${series.length} partidas com rating · de ${formatDate(series[0].date)} a ${formatDate(series[series.length - 1].date)}. Clique em um ponto para abrir a partida.</p>`;
}

/* ===================== IA: LEITURA E REPERTÓRIO ===================== */
function renderInsights() {
    const box = $('insightsBox');
    const meta = $('insightsMeta');
    if (!box) return;
    if (State.insights && State.insights.text) {
        box.innerHTML = renderMarkdown(State.insights.text);
        meta.textContent = aiRecordMeta(State.insights);
    } else {
        box.innerHTML = '<p class="muted small">Gere um diagnóstico das suas partidas, com pontos fortes, pontos fracos e um plano de evolução.</p>';
        meta.textContent = 'Ainda não gerado.';
    }
}

function renderRepertoire() {
    const box = $('repertoireBox');
    const meta = $('repertoireMeta');
    if (!box) return;
    if (State.repertoire && State.repertoire.text) {
        box.innerHTML = renderMarkdown(State.repertoire.text);
        meta.textContent = aiRecordMeta(State.repertoire);
    } else {
        box.innerHTML = '<p class="muted small">Sugestão de repertório baseada nas aberturas que você realmente joga.</p>';
        meta.textContent = 'Ainda não gerado.';
    }
}

async function generateInsights() {
    if (!State.games.length) {
        toast('Importe partidas antes de gerar a leitura do acervo.', 'warning');
        return;
    }
    if (State.aiBusy) return;
    if (!(await requireAI())) return;

    State.aiBusy = true;
    setAIBusy(true);
    const stats = Stats.compute(State.games, Settings.playerNameList());
    const box = $('insightsBox');
    const stream = streamTarget(box);
    const controller = new AbortController();
    State.aiController = controller;

    try {
        const response = await AI.request(
            AI.insightsMessages(stats.brief),
            { onToken: stream.push, signal: controller.signal }
        );
        stream.finish();
        const record = { text: response.text, model: AI.config().model, createdAt: Date.now() };
        State.insights = record;
        await DB.saveMeta('insights', record);
        renderInsights();
        toast('Leitura do acervo salva.', 'success');
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

async function generateRepertoire() {
    if (!State.games.length) {
        toast('Importe partidas antes de gerar um repertório.', 'warning');
        return;
    }
    const stats = Stats.compute(State.games, Settings.playerNameList());
    if (!stats.identity.name) {
        toast('Defina seu nome nos Ajustes para gerar um repertório por cor.', 'warning');
        return;
    }
    if (State.aiBusy) return;
    if (!(await requireAI())) return;

    State.aiBusy = true;
    setAIBusy(true);
    const box = $('repertoireBox');
    const stream = streamTarget(box);
    const controller = new AbortController();
    State.aiController = controller;

    try {
        const response = await AI.request(
            AI.repertoireMessages(stats.brief),
            { onToken: stream.push, signal: controller.signal }
        );
        stream.finish();
        const record = { text: response.text, model: AI.config().model, createdAt: Date.now() };
        State.repertoire = record;
        await DB.saveMeta('repertoire', record);
        renderRepertoire();
        toast('Repertório sugerido e salvo.', 'success');
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

/* ===================== CHAT ===================== */
const CHAT_WELCOME = `
    <div class="chat-msg assistant">
        <p>Pergunte algo sobre as suas partidas. Exemplos:</p>
        <ul>
            <li>Em quais jogos tive problemas no final?</li>
            <li>Qual abertura rende mais pontos para mim?</li>
            <li>Quais erros se repetem nas minhas derrotas?</li>
        </ul>
    </div>`;

function appendChatMessage(role, content) {
    const host = $('chatMessages');
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg ' + role;
    if (role === 'user') {
        const paragraph = document.createElement('p');
        paragraph.textContent = content;
        bubble.appendChild(paragraph);
    } else {
        bubble.innerHTML = renderMarkdown(content);
    }
    host.appendChild(bubble);
    host.scrollTop = host.scrollHeight;
    return bubble;
}

function renderChatSources(chosen) {
    const host = $('chatSources');
    if (!chosen.length) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = chosen.map((item, index) =>
        `<button class="source-chip" data-game-id="${escapeHtml(item.game.id)}" title="Abrir partida">
            [${index + 1}] ${escapeHtml(item.game.white)} × ${escapeHtml(item.game.black)}
        </button>`).join('');
}

async function sendChat(event) {
    event.preventDefault();
    const input = $('chatInput');
    const question = input.value.trim();
    if (!question || State.aiBusy) return;
    if (!(await requireAI())) return;

    State.aiBusy = true;
    State.aiController = new AbortController();
    $('chatSendBtn').disabled = true;
    $('chatStopBtn').classList.remove('hidden');
    appendChatMessage('user', question);
    input.value = '';

    const stats = Stats.compute(State.games, Settings.playerNameList());
    const summaries = {};
    Object.keys(State.aiSummaries).forEach(id => {
        summaries[id] = State.aiSummaries[id].text || '';
    });
    const chosen = AI.retrieve(question, State.games, summaries, 6);
    const docs = AI.buildDocs(chosen);
    State.chatSources = chosen;
    renderChatSources(chosen);

    const bubble = appendChatMessage('assistant', '');
    bubble.innerHTML = '<p class="spinner-line">Consultando a biblioteca e o assistente…</p>';
    let text = '';

    try {
        const messages = AI.chatMessages(question, docs, stats.brief);
        if (State.chatHistory.length) {
            messages.splice(1, 0, ...State.chatHistory.slice(-6));
        }
        const response = await AI.request(messages, {
            onToken: token => {
                text += token;
                const now = Date.now();
                if (!bubble.dataset.lastPaint || now - Number(bubble.dataset.lastPaint) > 70) {
                    bubble.dataset.lastPaint = String(now);
                    bubble.innerHTML = renderMarkdown(text) + '<span class="stream-cursor"></span>';
                    $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
                }
            },
            signal: State.aiController.signal,
        });
        bubble.innerHTML = renderMarkdown(response.text);
        State.chatHistory.push({ role: 'user', content: question });
        State.chatHistory.push({ role: 'assistant', content: response.text });
        State.chatHistory = State.chatHistory.slice(-6);
    } catch (error) {
        const message = error.name === 'AbortError' ? 'Pergunta cancelada.' : AI.describeError(error);
        bubble.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
        toast(message, 'error');
    } finally {
        State.aiBusy = false;
        State.aiController = null;
        $('chatSendBtn').disabled = false;
        $('chatStopBtn').classList.add('hidden');
        $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
    }
}

function clearChat() {
    if (State.aiController) State.aiController.abort();
    State.chatHistory = [];
    State.chatSources = [];
    $('chatMessages').innerHTML = CHAT_WELCOME;
    $('chatSources').innerHTML = '';
}

/* ===================== EVENTOS ===================== */
function bindAnalyticsEvents() {
    $('statsToAiBtn').addEventListener('click', () => {
        setView('ai');
        loadAICache();
        toast('Clique em “Gerar” na leitura do acervo.', 'info');
    });
    $('statsIdentity').addEventListener('click', event => {
        if (event.target.closest('[data-open-settings]')) setView('settings');
    });
    $('ratingChart').addEventListener('click', event => {
        const dot = event.target.closest('[data-game]');
        if (dot) openGame(dot.dataset.game);
    });
    $('accuracyChart').addEventListener('click', event => {
        const dot = event.target.closest('[data-game]');
        if (dot) openGame(dot.dataset.game);
    });

    $('aiRefreshStatus').addEventListener('click', async () => {
        const result = await checkAI(false);
        if (result.online) toast(`Assistente conectado. ${result.models.length} modelo(s) disponível(is).`, 'success');
        else toast(result.error || 'Assistente indisponível.', 'error');
    });
    $('genInsightsBtn').addEventListener('click', generateInsights);
    $('genRepertoireBtn').addEventListener('click', generateRepertoire);
    $('clearChatBtn').addEventListener('click', clearChat);
    $('chatForm').addEventListener('submit', sendChat);
    $('chatStopBtn').addEventListener('click', () => {
        if (State.aiController) State.aiController.abort();
    });
    $('chatSources').addEventListener('click', event => {
        const chip = event.target.closest('[data-game-id]');
        if (chip) openGame(chip.dataset.gameId);
    });
}
