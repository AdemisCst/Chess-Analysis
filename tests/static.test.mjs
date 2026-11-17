/* Regressões estáticas da Fase 1. Executar com: npm test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(join(root, name), 'utf8');

test('index.html não contém elementos removidos na Fase 1', async () => {
    const html = await read('index.html');
    assert.equal(html.includes('dropZone'), false);
    assert.equal(html.includes('dropzone'), false);
    assert.equal(html.includes('Detalhes da conexão'), false);
    assert.equal(html.includes('Código de acesso'), false);
    assert.equal(html.includes('licenças completas'), false);
    assert.equal(html.includes('Organizador de partidas'), false);
    assert.equal(html.includes('Assistente de IA'), false);
    assert.equal(html.includes('aiModeSelect'), false);
    assert.equal(html.includes('aiProxyInput'), false);
    assert.equal(html.includes('localhost'), false);
});

test('navegação principal tem exatamente as cinco áreas oficiais', async () => {
    const html = await read('index.html');
    const nav = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>'));
    const views = [...nav.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(views, ['library', 'game', 'stats', 'ai', 'settings']);
});

test('relatório, aviso de privacidade e controles de consentimento estão ligados', async () => {
    const html = await read('index.html');
    assert.ok(html.includes('js/report.js'));
    assert.ok(html.includes('id="aiPrivacyNotice"'));
    assert.ok(html.includes('id="aiBlockInput"'));
    assert.ok(html.includes('id="revokeConsentBtn"'));
});

test('tema padrão é escuro e a classe alternativa é light', async () => {
    const storage = await read('js/storage.js');
    const css = await read('style.css');
    assert.match(storage, /theme:\s*'dark'/);
    assert.ok(css.includes('body.light'));
    assert.equal(css.includes('body.dark'), false);
});

test('ordem visual das anotações segue a diretriz oficial', async () => {
    const engine = await read('js/engine.js');
    assert.ok(engine.includes(
        "const ANNOTATION_ORDER = ['brilliant', 'excellent', 'best', 'good', 'mistake', 'missed', 'blunder'];"
    ));
});

test('motor atualizado para o Stockfish 19 lite single com WDL capturado', async () => {
    const engine = await read('js/engine.js');
    assert.ok(engine.includes("vendor/stockfish/stockfish-19-lite-single.js"));
    assert.ok(engine.includes('setoption name UCI_ShowWDL value true'));
    assert.ok(engine.includes('function parseWdl'));
    assert.equal(engine.includes("'vendor/stockfish/stockfish.js'"), false);
    // A interface continua usando a curva sobre cp nesta fase.
    assert.ok(engine.includes('0.00368208'));
    for (const name of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
        const info = await stat(join(root, 'vendor/stockfish', name));
        assert.ok(info.size > 1000, name + ' parece vazio');
    }
});

test('exports e backup usam a identidade nova sem perder o banco legado', async () => {
    const library = await read('js/library.js');
    const storage = await read('js/storage.js');
    assert.ok(library.includes("app: 'chess-analysis'"));
    assert.ok(library.includes('chess-analysis-backup-'));
    assert.equal(library.includes('acervo64-backup-'), false);
    assert.ok(storage.includes("const NAME = 'acervo64'"));
    assert.ok(storage.includes("const KEY = 'acervo64_settings_v1'"));
});

test('cliente da IA não guarda código de acesso e usa o proxy do site', async () => {
    const ai = await read('js/ai.js');
    const settings = await read('js/settings.js');
    assert.equal(ai.includes('accessCode'), false);
    assert.equal(settings.includes('accessCode'), false);
    assert.ok(ai.includes('function useProxy()'));
    assert.ok(ai.includes('return true;'));
    assert.ok(ai.includes('ensureConsent'));
});

test('.env.example aponta para DeepSeek e não reintroduz código de acesso', async () => {
    const env = await read('.env.example');
    assert.ok(env.includes('AI_BASE_URL=https://api.deepseek.com/v1'));
    assert.ok(env.includes('AI_MODEL=deepseek-chat'));
    assert.equal(env.includes('AI_ACCESS_MODE'), false);
    assert.equal(env.includes('AI_ACCESS_CODES'), false);
});
