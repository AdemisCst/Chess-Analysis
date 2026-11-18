/* ========================================================================
   ARQUIVO: js/pgn.js
   DESCRIÇÃO: Leitura, validação e geração de arquivos PGN.
   Usa chess.js apenas para validar os lances e calcular a posição (FEN)
   depois de cada jogada. Comentários e variantes são ignorados na leitura,
   mas os lances principais são preservados integralmente.
   ======================================================================== */

const PGN = (() => {
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const TAG_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

    /* ---------- utilidades de texto ---------- */
    function unescapeTag(value) {
        return value.replace(/\\(["\\])/g, '$1');
    }

    function escapeTag(value) {
        return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function parseTagLine(line) {
        const m = line.match(/^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/);
        if (!m) return null;
        return { name: m[1], value: unescapeTag(m[2]) };
    }

    /* Remove comentários { }, variantes ( ), NAGs $n e comentários ; */
    function cleanMovetext(raw) {
        let out = '';
        let i = 0;
        let variationDepth = 0;
        while (i < raw.length) {
            const c = raw[i];
            if (c === '{') {
                i++;
                while (i < raw.length && raw[i] !== '}') i++;
                i++;
                out += ' ';
                continue;
            }
            if (c === ';') {
                while (i < raw.length && raw[i] !== '\n') i++;
                continue;
            }
            if (variationDepth > 0) {
                if (c === '(') { variationDepth++; i++; continue; }
                if (c === ')') { variationDepth--; i++; continue; }
                if (c === '{') {
                    while (i < raw.length && raw[i] !== '}') i++;
                    i++;
                    continue;
                }
                i++;
                continue;
            }
            if (c === '(') { variationDepth++; i++; continue; }
            if (c === ')') { i++; continue; }
            if (c === '$') {
                while (i < raw.length && !/\s/.test(raw[i])) i++;
                continue;
            }
            out += c;
            i++;
        }
        return out;
    }

    function normalizeResult(value) {
        if (!value) return '*';
        const v = String(value).trim();
        if (v === '1-0' || v === '0-1' || v === '1/2-1/2' || v === '*') return v;
        if (v === '½-½' || v === '0.5-0.5') return '1/2-1/2';
        return '*';
    }

    function tokenizeMovetext(raw) {
        const clean = cleanMovetext(raw);
        const parts = clean.split(/\s+/).filter(Boolean);
        const tokens = [];
        let result = null;

        for (let part of parts) {
            part = part.replace(/^\d+\.+/, '');
            if (!part) continue;
            if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(part)) {
                result = normalizeResult(part);
                break;
            }
            if (/^\d+\.+$/.test(part)) continue;
            if (/^(e\.p\.|--|Z0)$/i.test(part)) continue;
            if (/^[!?]+$/.test(part)) continue;
            part = part.replace(/[!?]+$/, '');
            part = part.replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
            part = part.replace(/½/g, '');
            if (!part) continue;
            tokens.push(part);
        }
        return { tokens, result };
    }

    /* ---------- split de várias partidas ---------- */
    function splitGames(text) {
        const normalized = String(text || '')
            .replace(/^\uFEFF/, '')
            .replace(/\r\n?/g, '\n');
        const lines = normalized.split('\n');
        const chunks = [];
        let current = { tags: [], moveLines: [] };
        let seenMoves = false;

        function flush() {
            if (current.tags.length || current.moveLines.join('').trim()) {
                chunks.push(current);
            }
            current = { tags: [], moveLines: [] };
            seenMoves = false;
        }

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                if (seenMoves) current.moveLines.push('');
                continue;
            }
            if (trimmed.startsWith('%')) continue;         // linhas de escape PGN
            if (trimmed.startsWith('[')) {
                const tag = parseTagLine(trimmed);
                if (tag) {
                    if (seenMoves) flush();
                    current.tags.push(tag);
                    continue;
                }
            }
            current.moveLines.push(line);
            seenMoves = true;
        }
        flush();
        return chunks;
    }

    /* ---------- validação dos lances ---------- */
    function tryMove(chess, san) {
        const attempts = [san, san.replace(/[+#]+$/, '')];
        for (const attempt of attempts) {
            if (!attempt) continue;
            try {
                const move = chess.move(attempt, { sloppy: true });
                if (move) return move;
            } catch (e) { /* tenta a próxima forma */ }
        }
        return null;
    }

    function hashString(str) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function parseDate(value) {
        if (!value) return { iso: null, year: null };
        const m = value.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
        if (!m || m[1] === '????') return { iso: null, year: /^\d{4}$/.test(m ? m[1] : '') ? Number(m[1]) : null };
        const year = Number(m[1]);
        const month = Number(m[2]);
        const day = Number(m[3]);
        if (!year || month < 1 || month > 12 || day < 1 || day > 31) return { iso: null, year: year || null };
        return { iso: `${m[1]}-${m[2]}-${m[3]}`, year };
    }

    function parseIntSafe(value) {
        const n = parseInt(String(value || '').replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    /* ---------- parse principal ---------- */
    function parse(text, sourceFile) {
        const chunks = splitGames(text);
        const games = [];
        const errors = [];

        chunks.forEach((chunk, index) => {
            const headers = {};
            const headerOrder = [];
            chunk.tags.forEach(tag => {
                if (!(tag.name in headers)) headerOrder.push(tag.name);
                headers[tag.name] = tag.value;
            });

            if (!chunk.moveLines.join('').trim() && chunk.tags.length === 0) return;

            const { tokens, result: movetextResult } = tokenizeMovetext(chunk.moveLines.join('\n'));
            const startFen = headers.FEN && headers.SetUp !== '0' ? headers.FEN : START_FEN;
            let chess;
            try {
                chess = new Chess(startFen);
                if (chess.fen() === START_FEN) chess = new Chess();
            } catch (e) {
                chess = new Chess();
                errors.push({ game: index + 1, message: 'FEN inválida; usando posição inicial.' });
            }

            const moves = [];
            const gameErrors = [];
            for (const san of tokens) {
                const move = tryMove(chess, san);
                if (!move) {
                    gameErrors.push(`Lance ${moves.length + 1} inválido: ${san}`);
                    errors.push({ game: index + 1, message: `Lance ${moves.length + 1} inválido: ${san} (${headers.White || '?'} × ${headers.Black || '?'})` });
                    break;
                }
                moves.push({
                    san: move.san,
                    from: move.from,
                    to: move.to,
                    promotion: move.promotion || null,
                    color: move.color,
                    fen: chess.fen(),
                });
            }

            const headerResult = headers.Result && headers.Result !== '*' ? normalizeResult(headers.Result) : null;
            const result = headerResult || movetextResult || '*';
            const date = parseDate(headers.Date);

            const white = headers.White || 'Brancas';
            const black = headers.Black || 'Pretas';
            const signature = [white, black, headers.Result || result, headers.Date || '', moves.map(m => m.san).join(' ')].join('|');
            const id = 'g_' + hashString(signature) + '_' + moves.length;

            const game = {
                id,
                headers,
                headerOrder,
                startFen,
                moves,
                plyCount: moves.length,
                result,
                white,
                black,
                whiteElo: parseIntSafe(headers.WhiteElo),
                blackElo: parseIntSafe(headers.BlackElo),
                maxElo: Math.max(parseIntSafe(headers.WhiteElo) || 0, parseIntSafe(headers.BlackElo) || 0) || null,
                eco: headers.ECO || '',
                opening: headers.Opening || '',
                event: headers.Event || '',
                site: headers.Site || '',
                dateISO: date.iso,
                year: date.year,
                timeControl: headers.TimeControl || '',
                round: headers.Round || '',
                sourceFile: sourceFile || '',
                importedAt: Date.now(),
                tags: [],
                tagsBySide: { w: [], b: [] },
                favorite: false,
                aiTags: [],
                analysisSummary: null,
                analyzedDepth: null,
                analyzedBuild: null,
                parseErrors: gameErrors,
                hasVariationsOrComments: /[{(;]/.test(chunk.moveLines.join('\n')),
            };

            game.pgn = serialize({ headers, headerOrder, moves, result, startFen });
            games.push(game);
        });

        return { games, errors };
    }

    /* ---------- geração de PGN ---------- */
    function serialize(game) {
        const headers = game.headers || {};
        const order = [];
        TAG_ORDER.forEach(name => { if (headers[name] !== undefined) order.push(name); });
        (game.headerOrder || []).forEach(name => {
            if (!order.includes(name) && headers[name] !== undefined) order.push(name);
        });
        Object.keys(headers).forEach(name => {
            if (!order.includes(name)) order.push(name);
        });
        if (!headers.Result) headers.Result = game.result || '*';
        if (!order.includes('Result')) order.push('Result');

        const lines = order
            .filter(name => headers[name] !== undefined)
            .map(name => `[${name} "${escapeTag(headers[name])}"]`);

        const moves = game.moves || [];
        const moveText = [];
        for (let i = 0; i < moves.length; i += 2) {
            const number = i / 2 + 1;
            const white = moves[i] ? moves[i].san : '';
            const black = moves[i + 1] ? moves[i + 1].san : '';
            moveText.push(`${number}. ${white}${black ? ' ' + black : ''}`.trim());
        }
        if (moves.length === 0) moveText.push(game.result || '*');
        else moveText.push(headers.Result || game.result || '*');

        // Quebra de linha em ~80 colunas, sem cortar lances.
        const body = [];
        let line = '';
        for (const token of moveText.join(' ').split(' ')) {
            if ((line + ' ' + token).trim().length > 80) {
                body.push(line.trim());
                line = token;
            } else {
                line += ' ' + token;
            }
        }
        if (line.trim()) body.push(line.trim());

        return lines.join('\n') + (lines.length ? '\n\n' : '') + body.join('\n') + '\n';
    }

    function serializeAll(pairs) {
        return pairs.map(pair => serialize(pair.game || pair)).join('\n');
    }

    function fenAt(data, ply) {
        if (!data) return START_FEN;
        if (ply <= 0) return data.startFen || START_FEN;
        const move = data.moves[Math.min(ply, data.moves.length) - 1];
        return move ? move.fen : (data.startFen || START_FEN);
    }

    function resultLabel(result, userColor) {
        if (!result || result === '*') return { text: '*', cls: 'unknown' };
        if (result === '1/2-1/2') return { text: '½–½', cls: 'draw' };
        if (!userColor) return { text: result === '1-0' ? '1–0' : '0–1', cls: 'unknown' };
        const win = (result === '1-0' && userColor === 'w') || (result === '0-1' && userColor === 'b');
        return { text: result === '1-0' ? '1–0' : '0–1', cls: win ? 'win' : 'loss' };
    }

    return {
        START_FEN,
        parse,
        serialize,
        serializeAll,
        fenAt,
        resultLabel,
        normalizeResult,
        hashString,
    };
})();

if (typeof window !== 'undefined') window.PGN = PGN;
else self.PGN = PGN;
