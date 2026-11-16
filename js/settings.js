/* ========================================================================
   ARQUIVO: js/settings.js
   DESCRIÇÃO: Tela de ajustes: perfil, modelo local, backups, análise em
   lote e limpeza da biblioteca.
   ======================================================================== */

function fillSettingsForm() {
    const settings = Settings.get();
    $('playerNamesInput').value = settings.playerNames || '';
    $('depthSelect').value = String(settings.depth);
    $('aiModeSelect').value = settings.ai.mode || 'auto';
    $('aiEndpointInput').value = settings.ai.baseUrl;
    $('aiProxyInput').value = settings.ai.proxyUrl || '';
    $('aiCodeInput').value = settings.ai.accessCode || '';
    $('aiModelInput').value = settings.ai.model;
    renderModelOptions();
}

function persistAIFromForm() {
    const mode = $('aiModeSelect').value || 'auto';
    const baseUrl = $('aiEndpointInput').value.trim() || 'http://localhost:11434';
    const proxyUrl = $('aiProxyInput').value.trim().replace(/\/+$/, '');
    const accessCode = $('aiCodeInput').value.trim();
    const model = $('aiModelInput').value.trim() || 'qwen2.5:3b';
    AI.setConfig({ mode, baseUrl, proxyUrl, accessCode, model });
    return { mode, baseUrl, proxyUrl, accessCode, model };
}

/* ===================== BACKUP ===================== */
async function restoreBackup(file) {
    try {
        const text = await readFileText(file);
        const payload = JSON.parse(text);
        const stores = payload.stores || payload;
        const names = ['games', 'data', 'analysis', 'ai', 'meta'];
        const available = names.filter(name => Array.isArray(stores[name]));
        if (!available.includes('games')) {
            toast('O arquivo não parece ser um backup do Acervo 64.', 'error');
            return;
        }

        const ok = await confirmAction(
            'Restaurar backup',
            'Os registros do arquivo serão mesclados com a biblioteca atual. Partidas com o mesmo identificador serão substituídas. Continuar?',
            'Restaurar'
        );
        if (!ok) return;

        for (const name of available) {
            await DB.bulkPut(name, stores[name]);
        }
        State.aiCacheLoaded = false;
        // A seleção pode apontar para partidas que vieram de outro acervo.
        State.selected.clear();
        await reloadGames();
        // O backup pode trazer análises da versão antiga; enriquece de novo.
        await migrateAnalysisData(true);
        await loadAICache();
        fillSettingsForm();
        toast('Backup restaurado.', 'success');
    } catch (error) {
        toast('Falha ao restaurar: ' + error.message, 'error');
    }
}

/* ===================== ANÁLISE EM LOTE ===================== */
/**
 * Analisa em lote. Sem argumento, percorre todo o acervo; com uma lista de
 * partidas (seleção múltipla), analisa apenas aquelas que ainda não atingiram
 * a profundidade configurada.
 */
async function analyzeAll(onlyGames) {
    if (!Engine.supported()) {
        toast('A análise em lote precisa que você abra o projeto com iniciar.bat.', 'warning');
        return;
    }
    if (!State.games.length) {
        toast('Não há partidas para analisar.', 'warning');
        return;
    }
    if (State.analysisRun) {
        toast('Já existe uma análise em andamento.', 'info');
        return;
    }

    const depth = Settings.get().depth;
    const scope = Array.isArray(onlyGames) && onlyGames.length ? onlyGames : State.games;
    const pending = scope.filter(game => !game.analyzedDepth || game.analyzedDepth < depth);
    if (!pending.length) {
        toast(`Todas as partidas já foram analisadas na profundidade ${depth}.`, 'success');
        return;
    }

    const controller = new AbortController();
    State.analysisRun = controller;
    let finished = false;

    openModal({
        title: 'Analisando partidas',
        body: `<p id="bulkStatus">Preparando Stockfish…</p>
               <div class="modal-progress"><span id="bulkFill"></span></div>
               <p class="muted small" id="bulkCount">${pending.length} partida(s) na fila · profundidade ${depth}</p>`,
        footer: '<button class="btn btn-ghost" data-act="cancel">Cancelar</button>',
        onClose: () => {
            if (!finished) controller.abort();
        },
    });
    $('modalFooter').querySelector('[data-act="cancel"]').addEventListener('click', () => {
        controller.abort();
        Engine.stop();
    });

    let done = 0;
    let errors = 0;

    try {
        for (const game of pending) {
            if (controller.signal.aborted) break;
            const data = await DB.get('data', game.id);
            if (!data) { errors++; continue; }
            const status = $('bulkStatus');
            if (status) status.textContent = `${done + 1}/${pending.length} · ${game.white} × ${game.black}`;

            try {
                const result = await Engine.analyzeGame(game, data, {
                    depth,
                    signal: controller.signal,
                    onProgress: ({ done: positionDone, total }) => {
                        const fill = $('bulkFill');
                        if (fill) fill.style.width = Math.round(((done + positionDone / total) / pending.length) * 100) + '%';
                    },
                });
                await DB.saveAnalysis(result);
                game.analysisSummary = result.summary;
                game.analyzedDepth = Math.max(game.analyzedDepth || 0, depth);
                if (window.Tags) Tags.apply(game, result, data.moves);
                await DB.put('games', game);
                done++;
            } catch (error) {
                if (controller.signal.aborted) break;
                errors++;
                console.warn('Falha ao analisar', game.id, error);
            }
            const count = $('bulkCount');
            if (count) count.textContent = `${done}/${pending.length} concluída(s)${errors ? ' · ' + errors + ' falha(s)' : ''}`;
        }
    } finally {
        finished = true;
        State.analysisRun = null;
        closeModal();
        renderLibrary();
        if ($('view-stats').classList.contains('active')) renderStatsView();
        if (State.current) {
            State.analysis = await DB.getAnalysis(State.current.id);
            renderGameHeader();
            renderAnalysisTab();
            renderMoveList();
            renderPosition();
        }
    }

    if (controller.signal.aborted) {
        toast('Análise em lote cancelada.', 'info');
    } else if (errors) {
        toast(`Análise concluída com ${errors} falha(s).`, 'warning');
    } else {
        toast(`Análise concluída em ${done} partida(s).`, 'success');
    }
}

/* ===================== LIMPEZA ===================== */
async function clearLibrary() {
    if (!State.games.length) {
        toast('A biblioteca já está vazia.', 'info');
        return;
    }
    const first = await confirmAction(
        'Apagar biblioteca',
        `Isso vai apagar ${State.games.length} partida(s), análises, tags e textos da IA. Deseja continuar?`,
        'Continuar'
    );
    if (!first) return;
    const second = await confirmAction(
        'Confirmar exclusão',
        'Esta ação não pode ser desfeita. Faça um backup antes se precisar. Apagar tudo agora?',
        'Apagar tudo'
    );
    if (!second) return;

    if (State.analysisRun) {
        State.analysisRun.abort();
        Engine.stop();
    }
    await DB.clearAll();
    State.games = [];
    State.filtered = [];
    State.current = null;
    State.data = null;
    State.analysis = null;
    State.ply = 0;
    State.aiSummaries = {};
    State.insights = null;
    State.repertoire = null;
    State.aiCacheLoaded = false;
    State.importReport = null;
    State.filters = { tokens: [], color: '', sort: 'date_desc' };
    $('searchInput').value = '';
    $('gameContent').classList.add('hidden');
    $('noGame').classList.remove('hidden');
    renderInsights();
    renderRepertoire();
    renderImportReport();
    renderLibrary();
    renderRailCount();
    setView('library');
    toast('Biblioteca apagada.', 'info');
}

/* ===================== EVENTOS ===================== */
function bindSettingsEvents() {
    $('playerNamesInput').addEventListener('change', event => {
        Settings.save({ playerNames: event.target.value });
        renderLibrary();
        if (State.current) renderGameHeader();
        if ($('view-stats').classList.contains('active')) renderStatsView();
        toast('Perfil salvo.', 'success');
    });

    $('depthSelect').addEventListener('change', event => {
        Settings.save({ depth: Number(event.target.value) || 12 });
        toast('Profundidade salva. Vale para novas análises.', 'success');
    });

    $('saveAiBtn').addEventListener('click', async () => {
        persistAIFromForm();
        toast('Configuração da IA salva.', 'success');
        await checkAI(true);
        renderAIStatus();
    });

    $('testAiBtn').addEventListener('click', async () => {
        const { model } = persistAIFromForm();
        const cfg = AI.config();
        const where = AI.useProxy() ? (cfg.proxyUrl || location.origin) : cfg.baseUrl;
        const result = $('aiTestResult');
        result.className = 'test-result';
        result.textContent = 'Testando conexão…';
        const status = await checkAI(true);
        if (!status.online) {
            result.className = 'test-result error';
            result.textContent = status.error || 'Não foi possível conectar.';
            return;
        }
        const models = status.models.map(item => item.name);
        const hasModel = models.includes(model);
        result.className = 'test-result ok';
        result.textContent = hasModel
            ? `Conectado em ${where}. Modelo ${model} disponível.`
            : `Conectado em ${where}. O modelo ${model} não aparece na lista; se as respostas falharem, ajuste o modelo.`;
        renderAIStatus();
    });

    $('exportPgnBtn').addEventListener('click', exportAllPgn);
    $('exportJsonBtn').addEventListener('click', exportJson);
    $('importJsonBtn').addEventListener('click', () => $('jsonInput').click());
    $('jsonInput').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (file) await restoreBackup(file);
        event.target.value = '';
    });

    $('analyzeAllBtn').addEventListener('click', analyzeAll);
    $('clearLibraryBtn').addEventListener('click', clearLibrary);
}
