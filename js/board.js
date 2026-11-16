/* ========================================================================
   ARQUIVO: js/board.js
   DESCRIÇÃO: Tabuleiro simples e acessível, desenhado com HTML e peças SVG.
   Não depende de bibliotecas externas: recebe um FEN e desenha a posição,
   com destaque do último lance, do rei em xeque e seta opcional.
   ======================================================================== */

const Board = (() => {
    const FILES = 'abcdefgh';
    let host = null;
    let orientation = 'white';
    let position = {};

    function squareName(fileIndex, rank) {
        return FILES[fileIndex] + rank;
    }

    function pieceFile(color, type) {
        return `vendor/pieces/${color}${type.toUpperCase()}.svg`;
    }

    function parse(fen) {
        const map = {};
        try {
            const chess = new Chess(fen);
            const rows = chess.board();
            const inCheck = chess.in_check();
            const turn = chess.turn();
            for (let r = 0; r < 8; r++) {
                for (let f = 0; f < 8; f++) {
                    const cell = rows[r][f];
                    if (cell) {
                        map[squareName(f, 8 - r)] = { color: cell.color, type: cell.type };
                    }
                }
            }
            return { map, inCheck, turn };
        } catch (e) {
            return { map, inCheck: false, turn: 'w' };
        }
    }

    function kingSquare(map, color) {
        for (const square in map) {
            if (map[square].type === 'k' && map[square].color === color) return square;
        }
        return null;
    }

    function squareIndex(square) {
        return { file: FILES.indexOf(square[0]), rank: Number(square[1]) };
    }

    function buildArrow(svgNs, from, to) {
        const a = squareIndex(from);
        const b = squareIndex(to);
        if (a.file < 0 || b.file < 0) return;

        // Converte a casa para coordenadas no sistema 0..8 do SVG (x da esquerda, y de cima).
        function point(square) {
            const file = square.file;
            const rank = square.rank;
            const x = orientation === 'white' ? file + 0.5 : 7.5 - file;
            const y = orientation === 'white' ? 8.5 - rank : rank - 0.5;
            return { x, y };
        }

        const p1 = point(a);
        const p2 = point(b);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const startX = p1.x + ux * 0.32;
        const startY = p1.y + uy * 0.32;
        const endX = p2.x - ux * 0.32;
        const endY = p2.y - uy * 0.32;
        const head = 0.34;

        const line = document.createElementNS(svgNs, 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', endX - ux * head * 0.65);
        line.setAttribute('y2', endY - uy * head * 0.65);
        line.setAttribute('stroke', 'rgba(37, 99, 235, 0.78)');
        line.setAttribute('stroke-width', '0.16');
        line.setAttribute('stroke-linecap', 'round');

        const perpX = -uy;
        const perpY = ux;
        const baseX = endX - ux * head;
        const baseY = endY - uy * head;
        const polygon = document.createElementNS(svgNs, 'polygon');
        polygon.setAttribute('points', [
            `${endX},${endY}`,
            `${baseX + perpX * head * 0.55},${baseY + perpY * head * 0.55}`,
            `${baseX - perpX * head * 0.55},${baseY - perpY * head * 0.55}`,
        ].join(' '));
        polygon.setAttribute('fill', 'rgba(37, 99, 235, 0.78)');

        return [line, polygon];
    }

    function arrowToUciBest(event, boardEl) {
        const rect = boardEl.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const col = Math.floor((x / rect.width) * 8);
        const row = Math.floor((y / rect.height) * 8);
        const file = orientation === 'white' ? col : 7 - col;
        const rank = orientation === 'white' ? 8 - row : row + 1;
        boardEl.dispatchEvent(new CustomEvent('boardsqclick', { detail: squareName(file, rank), bubbles: true }));
    }

    function render(fen, options) {
        if (!host) return;
        const opts = options || {};
        if (opts.orientation) orientation = opts.orientation;
        const parsed = parse(fen);
        position = parsed.map;
        if (opts.check === false) parsed.inCheck = false;
        const lastFrom = opts.lastFrom || null;
        const lastTo = opts.lastTo || null;
        // O destaque vermelho só aparece quando o rei do lado a jogar está em xeque.
        const checkSquare = (parsed.inCheck && opts.check !== false)
            ? kingSquare(parsed.map, parsed.turn)
            : null;

        const fragment = document.createDocumentFragment();
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const fileIndex = orientation === 'white' ? col : 7 - col;
                const rank = orientation === 'white' ? 8 - row : row + 1;
                const square = squareName(fileIndex, rank);
                const isLight = (fileIndex + rank) % 2 === 0;
                const cell = document.createElement('div');
                cell.className = 'sq ' + (isLight ? 'light' : 'dark');
                cell.dataset.square = square;
                cell.setAttribute('role', 'gridcell');
                cell.setAttribute('aria-label', square);
                if (square === lastFrom || square === lastTo) cell.classList.add('last');
                if (square === checkSquare) cell.classList.add('check');

                const piece = parsed.map[square];
                if (piece) {
                    const img = document.createElement('img');
                    img.className = 'piece';
                    img.src = pieceFile(piece.color, piece.type);
                    img.alt = '';
                    img.draggable = false;
                    cell.appendChild(img);
                }
                if (row === 7) {
                    const fileLabel = document.createElement('span');
                    fileLabel.className = 'coord file';
                    fileLabel.textContent = FILES[fileIndex];
                    cell.appendChild(fileLabel);
                }
                if (col === 0) {
                    const rankLabel = document.createElement('span');
                    rankLabel.className = 'coord rank';
                    rankLabel.textContent = rank;
                    cell.appendChild(rankLabel);
                }
                fragment.appendChild(cell);
            }
        }

        host.innerHTML = '';
        host.appendChild(fragment);

        if (opts.arrow && opts.arrow.from && opts.arrow.to) {
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 8 8');
            svg.setAttribute('class', 'board-arrow');
            svg.setAttribute('preserveAspectRatio', 'none');
            buildArrow(ns, opts.arrow.from, opts.arrow.to).forEach(child => svg.appendChild(child));
            host.appendChild(svg);
        }

        host.onclick = event => {
            if (!opts.onSquareClick) return;
            const cell = event.target.closest('.sq');
            if (cell) opts.onSquareClick(cell.dataset.square);
        };
    }

    function init(element) {
        host = element;
        host.setAttribute('role', 'grid');
        host.setAttribute('aria-label', 'Tabuleiro de xadrez');
        if (!element.dataset.bound) {
            element.dataset.bound = '1';
            element.addEventListener('boardsqclick', event => {
                // Evento usado para testes/ extensões futuras.
                host.dispatchEvent(new CustomEvent('squareclick', { detail: event.detail }));
            });
        }
    }

    function setOrientation(value) {
        orientation = value === 'black' ? 'black' : 'white';
    }

    function flip() {
        orientation = orientation === 'white' ? 'black' : 'white';
        return orientation;
    }

    function getOrientation() { return orientation; }
    function getPosition() { return position; }
    function size() { return host ? host.getBoundingClientRect().width : 0; }

    return { init, render, setOrientation, flip, getOrientation, getPosition, size };
})();

window.Board = Board;
