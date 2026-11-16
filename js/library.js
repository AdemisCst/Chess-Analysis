/* ========================================================================
   ARQUIVO: js/library.js
   DESCRIÇÃO: Importação de PGN, filtros, tabela da biblioteca, paginação,
   favoritos, exclusão e exportação.
   ======================================================================== */

/* ===================== LEITURA E IMPORTAÇÃO ===================== */
function readFileText(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo.'));
        reader.readAsText(file, 'utf-8');
    });
}

function metaOf(game) {
    const { pgn, moves, startFen, ...meta } = game;
    return meta;
}

function dataOf(game) {
    return { id: game.id, startFen: game.startFen, moves: game.moves, pgn: game.pgn };
}

function updateImportProgress(percent, status, count) {
    const fill = $('importFill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    const statusEl = $('importStatus');
    if (statusEl && status) statusEl.textContent = status;
    const countEl = $('importCount');
    if (countEl && count !== undefined) countEl.textContent = count;
}

async function importSources(sources) {
    if (!sources.length) return;

    openModal({
        title: 'Importando partidas',
        body: `<p id="importStatus">Lendo arquivos…</p>
               <div class="modal-progress"><span id="importFill"></span></div>
               <p class="muted small" id="importCount"></p>`,
        closable: false,
    });

    const existing = new Set(State.games.map(game => game.id));
    const report = { files: sources.length, imported: 0, duplicates: 0, errors: [] };
    const metas = [];
    const datas = [];

    try {
        for (let index = 0; index < sources.length; index++) {
            const source = sources[index];
            updateImportProgress((index / sources.length) * 55, `Lendo ${source.name}…`, `${metas.length} partidas encontradas`);
            await new Promise(resolve => setTimeout(resolve, 0));

            let text = source.text;
            if (text == null && source.file) {
                try {
                    text = await readFileText(source.file);
                } catch (error) {
                    report.errors.push(`${source.name}: não foi possível ler o arquivo.`);
                    continue;
                }
            }

            const parsed = PGN.parse(text || '', source.name);
            parsed.errors.slice(0, 20).forEach(error => {
                report.errors.push(`${source.name} — ${error.message}`);
            });

            parsed.games.forEach(game => {
                if (existing.has(game.id)) {
                    report.duplicates++;
                    return;
                }
                existing.add(game.id);
                metas.push(metaOf(game));
                datas.push(dataOf(game));
            });
            updateImportProgress(55 + ((index + 1) / sources.length) * 20, `Processando ${source.name}…`, `${metas.length} partidas válidas`);
        }

        updateImportProgress(80, 'Gravando no banco local…', `${metas.length} partidas`);
        await DB.bulkPut('games', metas);
        await DB.bulkPut('data', datas);
        updateImportProgress(100, 'Concluído.', `${metas.length} partidas importadas`);
    } catch (error) {
        report.errors.push('Erro ao gravar: ' + error.message);
    }

    report.imported = metas.length;
    State.importReport = report;
    closeModal();
    await reloadGames();
    State.page = 0;
    renderLibrary();
    renderImportReport();

    if (report.imported > 0) {
        toast(`${report.imported} partida(s) importada(s).`, 'success');
    } else if (report.duplicates > 0 && !report.errors.length) {
        toast('Todas as partidas já estavam na biblioteca.', 'warning');
    } else if (report.errors.length) {
        toast('Nenhuma partida importada. Veja os detalhes na biblioteca.', 'error');
    }
}

async function handleFileList(fileList) {
    const files = Array.from(fileList || []).filter(file => /\.(pgn|txt)$/i.test(file.name));
    if (!files.length) {
        toast('Selecione arquivos .pgn (ou .txt com texto PGN).', 'warning');
        return;
    }
    await importSources(files.map(file => ({ name: file.name, file })));
}

async function loadSamples() {
    await importSources(SAMPLES.map((text, index) => ({ name: `Exemplo ${index + 1}.pgn`, text })));
}

function renderImportReport() {
    const box = $('importReport');
    if (!box) return;
    const report = State.importReport;
    if (!report) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    const errorList = report.errors.slice(0, 6)
        .map(error => `<li>${escapeHtml(error)}</li>`)
        .join('');
    box.innerHTML = `
        <button class="btn btn-sm btn-ghost" style="float:right" data-dismiss>✕</button>
        <strong>Importação:</strong> ${report.imported} nova(s) partida(s), ${report.duplicates} duplicada(s) ignorada(s), ${report.errors.length} aviso(s).
        ${errorList ? `<details><summary>Ver avisos</summary><ul>${errorList}</ul></details>` : ''}
    `;
    box.classList.remove('hidden');
    box.querySelector('[data-dismiss]').addEventListener('click', () => {
        State.importReport = null;
        renderImportReport();
    });
}

/* ===================== FILTROS ===================== */
function tokenizeQuery(raw) {
    const tokens = [];
    const regex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = regex.exec(raw || '')) !== null) {
        const token = (match[1] || match[2] || '').trim();
        if (token) tokens.push(token);
    }
    return tokens;
}

function filterToken(token) {
    const eloMatch = token.match(/^elo(>=|<=|>|<|=)(\d+)$/i);
    if (eloMatch) return { key: 'elo', op: eloMatch[1], value: Number(eloMatch[2]) };
    const pair = token.match(/^([a-zA-Z]+)[:](.+)$/);
    if (pair) {
        const key = pair[1].toLowerCase();
        const allowed = ['white', 'black', 'player', 'result', 'eco', 'opening', 'event', 'site', 'tag', 'date', 'year', 'moves', 'source'];
        if (allowed.includes(key)) return { key, value: pair[2] };
    }
    if (/^(favoritos?|fav)$/i.test(token)) return { key: 'fav' };
    return { key: 'text', value: token };
}

function matchesToken(game, token, ident) {
    const value = (token.value || '').toLowerCase();
    const color = Stats.userColor(game, ident);
    switch (token.key) {
        case 'white': return Stats.normalize(game.white).includes(Stats.normalize(value));
        case 'black': return Stats.normalize(game.black).includes(Stats.normalize(value));
        case 'player': return Stats.normalize(game.white + ' ' + game.black).includes(Stats.normalize(value));
        case 'event': return Stats.normalize(game.event + ' ' + game.site).includes(Stats.normalize(value));
        case 'site': return Stats.normalize(game.site).includes(Stats.normalize(value));
        case 'opening': return Stats.normalize(game.opening + ' ' + game.eco).includes(Stats.normalize(value));
        case 'eco': return Stats.normalize(game.eco).startsWith(Stats.normalize(value));
        case 'source': return Stats.normalize(game.sourceFile).includes(Stats.normalize(value));
        case 'tag': return (game.tags || []).concat(game.aiTags || [])
            .some(tag => Stats.normalize(tag).includes(Stats.normalize(value)));
        case 'date': return (game.dateISO || '').startsWith(value.replace(/\./g, '-'));
        case 'year': return String(game.year || '') === value;
        case 'moves':
            if (/^\d+$/.test(value)) return game.plyCount === Number(value);
            return true;
        case 'elo': {
            const elo = game.maxElo || 0;
            if (token.op === '>') return elo > token.value;
            if (token.op === '>=') return elo >= token.value;
            if (token.op === '<') return elo < token.value;
            if (token.op === '<=') return elo <= token.value;
            return elo === token.value;
        }
        case 'fav': return !!game.favorite;
        case 'result': {
            const result = String(game.result || '');
            if (value === '1-0') return result === '1-0';
            if (value === '0-1') return result === '0-1';
            if (['1/2', '½', 'draw', 'empate', '1/2-1/2', '½-½'].includes(value)) return result === '1/2-1/2';
            if (['*', 'sem resultado'].includes(value)) return result === '*';
            if (['win', 'vitoria', 'vitória'].includes(value)) return Stats.outcome(result, color) === 'win';
            if (['loss', 'derrota'].includes(value)) return Stats.outcome(result, color) === 'loss';
            return true;
        }
        default: {
            const haystack = Stats.normalize([
                game.white, game.black, game.event, game.site, game.opening, game.eco,
                (game.tags || []).join(' '), (game.aiTags || []).join(' '), game.dateISO,
                game.sourceFile, game.result,
            ].join(' '));
            return haystack.includes(Stats.normalize(value));
        }
    }
}

function filteredGames() {
    const ident = identity();
    const tokens = State.filters.tokens.map(filterToken);
    const color = State.filters.color;
    let list = State.games.filter(game => {
        if (color && Stats.userColor(game, ident) !== color) return false;
        return tokens.every(token => matchesToken(game, token, ident));
    });

    const sort = State.filters.sort;
    list = list.slice();
    if (sort === 'date_asc') {
        list.sort((a, b) => (a.dateISO || '0000').localeCompare(b.dateISO || '0000') || (a.importedAt || 0) - (b.importedAt || 0));
    } else if (sort === 'white_asc') {
        list.sort((a, b) => a.white.localeCompare(b.white, 'pt-BR'));
    } else if (sort === 'black_asc') {
        list.sort((a, b) => a.black.localeCompare(b.black, 'pt-BR'));
    } else if (sort === 'length_desc') {
        list.sort((a, b) => (b.plyCount || 0) - (a.plyCount || 0));
    } else if (sort === 'imported_desc') {
        list.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
    } else {
        list.sort((a, b) => (b.dateISO || '0000').localeCompare(a.dateISO || '0000') || (b.importedAt || 0) - (a.importedAt || 0));
    }
    return list;
}

function renderFilterChips() {
    const box = $('filterChips');
    if (!box) return;
    const parts = State.filters.tokens.map((token, index) =>
        `<span class="chip accent">${escapeHtml(token)} <button data-remove-token="${index}" title="Remover filtro">✕</button></span>`
    );
    if (State.filters.color) {
        parts.push(`<span class="chip accent">${State.filters.color === 'w' ? 'Minhas brancas' : 'Minhas pretas'} <button data-remove-color title="Remover filtro">✕</button></span>`);
    }
    box.innerHTML = parts.join('');
}

function renderPagination(pageCount, total) {
    const box = $('pagination');
    if (!box) return;
    if (pageCount <= 1) {
        box.innerHTML = '';
        return;
    }
    const current = State.page;
    const pages = [];
    pages.push(`<button class="page-btn" data-page="${current - 1}" ${current === 0 ? 'disabled' : ''}>‹</button>`);
    for (let page = 0; page < pageCount; page++) {
        if (pageCount > 8 && page > 1 && page < pageCount - 2 && Math.abs(page - current) > 1) {
            if (pages[pages.length - 1] !== '<span class="muted small">…</span>') {
                pages.push('<span class="muted small">…</span>');
            }
            continue;
        }
        pages.push(`<button class="page-btn ${page === current ? 'active' : ''}" data-page="${page}">${page + 1}</button>`);
    }
    pages.push(`<button class="page-btn" data-page="${current + 1}" ${current >= pageCount - 1 ? 'disabled' : ''}>›</button>`);
    box.innerHTML = pages.join('');
    $('listCount').textContent = `${State.page * Settings.get().pageSize + 1}–${Math.min(total, (State.page + 1) * Settings.get().pageSize)} de ${total} partida(s)`;
}

function renderLibrary() {
    const ident = identity();
    const filtered = filteredGames();
    State.filtered = filtered;
    const pageSize = Settings.get().pageSize || 50;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    State.page = Math.max(0, Math.min(State.page, pageCount - 1));
    const start = State.page * pageSize;
    const pageGames = filtered.slice(start, start + pageSize);

    const tbody = $('gamesBody');
    tbody.innerHTML = pageGames.map(game => {
        const label = PGN.resultLabel(game.result, Stats.userColor(game, ident));
        const date = formatDate(game.dateISO, game.headers && game.headers.Date);
        const tags = (game.tags || []).concat(game.aiTags || []).slice(0, 2)
            .map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join('');
        return `
            <tr data-id="${escapeHtml(game.id)}">
                <td><button class="fav-cell ${game.favorite ? 'on' : ''}" data-id="${escapeHtml(game.id)}" title="Favoritar">${game.favorite ? '★' : '☆'}</button></td>
                <td class="date-cell">${escapeHtml(date)}</td>
                <td class="player-cell">${escapeHtml(game.white)}${game.whiteElo ? ` <span class="elo">${game.whiteElo}</span>` : ''}</td>
                <td><span class="result-pill ${label.cls}">${label.text}</span></td>
                <td class="player-cell">${escapeHtml(game.black)}${game.blackElo ? ` <span class="elo">${game.blackElo}</span>` : ''}</td>
                <td class="opening-cell" title="${escapeHtml(openingLabel(game))}">${escapeHtml(openingLabel(game))}</td>
                <td class="moves-cell">${game.plyCount || 0}</td>
                <td class="col-tags">${tags}</td>
                <td><button class="row-delete" data-id="${escapeHtml(game.id)}" title="Excluir partida">✕</button></td>
            </tr>`;
    }).join('');

    const empty = $('emptyLibrary');
    const tableScroll = document.querySelector('#view-library .table-scroll');
    if (!filtered.length) {
        tableScroll.classList.add('hidden');
        empty.classList.remove('hidden');
        const heading = empty.querySelector('h3');
        const text = empty.querySelector('p');
        const actions = empty.querySelector('.empty-actions');
        if (!State.games.length) {
            heading.textContent = 'Nenhuma partida ainda';
            text.textContent = 'Importe seus arquivos PGN ou carregue os exemplos para explorar o aplicativo.';
            actions.classList.remove('hidden');
        } else {
            heading.textContent = 'Nenhuma partida encontrada';
            text.textContent = 'Ajuste a busca ou remova alguns filtros.';
            actions.classList.add('hidden');
        }
    } else {
        empty.classList.add('hidden');
        tableScroll.classList.remove('hidden');
    }

    $('listCount').textContent = filtered.length
        ? `${start + 1}–${Math.min(filtered.length, start + pageSize)} de ${filtered.length} partida(s)`
        : '0 partidas';
    renderPagination(pageCount, filtered.length);
    renderFilterChips();
    renderRailCount();

    const analyzed = State.games.filter(game => game.analysisSummary).length;
    $('librarySubtitle').textContent = State.games.length
        ? `${State.games.length} partida(s) no acervo · ${analyzed} analisada(s)`
        : 'Importe arquivos PGN para começar.';

    $('colorFilter').value = State.filters.color;
    $('sortSelect').value = State.filters.sort;
}

/* ===================== AÇÕES ===================== */
async function toggleFavorite(id) {
    const game = State.games.find(item => item.id === id);
    if (!game) return;
    game.favorite = !game.favorite;
    await DB.put('games', game);
    renderLibrary();
    if (State.current && State.current.id === id) renderGameHeader();
}

async function deleteGame(id, skipConfirm) {
    const game = State.games.find(item => item.id === id);
    if (!game) return;
    if (!skipConfirm) {
        const ok = await confirmAction('Excluir partida', `Excluir “${game.white} × ${game.black}”? Esta ação não pode ser desfeita.`, 'Excluir');
        if (!ok) return;
    }
    // Evita que uma análise em andamento recrie registros da partida excluída.
    if (State.analysisRun && State.current && State.current.id === id) {
        State.analysisRun.abort();
        Engine.stop();
    }
    await DB.deleteGame(id);
    State.games = State.games.filter(item => item.id !== id);
    delete State.aiSummaries[id];
    if (State.current && State.current.id === id) {
        State.current = null;
        State.data = null;
        State.analysis = null;
        State.ply = 0;
        setView('library');
        $('gameContent').classList.add('hidden');
        $('noGame').classList.remove('hidden');
    }
    renderLibrary();
    renderRailCount();
    toast('Partida excluída.', 'info');
}

/* ===================== EXPORTAÇÃO ===================== */
async function exportAllPgn() {
    const records = await DB.getAll('data');
    const map = new Map(records.map(record => [record.id, record]));
    const games = State.games.map(meta => {
        const data = map.get(meta.id);
        return Object.assign({}, meta, {
            moves: data ? data.moves : [],
            startFen: data ? data.startFen : PGN.START_FEN,
        });
    });
    if (!games.length) {
        toast('Não há partidas para exportar.', 'warning');
        return;
    }
    const pgn = games.map(game => PGN.serialize(game)).join('\n');
    downloadFile(`acervo64-${todayStamp()}.pgn`, pgn, 'application/x-chess-pgn;charset=utf-8');
    toast(`${games.length} partida(s) exportada(s).`, 'success');
}

async function exportJson() {
    const [games, data, analysis, ai, meta] = await Promise.all([
        DB.getAll('games'), DB.getAll('data'), DB.getAll('analysis'), DB.getAll('ai'), DB.getAll('meta'),
    ]);
    const payload = {
        app: 'acervo64',
        version: 1,
        exportedAt: new Date().toISOString(),
        stores: { games, data, analysis, ai, meta },
    };
    downloadFile(`acervo64-backup-${todayStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup completo gerado.', 'success');
}

function openExportModal() {
    openModal({
        title: 'Exportar',
        body: '<p>Escolha o formato do arquivo.</p>',
        footer: `<button class="btn btn-secondary" data-export="json">Backup completo (JSON)</button>
                 <button class="btn btn-primary" data-export="pgn">Acervo em PGN</button>`,
    });
    $('modalFooter').querySelector('[data-export="pgn"]').addEventListener('click', () => {
        closeModal();
        exportAllPgn();
    });
    $('modalFooter').querySelector('[data-export="json"]').addEventListener('click', () => {
        closeModal();
        exportJson();
    });
}

/* ===================== EVENTOS ===================== */
function bindLibraryEvents() {
    $('importBtn').addEventListener('click', () => $('fileInput').click());
    $('emptyImportBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async event => {
        const files = event.target.files;
        await handleFileList(files);
        event.target.value = '';
    });

    const dropZone = $('dropZone');
    dropZone.addEventListener('click', () => $('fileInput').click());
    dropZone.addEventListener('dragover', event => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', async event => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        await handleFileList(event.dataTransfer.files);
    });

    $('searchInput').addEventListener('input', debounce(event => {
        State.filters.tokens = tokenizeQuery(event.target.value);
        State.page = 0;
        renderLibrary();
    }, 180));

    $('colorFilter').addEventListener('change', event => {
        const value = event.target.value;
        if (value && !identity().name) {
            toast('Defina seu nome nos Ajustes para filtrar por cor.', 'warning');
            event.target.value = '';
            State.filters.color = '';
            return;
        }
        State.filters.color = value;
        State.page = 0;
        renderLibrary();
    });

    $('sortSelect').addEventListener('change', event => {
        State.filters.sort = event.target.value;
        State.page = 0;
        renderLibrary();
    });

    $('clearFiltersBtn').addEventListener('click', () => {
        State.filters.tokens = [];
        State.filters.color = '';
        State.page = 0;
        $('searchInput').value = '';
        renderLibrary();
    });

    $('filterChips').addEventListener('click', event => {
        const tokenButton = event.target.closest('[data-remove-token]');
        if (tokenButton) {
            State.filters.tokens.splice(Number(tokenButton.dataset.removeToken), 1);
            $('searchInput').value = State.filters.tokens
                .map(token => token.includes(' ') ? `"${token}"` : token).join(' ');
            State.page = 0;
            renderLibrary();
            return;
        }
        if (event.target.closest('[data-remove-color]')) {
            State.filters.color = '';
            State.page = 0;
            renderLibrary();
        }
    });

    $('gamesBody').addEventListener('click', event => {
        const deleteButton = event.target.closest('.row-delete');
        if (deleteButton) {
            event.stopPropagation();
            deleteGame(deleteButton.dataset.id);
            return;
        }
        const favButton = event.target.closest('.fav-cell');
        if (favButton) {
            event.stopPropagation();
            toggleFavorite(favButton.dataset.id);
            return;
        }
        const row = event.target.closest('tr[data-id]');
        if (row) openGame(row.dataset.id);
    });

    $('pagination').addEventListener('click', event => {
        const button = event.target.closest('[data-page]');
        if (!button || button.disabled) return;
        State.page = Number(button.dataset.page);
        renderLibrary();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('loadSamplesBtn').addEventListener('click', loadSamples);
    $('emptySamplesBtn').addEventListener('click', loadSamples);
    $('exportBtn').addEventListener('click', openExportModal);
}
