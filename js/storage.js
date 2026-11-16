/* ========================================================================
   ARQUIVO: js/storage.js
   DESCRIÇÃO: Persistência local.
   - IndexedDB: partidas (metadados), dados do PGN (lances/FEN), análises,
     textos da IA e chaves auxiliares.
   - localStorage: preferências (tema, modelo, profundidade etc.).
   ======================================================================== */

const DB = (() => {
    const NAME = 'acervo64';
    const VERSION = 1;
    let dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('Este navegador não suporta IndexedDB.'));
                return;
            }
            const request = indexedDB.open(NAME, VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('games')) {
                    const games = db.createObjectStore('games', { keyPath: 'id' });
                    ['dateISO', 'result', 'white', 'black', 'eco', 'event', 'year', 'favorite', 'maxElo', 'importedAt']
                        .forEach(name => games.createIndex(name, name, { unique: false }));
                }
                if (!db.objectStoreNames.contains('data')) {
                    db.createObjectStore('data', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('analysis')) {
                    const analysis = db.createObjectStore('analysis', { keyPath: 'key' });
                    analysis.createIndex('gameId', 'gameId', { unique: false });
                }
                if (!db.objectStoreNames.contains('ai')) {
                    const ai = db.createObjectStore('ai', { keyPath: 'key' });
                    ai.createIndex('gameId', 'gameId', { unique: false });
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Falha ao abrir o banco local.'));
        });
        return dbPromise;
    }

    function ask(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function store(name, mode) {
        const db = await open();
        return db.transaction(name, mode || 'readonly').objectStore(name);
    }

    async function get(name, key) {
        return ask((await store(name)).get(key));
    }

    async function getAll(name) {
        return ask((await store(name)).getAll());
    }

    async function put(name, value) {
        return ask((await store(name, 'readwrite')).put(value));
    }

    async function del(name, key) {
        return ask((await store(name, 'readwrite')).delete(key));
    }

    async function clear(name) {
        return ask((await store(name, 'readwrite')).clear());
    }

    async function count(name) {
        return ask((await store(name)).count());
    }

    /* Grava muitos registros em uma única transação (importação rápida). */
    async function bulkPut(name, values) {
        if (!values.length) return;
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(name, 'readwrite');
            const os = tx.objectStore(name);
            values.forEach(value => os.put(value));
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Importação cancelada.'));
        });
    }

    async function getByIndex(name, indexName, value) {
        const os = await store(name);
        return ask(os.index(indexName).getAll(value));
    }

    async function deleteGame(id) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['games', 'data', 'analysis', 'ai'], 'readwrite');
            tx.objectStore('games').delete(id);
            tx.objectStore('data').delete(id);
            ['analysis', 'ai'].forEach(name => {
                const index = tx.objectStore(name).index('gameId');
                index.openKeyCursor(IDBKeyRange.only(id)).onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor) {
                        tx.objectStore(name).delete(cursor.primaryKey);
                        cursor.continue();
                    }
                };
            });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function clearAll() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const names = ['games', 'data', 'analysis', 'ai', 'meta'];
            const tx = db.transaction(names, 'readwrite');
            names.forEach(name => tx.objectStore(name).clear());
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    /* ---------- atalhos para análise e IA ---------- */
    function analysisKey(gameId, depth) { return `${gameId}@${depth}`; }

    async function getAnalysis(gameId) {
        const list = await getByIndex('analysis', 'gameId', gameId);
        if (!list || !list.length) return null;
        return list.sort((a, b) => (b.depth - a.depth) || (b.createdAt - a.createdAt))[0];
    }

    async function saveAnalysis(record) {
        record.key = analysisKey(record.gameId, record.depth);
        await put('analysis', record);
        return record;
    }

    async function getAI(gameId, kind) {
        return get('ai', `${gameId}:${kind}`);
    }

    async function saveAI(gameId, kind, payload) {
        const record = Object.assign({ key: `${gameId}:${kind}`, gameId, kind, createdAt: Date.now() }, payload);
        await put('ai', record);
        return record;
    }

    async function getMeta(key) { return get('meta', key); }
    async function saveMeta(key, value) { return put('meta', { key, value, createdAt: Date.now() }); }

    return {
        open, get, getAll, put, del, clear, count, bulkPut, getByIndex, deleteGame, clearAll,
        getAnalysis, saveAnalysis, getAI, saveAI, getMeta, saveMeta, analysisKey,
    };
})();

const Settings = (() => {
    const KEY = 'acervo64_settings_v1';
    const DEFAULTS = {
        theme: 'light',
        playerNames: '',
        depth: 12,
        pageSize: 50,
        ai: {
            // auto: Ollama no PC, proxy quando o site está publicado.
            mode: 'auto',
            baseUrl: 'http://localhost:11434',
            proxyUrl: '',
            accessCode: '',
            model: 'qwen2.5:3b',
            temperature: 0.3,
            numCtx: 4096,
        },
    };
    let cache = null;

    function clone(value) { return JSON.parse(JSON.stringify(value)); }

    function load() {
        if (cache) return cache;
        let stored = {};
        try {
            stored = JSON.parse(localStorage.getItem(KEY) || '{}');
        } catch (e) { stored = {}; }
        cache = Object.assign(clone(DEFAULTS), stored);
        cache.ai = Object.assign(clone(DEFAULTS.ai), stored.ai || {});
        cache.depth = Number(cache.depth) || DEFAULTS.depth;
        cache.pageSize = Number(cache.pageSize) || DEFAULTS.pageSize;
        return cache;
    }

    function get() { return load(); }

    function save(patch) {
        const current = load();
        const next = Object.assign({}, current, patch || {});
        if (patch && patch.ai) next.ai = Object.assign({}, current.ai, patch.ai);
        cache = next;
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* modo privado */ }
        return next;
    }

    function playerNameList() {
        // Aceita vários apelidos separados por ponto e vírgula ou por quebra de linha.
        // A vírgula é preservada porque nomes de PGN costumam ser "Sobrenome, Nome".
        return String(load().playerNames || '')
            .split(/[;\n]+/)
            .map(name => name.trim())
            .filter(Boolean);
    }

    return { get, save, playerNameList, DEFAULTS };
})();

window.DB = DB;
window.Settings = Settings;
