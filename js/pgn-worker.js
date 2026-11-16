/* ==========================================================================
   ARQUIVO: js/pgn-worker.js
   DESCRIÇÃO: Worker que lê PGN fora da thread da interface.

   Por que existe: um arquivo com centenas de partidas pode levar segundos para
   ser validado lance a lance pelo chess.js. Sem o Worker, a página congela
   (barra de progresso não anima, botões não respondem). Aqui a leitura roda em
   paralelo e o resultado volta por mensagem.

   CONTRATO
     entrada: { id, text, sourceFile }
     saída:   { id, ok:true, games:[...], errors:[...] }
              { id, ok:false, error:'mensagem' }

   O worker reaproveita exatamente os mesmos arquivos do aplicativo — nada é
   duplicado. Se o navegador não permitir workers (por exemplo, página aberta
   como file://), js/library.js volta a ler na thread principal.
   ========================================================================== */

/* global PGN */
importScripts('../vendor/chess.js', 'pgn.js');

self.onmessage = function handleParse(event) {
    const data = event.data || {};
    const { id, text, sourceFile } = data;
    try {
        const result = PGN.parse(String(text || ''), sourceFile || 'arquivo');
        self.postMessage({
            id,
            ok: true,
            games: result.games,
            errors: result.errors,
        });
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error && error.message ? error.message : 'Falha ao ler o PGN.',
        });
    }
};
