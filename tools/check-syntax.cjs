/* ==========================================================================
   ARQUIVO: tools/check-syntax.cjs
   DESCRIÇÃO: Verificação rápida, sem dependências, usada antes de publicar.

   O projeto não tem build nem bundler. O risco real é publicar um arquivo
   JavaScript com erro de sintaxe, porque o navegador só reclamaria no console.
   Este script roda `node --check` em todos os arquivos de `js/` e nas funções
   de `api/`, e valida os JSON que o aplicativo carrega em tempo de execução.

   USO:  node tools/check-syntax.cjs     (ou npm run check)
   SAÍDA: lista os arquivos com problema e termina com código 1 se houver erro.
   ========================================================================== */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

/** Confere a sintaxe de um arquivo com o próprio parser do Node. */
function checkScript(relativePath) {
    const file = path.join(root, relativePath);
    try {
        // `--check` só analisa; não executa o arquivo nem cria efeitos colaterais.
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log('ok      ' + relativePath);
    } catch (error) {
        const message = error.stderr ? error.stderr.toString().trim() : error.message;
        failures.push(relativePath + '\n' + message);
        console.log('FALHOU  ' + relativePath);
    }
}

/** Garante que os JSON embutidos continuam válidos após edições manuais. */
function checkJson(relativePath) {
    const file = path.join(root, relativePath);
    if (!fs.existsSync(file)) return;
    try {
        JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        console.log('json ok ' + relativePath);
    } catch (error) {
        failures.push(relativePath + '\n' + error.message);
        console.log('json FALHOU ' + relativePath);
    }
}

function scriptFiles(directory) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) return [];
    return fs.readdirSync(absolute)
        .filter(name => name.endsWith('.js'))
        .sort()
        .map(name => path.join(directory, name).replace(/\\/g, '/'));
}

scriptFiles('js').forEach(checkScript);
scriptFiles('api').forEach(checkScript);
checkJson('vendor/eco/openings.json');
checkJson('opencode.json');
checkJson('package.json');
checkJson('vercel.json');

if (failures.length) {
    console.error('\n' + failures.length + ' arquivo(s) com problema:\n');
    failures.forEach(item => console.error(item + '\n'));
    process.exit(1);
}

console.log('\nTudo certo: sintaxe e JSON válidos.');
