/* ========================================================================
   ARQUIVO: script.js
   DESCRIÇÃO: Lógica completa da aplicação "Xadrez Tático - Treino de Finais".
   Este arquivo é o "cérebro" do programa. Tudo roda no navegador
   (100% client-side). Os dados ficam salvos no localStorage do navegador.
   
   O QUE ESTE ARQUIVO FAZ (resumo):
   1) Controla login, cadastro e logout de usuários (vários perfis).
   2) Salva e carrega o progresso de cada usuário (livros, exercícios, acertos/erros).
   3) Faz upload e leitura de arquivos PDF (via PDF.js).
   4) Extrai texto do PDF para encontrar capítulos, exercícios e gabaritos.
   5) Converte notação de xadrez em português (R, D, T, B, C) para internacional (K, Q, R, B, N).
   6) Tenta detectar automaticamente a posição do tabuleiro nas imagens do PDF.
   7) Oferece um editor visual para corrigir a posição do diagrama (clique nas casas).
   8) Desenha o tabuleiro interativo (chessboard.js) e valida lances (chess.js).
   9) Compara o lance do usuário com o gabarito e reproduz a resposta do adversário.
   10) Gera explicações didáticas (heurísticas) após cada lance.
   11) Permite exportar/importar backup em JSON.
   
   COMO ALTERAR COMPORTAMENTOS (para usuários leigos):
   - Mudar cores/temas: edite style.css (variáveis :root e body.dark).
   - Mudar a velocidade da resposta do adversário: altere CONFIG.ADVERSARY_DELAY_MS abaixo.
   - Adicionar chave de IA (opcional): preencha CONFIG.AI_API_KEY e CONFIG.AI_ENDPOINT.
   - Mudar palavras-chave de detecção de capítulos: edite o array CHAPTER_KEYWORDS na seção 06.
   - Se o app não abrir: verifique se os 3 arquivos (index.html, style.css, script.js)
     estão na mesma pasta e se você está conectado à internet (para carregar as bibliotecas CDN).
   
   ÍNDICE DAS SEÇÕES:
     SEÇÃO 00 - Configuração global (CONFIG)
     SEÇÃO 01 - Estado da aplicação (AppState)
     SEÇÃO 02 - Utilitários gerais (helpers)
     SEÇÃO 03 - Persistência (localStorage) e usuários
     SEÇÃO 04 - Autenticação (login, cadastro, logout)
     SEÇÃO 05 - Tema (claro/escuro)
     SEÇÃO 06 - Upload e processamento de PDF
     SEÇÃO 07 - Parser de texto do PDF (capítulos, exercícios, gabarito)
     SEÇÃO 08 - Conversão de notação PT -> internacional
     SEÇÃO 09 - Detector de diagramas (canvas) e editor de posição
     SEÇÃO 10 - Tabuleiro interativo (chess.js + chessboard.js)
     SEÇÃO 11 - Validação de lances e fluxo do exercício
     SEÇÃO 12 - Feedback pedagógico e explicações heurísticas
     SEÇÃO 13 - Backup (exportar/importar JSON)
     SEÇÃO 14 - Renderização da UI (listas, estatísticas, histórico)
     SEÇÃO 15 - Inicialização (DOMContentLoaded)
   ======================================================================== */

/* ===================== SEÇÃO 00 - CONFIGURAÇÃO GLOBAL ===================== */
/* Objeto de configuração. Altere valores aqui para mudar comportamentos do app. */
const CONFIG = {
    // Chave de API opcional para gerar explicações com IA (Gemini/OpenAI).
    // Deixe vazio ("") para usar apenas o gerador heurístico local (grátis).
    // Exemplo: coloque aqui sua chave gratuita do Google AI Studio ou OpenAI.
    AI_API_KEY: "",
    // Endpoint da IA (opcional). Use "" para desativar a IA.
    AI_ENDPOINT: "",
    // Atraso (em milissegundos) antes de o adversário responder no tabuleiro.
    // 600 = 0,6 segundos. Aumente para dar tempo do usuário ler.
    ADVERSARY_DELAY_MS: 600,
    // Número máximo de páginas processadas por vez (evita travar em PDFs grandes).
    PDF_MAX_PAGES: 200,
    // Tamanho (em pixels) do canvas de referência do diagrama no editor.
    REF_CANVAS_SIZE: 320,
};

/* ===================== SEÇÃO 01 - ESTADO DA APLICAÇÃO ===================== */
/* AppState guarda tudo que é "memória" do programa enquanto ele está aberto.
   Quando você recarrega a página, esse estado é recriado do zero (exceto
   o que foi salvo no localStorage). */
const AppState = {
    // Usuário atualmente logado: { name: "João", email: "joao@email.com" }
    currentUser: null,
    // Tema atual: "light" ou "dark"
    theme: "light",
    // Livro atualmente selecionado (objeto com chapters e exercises)
    currentBook: null,
    // Lista de livros importados pelo usuário logado
    books: [],
    // Exercício que o usuário está resolvendo no momento
    currentExercise: null,
    // Instância do motor chess.js (regras do xadrez)
    game: null,
    // Instância do tabuleiro visual chessboard.js
    board: null,
    // Orientação do tabuleiro: "white" (brancas embaixo) ou "black" (pretas embaixo)
    orientation: "white",
    // Linha de solução extraída do gabarito (array de strings SAN)
    solutionMoves: [],
    // Índice do próximo lance esperado na solução
    solutionIndex: 0,
    // Histórico de lances jogados pelo usuário (array de strings SAN)
    playedMoves: [],
    // Status do exercício atual: "pending" | "solved" | "failed"
    exerciseStatus: "pending",
    // Dados temporários do editor de posição (qual exercício está sendo editado)
    editorPosition: null,
    // Imagem de referência do diagrama (dataURL da página do PDF)
    editorRefImage: null,
    // Texto completo extraído de todas as páginas do PDF
    pdfText: "",
    // Páginas do PDF (array de objetos {pageNum, text, imageDataUrl, canvas})
    pdfPages: [],
};

/* ===================== SEÇÃO 02 - UTILITÁRIOS GERAIS ===================== */
/* Funções auxiliares usadas em vários lugares do código. */

/* Atalho para document.getElementById. Ex: $("meuId") em vez de document.getElementById("meuId"). */
function $(id) { return document.getElementById(id); }

/* Cria um elemento HTML com classe e texto opcionais. */
function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

/* Mostra uma mensagem temporária em um elemento (ex: erro ou sucesso). */
function showMessage(el, text, type) {
    el.textContent = text;
    el.className = "message " + (type || "info");
    el.classList.remove("hidden");
    // Esconde automaticamente após 4 segundos
    setTimeout(function () { el.classList.add("hidden"); }, 4000);
}

/* Escapa HTML para evitar injeção de código ao inserir texto do usuário/livro. */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/* Gera um identificador único simples (ex: id_1234567890_abc12). */
function uid() {
    return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/* Converte a vez ("w" ou "b") para nome legível em português. */
function turnName(turn) {
    return turn === "w" ? "Brancas" : "Pretas";
}

/* ===================== SEÇÃO 03 - PERSISTÊNCIA (localStorage) ===================== */
/* localStorage salva dados no navegador. Mesmo fechando o navegador, os dados permanecem.
   Não há servidor: tudo fica no computador do usuário. */

const STORAGE_KEY = "xadrez_tatico_v1"; // chave usada para salvar no localStorage

/* Estrutura padrão do que será salvo no armazenamento. */
function defaultStorage() {
    return { users: {}, lastUser: null };
}

/* Carrega o objeto de armazenamento do localStorage. Retorna padrão se não houver nada. */
function loadStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultStorage();
        return JSON.parse(raw);
    } catch (e) {
        console.error("Erro ao ler localStorage:", e);
        return defaultStorage();
    }
}

/* Salva o objeto de armazenamento no localStorage. */
function saveStorage(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error("Erro ao salvar localStorage:", e);
        alert("Não foi possível salvar (armazenamento cheio?). Exporte um backup.");
    }
}

/* Retorna o registro completo do usuário logado (incluindo seu progresso). */
function getCurrentUserData() {
    if (!AppState.currentUser) return null;
    const store = loadStorage();
    return store.users[AppState.currentUser.email] || null;
}

/* Atualiza os dados do usuário logado aplicando uma função de modificação. */
function updateCurrentUserData(mutator) {
    if (!AppState.currentUser) return;
    const store = loadStorage();
    const u = store.users[AppState.currentUser.email];
    if (!u) return;
    mutator(u);               // aplica as mudanças (ex: adicionar livro, salvar progresso)
    saveStorage(store);       // grava de volta no localStorage
}

/* ===================== SEÇÃO 04 - AUTENTICAÇÃO ===================== */
/* Login, cadastro e logout. Senha é armazenada em texto simples (apenas demo local). */

/* Inicializa os eventos dos formulários de login e cadastro. */
function initAuth() {
    // Abas: alternar entre formulário de Login e de Cadastro
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            // Remove "active" de todas as abas e adiciona na clicada
            document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            // Mostra o formulário correspondente à aba
            const tab = btn.getAttribute("data-tab");
            document.querySelectorAll(".form").forEach(function (f) { f.classList.remove("active"); });
            if (tab === "login") $("loginForm").classList.add("active");
            else $("registerForm").classList.add("active");
        });
    });

    // Cadastro de novo usuário
    $("registerForm").addEventListener("submit", function (e) {
        e.preventDefault(); // impede recarregar a página
        const name = $("regName").value.trim();
        const email = $("regEmail").value.trim().toLowerCase();
        const password = $("regPassword").value;
        if (!name || !email || !password) {
            showMessage($("loginMessage"), "Preencha todos os campos.", "error");
            return;
        }
        const store = loadStorage();
        if (store.users[email]) {
            showMessage($("loginMessage"), "Este e-mail já está cadastrado.", "error");
            return;
        }
        // Cria o usuário com progresso vazio
        store.users[email] = {
            name: name,
            email: email,
            password: password, // ATENÇÃO: senha em texto simples (apenas demo client-side)
            books: [],
            progress: {},       // progress[bookId][exerciseId] = {status, errors, attempts}
            lastExercise: null,
        };
        store.lastUser = email;
        saveStorage(store);
        showMessage($("loginMessage"), "Conta criada! Faça login.", "success");
    });

    // Login de usuário existente
    $("loginForm").addEventListener("submit", function (e) {
        e.preventDefault();
        const email = $("loginEmail").value.trim().toLowerCase();
        const password = $("loginPassword").value;
        const store = loadStorage();
        const u = store.users[email];
        if (!u || u.password !== password) {
            showMessage($("loginMessage"), "E-mail ou senha inválidos.", "error");
            return;
        }
        AppState.currentUser = { name: u.name, email: u.email };
        store.lastUser = email;
        saveStorage(store);
        enterApp(); // entra na aplicação
    });

    // Logout: volta para a tela de login
    $("logoutBtn").addEventListener("click", function () {
        AppState.currentUser = null;
        AppState.currentBook = null;
        $("appScreen").classList.remove("active");
        $("loginScreen").classList.add("active");
    });

    // Se houver um último usuário salvo, preenche o campo de e-mail para facilitar
    const store = loadStorage();
    if (store.lastUser && store.users[store.lastUser]) {
        const u = store.users[store.lastUser];
        $("loginEmail").value = u.email;
    }
}

/* Entra na aplicação após o login bem-sucedido. */
function enterApp() {
    $("loginScreen").classList.remove("active");
    $("appScreen").classList.add("active");
    const u = getCurrentUserData();
    $("userName").textContent = u.name;
    // Carrega livros salvos deste usuário
    AppState.books = u.books || [];
    // Aplica o tema salvo (ou claro por padrão)
    const savedTheme = localStorage.getItem("theme") || "light";
    setTheme(savedTheme);
    renderBookSelect();
    renderExerciseList();
    updateStats();
}

/* ===================== SEÇÃO 05 - TEMA (CLARO/ESCURO) ===================== */

/* Aplica o tema claro ou escuro ao body e atualiza o botão. */
function setTheme(theme) {
    AppState.theme = theme;
    if (theme === "dark") document.body.classList.add("dark");
    else document.body.classList.remove("dark");
    $("themeToggle").textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem("theme", theme);
}

/* Inicializa o botão de alternar tema. */
function initTheme() {
    $("themeToggle").addEventListener("click", function () {
        setTheme(AppState.theme === "dark" ? "light" : "dark");
    });
}

/* ===================== SEÇÃO 06 - UPLOAD E PROCESSAMENTO DE PDF ===================== */
/* Esta seção lida com arrastar e soltar (drag & drop) de PDF e leitura via PDF.js. */

function initUpload() {
    const dropZone = $("dropZone");
    const input = $("pdfInput");

    // Clicar na área abre o seletor de arquivos
    dropZone.addEventListener("click", function () { input.click(); });
    // Quando um arquivo é escolhido no input
    input.addEventListener("change", function (e) {
        if (e.target.files && e.target.files[0]) handlePdfFile(e.target.files[0]);
    });

    // Drag & drop: arrastar o PDF sobre a área
    dropZone.addEventListener("dragover", function (e) {
        e.preventDefault(); // necessário para permitir soltar
        dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", function () {
        dropZone.classList.remove("dragover");
    });
    dropZone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
    });
}

/* Processa o arquivo PDF selecionado pelo usuário. */
async function handlePdfFile(file) {
    if (!file || file.type !== "application/pdf") {
        alert("Por favor, selecione um arquivo PDF.");
        return;
    }
    showProgress(true, "Abrindo PDF...");
    try {
        const arrayBuffer = await file.arrayBuffer();
        // Configura o worker do PDF.js (necessário para processar em background)
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        AppState.pdfPages = [];
        AppState.pdfText = "";

        // Processa cada página do PDF (limitado por PDF_MAX_PAGES para performance)
        const totalPages = Math.min(pdf.numPages, CONFIG.PDF_MAX_PAGES);
        for (let i = 1; i <= totalPages; i++) {
            showProgress(true, "Processando página " + i + " de " + totalPages + "...");
            const page = await pdf.getPage(i);

            // Extrai o texto selecionável da página
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(function (it) { return it.str; }).join(" ");
            AppState.pdfText += "\n--- PÁGINA " + i + " ---\n" + pageText;

            // Renderiza a página em um canvas (imagem) para extrair diagramas depois
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            // Salva a imagem da página como dataURL (para o editor de posição)
            AppState.pdfPages.push({
                pageNum: i,
                text: pageText,
                imageDataUrl: canvas.toDataURL("image/png"),
                canvas: canvas,
            });
        }

        showProgress(false);
        // Analisa o texto extraído para montar a estrutura do livro
        const book = parsePdfToBook(file.name, AppState.pdfPages);
        // Adiciona o livro à biblioteca do usuário logado
        addBookToUser(book);
        AppState.currentBook = book;
        renderBookSelect();
        selectBook(book.id);
        alert("PDF processado! " + book.exercises.length + " exercícios encontrados.\nRevise as posições no editor se necessário.");
    } catch (err) {
        showProgress(false);
        console.error(err);
        alert("Erro ao processar PDF: " + err.message);
    }
}

/* Mostra ou esconde a barra de progresso do upload. */
function showProgress(show, text) {
    const p = $("uploadProgress");
    if (show) {
        p.classList.remove("hidden");
        $("progressText").textContent = text || "Processando...";
    } else {
        p.classList.add("hidden");
    }
}

/* Adiciona um livro à lista do usuário logado e persiste no localStorage. */
function addBookToUser(book) {
    const u = getCurrentUserData();
    if (!u) return;
    u.books = u.books || [];
    // Evita duplicar livro com o mesmo id
    const idx = u.books.findIndex(function (b) { return b.id === book.id; });
    if (idx >= 0) u.books[idx] = book;
    else u.books.push(book);
    updateCurrentUserData(function (uu) { uu.books = u.books; });
    AppState.books = u.books;
}

/* ===================== SEÇÃO 07 - PARSER DE TEXTO DO PDF ===================== */
/* Esta seção analisa o texto extraído do PDF para encontrar capítulos, exercícios e gabaritos.
   O padrão esperado é o dos e-books do Clube de Xadrez Online (CXOL). */

// Regex para identificar linhas de enunciado de exercício.
// Exemplos: "1 - Brancas jogam e empatam", "5 - Pretas jogam e as brancas ganham"
const EXERCISE_REGEX = /(\d+)\s*[-–—]\s*(Brancas|Pretas)\s+jogam\s+e\s+([^\d\n]*?)(?=\s*\d+\s*[-–—]|---|$)/gi;

// Palavras-chave que indicam início de uma seção de gabarito
const GABARITO_KEYWORDS = ["gabarito", "solução", "soluções", "solucao", "respostas"];

// Palavras-chave que indicam capítulos (temas de finais de xadrez)
const CHAPTER_KEYWORDS = [
    "peões", "peao", "cavalo", "bispo", "torre", "dama", "rei",
    "finais", "final", "oposição", "oposicao", "lucena", "philidor",
];

// Converte o texto de todas as páginas em um objeto livro (estrutura de dados).
function parsePdfToBook(fileName, pages) {
    const book = {
        id: uid(),
        name: fileName.replace(/\.pdf$/i, ""), // remove extensão .pdf
        chapters: [],
        exercises: [], // lista plana de todos os exercícios
    };

    // Junta todo o texto extraído em uma única string
    let fullText = pages.map(function (p) { return p.text; }).join("\n");

    // 1) Encontra todos os enunciados de exercício no texto
    const exercisesFound = [];
    let match;
    const regex = new RegExp(EXERCISE_REGEX.source, "gi");
    while ((match = regex.exec(fullText)) !== null) {
        exercisesFound.push({
            number: parseInt(match[1], 10),
            side: match[2], // "Brancas" ou "Pretas"
            objective: match[2] + " jogam e " + match[3].trim().replace(/\s+/g, " "),
            raw: match[0],
            index: match.index,
        });
    }

    // 2) Extrai a seção de gabarito (tudo após a palavra-chave "Gabarito")
    const gabaritoSection = extractGabaritoSection(fullText);

    // 3) Detecta o nome do capítulo a partir de palavras-chave no texto
    const chapterName = detectChapterName(fullText) || "Exercícios";

    // 4) Para cada exercício encontrado, tenta achar a solução correspondente no gabarito
    exercisesFound.forEach(function (ex) {
        const sol = findSolutionForExercise(ex.number, gabaritoSection);
        const exercise = {
            id: uid(),
            number: ex.number,
            chapter: chapterName,
            objective: ex.objective,
            sideToMove: ex.side === "Brancas" ? "w" : "b", // w = brancas jogam, b = pretas jogam
            // Posição FEN padrão (vazia) até o usuário definir via editor de diagrama
            fen: "8/8/8/8/8/8/8/8 w - - 0 1",
            // Solução em notação portuguesa extraída do gabarito
            solutionSanPt: sol ? sol.moves : [],
            // Variantes alternativas (texto entre colchetes [...] do gabarito)
            variants: sol ? sol.variants : [],
            status: "pending", // pendente, resolvido ou falhou
            // Índice da página onde o diagrama provavelmente está (heurística simples)
            pageIndex: findExercisePageIndex(pages, ex.number),
        };
        book.exercises.push(exercise);
    });

    // Se nenhum exercício foi encontrado (PDF sem padrão reconhecido), cria um exemplo
    if (book.exercises.length === 0) {
        book.exercises.push({
            id: uid(),
            number: 1,
            chapter: "Exemplo",
            objective: "Brancas jogam e ganham",
            sideToMove: "w",
            fen: "8/8/8/8/8/8/8/8 w - - 0 1",
            solutionSanPt: [],
            variants: [],
            status: "pending",
            pageIndex: 0,
        });
    }

    // Agrupa exercícios por capítulo (por enquanto um único capítulo)
    book.chapters.push({ name: chapterName, exerciseIds: book.exercises.map(function (e) { return e.id; }) });

    return book;
}

// Extrai a seção do gabarito a partir da palavra-chave no texto completo.
function extractGabaritoSection(text) {
    const lower = text.toLowerCase();
    let start = -1;
    for (let i = 0; i < GABARITO_KEYWORDS.length; i++) {
        const idx = lower.indexOf(GABARITO_KEYWORDS[i]);
        if (idx !== -1 && (start === -1 || idx < start)) start = idx;
    }
    if (start === -1) return text; // fallback: retorna todo o texto se não encontrar gabarito
    return text.slice(start);
}

// Detecta o nome do capítulo procurando palavras-chave no texto.
function detectChapterName(text) {
    const lower = text.toLowerCase();
    for (let i = 0; i < CHAPTER_KEYWORDS.length; i++) {
        if (lower.indexOf(CHAPTER_KEYWORDS[i]) !== -1) {
            const w = CHAPTER_KEYWORDS[i];
            return w.charAt(0).toUpperCase() + w.slice(1);
        }
    }
    return null;
}

// Encontra a solução para um exercício específico na seção de gabarito.
// Retorna { moves: [san em português...], variants: [strings de variantes...] }.
function findSolutionForExercise(num, gabaritoText) {
    const lines = gabaritoText.split(/\n/);
    let capturing = false;
    const collected = [];
    const numStr = String(num);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Detecta início de um novo exercício no gabarito (ex: "1." ou "1 -")
        const m = line.match(/^(\d+)\s*[\.\-–]/);
        if (m) {
            if (m[1] === numStr) { capturing = true; continue; }
            else if (capturing) { capturing = false; }
        }
        if (capturing && line) collected.push(line);
    }
    if (collected.length === 0) {
        // Fallback: busca a primeira ocorrência do número no texto
        const idx = gabaritoText.indexOf(numStr + ".");
        if (idx !== -1) {
            const chunk = gabaritoText.slice(idx, idx + 400);
            collected.push(chunk);
        }
    }
    const full = collected.join(" ");
    if (!full.trim()) return null;

    // Extrai variantes entre colchetes [...]
    const variants = [];
    const varRegex = /\[([^\]]+)\]/g;
    let vm;
    while ((vm = varRegex.exec(full)) !== null) variants.push(vm[1].trim());

    // Remove colchetes do texto principal para obter apenas a linha principal
    const mainLine = full.replace(/\[[^\]]*\]/g, "").trim();

    // Extrai lances individuais (tokens que parecem SAN)
    const tokens = mainLine.split(/\s+/);
    const moves = [];
    for (let i = 0; i < tokens.length; i++) {
        let t = tokens[i];
        // Remove número de lance inicial ("1.", "2..." etc.) e marcadores tipo "2)"
        t = t.replace(/^\d+\.+/, "");
        t = t.replace(/\d+\)/g, "");
        t = t.replace(/[()]/g, "");
        // Remove símbolos de avaliação (!, ?, +, -, =, #)
        t = t.replace(/[!?]+/g, "");
        t = t.replace(/[+\-=#]/g, function (ch) { return ch === "+" || ch === "#" ? ch : ""; });
        // Remove resultado final da partida (1-0, 0-1, ½-½, etc.)
        if (/^(1-0|0-1|½-½|1\/2-1\/2)$/.test(t)) continue;
        if (!t) continue;
        // Ignora tokens que são apenas números
        if (/^\d+$/.test(t)) continue;
        // Heurística: token válido se contém letra ou número de casa de xadrez
        if (/[a-h1-8]/.test(t)) moves.push(t);
    }
    return { moves: moves, variants: variants, raw: full };
}

// Tenta encontrar em qual página do PDF o diagrama do exercício está (heurística simples).
function findExercisePageIndex(pages, num) {
    for (let i = 0; i < pages.length; i++) {
        if (pages[i].text.indexOf(String(num) + " -") !== -1 ||
            pages[i].text.indexOf(String(num) + "-") !== -1) {
            return i;
        }
    }
    return 0;
}

/* ===================== SEÇÃO 08 - CONVERSÃO DE NOTAÇÃO ===================== */
/* Converte notação algébrica em português (R, D, T, B, C) para internacional (K, Q, R, B, N).
   O chess.js usa o padrão internacional. Peões não têm letra (são apenas a4, e5, etc.). */

// Mapa de peças: português -> inglês (usado pelo chess.js)
const PIECE_MAP_PT_TO_EN = {
    "R": "K", // Rei
    "D": "Q", // Dama
    "T": "R", // Torre
    "B": "B", // Bispo
    "C": "N", // Cavalo
    // Peão: não tem letra (ex: e4, d5)
};

/* Converte um único lance SAN em português para SAN internacional.
   Ex: "Rc2" (Rei para c2) -> "Kc2" no padrão internacional. */
function convertSanPtToEn(sanPt) {
    if (!sanPt) return sanPt;
    // Preserva roque (não muda)
    if (sanPt === "0-0" || sanPt === "O-O") return "O-O";
    if (sanPt === "0-0-0" || sanPt === "O-O-O") return "O-O-O";
    let s = sanPt;
    // Se começa com letra de peça em português, substitui pela inglesa
    const first = s.charAt(0);
    if (PIECE_MAP_PT_TO_EN[first]) {
        s = PIECE_MAP_PT_TO_EN[first] + s.slice(1);
    }
    // Promoção: =D (Dama) -> =Q, =T (Torre) -> =R, etc.
    s = s.replace(/=([RDTBC])/g, function (_, p) {
        return "=" + (PIECE_MAP_PT_TO_EN[p] || p);
    });
    return s;
}

// Converte um array de lances em português para o padrão internacional.
function convertMovesPtToEn(movesPt) {
    return movesPt.map(convertSanPtToEn);
}

/* ===================== SEÇÃO 09 - DETECTOR DE DIAGRAMAS E EDITOR ===================== */
/* Os diagramas no PDF são imagens. Como não há OCR integrado, usamos:
   1) Detecção automática simplificada por densidade de pixels (aproximada).
   2) Editor visual manual para o usuário corrigir cada casa. */

// Peças disponíveis no editor (clicar cicla entre elas)
const PIECE_CYCLE = [
    "", "wP", "wN", "wB", "wR", "wQ", "wK",
    "bP", "bN", "bB", "bR", "bQ", "bK",
];
// Símbolos unicode para exibir as peças na grade do editor
const PIECE_UNICODE = {
    "": "",
    "wP": "♙", "wN": "♘", "wB": "♗", "wR": "♖", "wQ": "♕", "wK": "♔",
    "bP": "♟", "bN": "♞", "bB": "♝", "bR": "♜", "bQ": "♛", "bK": "♚",
};

// Estado da grade do editor (array de 64 posições, cada uma com "" ou "wP"/"bK" etc.)
let editorGridState = new Array(64).fill("");

// Abre o modal do editor de posição para um exercício específico.
function openPositionEditor(exercise) {
    AppState.editorPosition = exercise;
    // Carrega a imagem da página do PDF como referência visual
    const page = AppState.pdfPages[exercise.pageIndex || 0];
    if (page) {
        AppState.editorRefImage = page.imageDataUrl;
        const img = new Image();
        img.onload = function () {
            const canvas = $("refCanvas");
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = page.imageDataUrl;
    }
    // Inicializa a grade a partir do FEN atual do exercício
    fenToEditorGrid(exercise.fen);
    // Preenche campos do modal
    $("editorSide").value = exercise.sideToMove || "w";
    $("editorObjective").value = exercise.objective || "";
    renderEditorGrid();
    $("positionEditorModal").classList.remove("hidden");
}

// Converte uma string FEN para o estado da grade do editor.
function fenToEditorGrid(fen) {
    editorGridState = new Array(64).fill("");
    if (!fen) return;
    const parts = fen.split(" ");
    const rows = parts[0].split("/");
    const pieceMap = {
        "P": "wP", "N": "wN", "B": "wB", "R": "wR", "Q": "wQ", "K": "wK",
        "p": "bP", "n": "bN", "b": "bB", "r": "bR", "q": "bQ", "k": "bK",
    };
    let idx = 0;
    for (let r = 0; r < 8; r++) {
        const row = rows[r] || "";
        for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (/\d/.test(ch)) {
                idx += parseInt(ch, 10); // número = casas vazias
            } else if (pieceMap[ch]) {
                editorGridState[idx] = pieceMap[ch];
                idx++;
            }
        }
    }
}

// Converte o estado da grade do editor de volta para uma string FEN.
function editorGridToFen() {
    const side = $("editorSide").value || "w";
    let fen = "";
    for (let r = 0; r < 8; r++) {
        let empty = 0;
        let rowStr = "";
        for (let c = 0; c < 8; c++) {
            const idx = r * 8 + c;
            const p = editorGridState[idx];
            if (!p) {
                empty++;
            } else {
                if (empty > 0) { rowStr += empty; empty = 0; }
                const color = p.charAt(0);
                const type = p.charAt(1);
                const map = { "P": "P", "N": "N", "B": "B", "R": "R", "Q": "Q", "K": "K" };
                rowStr += map[type] ? (color === "w" ? map[type] : map[type].toLowerCase()) : "";
            }
        }
        if (empty > 0) rowStr += empty;
        fen += (r > 0 ? "/" : "") + rowStr;
    }
    fen += " " + side + " - - 0 1";
    return fen;
}

// Renderiza a grade visual 8x8 do editor (clicável).
function renderEditorGrid() {
    const grid = $("editorGrid");
    grid.innerHTML = "";
    for (let i = 0; i < 64; i++) {
        const cell = document.createElement("div");
        cell.className = "editor-cell";
        const r = Math.floor(i / 8);
        const c = i % 8;
        if ((r + c) % 2 === 1) cell.classList.add("dark"); // casa escura
        cell.textContent = PIECE_UNICODE[editorGridState[i]] || "";
        cell.dataset.idx = i;
        cell.addEventListener("click", function () {
            const idx = parseInt(cell.dataset.idx, 10);
            // Cicla para a próxima peça na lista
            const cur = editorGridState[idx];
            const pos = PIECE_CYCLE.indexOf(cur);
            const next = PIECE_CYCLE[(pos + 1) % PIECE_CYCLE.length];
            editorGridState[idx] = next;
            cell.textContent = PIECE_UNICODE[next] || "";
        });
        grid.appendChild(cell);
    }
}

// Detecção automática aproximada do tabuleiro na imagem da página (por densidade de pixels).
function autoDetectBoard() {
    const page = AppState.pdfPages[AppState.editorPosition.pageIndex || 0];
    if (!page) { alert("Sem imagem de referência."); return; }
    const img = new Image();
    img.onload = function () {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Heurística: recorta um quadrado central e analisa densidade de pixels escuros em cada casa
        const size = Math.min(canvas.width, canvas.height);
        const startX = Math.floor((canvas.width - size * 0.6) / 2);
        const startY = Math.floor((canvas.height - size * 0.6) / 2);
        const boardSize = Math.floor(size * 0.6);
        const cellSize = Math.floor(boardSize / 8);

        const newGrid = new Array(64).fill("");
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const x0 = startX + c * cellSize;
                const y0 = startY + r * cellSize;
                let darkCount = 0;
                let total = 0;
                for (let yy = 2; yy < cellSize - 2; yy++) {
                    for (let xx = 2; xx < cellSize - 2; xx++) {
                        const px = ((y0 + yy) * canvas.width + (x0 + xx)) * 4;
                        const gray = (data.data[px] + data.data[px + 1] + data.data[px + 2]) / 3;
                        if (gray < 120) darkCount++;
                        total++;
                    }
                }
                const density = darkCount / total;
                if (density > 0.12) {
                    const isDarkSquare = (r + c) % 2 === 1;
                    const color = isDarkSquare ? "w" : "b"; // heurística simples de cor da peça
                    newGrid[r * 8 + c] = color + "P";       // assume peão por padrão (usuário corrige depois)
                }
            }
        }
        editorGridState = newGrid;
        renderEditorGrid();
        alert("Detecção automática concluída (aproximada). Revise cada casa clicando para corrigir.");
    };
    img.src = page.imageDataUrl;
}

// Inicializa os eventos do modal do editor.
function initEditor() {
    $("autoDetectBtn").addEventListener("click", autoDetectBoard);
    $("clearBoardBtn").addEventListener("click", function () {
        editorGridState = new Array(64).fill("");
        renderEditorGrid();
    });
    $("savePositionBtn").addEventListener("click", function () {
        const fen = editorGridToFen();
        const ex = AppState.editorPosition;
        if (ex) {
            ex.fen = fen;
            ex.sideToMove = $("editorSide").value;
            ex.objective = $("editorObjective").value;
        }
        persistCurrentBook(); // salva no localStorage
        $("positionEditorModal").classList.add("hidden");
        renderExerciseList();
        // Se for o exercício atual, recarrega o tabuleiro
        if (AppState.currentExercise && AppState.currentExercise.id === ex.id) {
            loadExercise(ex.id);
        }
    });
    // Fecha o modal ao clicar no X
    document.querySelectorAll(".modal-close").forEach(function (btn) {
        btn.addEventListener("click", function () {
            const target = btn.getAttribute("data-close");
            $(target).classList.add("hidden");
        });
    });
}

// Persiste o livro atual no usuário logado (salva alterações do editor, progresso, etc.)
function persistCurrentBook() {
    if (!AppState.currentBook) return;
    const u = getCurrentUserData();
    if (!u) return;
    const idx = u.books.findIndex(function (b) { return b.id === AppState.currentBook.id; });
    if (idx >= 0) u.books[idx] = AppState.currentBook;
    else u.books.push(AppState.currentBook);
    updateCurrentUserData(function (uu) { uu.books = u.books; });
    AppState.books = u.books;
}

/* ===================== SEÇÃO 10 - TABULEIRO INTERATIVO ===================== */
/* Usa chess.js (regras) e chessboard.js (desenho visual). */

// Configuração do tabuleiro chessboard.js
function boardConfig() {
    return {
        draggable: true,
        position: "start",
        orientation: AppState.orientation,
        onDrop: onPieceDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
    };
}

// Inicializa o tabuleiro visual (chamado uma vez ao carregar a app).
function initBoard() {
    if (typeof Chessboard === "undefined") {
        console.error("chessboard.js não carregado");
        return;
    }
    AppState.board = Chessboard("board", boardConfig());
    window.addEventListener("resize", function () {
        if (AppState.board) AppState.board.resize();
    });
}

/* Callback quando o usuário solta uma peça no tabuleiro. */
function onPieceDrop(source, target, piece, newPos, oldPos, orientation) {
    if (!AppState.game) return "snapback";
    // Tenta aplicar o lance no motor chess.js
    let move;
    try {
        move = AppState.game.move({ from: source, to: target, promotion: "q" });
    } catch (e) {
        move = null;
    }
    if (move === null) {
        // Lance ilegal (ex: mover peça do adversário, casa inválida)
        showMoveFeedback("Lance ilegal. Tente novamente.", "wrong");
        return "snapback"; // devolve a peça para a casa original
    }

    const playedSan = move.san; // notação do lance jogado (ex: "e4", "Rc2")
    const expectedSan = AppState.solutionMoves[AppState.solutionIndex];

    // Se não houver gabarito definido, aceita qualquer lance legal
    const hasSolution = AppState.solutionMoves && AppState.solutionMoves.length > 0
                       && AppState.solutionIndex < AppState.solutionMoves.length;
    const isCorrect = !hasSolution || (normalizeSan(playedSan) === normalizeSan(expectedSan));

    if (!isCorrect) {
        // Lance incorreto: desfaz e avisa
        AppState.game.undo();
        showMoveFeedback("Lance incorreto. Tente novamente ou peça uma dica.", "wrong");
        highlightSquare(target, "wrong");
        return "snapback";
    }

    // Lance correto: registra e avança na solução
    AppState.playedMoves.push(playedSan);
    AppState.solutionIndex++;
    // Sincroniza o tabuleiro visual com o estado do motor
    if (AppState.board && AppState.game) AppState.board.position(AppState.game.fen());
    renderMoveHistory();
    showMoveFeedback("Correto! " + playedSan, "correct");
    // Gera explicação didática do lance
    postMoveExplanation(playedSan);

    // Se terminou a linha principal da solução, o exercício está resolvido
    if (AppState.solutionIndex >= AppState.solutionMoves.length) {
        markExerciseSolved();
        showMoveFeedback("Parabéns! Exercício resolvido. ✅", "correct");
        return;
    }

    // Se ainda há lances na solução, o próximo é do adversário: joga automaticamente
    setTimeout(function () {
        playAdversaryMove();
    }, CONFIG.ADVERSARY_DELAY_MS);

    return;
}

// Normaliza SAN para comparação (remove símbolos de avaliação como ! ? + = #)
function normalizeSan(san) {
    if (!san) return "";
    return san.replace(/[!?]+/g, "").replace(/\s/g, "");
}

// Reproduz o lance do adversário conforme o gabarito (linha principal da solução).
function playAdversaryMove() {
    if (AppState.solutionIndex >= AppState.solutionMoves.length) return;
    const advSan = AppState.solutionMoves[AppState.solutionIndex];
    let move;
    try {
        move = AppState.game.move(advSan); // já convertido para padrão internacional
    } catch (e) {
        move = null;
    }
    if (!move) {
        console.warn("Adversário não conseguiu jogar:", advSan);
        return;
    }
    AppState.playedMoves.push(move.san);
    AppState.solutionIndex++;
    AppState.board.position(AppState.game.fen());
    renderMoveHistory();

    if (AppState.solutionIndex >= AppState.solutionMoves.length) {
        markExerciseSolved();
        showMoveFeedback("Variante concluída. ✅", "correct");
    } else {
        showMoveFeedback("Resposta do adversário: " + move.san, "info");
    }
}

function onSnapEnd() {
    if (AppState.board && AppState.game) {
        AppState.board.position(AppState.game.fen());
    }
}

// Carrega um exercício no tabuleiro (define posição FEN, orientação, solução).
function loadExercise(exerciseId) {
    const book = AppState.currentBook;
    if (!book) return;
    const ex = book.exercises.find(function (e) { return e.id === exerciseId; });
    if (!ex) return;
    AppState.currentExercise = ex;
    AppState.exerciseStatus = ex.status || "pending";

    // Orientação: se as pretas jogam, vira o tabuleiro (pretas embaixo)
    AppState.orientation = ex.sideToMove === "b" ? "black" : "white";

    // Reinicia o motor com a posição FEN do exercício
    AppState.game = new Chess(ex.fen);
    AppState.playedMoves = [];
    AppState.solutionMoves = convertMovesPtToEn(ex.solutionSanPt || []);
    AppState.solutionIndex = 0;

    // Atualiza o tabuleiro visual
    if (AppState.board) {
        AppState.board.orientation(AppState.orientation);
        AppState.board.position(ex.fen);
    }

    // Atualiza a interface
    $("exerciseNumber").textContent = "Exercício " + ex.number;
    $("exerciseObjective").textContent = ex.objective || "";
    $("turnIndicator").textContent = "Vez das " + (ex.sideToMove === "w" ? "Brancas" : "Pretas");
    renderMoveHistory();
    $("explanationPanel").innerHTML = '<p class="empty-hint">Jogue um lance para ver a explicação.</p>';
    $("variantsPanel").innerHTML = ex.variants && ex.variants.length
        ? ex.variants.map(function (v) { return '<div class="variant">' + escapeHtml(v) + "</div>"; }).join("")
        : '<p class="empty-hint">Sem variantes.</p>';
    $("moveFeedback").classList.add("hidden");

    // Marca o exercício ativo na lista da esquerda
    document.querySelectorAll(".exercise-item").forEach(function (el) {
        el.classList.toggle("active", el.dataset.id === ex.id);
    });
}

// Marca o exercício atual como resolvido e salva o progresso.
function markExerciseSolved() {
    const ex = AppState.currentExercise;
    if (!ex) return;
    ex.status = "solved";
    AppState.exerciseStatus = "solved";
    updateProgress(ex.id, "solved");
    renderExerciseList();
    updateStats();
}

// Marca o exercício como falho (usuário desistiu ou pediu solução após errar).
function markExerciseFailed() {
    const ex = AppState.currentExercise;
    if (!ex) return;
    if (ex.status !== "solved") {
        ex.status = "failed";
        AppState.exerciseStatus = "failed";
        updateProgress(ex.id, "failed");
        renderExerciseList();
        updateStats();
    }
}

// Atualiza o progresso do usuário para um exercício específico.
function updateProgress(exerciseId, status) {
    updateCurrentUserData(function (u) {
        u.progress = u.progress || {};
        const bookId = AppState.currentBook ? AppState.currentBook.id : "default";
        u.progress[bookId] = u.progress[bookId] || {};
        const cur = u.progress[bookId][exerciseId] || { errors: 0, attempts: 0 };
        cur.status = status;
        cur.attempts = (cur.attempts || 0) + 1;
        if (status === "failed") cur.errors = (cur.errors || 0) + 1;
        u.progress[bookId][exerciseId] = cur;
        u.lastExercise = { bookId: bookId, exerciseId: exerciseId };
    });
}

/* ===================== SEÇÃO 11 - VALIDAÇÃO E FLUXO DO EXERCÍCIO ===================== */
/* (A validação de lances está implementada em onPieceDrop, seção 10.)
   Esta seção contém os botões de controle e o fluxo entre exercícios. */

function initControls() {
    // Reiniciar exercício atual
    $("restartBtn").addEventListener("click", function () {
        if (!AppState.currentExercise) return;
        loadExercise(AppState.currentExercise.id);
    });

    // Dica: mostra o próximo lance esperado da solução
    $("hintBtn").addEventListener("click", function () {
        if (!AppState.solutionMoves || AppState.solutionIndex >= AppState.solutionMoves.length) {
            showMoveFeedback("Sem dica disponível.", "info");
            return;
        }
        const next = AppState.solutionMoves[AppState.solutionIndex];
        showMoveFeedback("Dica: tente " + next, "info");
    });

    // Ver solução completa: mostra todos os lances da linha principal
    $("solutionBtn").addEventListener("click", function () {
        if (!AppState.currentExercise) return;
        const sol = AppState.solutionMoves.join(" ");
        showMoveFeedback("Solução: " + sol, "info");
        markExerciseFailed();
        showExplanation("Solução", "Linha principal do gabarito: " + sol + ". " + (AppState.currentExercise.variants.length ? "Variantes: " + AppState.currentExercise.variants.join(" | ") : ""));
    });

    // Próximo exercício da lista
    $("nextBtn").addEventListener("click", function () {
        const book = AppState.currentBook;
        if (!book) return;
        const idx = book.exercises.findIndex(function (e) { return e.id === AppState.currentExercise.id; });
        const next = book.exercises[idx + 1] || book.exercises[0];
        if (next) openExerciseFlow(next.id);
    });
}

// Fluxo ao selecionar um exercício: se não tem FEN válido, abre o editor de posição primeiro.
function openExerciseFlow(exerciseId) {
    const book = AppState.currentBook;
    const ex = book.exercises.find(function (e) { return e.id === exerciseId; });
    if (!ex) return;
    // Se o FEN for o padrão vazio, força o usuário a definir a posição no editor
    if (!ex.fen || ex.fen.indexOf("8/8/8/8/8/8/8/8") === 0) {
        openPositionEditor(ex);
    } else {
        loadExercise(exerciseId);
    }
}

// Destaque visual temporário em uma casa do tabuleiro (feedback de erro/acerto)
function highlightSquare(square, type) {
    const el = document.querySelector('.square-' + square);
    if (!el) return;
    el.classList.add(type === "wrong" ? "highlight-wrong" : "highlight-ok");
    setTimeout(function () { el.classList.remove("highlight-wrong", "highlight-ok"); }, 800);
}

/* ===================== SEÇÃO 12 - FEEDBACK PEDAGÓGICO E EXPLICAÇÕES ===================== */
/* Exibe mensagens de feedback e explicações didáticas para o usuário aprender. */

function showMoveFeedback(text, type) {
    const el = $("moveFeedback");
    el.textContent = text;
    el.className = "move-feedback " + (type || "info");
    el.classList.remove("hidden");
}

// Exibe uma explicação no painel da coluna direita
function showExplanation(title, body) {
    const panel = $("explanationPanel");
    panel.innerHTML = '<div class="exp-title">' + escapeHtml(title) + '</div><div class="exp-body">' + escapeHtml(body) + '</div>';
}

/* Gerador heurístico de explicações: analisa um lance usando chess.js e traduz para português simples. */
function generateHeuristicExplanation(moveSan, game) {
    const explanations = [];
    if (game.in_check()) explanations.push("O lance dá xeque ao rei adversário.");
    if (moveSan.indexOf("x") !== -1) explanations.push("Há uma captura neste lance.");
    if (moveSan.indexOf("=") !== -1) explanations.push("Promoção de peão!");
    if (moveSan === "O-O" || moveSan === "O-O-O") explanations.push("Roque para segurança do rei.");
    if (game.in_checkmate()) explanations.push("Xeque-mate! Fim de jogo.");
    if (game.in_draw()) explanations.push("Posição de empate (afogamento ou material insuficiente).");
    if (explanations.length === 0) {
        explanations.push("Lance posicional: melhora a coordenação das peças e mantém a iniciativa.");
    }
    return explanations.join(" ");
}

// Chamado após um lance correto para mostrar a explicação heurística.
function postMoveExplanation(moveSan) {
    if (!AppState.game) return;
    const exp = generateHeuristicExplanation(moveSan, AppState.game);
    showExplanation("Análise do lance " + moveSan, exp);
}

/* Opcional: chama uma IA (Gemini/OpenAI) se o usuário configurou a chave API. */
async function generateAIExplanation(context) {
    if (!CONFIG.AI_API_KEY || !CONFIG.AI_ENDPOINT) return null;
    try {
        const res = await fetch(CONFIG.AI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + CONFIG.AI_API_KEY },
            body: JSON.stringify({ prompt: context }),
        });
        const data = await res.json();
        return data.text || data.choices?.[0]?.message?.content || null;
    } catch (e) {
        console.warn("IA indisponível:", e);
        return null;
    }
}

/* ===================== SEÇÃO 13 - BACKUP (EXPORTAR/IMPORTAR JSON) ===================== */
/* Permite salvar todo o progresso em um arquivo JSON e restaurar depois. */

function initBackup() {
    $("backupBtn").addEventListener("click", function () {
        $("backupModal").classList.remove("hidden");
    });
    // Exporta todo o localStorage para um arquivo JSON
    $("exportBackupBtn").addEventListener("click", function () {
        const store = loadStorage();
        const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "xadrez_tatico_backup.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    // Importa um arquivo JSON de backup anterior
    $("importBackupInput").addEventListener("change", function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const data = JSON.parse(ev.target.result);
                saveStorage(data);
                alert("Backup importado com sucesso! Faça login novamente.");
                location.reload();
            } catch (err) {
                alert("Arquivo inválido: " + err.message);
            }
        };
        reader.readAsText(file);
    });
}

/* ===================== SEÇÃO 14 - RENDERIZAÇÃO DA UI ===================== */
/* Atualiza os elementos da tela com base no estado atual da aplicação. */

function renderBookSelect() {
    const sel = $("bookSelect");
    sel.innerHTML = "";
    if (!AppState.books || AppState.books.length === 0) {
        const u = getCurrentUserData();
        if (u && u.books) AppState.books = u.books;
    }
    const books = AppState.books || [];
    if (books.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Nenhum livro";
        sel.appendChild(opt);
        return;
    }
    books.forEach(function (b) {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
    });
    // Seleciona o livro atual ou o primeiro da lista
    if (AppState.currentBook) sel.value = AppState.currentBook.id;
    else { sel.value = books[0].id; selectBook(books[0].id); }
}

function selectBook(bookId) {
    const books = AppState.books || [];
    let book = books.find(function (b) { return b.id === bookId; });
    if (!book) {
        const u = getCurrentUserData();
        if (u && u.books) {
            book = u.books.find(function (b) { return b.id === bookId; });
            if (book) AppState.books = u.books;
        }
    }
    if (!book) return;
    AppState.currentBook = book;
    $("currentBookTitle").textContent = book.name;
    renderExerciseList();
}

function renderExerciseList() {
    const container = $("exerciseList");
    container.innerHTML = "";
    const book = AppState.currentBook;
    if (!book) {
        container.innerHTML = '<p class="empty-hint">Importe um PDF para começar.</p>';
        return;
    }
    // Agrupa exercícios por capítulo
    (book.chapters || []).forEach(function (ch) {
        const header = document.createElement("div");
        header.className = "chapter-header";
        header.textContent = ch.name;
        container.appendChild(header);
        (ch.exerciseIds || []).forEach(function (eid) {
            const ex = book.exercises.find(function (e) { return e.id === eid; });
            if (!ex) return;
            const item = document.createElement("div");
            item.className = "exercise-item";
            item.dataset.id = ex.id;
            const statusIcon = ex.status === "solved" ? "✅" : (ex.status === "failed" ? "❌" : "⚪");
            item.innerHTML = '<span class="status">' + statusIcon + '</span><span class="ex-label">Ex. ' + ex.number + ' - ' + escapeHtml(ex.objective) + '</span>';
            item.addEventListener("click", function () { openExerciseFlow(ex.id); });
            container.appendChild(item);
        });
    });
    // Se não há capítulos definidos, lista os exercícios diretamente
    if (!book.chapters || book.chapters.length === 0) {
        book.exercises.forEach(function (ex) {
            const item = document.createElement("div");
            item.className = "exercise-item";
            item.dataset.id = ex.id;
            const statusIcon = ex.status === "solved" ? "✅" : (ex.status === "failed" ? "❌" : "⚪");
            item.innerHTML = '<span class="status">' + statusIcon + '</span><span class="ex-label">Ex. ' + ex.number + ' - ' + escapeHtml(ex.objective) + '</span>';
            item.addEventListener("click", function () { openExerciseFlow(ex.id); });
            container.appendChild(item);
        });
    }
}

function renderMoveHistory() {
    const container = $("moveHistory");
    if (!AppState.playedMoves || AppState.playedMoves.length === 0) {
        container.innerHTML = '<p class="empty-hint">Nenhum lance ainda.</p>';
        return;
    }
    let html = "";
    for (let i = 0; i < AppState.playedMoves.length; i += 2) {
        const num = Math.floor(i / 2) + 1;
        const w = AppState.playedMoves[i] || "";
        const b = AppState.playedMoves[i + 1] || "";
        html += '<div class="move-row"><span class="move-num">' + num + '.</span><span class="move-white">' + escapeHtml(w) + '</span><span class="move-black">' + escapeHtml(b) + '</span></div>';
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

function updateStats() {
    const u = getCurrentUserData();
    if (!u) return;
    const bookId = AppState.currentBook ? AppState.currentBook.id : null;
    let solved = 0, errors = 0, total = 0;
    if (bookId && u.progress && u.progress[bookId]) {
        const p = u.progress[bookId];
        Object.keys(p).forEach(function (k) {
            total++;
            if (p[k].status === "solved") solved++;
            errors += (p[k].errors || 0);
        });
    }
    // Também conta diretamente do livro atual
    if (AppState.currentBook) {
        total = AppState.currentBook.exercises.length;
        solved = AppState.currentBook.exercises.filter(function (e) { return e.status === "solved"; }).length;
        errors = AppState.currentBook.exercises.reduce(function (a, e) { return a + (e.status === "failed" ? 1 : 0); }, 0);
    }
    $("statSolved").textContent = solved;
    $("statErrors").textContent = errors;
    const rate = total > 0 ? Math.round((solved / total) * 100) : 0;
    $("statRate").textContent = rate + "%";
}

/* ===================== SEÇÃO 15 - INICIALIZAÇÃO ===================== */
/* Executado quando o HTML termina de carregar. */

document.addEventListener("DOMContentLoaded", function () {
    initAuth();
    initTheme();
    initUpload();
    initBoard();
    initControls();
    initEditor();
    initBackup();

    // Troca de livro pelo seletor
    $("bookSelect").addEventListener("change", function (e) {
        selectBook(e.target.value);
        updateStats();
    });

    // Aplica o tema salvo ao carregar
    const savedTheme = localStorage.getItem("theme") || "light";
    setTheme(savedTheme);
    // (Não faz login automático; apenas preenche o e-mail do último usuário)
});

/* ========================================================================
   FIM DO ARQUIVO script.js
   ======================================================================== */