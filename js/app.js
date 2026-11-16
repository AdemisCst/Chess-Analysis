/* ========================================================================
   ARQUIVO: js/app.js
   DESCRIÇÃO: Núcleo da interface. Estado global, utilidades, navegação entre
   telas, tema, modais, avisos, markdown seguro e inicialização.
   Os demais módulos (library.js, game.js, analytics.js, settings.js) usam
   as funções e o objeto State definidos aqui.
   ======================================================================== */

const State = {
    games: [],
    filtered: [],
    page: 0,
    view: 'library',
    current: null,
    data: null,
    ply: 0,
    orientation: 'white',
    analysis: null,
    analysisRun: null,
    ai: { online: false, models: [], error: null },
    aiSummaries: {},
    insights: null,
    repertoire: null,
    aiCacheLoaded: false,
    aiBusy: false,
    aiController: null,
    chatHistory: [],
    chatSources: [],
    importReport: null,
    filters: { tokens: [], color: '', sort: 'date_desc' },
};

const $ = id => document.getElementById(id);
const $$ = selector => Array.from(document.querySelectorAll(selector));

/* ===================== UTILITÁRIOS ===================== */
function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

function formatDate(iso, fallback) {
    if (!iso) return fallback || '—';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function openingLabel(game) {
    if (!game.opening) return game.eco || '—';
    return game.eco ? `${game.eco} · ${game.opening}` : game.opening;
}

function identity() {
    return Stats.identifyPlayer(State.games, Settings.playerNameList());
}

function userColorOf(game) {
    return Stats.userColor(game, identity());
}

function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function todayStamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
            resolve();
        } catch (error) {
            reject(error);
        } finally {
            area.remove();
        }
    });
}

/* ===================== AVISOS (TOASTS) ===================== */
function toast(message, type) {
    const host = $('toastHost');
    if (!host) return;
    const item = document.createElement('div');
    item.className = 'toast ' + (type || '');
    item.textContent = message;
    item.addEventListener('click', () => item.remove());
    host.appendChild(item);
    setTimeout(() => item.remove(), 5200);
}

/* ===================== MODAL ===================== */
let modalState = { closable: true, onClose: null };

function openModal(options) {
    const opts = options || {};
    $('modalTitle').textContent = opts.title || '';
    $('modalBody').innerHTML = opts.body || '';
    $('modalFooter').innerHTML = opts.footer || '';
    $('modalClose').style.visibility = opts.closable === false ? 'hidden' : 'visible';
    modalState = { closable: opts.closable !== false, onClose: opts.onClose || null };
    $('modal').classList.remove('hidden');
}

function closeModal() {
    if ($('modal').classList.contains('hidden')) return;
    $('modal').classList.add('hidden');
    const callback = modalState.onClose;
    modalState = { closable: true, onClose: null };
    if (callback) callback();
}

function confirmAction(title, message, confirmLabel) {
    return new Promise(resolve => {
        let settled = false;
        function finish(value) {
            if (settled) return;
            settled = true;
            resolve(value);
            closeModal();
        }
        openModal({
            title,
            body: `<p>${escapeHtml(message)}</p>`,
            footer: `<button class="btn btn-ghost" data-act="cancel">Cancelar</button>
                     <button class="btn btn-primary" data-act="ok">${escapeHtml(confirmLabel || 'Confirmar')}</button>`,
            onClose: () => finish(false),
        });
        $('modalFooter').querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
        $('modalFooter').querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
    });
}

/* ===================== MARKDOWN SEGURO (para textos da IA) ===================== */
function inlineMarkdown(text) {
    return text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(text) {
    if (!text) return '';
    const lines = escapeHtml(text).replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let listType = null;

    function closeList() {
        if (listType) {
            html += `</${listType}>`;
            listType = null;
        }
    }

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { closeList(); continue; }
        let match = line.match(/^#{1,4}\s+(.*)$/);
        if (match) { closeList(); html += `<h4>${inlineMarkdown(match[1])}</h4>`; continue; }
        match = line.match(/^[-*•]\s+(.*)$/);
        if (match) {
            if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
            html += `<li>${inlineMarkdown(match[1])}</li>`;
            continue;
        }
        match = line.match(/^\d+[.)]\s+(.*)$/);
        if (match) {
            if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
            html += `<li>${inlineMarkdown(match[1])}</li>`;
            continue;
        }
        closeList();
        html += `<p>${inlineMarkdown(line)}</p>`;
    }
    closeList();
    return html;
}

function streamTarget(element) {
    let text = '';
    let lastPaint = 0;
    element.innerHTML = '<p class="spinner-line">Gerando com o assistente… isso pode levar alguns segundos.</p>';
    return {
        push(token) {
            text += token;
            const now = Date.now();
            if (now - lastPaint > 70) {
                lastPaint = now;
                element.innerHTML = renderMarkdown(text) + '<span class="stream-cursor"></span>';
                element.scrollTop = element.scrollHeight;
            }
        },
        get text() { return text; },
        finish() {
            element.innerHTML = renderMarkdown(text);
            return text;
        },
        fail(message) {
            element.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
        },
    };
}

/* ===================== TEMA ===================== */
function applyTheme(theme) {
    const dark = theme === 'dark';
    document.body.classList.toggle('dark', dark);
    const button = $('themeBtn');
    if (button) button.textContent = dark ? '☀' : '🌙';
}

function toggleTheme() {
    const settings = Settings.get();
    const next = settings.theme === 'dark' ? 'light' : 'dark';
    Settings.save({ theme: next });
    applyTheme(next);
}

/* ===================== NAVEGAÇÃO ENTRE TELAS ===================== */
function setView(name) {
    State.view = name;
    $$('.view').forEach(view => view.classList.toggle('active', view.id === 'view-' + name));
    $$('.rail-btn').forEach(button => button.classList.toggle('active', button.dataset.view === name));

    if (name === 'game') {
        $('noGame').classList.toggle('hidden', !!State.current);
        $('gameContent').classList.toggle('hidden', !State.current);
    }
    if (name === 'stats') renderStatsView();
    if (name === 'ai') { renderAIStatus(); loadAICache(); }
    if (name === 'settings') fillSettingsForm();
}

/* ===================== STATUS DA IA ===================== */
function setAIStatus(online, text) {
    const chip = $('aiStatusChip');
    chip.classList.remove('online', 'offline');
    chip.classList.add(online ? 'online' : 'offline');
    $('aiStatusText').textContent = text;
}

async function checkAI(quiet) {
    setAIStatus(false, 'Assistente: verificando…');
    const result = await AI.check();
    State.ai = result;
    if (result.online) {
        setAIStatus(true, 'Assistente pronto');
        const cfg = AI.config();
        $('aiStatusChip').title = `Assistente conectado em ${cfg.baseUrl} · modelo ${cfg.model}`;
        renderModelOptions();
    } else {
        setAIStatus(false, 'Assistente offline');
        $('aiStatusChip').title = result.error || 'Assistente indisponível';
        if (!quiet) toast('Assistente indisponível. Veja os Ajustes para configurar.', 'warning');
    }
    renderAIStatus();
    return result;
}

function renderModelOptions() {
    const list = $('aiModelList');
    if (!list) return;
    list.innerHTML = (State.ai.models || [])
        .map(model => `<option value="${escapeHtml(model.name)}"></option>`)
        .join('');
}

function renderAIStatus() {
    const panel = $('aiStatusPanel');
    if (!panel) return;
    const cfg = AI.config();
    const models = (State.ai.models || []).map(model => model.name);
    const online = State.ai.online;
    panel.innerHTML = `
        <div class="row"><span>Status</span><strong style="color:${online ? 'var(--success)' : 'var(--danger)'}">${online ? 'Conectado' : 'Desconectado'}</strong></div>
        <div class="row"><span>Endereço</span><code>${escapeHtml(cfg.baseUrl)}</code></div>
        <div class="row"><span>Modelo em uso</span><code>${escapeHtml(cfg.model)}</code></div>
        <div class="row"><span>Modelos instalados</span><span>${models.length ? models.map(name => `<code>${escapeHtml(name)}</code>`).join(' ') : '—'}</span></div>
        ${online ? '' : `<div class="row"><span>Como resolver</span><span class="small muted">Abra o Ollama, rode <code>ollama pull ${escapeHtml(cfg.model)}</code> e clique em “Verificar conexão”. Se o navegador bloquear, inicie o Ollama com <code>OLLAMA_ORIGINS=*</code>.</span></div>`}
    `;
    if (!online && State.ai.error) {
        panel.innerHTML += `<div class="row"><span>Detalhe</span><span class="small muted">${escapeHtml(State.ai.error)}</span></div>`;
    }
}

function setAIBusy(busy) {
    ['aiSummaryBtn', 'aiTagsBtn', 'genInsightsBtn', 'genRepertoireBtn'].forEach(id => {
        const element = $(id);
        if (element) element.disabled = !!busy;
    });
}

async function requireAI() {
    if (!State.ai.online) await checkAI(true);
    if (!State.ai.online) {
        toast('O assistente não está disponível. Confira os Ajustes para configurá-lo.', 'warning');
        return false;
    }
    return true;
}

/* ===================== CARREGAMENTO DE CACHES ===================== */
async function loadAISummariesIndex() {
    try {
        const records = await DB.getAll('ai');
        State.aiSummaries = {};
        records.forEach(record => {
            if (record.kind === 'summary' && record.gameId) State.aiSummaries[record.gameId] = record;
        });
    } catch (error) {
        State.aiSummaries = {};
    }
}

async function loadAICache() {
    if (State.aiCacheLoaded) return;
    State.aiCacheLoaded = true;
    try {
        const insights = await DB.getMeta('insights');
        const repertoire = await DB.getMeta('repertoire');
        State.insights = insights ? insights.value : null;
        State.repertoire = repertoire ? repertoire.value : null;
    } catch (error) {
        State.insights = null;
        State.repertoire = null;
    }
    renderInsights();
    renderRepertoire();
}

function aiRecordMeta(record) {
    if (!record) return '';
    const date = record.createdAt ? new Date(record.createdAt).toLocaleString('pt-BR') : '';
    return `Gerado por ${record.model || 'assistente de IA'}${date ? ' em ' + date : ''}.`;
}

/* ===================== RELOAD GERAL ===================== */
async function reloadGames() {
    State.games = await DB.getAll('games');
    State.games.sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || '') || (b.importedAt || 0) - (a.importedAt || 0));
    await loadAISummariesIndex();
    renderLibrary();
    renderRailCount();
    if ($('view-stats').classList.contains('active')) renderStatsView();
}

function renderRailCount() {
    const foot = $('railCount');
    if (foot) foot.textContent = State.games.length === 1 ? '1 partida' : `${State.games.length} partidas`;
}

/* ===================== MIGRAÇÃO DAS ANÁLISES ===================== */
/**
 * Análises geradas antes da versão 2 não têm anotações (!!, ★, ×, ??, ?,
 * !, 👍), ACPL nem precisão por fase. Como as posições do Stockfish já estão
 * salvas, é possível reconstruir tudo sem reanalisar nenhuma partida.
 *
 * A migração roda uma vez por navegador e grava o marcador `analysisMigration`
 * para não repetir o trabalho a cada abertura do aplicativo.
 */
async function migrateAnalysisData(force) {
    if (!window.Engine || typeof Engine.enrichAnalysis !== 'function') return { updated: 0, skipped: true };
    const marker = await DB.getMeta('analysisMigration').catch(() => null);
    if (!force && marker && Number(marker.value) >= 2) return { updated: 0, skipped: true };

    const candidates = State.games.filter(game => game.analysisSummary);
    let updated = 0;

    for (const game of candidates) {
        try {
            const [analysis, data] = await Promise.all([
                DB.getAnalysis(game.id),
                DB.get('data', game.id),
            ]);
            if (!analysis || !data) continue;
            const enriched = Engine.enrichAnalysis(analysis, data);
            if (enriched === analysis) continue;
            await DB.saveAnalysis(enriched);
            game.analysisSummary = enriched.summary;
            await DB.put('games', game);
            updated++;
        } catch (error) {
            console.warn('Falha ao migrar a análise de', game.id, error);
        }
    }

    await DB.saveMeta('analysisMigration', 2).catch(() => {});
    if (updated) {
        renderLibrary();
        if ($('view-stats').classList.contains('active')) renderStatsView();
    }
    return { updated, skipped: false };
}

/* ===================== INICIALIZAÇÃO ===================== */
function bindGlobalEvents() {
    $$('.rail-btn').forEach(button => {
        button.addEventListener('click', () => setView(button.dataset.view));
    });
    $$('[data-goto]').forEach(button => {
        button.addEventListener('click', () => setView(button.dataset.goto));
    });
    $('themeBtn').addEventListener('click', toggleTheme);
    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', event => {
        if (event.target === $('modal') && modalState.closable) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('modal').classList.contains('hidden') && modalState.closable) {
            closeModal();
        }
        if (State.view !== 'game' || !State.current) return;
        const tag = (event.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (event.key === 'ArrowLeft') { event.preventDefault(); setPly(State.ply - 1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); setPly(State.ply + 1); }
        if (event.key === 'Home') { event.preventDefault(); setPly(0); }
        if (event.key === 'End') { event.preventDefault(); setPly(State.data ? State.data.moves.length : 0); }
    });
    $('aiStatusChip').addEventListener('click', () => setView('ai'));
}

async function init() {
    Settings.get();
    applyTheme(Settings.get().theme);
    Board.init($('board'));

    if (location.protocol === 'file:') {
        $('protocolBanner').classList.remove('hidden');
    }

    bindGlobalEvents();
    bindLibraryEvents();
    bindGameEvents();
    bindAnalyticsEvents();
    bindSettingsEvents();

    try {
        await DB.open();
        await reloadGames();
        // Reaproveita análises antigas antes de desenhar estatísticas.
        await migrateAnalysisData(false);
    } catch (error) {
        toast('Não foi possível abrir o banco local: ' + error.message, 'error');
    }

    fillSettingsForm();
    renderImportReport();
    renderLibrary();
    renderRailCount();
    checkAI(true);
}

document.addEventListener('DOMContentLoaded', init);
