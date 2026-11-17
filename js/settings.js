/* ========================================================================
   ARQUIVO: js/settings.js
   DESCRIÇÃO: Tela de configurações: perfil, privacidade da IA, backups,
   análise em lote e limpeza da biblioteca.
   ======================================================================== */

function fillSettingsForm() {
    const settings = Settings.get();
    $('playerNamesInput').value = settings.playerNames || '';
    $('depthSelect').value = String(settings.depth);
    if ($('aiBlockInput')) $('aiBlockInput').checked = !!(settings.ai.privacy && settings.ai.privacy.blocked);
    renderModelOptions();
    renderConsentState();
}

function renderConsentState() {
    const hint = $('aiConsentState');
    if (!hint) return;
    const privacy = AI.privacy();
    if (privacy.blocked) {
        hint.textContent = 'Envio bloqueado: nenhuma chamada externa será feita.';
        return;
    }
    if (AI.hasConsent()) {
        const date = privacy.consentAt ? new Date(privacy.consentAt).toLocaleString('pt-BR') : '';
        hint.textContent = `Envio autorizado${privacy.provider ? ' para ' + privacy.provider : ''}${date ? ' em ' + date : ''}. A autorização vale para este navegador.`;
        return;
    }
    hint.textContent = 'O primeiro envio pedirá sua autorização. Você pode recusar e continuar usando os recursos locais.';
}

function persistAIFromForm() {
    const blocked = $('aiBlockInput') ? !!$('aiBlockInput').checked : false;
    AI.savePrivacy({ blocked });
    renderConsentState();
    renderAIStatus();
    return { blocked };
}

/* ===================== BACKUP ===================== */
async function restoreBackup(file) {
    try {
        const text = await readFileText(file);
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object') throw new Error('O arquivo não contém um backup válido.');
        const stores = payload.stores || payload;
        const names = ['games', 'data', 'analysis', 'ai', 'meta'];
        const available = names.filter(name => Array.isArray(stores[name]));
        if (!available.includes('games')) {
            toast('O arquivo não parece ser um backup do Chess-Analysis.', 'error');
            return;
        }
        if (payload.app && payload.app !== 'chess-analysis' && payload.app !== 'acervo64') {
            toast('O backup tem uma origem desconhecida. A estrutura será validada antes de qualquer alteração.', 'warning');
        }

        const ok = await confirmAction(
            'Restaurar backup',
            'Os registros do arquivo serão mesclados com a biblioteca atual. Partidas com o mesmo identificador serão substituídas. Um backup do estado atual será baixado antes da mesclagem. Continuar?',
            'Restaurar'
        );
        if (!ok) return;

        // Proteção explícita antes de mesclar: o estado atual vira um arquivo.
        await exportJson();

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
        toast('Backup restaurado. O banco legado foi preservado e mesclado.', 'success');
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
        const state = persistAIFromForm();
        toast('Configuração da IA salva.', 'success');
        if (state.blocked) {
            State.ai = { online: false, models: [], error: 'Envio de dados à IA desativado nas Configurações.', code: 'privacy_blocked' };
            setAIStatus(false, 'IA externa desativada');
            renderAIStatus();
            return;
        }
        await checkAI(true);
        renderAIStatus();
    });

    $('aiBlockInput').addEventListener('change', event => {
        AI.savePrivacy({ blocked: !!event.target.checked });
        renderConsentState();
        renderAIStatus();
        if (event.target.checked) {
            State.ai = { online: false, models: [], error: 'Envio de dados à IA desativado nas Configurações.', code: 'privacy_blocked' };
            setAIStatus(false, 'IA externa desativada');
            toast('Envio de dados à IA bloqueado.', 'info');
        } else {
            toast('Envio de dados à IA permitido. A autorização será pedida antes do primeiro envio.', 'info');
            checkAI(true);
        }
    });

    $('revokeConsentBtn').addEventListener('click', () => {
        AI.savePrivacy({ consentVersion: '', consentAt: 0, provider: '' });
        renderConsentState();
        renderAIStatus();
        toast('Autorização de envio revogada. O próximo uso pedirá autorização novamente.', 'info');
    });

    $('testAiBtn').addEventListener('click', async () => {
        const state = persistAIFromForm();
        const result = $('aiTestResult');
        result.className = 'test-result';
        result.textContent = 'Testando conexão…';
        if (state.blocked) {
            result.className = 'test-result error';
            result.textContent = 'O envio de dados à IA está bloqueado nas Configurações.';
            return;
        }
        const status = await checkAI(true);
        if (!status.online) {
            result.className = 'test-result error';
            result.textContent = status.error || 'Não foi possível conectar.';
            return;
        }
        result.className = 'test-result ok';
        result.textContent = `Conectado a ${aiProviderLabel()}${status.model ? ' · modelo ' + status.model : ''}. `
            + 'Nenhum dado de partida foi enviado neste teste.';
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
