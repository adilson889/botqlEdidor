// =====================================================================
// index.html — editor BotQL ONLINE.
//
// Layout e UX idênticos ao editor do app (sidebar de ficheiros, menu,
// modais, highlight de sintaxe). O que muda em relação ao app:
//
//   - Motor: carregado via CDN (botql.browser.js, sem versão fixa —
//     puxa sempre a mais recente publicada), não módulos locais
//     (Parser.js/RAG.js/botql.js). Sem Ternlight aqui: o THINK
//     semântico é recurso da app, este editor fica só com o que o
//     build público do BotQL já embute.
//   - Run: corre o bot num preview inline (perguntas/respostas reais),
//     não só um "arrancou" isolado — dá para testar de verdade.
//   - Partilhar Bot: liga-se de facto à API (publicar/pausar), com o
//     mesmo link ?id= que a app gera — em vez do aviso "só na app".
//   - Modelos: usa o mesmo indice do repo que o app le
//     (app/index.json + app/modules/<arquivo>.sql via
//     raw.githubusercontent.com) — se um modelo novo aparecer no
//     repo, aparece aqui tambem, sem precisar de deploy do editor.
// =====================================================================

const URL_API_BOTQL = 'https://sire-kixikila-api.vercel.app';
const URL_CHAT_PUBLICO = 'https://adilson889.github.io/botql/app/publish/chat.html';
const URL_APP_DOWNLOAD = 'https://github.com/adilson889/botql';
const URL_ENCURTADOR = 'https://url.gratis';
const MODELOS_INDEX_URL = 'https://raw.githubusercontent.com/adilson889/botql/main/app/index.json';
const MODELOS_BASE_URL = 'https://raw.githubusercontent.com/adilson889/botql/main/app/modules/';
const MODELOS_CACHE_KEY = 'botql_editor_online_modelos_cache';

(async () => {
    // O <script src> do CDN já devia ter corrido antes deste ponto (a
    // ordem no HTML garante isso) -- mas se a rede estiver lenta, o
    // browser pode ainda estar a processá-lo. Espera um pouco antes de
    // desistir, em vez de abortar ao primeiro instante.
    for (let tentativas = 0; tentativas < 20 && typeof BotQL === 'undefined'; tentativas++) {
        await new Promise((r) => setTimeout(r, 150));
    }
    if (typeof BotQL === 'undefined') {
        throw new Error('O motor do BotQL não carregou (CDN indisponível ou sem ligação à internet). Recarrega a página.');
    }
    const { MemoryFileSystem, BotQLInterpreter } = BotQL;

    // ==========================================================
    // Ícones SVG
    // ==========================================================
    const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const SVG_FICHEIRO = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#A52A2A"/><path d="M15 2v5h5" fill="#7A6A5E"/></svg>';
    const SVG_PASTA = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="#A52A2A"/></svg>';
    const SVG_LAPIS = '<svg viewBox="0 0 24 24" fill="none"><path d="M14.7 3.3a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4L9.5 20.5 3 21l0.5-6.5L14.7 3.3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    const SVG_ANALYTICS = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20V10M11 20V4M18 20v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const SVG_LIXEIRA = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3m-8 0v13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const SVG_ROBO_BRANCO = '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="8" width="14" height="11" rx="3" fill="#fff"/><path d="M12 2v4" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="2" r="1.4" fill="#fff"/><circle cx="9" cy="13.5" r="1.4" fill="#8B0000"/><circle cx="15" cy="13.5" r="1.4" fill="#8B0000"/><path d="M2 12h3M19 12h3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

    // ==========================================================
    // Editor próprio (textarea + pre) — highlight simplificado sem
    // acesso a KEYWORDS do Parser.js local (não carregado aqui); usa
    // uma lista fixa das palavras-chave da linguagem.
    // ==========================================================
    const editorArea = document.getElementById('editor-area');
    const editorPre = document.getElementById('editor-pre');

    const KEYWORD_SET = new Set([
        'CREATE','BOT','PLATFORM','TABLE','PREVENT','DEFAULT','ON','MESSAGE',
        'INSERT','INTO','VALUES','WHEN','CONTAINS','OR','AND','NOT','OTHERWISE',
        'KEYWORDS','THINK','WAITING','REPLY','FORWARD','SEND','RUN','SELECT',
        'FROM','WHERE','UPDATE','SET','DELETE','SHOW','CATALOG','CATEGORY',
        'IF','ELSE','END','TO','AS','GROUP','BY','ORDER','LIMIT'
    ]);
    const BUILTINS_SET = new Set(['NOW', 'LAST_INSERT_ID']);

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function realcarLinha(linha) {
        if (/^\s*--/.test(linha)) {
            return '<span class="tok-comment">' + escapeHtml(linha) + '</span>';
        }
        let html = '';
        let i = 0;
        const n = linha.length;
        while (i < n) {
            const c = linha.charAt(i);
            if (c === '-' && linha.charAt(i + 1) === '-') {
                html += '<span class="tok-comment">' + escapeHtml(linha.slice(i)) + '</span>';
                break;
            }
            if (c === '"' || c === "'") {
                const quote = c;
                let j = i + 1;
                while (j < n && linha.charAt(j) !== quote) {
                    if (linha.charAt(j) === '\\') j++;
                    j++;
                }
                const fecho = j < n ? j + 1 : n;
                html += '<span class="tok-string">' + escapeHtml(linha.slice(i, fecho)) + '</span>';
                i = fecho;
                continue;
            }
            if (/[0-9]/.test(c)) {
                let j = i;
                while (j < n && /[0-9.]/.test(linha.charAt(j))) j++;
                html += '<span class="tok-number">' + escapeHtml(linha.slice(i, j)) + '</span>';
                i = j;
                continue;
            }
            if (/[A-Za-z_]/.test(c)) {
                let j = i;
                while (j < n && /[A-Za-z0-9_]/.test(linha.charAt(j))) j++;
                const palavra = linha.slice(i, j);
                const upper = palavra.toUpperCase();
                if (palavra === upper && KEYWORD_SET.has(upper)) {
                    html += '<span class="tok-keyword">' + escapeHtml(palavra) + '</span>';
                } else if (BUILTINS_SET.has(upper)) {
                    html += '<span class="tok-builtin">' + escapeHtml(palavra) + '</span>';
                } else {
                    html += '<span class="tok-ident">' + escapeHtml(palavra) + '</span>';
                }
                i = j;
                continue;
            }
            html += escapeHtml(c);
            i++;
        }
        return html;
    }

    function realcarTexto(texto) {
        return texto.split('\n').map(realcarLinha).join('\n');
    }

    let debounceId = null;
    function atualizarHighlight() {
        editorPre.innerHTML = realcarTexto(editorArea.value) + '\n';
        sincronizarScroll();
    }

    function sincronizarScroll() {
        editorPre.scrollTop = editorArea.scrollTop;
        editorPre.scrollLeft = editorArea.scrollLeft;
    }

    editorArea.addEventListener('input', () => {
        clearTimeout(debounceId);
        debounceId = setTimeout(atualizarHighlight, 120);
        agendarGuardar();
    });
    editorArea.addEventListener('scroll', sincronizarScroll);

    // ==========================================================
    // Persistência
    // ==========================================================
    const STORAGE_KEY = 'botql_editor_online_ficheiros';
    const ATUAL_KEY = 'botql_editor_online_atual';
    const STORAGE_CONTA = 'botql_editor_online_conta'; // { deviceId, codigo } -- a unica chave que fica no navegador
    const STORAGE_PASTAS = 'botql_editor_online_pastas';

    let ficheiros = {};
    let ficheiroAtual = null;
    let pastasAbertas = new Set();

    function carregarFicheirosSalvos() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) ficheiros = JSON.parse(raw);
        } catch (e) { ficheiros = {}; }
        try {
            const atual = localStorage.getItem(ATUAL_KEY);
            if (atual && ficheiros[atual]) ficheiroAtual = atual;
        } catch (e) {}
    }

    function salvarFicheirosNoDisco() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ficheiros)); } catch (e) {}
        try { localStorage.setItem(ATUAL_KEY, ficheiroAtual || ''); } catch (e) {}
        agendarSincronizacao();
    }

    // ---- Conta (servidor). No navegador fica só { deviceId, codigo }.
    // Tudo o resto (premium, publicados, contagem) vem do servidor e
    // vive em memória durante a sessão.
    let conta = null;                 // { deviceId, codigo }
    let idsPublicadosMem = {};        // nomeArquivo -> idPublico
    let estadoConta = null;           // { premium, uso, limites }

    function lerContaLocal() {
        try { return JSON.parse(localStorage.getItem(STORAGE_CONTA) || 'null'); }
        catch (e) { return null; }
    }
    function guardarContaLocal(c) {
        try { localStorage.setItem(STORAGE_CONTA, JSON.stringify(c)); } catch (e) {}
    }
    function obterDeviceId() { return conta ? conta.deviceId : ''; }
    function obterCodigo() { return conta ? conta.codigo : ''; }
    function credenciais() { return { deviceId: obterDeviceId(), codigo: obterCodigo() }; }

    function lerIdsPublicados() { return idsPublicadosMem; }
    function guardarIdPublicado(nomeArquivo, id) { idsPublicadosMem[nomeArquivo] = id; }

    async function chamarConta(caminho, corpo) {
        const resp = await fetch(URL_API_BOTQL + caminho, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo)
        });
        const dados = await resp.json();
        return { ok: resp.ok && dados.sucesso, dados: dados, status: resp.status };
    }

    function aplicarEstado(est) {
        if (!est) return;
        estadoConta = est;
        if (est.premium && est.premium.ativo && est.premium.expiraEm) {
            premiumMem = { expiraEm: est.premium.expiraEm };
        } else {
            premiumMem = null;
        }
        pedidoPendenteMem = !!(est.premium && est.premium.pendente);
    }

    // Arranque: cria conta nova ou recupera a existente. Se o servidor
    // estiver inacessível, o editor abre em modo local (sem limites
    // aplicados até haver ligação).
    async function iniciarConta() {
        conta = conta || lerContaLocal();
        try {
            if (!conta) {
                const r = await chamarConta('/api/botql/conta/criar', {});
                if (!r.ok) throw new Error('HTTP ' + r.status + ' em /conta/criar: ' + (r.dados.erro || 'sem detalhe'));
                conta = { deviceId: r.dados.deviceId, codigo: r.dados.codigo };
                guardarContaLocal(conta);
                contaNova = true;
            }
            const resp = await fetch(URL_API_BOTQL + '/api/botql/conta/estado?deviceId=' +
                encodeURIComponent(conta.deviceId) + '&codigo=' + encodeURIComponent(conta.codigo));
            let dados = {};
            try { dados = await resp.json(); } catch (e) {}
            if (!resp.ok || !dados.sucesso) {
                throw new Error('HTTP ' + resp.status + ' em /conta/estado: ' + (dados.erro || 'sem detalhe'));
            }
            aplicarEstado(dados.estado);
            servidorOnline = true;
            erroServidor = '';
            return true;
        } catch (e) {
            servidorOnline = false;
            // TypeError de fetch = nem chegou ao servidor (rede ou CORS).
            erroServidor = (e instanceof TypeError)
                ? 'sem resposta do servidor (rede ou CORS)'
                : (e.message || 'erro desconhecido');
            return false;
        }
    }
    let erroServidor = '';
    let contaNova = false;
    let servidorOnline = false;
    let premiumMem = null;
    let pedidoPendenteMem = false;

    // Recuperar conta noutro navegador: substitui deviceId/codigo e
    // traz de volta bots, ficheiros e publicados.
    async function recuperarConta(codigo) {
        const r = await chamarConta('/api/botql/conta/recuperar', { codigo: codigo });
        if (!r.ok) throw new Error(r.dados.erro || 'Código não encontrado');
        conta = { deviceId: r.dados.deviceId, codigo: String(codigo).trim().toUpperCase() };
        guardarContaLocal(conta);
        idsPublicadosMem = r.dados.publicados || {};
        const bots = r.dados.bots || {};
        const novos = {};
        Object.keys(bots).forEach((n) => { novos[n] = bots[n].sql; });
        Object.assign(novos, r.dados.ficheiros || {});
        ficheiros = novos;
        ficheiroAtual = Object.keys(ficheiros)[0] || null;
        aplicarEstado(r.dados.estado);
        salvarFicheirosNoDisco();
        editorArea.value = ficheiroAtual ? ficheiros[ficheiroAtual] : '';
        atualizarHighlight();
        atualizarTitulo();
        renderizarListaBots();
    }

    // Envia os bots e ficheiros ao servidor (backup + contagem de bots).
    let sincId = null;
    function agendarSincronizacao() {
        clearTimeout(sincId);
        sincId = setTimeout(sincronizarComServidor, 2500);
    }
    async function sincronizarComServidor() {
        if (!conta || !servidorOnline) return;
        const bots = {}, aux = {};
        Object.keys(ficheiros).forEach((n) => { (/\.sql$/i.test(n) ? bots : aux)[n] = ficheiros[n]; });
        try {
            const r = await chamarConta('/api/botql/conta/sincronizar',
                Object.assign(credenciais(), { bots: bots, ficheiros: aux }));
            if (r.ok) aplicarEstado(r.dados.estado);
        } catch (e) {}
    }

    function lerPastasCriadas() {
        try { return JSON.parse(localStorage.getItem(STORAGE_PASTAS) || '[]'); }
        catch (e) { return []; }
    }
    function guardarPastasCriadas(lista) {
        try { localStorage.setItem(STORAGE_PASTAS, JSON.stringify(lista)); } catch (e) {}
    }
    // Pastas = as criadas explicitamente + as que já têm bots dentro
    // (deduzidas do prefixo "Pasta/nome.sql"), para nunca "desaparecer"
    // uma pasta que ainda tem conteúdo.
    function listarPastas() {
        const s = new Set(lerPastasCriadas());
        Object.keys(ficheiros).forEach((nome) => {
            const i = nome.lastIndexOf('/');
            if (i > 0) s.add(nome.slice(0, i));
        });
        return [...s].sort((a, b) => a.localeCompare(b));
    }

    let guardarId = null;
    function agendarGuardar() {
        clearTimeout(guardarId);
        guardarId = setTimeout(() => {
            if (ficheiroAtual) {
                ficheiros[ficheiroAtual] = editorArea.value;
                salvarFicheirosNoDisco();
            }
        }, 400);
    }

    function abrirFicheiro(nome) {
        if (ficheiroAtual && ficheiros[ficheiroAtual] !== editorArea.value) {
            ficheiros[ficheiroAtual] = editorArea.value;
        }
        ficheiroAtual = nome;
        editorArea.value = ficheiros[nome] || '';
        atualizarHighlight();
        atualizarTitulo();
        renderizarListaBots();
        salvarFicheirosNoDisco();
    }

    function atualizarTitulo() {
        const nome = ficheiroAtual
            ? (ficheiroAtual.includes('/') ? ficheiroAtual.slice(ficheiroAtual.lastIndexOf('/') + 1) : ficheiroAtual)
            : 'BotQL';
        document.getElementById('titulo-statusbar').textContent = nome;
    }

    // ==========================================================
    // Sidebar
    // ==========================================================
    function abrirSidebar() {
        renderizarListaBots();
        document.getElementById('sidebar').classList.add('show');
        document.getElementById('sidebar-overlay').classList.add('show');
    }
    function fecharSidebar() {
        document.getElementById('sidebar').classList.remove('show');
        document.getElementById('sidebar-overlay').classList.remove('show');
    }

    function listarNomesBots() {
        return Object.keys(ficheiros).filter((n) => n.endsWith('.sql'));
    }

    function linhaBotHTML(nome, indentado) {
        const nomeEsc = escapeHtml(nome.includes('/') ? nome.slice(nome.lastIndexOf('/') + 1) : nome);
        const ativo = nome === ficheiroAtual ? ' ativo' : '';
        const nomeAttr = nome.replace(/'/g, "\\'");
        const estilo = indentado ? ' style="margin-left:20px"' : '';
        return '<div class="arv-linha' + ativo + '"' + estilo + ' onclick="abrirBot(\'' + nomeAttr + '\')">' +
            '<span class="arv-icone">' + SVG_FICHEIRO + '</span>' +
            '<span class="arv-nome">' + nomeEsc + '</span>' +
            '<button class="arv-btn-menu" onclick="event.stopPropagation(); renomearBot(\'' + nomeAttr + '\')" aria-label="Renomear">' + SVG_LAPIS + '</button>' +
            '<button class="arv-btn-menu" onclick="event.stopPropagation(); apagarBot(\'' + nomeAttr + '\')" aria-label="Apagar">' + SVG_LIXEIRA + '</button>' +
            '</div>';
    }

    function renderizarListaBots() {
        const lista = document.getElementById('lista-bots');
        const todos = Object.keys(ficheiros);
        const pastas = listarPastas();
        if (todos.length === 0 && pastas.length === 0) {
            lista.innerHTML = '<div style="color:var(--muted);padding:10px 6px;font-size:14px">Nenhum bot ainda. Cria um novo abaixo.</div>';
            return;
        }
        let html = '';
        pastas.forEach((pasta) => {
            const pastaAttr = pasta.replace(/'/g, "\\'");
            const doPasta = todos.filter((n) => n.startsWith(pasta + '/'));
            const aberta = pastasAbertas.has(pasta);
            html += '<div class="arv-linha" onclick="alternarPasta(\'' + pastaAttr + '\')">' +
                '<span class="arv-icone">' + SVG_PASTA + '</span>' +
                '<span class="arv-nome">' + escapeHtml(pasta) + '</span>' +
                '<span style="color:var(--muted);font-size:13px;margin-right:2px">' + doPasta.length + '</span>' +
                '<button class="arv-btn-menu" onclick="event.stopPropagation(); apagarPasta(\'' + pastaAttr + '\')" aria-label="Apagar pasta">' + SVG_LIXEIRA + '</button>' +
                '</div>';
            if (aberta) {
                doPasta.forEach((nome) => { html += linhaBotHTML(nome, true); });
            }
        });
        todos.filter((n) => n.indexOf('/') === -1).forEach((nome) => { html += linhaBotHTML(nome, false); });
        lista.innerHTML = html;
    }

    function alternarPasta(pasta) {
        if (pastasAbertas.has(pasta)) pastasAbertas.delete(pasta);
        else pastasAbertas.add(pasta);
        renderizarListaBots();
    }

    function abrirBot(nome) {
        abrirFicheiro(nome);
        fecharSidebar();
    }

    // ==========================================================
    // Modal
    // ==========================================================
    function abrirModal(titulo, corpo, botoesHTML, html) {
        document.getElementById('modal-cabecalho').textContent = titulo;
        const corpoEl = document.getElementById('modal-corpo');
        if (html) {
            corpoEl.innerHTML = corpo;
        } else {
            corpoEl.textContent = corpo;
        }
        document.getElementById('modal-rodape').innerHTML = botoesHTML;
        document.getElementById('modal-overlay').classList.add('show');
    }
    function fecharModal() {
        document.getElementById('modal-overlay').classList.remove('show');
    }
    function modalAviso(titulo, corpo) {
        abrirModal(titulo, corpo,
            '<button class="primario" onclick="fecharModal()"><span class="modal-icone">' + SVG_CHECK + '</span>OK</button>');
    }

    // Folha (bottom sheet) — usada para telas de conteúdo/formulário
    // (Novo bot, Novo ficheiro, Renomear, Partilhar, Customizar, Modelos,
    // Sobre). Os popups pequenos (#modal-overlay) ficam só para alertas,
    // erros e confirmações destrutivas.
    function abrirFolha(titulo, corpoHTML, botoesHTML, cheia) {
        document.getElementById('folha-titulo').textContent = titulo;
        document.getElementById('folha-corpo').innerHTML = corpoHTML;
        document.getElementById('folha-rodape').innerHTML = botoesHTML || '';
        document.getElementById('folha-overlay').classList.add('show');
        document.getElementById('folha-overlay').classList.toggle('folha-cheia', !!cheia);
        document.getElementById('folha-corpo').scrollTop = 0;
    }
    function fecharFolha() {
        document.getElementById('folha-overlay').classList.remove('show');
    }

    // ==========================================================
    // Novo bot (modal) — com seletor de pasta quando há pastas criadas
    // ==========================================================
    function mostrarNovoBot() {
        abrirFolha('Novo bot',
            '<input id="novo-bot-input" placeholder="NomeDoBot" style="width:100%;box-sizing:border-box;padding:12px 14px;font-family:inherit;font-size:17px;font-weight:bold;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text)">' +
            '<div style="font-size:13px;color:var(--muted);font-weight:normal;margin-top:8px">Cria um projeto com esse nome, com o ficheiro .sql lá dentro.</div>',
            '<button class="primario" onclick="confirmarNovoBot()">' +
            '<span class="modal-icone">' + SVG_CHECK + '</span>Criar</button>' +
            '<button onclick="fecharFolha()">Cancelar</button>');
        const input = document.getElementById('novo-bot-input');
        if (input) { input.focus(); input.select(); }
    }

    function confirmarNovoBot() {
        const input = document.getElementById('novo-bot-input');
        const nomeBase = (input.value || '').trim().replace(/\.sql$/i, '');
        if (!nomeBase) return;
        if (contarBots() >= LIMITE_FREE_BOTS && !premiumAtivoLocal()) {
            fecharFolha();
            setTimeout(() => modalLimite('Limite de bots atingido',
                linhaModal('O plano gratuito permite ' + LIMITE_FREE_BOTS + ' bots e já tens ' + contarBots() + '.') +
                linhaModal('<br>Com o Premium crias quantos precisares.')), 200);
            return;
        }
        const nomeFinal = nomeBase + '/' + nomeBase + '.sql';
        if (ficheiros[nomeFinal]) {
            fecharFolha();
            setTimeout(() => modalAviso('Erro', 'Já existe um projeto com esse nome.'), 200);
            return;
        }
        ficheiros[nomeFinal] = 'CREATE BOT "' + nomeBase + '"\nPLATFORM WHATSAPP\n\nCREATE TABLE Context() PREVENT DEFAULT\n\nON MESSAGE {\n    INSERT INTO Context()\n\n    WHEN CONTAINS "oi" OR CONTAINS "ola" {\n        REPLY "Ola! Como posso ajudar?"\n    }\n\n    OTHERWISE {\n        REPLY "Nao percebi, escreve ajuda."\n    }\n}\n\nRUN BOT\n';
        salvarFicheirosNoDisco();
        fecharFolha();
        pastasAbertas.add(nomeBase);
        abrirFicheiro(nomeFinal);
        fecharSidebar();
        setTimeout(avisarUsoAposCriarBot, 350);
    }

    // ==========================================================
    // Novo ficheiro auxiliar (.txt) dentro de um projeto existente
    // ==========================================================
    function mostrarNovoFicheiro() {
        const pastas = listarPastas();
        if (pastas.length === 0) {
            modalAviso('Novo ficheiro', 'Cria um bot primeiro — cada ficheiro auxiliar (.txt) fica dentro do projeto de um bot.');
            return;
        }
        const opcoes = pastas.map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
        abrirFolha('Novo ficheiro',
            '<input id="novo-ficheiro-input" placeholder="nome.txt" style="width:100%;box-sizing:border-box;padding:12px 14px;font-family:inherit;font-size:17px;font-weight:bold;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text)">' +
            '<select id="novo-ficheiro-pasta" style="width:100%;box-sizing:border-box;margin-top:8px;padding:10px 12px;font-family:inherit;font-size:15px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text)">' + opcoes + '</select>',
            '<button class="primario" onclick="confirmarNovoFicheiro()">' +
            '<span class="modal-icone">' + SVG_CHECK + '</span>Criar</button>' +
            '<button onclick="fecharFolha()">Cancelar</button>');
        const input = document.getElementById('novo-ficheiro-input');
        if (input) input.focus();
    }

    function confirmarNovoFicheiro() {
        const input = document.getElementById('novo-ficheiro-input');
        let nome = (input.value || '').trim();
        if (!nome) return;
        if (!nome.endsWith('.txt')) nome += '.txt';
        const pasta = document.getElementById('novo-ficheiro-pasta').value;
        const nomeFinal = pasta + '/' + nome;
        if (ficheiros[nomeFinal]) {
            fecharFolha();
            setTimeout(() => modalAviso('Erro', 'Já existe um ficheiro com esse nome nesse projeto.'), 200);
            return;
        }
        ficheiros[nomeFinal] = '';
        salvarFicheirosNoDisco();
        fecharFolha();
        pastasAbertas.add(pasta);
        abrirFicheiro(nomeFinal);
        fecharSidebar();
    }

    function apagarPasta(pasta) {
        const doPasta = Object.keys(ficheiros).filter((n) => n.startsWith(pasta + '/'));
        if (doPasta.length > 0) {
            modalAviso('Pasta não vazia', 'Move ou apaga os bots de dentro de "' + pasta + '" antes de a apagar.');
            return;
        }
        guardarPastasCriadas(lerPastasCriadas().filter((p) => p !== pasta));
        pastasAbertas.delete(pasta);
        renderizarListaBots();
    }

    // ==========================================================
    // Renomear bot (mantém a pasta atual; só o nome do ficheiro muda)
    // ==========================================================
    function renomearBot(nome) {
        const temPasta = nome.includes('/');
        const base = temPasta ? nome.slice(nome.lastIndexOf('/') + 1) : nome;
        const pasta = temPasta ? nome.slice(0, nome.lastIndexOf('/')) : '';
        abrirFolha('Renomear bot',
            '<input id="renomear-bot-input" value="' + escapeHtml(base) + '" style="width:100%;box-sizing:border-box;padding:12px 14px;font-family:inherit;font-size:17px;font-weight:bold;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text)">',
            '<button class="primario" onclick="confirmarRenomearBot(\'' + nome.replace(/'/g, "\\'") + '\')">' +
            '<span class="modal-icone">' + SVG_CHECK + '</span>Renomear</button>' +
            '<button onclick="fecharFolha()">Cancelar</button>');
        const input = document.getElementById('renomear-bot-input');
        if (input) {
            input.dataset.pasta = pasta;
            input.focus();
            input.select();
        }
    }

    function confirmarRenomearBot(nomeAntigo) {
        const input = document.getElementById('renomear-bot-input');
        let novoBase = (input.value || '').trim();
        if (!novoBase) return;
        const extAntiga = nomeAntigo.includes('.') ? nomeAntigo.slice(nomeAntigo.lastIndexOf('.')) : '.sql';
        if (!novoBase.endsWith(extAntiga)) novoBase += extAntiga;
        const pasta = input.dataset.pasta || '';
        const novoNome = pasta ? pasta + '/' + novoBase : novoBase;
        if (novoNome === nomeAntigo) { fecharFolha(); return; }
        if (ficheiros[novoNome]) {
            fecharFolha();
            setTimeout(() => modalAviso('Erro', 'Já existe um bot com esse nome.'), 200);
            return;
        }
        ficheiros[novoNome] = ficheiros[nomeAntigo];
        delete ficheiros[nomeAntigo];
        const mapa = lerIdsPublicados();
        if (mapa[nomeAntigo]) {
            mapa[novoNome] = mapa[nomeAntigo];
            delete mapa[nomeAntigo];
        }
        if (ficheiroAtual === nomeAntigo) ficheiroAtual = novoNome;
        salvarFicheirosNoDisco();
        fecharFolha();
        renderizarListaBots();
        atualizarTitulo();
    }

    // ==========================================================
    // Apagar bot (modal)
    // ==========================================================
    function apagarBot(nome) {
        abrirModal('Apagar bot',
            'Apagar "' + nome + '"? Isto não pode ser desfeito.',
            '<button class="destrutivo" onclick="confirmarApagarBot(\'' + nome.replace(/'/g, "\\'") + '\')">' +
            '<span class="modal-icone">' + SVG_LIXEIRA + '</span>Apagar</button>' +
            '<button onclick="fecharModal()">Cancelar</button>');
    }

    function confirmarApagarBot(nome) {
        delete ficheiros[nome];
        if (ficheiroAtual === nome) {
            const restantes = Object.keys(ficheiros);
            ficheiroAtual = restantes[0] || null;
            editorArea.value = ficheiroAtual ? (ficheiros[ficheiroAtual] || '') : '';
            atualizarHighlight();
            atualizarTitulo();
        }
        salvarFicheirosNoDisco();
        fecharModal();
        renderizarListaBots();
    }

    // ==========================================================
    // Carregar / Exportar
    // ==========================================================
    function carregarFicheiro() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.sql,.txt,text/plain';
        input.onchange = () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                let nome = file.name;
                if (!nome.endsWith('.sql') && !nome.endsWith('.txt')) nome += '.sql';
                ficheiros[nome] = String(reader.result);
                salvarFicheirosNoDisco();
                abrirFicheiro(nome);
                fecharSidebar();
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function exportarFicheiroAtual() {
        if (!ficheiroAtual) return;
        const conteudo = editorArea.value;
        const blob = new Blob([conteudo], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ficheiroAtual.includes('/') ? ficheiroAtual.slice(ficheiroAtual.lastIndexOf('/') + 1) : ficheiroAtual;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ==========================================================
    // Barra de atalhos
    // ==========================================================
    const ATALHOS = ['Tab', '{', '}', '(', ')', '"', ';', ',', '_'];
    const atalhosScrollEl = document.getElementById('atalhos-scroll');
    atalhosScrollEl.innerHTML = ATALHOS.map((s) =>
        '<button type="button" class="btn-atalho" data-atalho="' + s + '">' + s + '</button>'
    ).join('');
    atalhosScrollEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-atalho');
        if (!btn) return;
        inserirNoCursor(btn.dataset.atalho === 'Tab' ? '  ' : btn.dataset.atalho);
    });

    function inserirNoCursor(texto) {
        const start = editorArea.selectionStart;
        const end = editorArea.selectionEnd;
        const valor = editorArea.value;
        editorArea.value = valor.slice(0, start) + texto + valor.slice(end);
        editorArea.selectionStart = editorArea.selectionEnd = start + texto.length;
        editorArea.focus();
        atualizarHighlight();
        agendarGuardar();
    }

    // ==========================================================
    // Menu
    // ==========================================================
    function abrirMenu() { document.getElementById('menu-overlay').classList.add('show'); }
    function fecharMenu() { document.getElementById('menu-overlay').classList.remove('show'); }

    function abrirDocumentacao() { location.href = 'Doc.html'; }



    // ---- Limites do plano gratuito
    const LIMITE_FREE_BOTS = 2;
    const LIMITE_FREE_PUBLICADOS = 1;
    const LIMITE_FREE_PUBLICACOES_24H = 2;
    const JANELA_24H_MS = 24 * 60 * 60 * 1000;

    function contarBots() {
        return Object.keys(ficheiros).filter((n) => /\.sql$/i.test(n)).length;
    }
    function contarPublicados() {
        if (estadoConta) return estadoConta.uso.publicados;
        return Object.keys(idsPublicadosMem).filter((n) => ficheiros[n] !== undefined).length;
    }
    function restamPublicacoesServidor() {
        return estadoConta ? Math.max(0, LIMITE_FREE_PUBLICACOES_24H - estadoConta.uso.publicacoes24h) : LIMITE_FREE_PUBLICACOES_24H;
    }
    function esperaServidorMs() {
        return estadoConta ? estadoConta.uso.reiniciaEmMs : 0;
    }
    function textoEspera(ms) {
        const min = Math.max(1, Math.ceil(ms / 60000));
        if (min < 60) return min + ' min';
        return Math.ceil(min / 60) + ' h';
    }

    // ==========================================================
    // Premium — mesmo backend do HTMLxEditor (/api/premium/*).
    // Pagamento fora do app; o cliente envia o comprovativo (referência
    // opcional) e o estado sincroniza sozinho enquanto houver pedido
    // pendente. Validade: 30 dias, controlada pelo servidor.
    // ==========================================================
    const INTERVALO_POLLING_MS = 15000;
    const METODOS_PAGAMENTO = [
        { id: 'paypay', rotulo: 'PayPay', preco: '2000 Kz / mês', valorPreco: '2000 Kz', titulo: 'Transferência bancária',
          texto: 'Transfira para o IBAN abaixo por qualquer meio: ATM, Multicaixa Express, app PayPay ou outro banco. Depois anexe o comprovativo.',
          campo: 'IBAN', valor: 'A006 0420 0000 0000 0303 5677 8', link: null },
        { id: 'airtm', rotulo: 'AirTM', preco: '5 USD / mês', valorPreco: '5 USD', titulo: 'AirTM',
          texto: 'Pague pelo perfil AirTM abaixo e depois anexe o comprovativo.',
          campo: 'Link AirTM', valor: 'https://airtm.me/adilsonrafael', link: 'https://airtm.me/adilsonrafael' },
        { id: 'paypal', rotulo: 'PayPal', preco: '5 USD / mês', valorPreco: '5 USD', titulo: 'PayPal',
          texto: 'Envie o pagamento para o e-mail PayPal abaixo e depois anexe o comprovativo.',
          campo: 'E-mail PayPal', valor: 'adilsoncambinda8@gmail.com', link: null }
    ];
    let metodoSelecionado = 'paypay';
    let etapaPremium = 'beneficios'; // 'beneficios' -> 'pagamento'
    let fotoComprovativo = null;
    let pollingId = null;
    let toastId = null;
    let folhaPremiumAberta = false;

    function lerPremiumLocal() { return premiumMem; }
    function premiumAtivoLocal() {
        return !!(premiumMem && premiumMem.expiraEm && new Date(premiumMem.expiraEm).getTime() > Date.now());
    }
    function temPedidoPendente() { return pedidoPendenteMem; }
    function definirPedidoPendente(valor) { pedidoPendenteMem = !!valor; }
    function formatarData(iso) {
        try { return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' }); }
        catch (e) { return ''; }
    }

    // Aviso leve no fundo do ecrã, em vez de popups.
    function mostrarToast(texto) {
        let el = document.getElementById('toast-global');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast-global';
            document.body.appendChild(el);
        }
        el.textContent = texto;
        el.classList.add('show');
        clearTimeout(toastId);
        toastId = setTimeout(() => el.classList.remove('show'), 3200);
    }

    // Consulta o servidor. Se houver aprovação, grava e devolve estado.
    async function sincronizarPremium() {
        try {
            const resp = await fetch(URL_API_BOTQL + '/api/botql/conta/estado?deviceId=' +
                encodeURIComponent(obterDeviceId()) + '&codigo=' + encodeURIComponent(obterCodigo()));
            const dados = await resp.json();
            if (!resp.ok || !dados.sucesso) throw new Error(dados.erro || 'falha');
            aplicarEstado(dados.estado);
            servidorOnline = true;
            const p = dados.estado.premium;
            return { aprovado: !!p.ativo, pendente: !!p.pendente };
        } catch (e) {
            return { aprovado: premiumAtivoLocal(), pendente: temPedidoPendente(), offline: true };
        }
    }

    // Polling automático: corre enquanto houver pedido pendente e para
    // sozinho quando for aprovado. Sem cliques do utilizador.
    function iniciarPollingPremium() {
        if (pollingId) return;
        pollingId = setInterval(async () => {
            if (premiumAtivoLocal() && !temPedidoPendente()) { pararPollingPremium(); return; }
            const antes = premiumAtivoLocal();
            const estado = await sincronizarPremium();
            if (estado.aprovado && premiumAtivoLocal() && !antes) {
                pararPollingPremium();
                aoAtivarPremium();
            } else if (!estado.pendente && !estado.aprovado && !estado.offline) {
                pararPollingPremium();
                if (folhaPremiumAberta) renderizarFolhaPremium();
                mostrarToast('O teu pedido não foi aprovado.');
            }
        }, INTERVALO_POLLING_MS);
    }
    function pararPollingPremium() {
        if (pollingId) { clearInterval(pollingId); pollingId = null; }
    }
    function aoAtivarPremium() {
        mostrarToast('Premium ativado. Sem limites por 30 dias.');
        if (folhaPremiumAberta) renderizarFolhaPremium();
    }

    // Ao abrir a página: se há pedido pendente, retoma o polling; se o
    // premium local expirou, tenta renovar pelo servidor.
    async function arrancarPremium() {
        const estado = await sincronizarPremium();
        if (estado.pendente) iniciarPollingPremium();
    }

    // Verifica se o utilizador tem Premium ativo (local ou servidor).
    async function verificarPremiumAtivo() {
        if (premiumAtivoLocal()) return true;
        const estado = await sincronizarPremium();
        if (estado.pendente) iniciarPollingPremium();
        return !!(estado.aprovado && premiumAtivoLocal());
    }

    // ---- Ecrã Premium (uma única folha, 3 estados)
    function abrirEcraPremium() {
        fecharMenu();
        fotoComprovativo = null;
        nomeFotoComprovativo = '';
        miniaturaComprovativo = '';
        folhaPremiumAberta = true;
        etapaPremium = 'beneficios';
        renderizarFolhaPremium();
    }
    function fecharFolhaPremium() {
        folhaPremiumAberta = false;
        fecharFolha();
    }

    function metodoAtual() {
        return METODOS_PAGAMENTO.find((m) => m.id === metodoSelecionado) || METODOS_PAGAMENTO[0];
    }

    function renderizarFolhaPremium() {
        const btnFechar = '<button onclick="fecharFolhaPremium()">Fechar</button>';

        if (premiumAtivoLocal()) {
            const p = lerPremiumLocal();
            abrirFolha('Premium',
                '<div class="prem-titulo">Premium ativo</div>' +
                '<div class="prem-texto">Válido até ' + formatarData(p.expiraEm) + '. Sem limites de bots nem de publicações.</div>',
                btnFechar);
            return;
        }

        if (temPedidoPendente()) {
            abrirFolha('Premium',
                '<div class="prem-titulo">A verificar o pagamento</div>' +
                '<div class="prem-texto">O Premium ativa-se sozinho assim que for aprovado. Pode continuar a usar o editor.</div>',
                btnFechar);
            iniciarPollingPremium();
            return;
        }

        if (etapaPremium === 'beneficios') {
            renderizarBeneficiosPremium(btnFechar);
            return;
        }

        const m = metodoAtual();
        const botoes = METODOS_PAGAMENTO.map((x) =>
            '<button class="prem-metodo' + (x.id === metodoSelecionado ? ' ativo' : '') + '" onclick="escolherMetodoPremium(\'' + x.id + '\')">' + x.rotulo + '</button>').join('');

        abrirFolha('Premium',
            '<div class="prem-titulo">BotQL Premium</div>' +
            '<div class="prem-texto">Bots e publicações sem limite. Assinatura mensal (30 dias).</div>' +
            '<div class="prem-secao">Método de pagamento</div>' +
            '<div class="prem-metodos">' + botoes + '</div>' +
            '<div class="prem-preco">' + m.preco + '</div>' +
            '<button class="prem-link" onclick="verDadosPagamento()">Ver dados para pagamento</button>' +
            '<input id="premium-foto" type="file" accept="image/*" onchange="escolherComprovativo(this)" style="display:none">' +
            '<div class="prem-secao">Comprovativo</div>' +
            '<button class="prem-upload" id="btn-foto-premium" onclick="document.getElementById(\'premium-foto\').click()">' +
            '<span class="prem-upload-icone"><svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
            '<span class="prem-upload-texto" id="prem-upload-texto">Anexar foto do comprovativo</span>' +
            '<span class="prem-upload-sub" id="prem-upload-sub">Toque para escolher uma imagem</span>' +
            '</button>' +
            '<button class="prem-link" onclick="abrirEcraConta()">Já pagaste noutro navegador? Recuperar conta</button>' +
            '<div id="premium-estado" class="prem-erro" style="display:none"></div>',
            '<button class="primario" id="btn-enviar-premium" onclick="enviarPedidoPremium()">Enviar comprovativo</button>' +
            '<button onclick="voltarParaBeneficios()">Voltar</button>');
    }

    // Etapa 1: o que o Premium dá, antes de pedir pagamento.
    function linhaBeneficio(texto, incluido) {
        const cor = incluido ? '#2E7D32' : 'var(--muted)';
        const icone = incluido
            ? SVG_CHECK
            : '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
        return '<div class="ben-linha"><span class="ben-icone" style="color:' + cor + '">' + icone + '</span>' +
            '<span class="ben-texto">' + texto + '</span></div>';
    }

    function renderizarBeneficiosPremium(btnFechar) {
        abrirFolha('Premium',
            '<div class="prem-titulo">Cria sem limites</div>' +
            '<div class="prem-texto">Tira todas as restrições do plano gratuito e publica os teus bots sem contar.</div>' +
            '<div class="ben-cartao">' +
            '<div class="ben-precos">' +
            '<div class="ben-metade"><span class="ben-valor">2000 Kz</span><span class="ben-periodo">por mês</span></div>' +
            '<div class="ben-divisor"></div>' +
            '<div class="ben-metade"><span class="ben-valor">5 USD</span><span class="ben-periodo">por mês</span></div>' +
            '</div>' +
            '<div class="ben-sub">Assinatura mensal (30 dias). Sem renovação automática.</div>' +
            '</div>' +
            '<div class="prem-secao">O que ganhas</div>' +
            '<div class="ben-lista">' +
            linhaBeneficio('<b>Bots ilimitados</b><span class="ben-de">Gratuito: ' + LIMITE_FREE_BOTS + ' bots</span>', true) +
            linhaBeneficio('<b>Bots publicados ilimitados</b><span class="ben-de">Gratuito: ' + LIMITE_FREE_PUBLICADOS + ' publicado</span>', true) +
            linhaBeneficio('<b>Atualizações sem limite</b><span class="ben-de">Gratuito: ' + LIMITE_FREE_PUBLICACOES_24H + ' por dia</span>', true) +
            linhaBeneficio('<b>Sem a marca BotQL nos teus chats</b><span class="ben-de">Gratuito: aparece "Criado com BotQL"</span>', true) +
            linhaBeneficio('<b>Bots guardados na tua conta</b><span class="ben-de">Recupera-os em qualquer navegador</span>', true) +
            '</div>' +
            '<div class="ben-nota">Sem o Premium, o teu bot continua a funcionar. Só ficas com os limites acima.</div>',
            '<button class="primario" onclick="avancarParaPagamento()">Obter Premium</button>' +
            '<button onclick="fecharFolhaPremium()">Agora não</button>');
    }

    function avancarParaPagamento() {
        etapaPremium = 'pagamento';
        renderizarFolhaPremium();
    }
    function voltarParaBeneficios() {
        etapaPremium = 'beneficios';
        renderizarFolhaPremium();
    }

    function escolherMetodoPremium(id) {
        metodoSelecionado = id;
        renderizarFolhaPremium();
        if (fotoComprovativo) marcarFotoAnexada();
    }

    // Dados de pagamento no modal pequeno já existente (sem nova folha).
    function verDadosPagamento() {
        const m = metodoAtual();
        if (!m.valor) {
            abrirModal(m.titulo, 'Dados de pagamento ainda não configurados para este método.',
                '<button class="primario" onclick="fecharModal()">OK</button>');
            return;
        }
        const abrir = m.link ? '<button onclick="window.open(\'' + m.link + '\', \'_blank\')">Abrir ' + m.rotulo + '</button>' : '';
        abrirModal(m.titulo,
            '<div style="font-weight:normal;font-size:14px;margin-bottom:12px">' + m.texto + '</div>' +
            '<div style="font-size:12px;color:var(--muted);font-weight:normal">' + m.campo + '</div>' +
            '<input readonly value="' + escapeHtml(m.valor) + '" onclick="this.select()" class="prem-input" style="font-family:ui-monospace,monospace;font-size:13px">',
            '<button class="primario" onclick="copiarDadoPagamento()">Copiar</button>' + abrir +
            '<button onclick="fecharModal()">Fechar</button>', true);
    }
    function copiarDadoPagamento() {
        const m = metodoAtual();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(m.valor).catch(() => {});
        }
        fecharModal();
        mostrarToast('Copiado.');
    }
    let nomeFotoComprovativo = '';
    let miniaturaComprovativo = '';
    function marcarFotoAnexada() {
        const b = document.getElementById('btn-foto-premium');
        if (!b) return;
        b.classList.add('anexado');
        const t = document.getElementById('prem-upload-texto');
        const sub = document.getElementById('prem-upload-sub');
        if (t) t.textContent = nomeFotoComprovativo || 'Comprovativo anexado';
        if (sub) sub.textContent = 'Toque para trocar a imagem';
        if (miniaturaComprovativo) {
            const ic = b.querySelector('.prem-upload-icone');
            if (ic) ic.innerHTML = '<img src="' + miniaturaComprovativo + '" alt="">';
        }
    }

    // Comprime a imagem via canvas (lado maior 1280px, JPEG 0.7) e
    // guarda só o base64 puro, como o servidor espera.
    // Bloqueia a folha (impede toques) e mostra spinner enquanto algo
    // demorado corre — ex: comprimir a foto do comprovativo.
    function mostrarCarregandoFolha(texto) {
        esconderCarregandoFolha();
        const caixa = document.getElementById('folha-caixa');
        if (!caixa) return;
        const d = document.createElement('div');
        d.id = 'folha-carregando';
        d.innerHTML = '<div class="spinner"></div><span>' + escapeHtml(texto || 'A carregar...') + '</span>';
        caixa.appendChild(d);
    }
    function esconderCarregandoFolha() {
        const d = document.getElementById('folha-carregando');
        if (d) d.remove();
    }

    function escolherComprovativo(input) {
        const f = input.files && input.files[0];
        fotoComprovativo = null;
        nomeFotoComprovativo = '';
        miniaturaComprovativo = '';
        if (!f) return;
        nomeFotoComprovativo = f.name;
        mostrarCarregandoFolha('A processar imagem...');
        const leitor = new FileReader();
        leitor.onerror = () => {
            esconderCarregandoFolha();
            mostrarErroPremium('Não foi possível ler o ficheiro. Tenta outra imagem.');
        };
        leitor.onload = () => {
            const img = new Image();
            img.onload = () => {
                try {
                    const max = 1280;
                    const escala = Math.min(1, max / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * escala));
                    canvas.height = Math.max(1, Math.round(img.height * escala));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    fotoComprovativo = dataUrl.split(',')[1];
                    miniaturaComprovativo = dataUrl;
                    mostrarErroPremium('');
                    marcarFotoAnexada();
                } catch (e) {
                    mostrarErroPremium('Não foi possível processar essa imagem. Tenta outra.');
                } finally {
                    esconderCarregandoFolha();
                }
            };
            img.onerror = () => {
                esconderCarregandoFolha();
                mostrarErroPremium('Não foi possível ler essa imagem (formato não suportado). Tenta outra.');
            };
            img.src = leitor.result;
        };
        leitor.readAsDataURL(f);
    }

    async function enviarPedidoPremium() {
        if (!fotoComprovativo) { mostrarErroPremium('Anexa o comprovativo do pagamento.'); return; }

        const metodo = metodoSelecionado;
        const btn = document.getElementById('btn-enviar-premium');
        if (btn) btn.disabled = true;
        mostrarErroPremium('');
        mostrarCarregandoFolha('A enviar...');
        try {
            const resp = await fetch(URL_API_BOTQL + '/api/premium/solicitar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: obterDeviceId(),
                    referencia: 'comprovativo anexado',
                    metodoPagamento: metodo,
                    foto: fotoComprovativo,
                    fotoTipo: 'image/jpeg'
                })
            });
            const dados = await resp.json();
            if (!resp.ok || !dados.sucesso) throw new Error(dados.erro || 'O servidor recusou o pedido.');
            definirPedidoPendente(true);
            iniciarPollingPremium();
            renderizarFolhaPremium();
            mostrarToast('Pedido enviado.');
        } catch (e) {
            mostrarErroPremium((e && e.message) || 'Não foi possível enviar. Verifica a ligação e tenta de novo.');
            if (btn) btn.disabled = false;
        } finally {
            esconderCarregandoFolha();
        }
    }

    // ---- Regras de publicação para o plano gratuito.
    // Mostra tudo na folha Premium (sem popups extra) quando bloqueia.
    // Modal pequeno de limite. O botão principal abre o ecrã Premium;
    // é assim que se chega ao Premium (não há item no menu).
    function irParaPremium() {
        fecharModal();
        fecharFolha();
        setTimeout(abrirEcraPremium, 180);
    }

    function modalLimite(titulo, corpoHTML, textoBotao) {
        abrirModal(titulo, corpoHTML,
            '<button class="primario" onclick="irParaPremium()">' + (textoBotao || 'Ver Premium') + '</button>' +
            '<button onclick="fecharModal()">Agora não</button>', true);
    }
    function linhaModal(texto) {
        return '<div style="font-weight:normal;font-size:15px;line-height:1.45">' + texto + '</div>';
    }
    function pluralizar(n, singular, plural) {
        return n + ' ' + (n === 1 ? singular : plural);
    }

    // Aviso informativo (não bloqueia): mostrado quando o utilizador
    // acabou de usar uma ação e já quase não resta nenhuma.
    function avisoRestam(titulo, corpoHTML) {
        abrirModal(titulo, corpoHTML,
            '<button class="primario" onclick="irParaPremium()">Ver Premium</button>' +
            '<button onclick="fecharModal()">Continuar</button>', true);
    }

    function restamPublicacoes24h() { return restamPublicacoesServidor(); }
    function esperaAteReiniciar() { return esperaServidorMs(); }

    async function podePublicar(nomeArquivo) {
        if (!servidorOnline) {
            mostrarToast('A ligar ao servidor...');
            await iniciarConta();
        }
        if (!servidorOnline) {
            mostrarToast('Sem ligação ao servidor: ' + erroServidor);
            return false;
        }
        try {
            const r = await chamarConta('/api/botql/conta/pode-publicar',
                Object.assign(credenciais(), { nomeArquivo: nomeArquivo }));
            if (!r.ok) throw new Error(r.dados.erro || 'falha');
            aplicarEstado(r.dados.estado);
            if (r.dados.pode) return true;

            if (r.dados.motivo === 'pendente') { abrirEcraPremium(); return false; }
            if (r.dados.motivo === 'limite_publicados') {
                modalLimite('Limite de bots publicados',
                    linhaModal('O plano gratuito permite ' + pluralizar(LIMITE_FREE_PUBLICADOS, 'bot publicado', 'bots publicados') + '. Já usaste ' + contarPublicados() + ' de ' + LIMITE_FREE_PUBLICADOS + '.') +
                    linhaModal('<br>Com o Premium publicas quantos bots quiseres.'));
                return false;
            }
            modalLimite('Limite de publicações atingido',
                linhaModal('Usaste as ' + LIMITE_FREE_PUBLICACOES_24H + ' publicações permitidas nas últimas 24 horas.') +
                linhaModal('<br>O teu limite volta daqui a <b>' + textoEspera(esperaAteReiniciar()) + '</b>.') +
                linhaModal('<br>Com o Premium atualizas sem limite.'));
            return false;
        } catch (e) {
            mostrarToast('Não foi possível verificar o plano. Tenta de novo.');
            return false;
        }
    }

    // Chamado depois de uma publicação bem-sucedida: se o utilizador
    // free ficou com 0 ou 1 restantes, avisa quantas restam e quando volta.
    function avisarUsoAposPublicar() {
        if (premiumAtivoLocal()) return;
        const restam = restamPublicacoes24h();
        if (restam > 1) return;
        const espera = esperaAteReiniciar();
        if (restam === 1) {
            avisoRestam('Resta 1 publicação',
                linhaModal('Ainda podes publicar ou atualizar <b>1 vez</b> nas próximas 24 horas.') +
                linhaModal('<br>O limite reinicia daqui a <b>' + textoEspera(espera) + '</b>.'));
        } else {
            avisoRestam('Publicações esgotadas',
                linhaModal('Usaste as ' + LIMITE_FREE_PUBLICACOES_24H + ' publicações de hoje.') +
                linhaModal('<br>O teu limite volta daqui a <b>' + textoEspera(espera) + '</b>.'));
        }
    }

    // Igual, para a criação de bots: avisa quando só resta 1 (ou 0).
    function avisarUsoAposCriarBot() {
        if (premiumAtivoLocal()) return;
        const restam = Math.max(0, LIMITE_FREE_BOTS - contarBots());
        if (restam > 1) return;
        if (restam === 1) {
            avisoRestam('Podes criar mais 1 bot',
                linhaModal('O plano gratuito permite ' + LIMITE_FREE_BOTS + ' bots. Já tens ' + contarBots() + '.'));
        } else {
            avisoRestam('Limite de bots atingido',
                linhaModal('Chegaste aos ' + LIMITE_FREE_BOTS + ' bots do plano gratuito.') +
                linhaModal('<br>Para criar mais, ativa o Premium.'));
        }
    }


    // ==========================================================
    // Conta: ver código de recuperação e recuperar noutro navegador.
    // Chega-se aqui pelo aviso de "conta nova" e pelo modal de limite;
    // não há item no menu.
    // ==========================================================
    function abrirEcraConta() {
        fecharMenu();
        const cod = obterCodigo();
        abrirFolha('A tua conta',
            '<div class="prem-titulo">Código de recuperação</div>' +
            '<div class="prem-texto">Guarda este código. Com ele recuperas os teus bots e o Premium noutro navegador ou telemóvel.</div>' +
            '<input readonly value="' + escapeHtml(cod) + '" onclick="this.select()" class="prem-input" style="text-align:center;font-family:ui-monospace,monospace;font-size:20px;letter-spacing:2px">' +
            '<button class="prem-link" onclick="copiarCodigoConta()">Copiar código</button>' +
            '<div class="prem-secao">Já tens um código?</div>' +
            '<input id="conta-codigo-recuperar" class="prem-input" type="text" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters">' +
            '<div id="conta-erro" class="prem-erro" style="display:none"></div>',
            '<button class="primario" onclick="confirmarRecuperarConta()">Recuperar conta</button>' +
            '<button onclick="fecharFolha()">Fechar</button>');
    }
    function copiarCodigoConta() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(obterCodigo()).catch(() => {});
        }
        mostrarToast('Código copiado.');
    }
    async function confirmarRecuperarConta() {
        const campo = document.getElementById('conta-codigo-recuperar');
        const erro = document.getElementById('conta-erro');
        const cod = (campo.value || '').trim();
        if (!cod) return;
        erro.style.display = 'none';
        try {
            await recuperarConta(cod);
            fecharFolha();
            mostrarToast('Conta recuperada.');
        } catch (e) {
            erro.textContent = e.message || 'Não foi possível recuperar.';
            erro.style.display = 'block';
        }
    }
    // Primeira visita: mostra o código uma vez, num modal pequeno.
    function avisarContaNova() {
        abrirModal('Guarda o teu código',
            '<div style="font-weight:normal;font-size:15px;line-height:1.45">Este código recupera os teus bots e o Premium se mudares de navegador.</div>' +
            '<input readonly value="' + escapeHtml(obterCodigo()) + '" onclick="this.select()" class="prem-input" style="text-align:center;font-family:ui-monospace,monospace;font-size:18px;letter-spacing:2px">',
            '<button class="primario" onclick="copiarCodigoConta();fecharModal()">Copiar e continuar</button>' +
            '<button onclick="fecharModal()">Depois</button>', true);
    }


    // ==========================================================
    // Meus bots + Atividade. Os números só são pedidos ao servidor
    // quando o dono toca em "Ver atividade" (nada corre em segundo plano).
    // ==========================================================
    function formatarDataHora(iso) {
        if (!iso) return '-';
        try {
            return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch (e) { return '-'; }
    }
    function formatarNumero(n) {
        return Number(n || 0).toLocaleString('pt-PT');
    }

    function abrirMeusBots() {
        fecharMenu();
        const bots = listarNomesBots();
        const publicados = lerIdsPublicados();
        if (!bots.length) {
            abrirFolha('Meus bots',
                '<div class="prem-texto">Ainda não tens bots. Cria um em "+ Novo bot".</div>', '');
            return;
        }
        const cartoes = bots.map((nome, i) => {
            const base = nome.includes('/') ? nome.slice(nome.lastIndexOf('/') + 1) : nome;
            const id = publicados[nome];
            const nomeAttr = nome.replace(/'/g, "\\'");
            return '<div class="part-cartao">' +
                '<div class="part-cabecalho">' +
                '<span class="part-icone">' + SVG_ROBO_BRANCO + '</span>' +
                '<span class="part-nome">' + escapeHtml(base) + '</span>' +
                '</div>' +
                (id
                    ? '<button class="part-btn destaque" style="width:100%;margin-top:14px" onclick="abrirAtividadeBot(\'' + nomeAttr + '\')">Ver atividade</button>'
                    : '<div class="part-link" style="margin-top:14px">Ainda não publicado. Publica para ver a atividade.</div>') +
                '</div>';
        }).join('');
        abrirFolha('Meus bots', cartoes, '');
    }

    async function abrirAtividadeBot(nomeArquivo) {
        const id = lerIdsPublicados()[nomeArquivo];
        if (!id) return;
        const base = nomeArquivo.includes('/') ? nomeArquivo.slice(nomeArquivo.lastIndexOf('/') + 1) : nomeArquivo;
        abrirFolha('Atividade',
            '<div class="prem-titulo">' + escapeHtml(base) + '</div>' +
            '<div class="prem-texto">A carregar...</div>',
            '<button onclick="abrirMeusBots()">Voltar</button>', true);
        try {
            const resp = await fetch(URL_API_BOTQL + '/api/botql/' + encodeURIComponent(id) + '/stats?deviceId=' +
                encodeURIComponent(obterDeviceId()) + '&codigo=' + encodeURIComponent(obterCodigo()));
            const dados = await resp.json();
            if (!resp.ok || !dados.sucesso) throw new Error(dados.erro || ('HTTP ' + resp.status));
            renderizarAtividade(base, dados);
        } catch (e) {
            abrirFolha('Atividade',
                '<div class="prem-titulo">' + escapeHtml(base) + '</div>' +
                '<div class="prem-texto">Não foi possível carregar a atividade: ' + escapeHtml(e.message || 'erro') + '</div>',
                '<button onclick="abrirMeusBots()">Voltar</button>', true);
        }
    }

    function renderizarAtividade(nomeBase, dados) {
        const st = dados.stats;
        const total = st.recebidas + st.enviadas;
        const dias = Object.keys(st.por_dia || {}).sort().slice(-7);
        const maximo = Math.max.apply(null, dias.map((d) => st.por_dia[d]).concat([1]));
        const barras = dias.map((d) => {
            const v = st.por_dia[d];
            const alt = Math.max(4, Math.round((v / maximo) * 64));
            return '<div class="atv-col"><div class="atv-barra" style="height:' + alt + 'px"></div>' +
                '<div class="atv-dia">' + d.slice(8, 10) + '/' + d.slice(5, 7) + '</div></div>';
        }).join('');
        const votos = st.likes + st.dislikes;
        const satisf = votos ? Math.round((st.likes / votos) * 100) + '%' : '-';

        abrirFolha('Atividade',
            '<div class="prem-titulo">' + escapeHtml(nomeBase) + '</div>' +
            '<div class="prem-texto">' + (dados.pausado ? 'Bot pausado. ' : '') + 'Atualizado em ' + formatarDataHora(dados.atualizado_em) + '</div>' +
            '<div class="atv-grelha">' +
            '<div class="atv-caixa"><div class="atv-num">' + formatarNumero(st.recebidas) + '</div><div class="atv-rot">Mensagens recebidas</div></div>' +
            '<div class="atv-caixa"><div class="atv-num">' + formatarNumero(st.enviadas) + '</div><div class="atv-rot">Respostas enviadas</div></div>' +
            '<div class="atv-caixa"><div class="atv-num">' + formatarNumero(st.visitantes) + '</div><div class="atv-rot">Visitas</div></div>' +
            '<div class="atv-caixa"><div class="atv-num">' + satisf + '</div><div class="atv-rot">' + formatarNumero(st.likes) + ' gostos, ' + formatarNumero(st.dislikes) + ' não gostos</div></div>' +
            '</div>' +
            (dias.length
                ? '<div class="prem-secao">Últimos dias</div><div class="atv-grafico">' + barras + '</div>'
                : '<div class="prem-texto" style="margin-top:18px">Ainda sem atividade. Partilha o link do bot para começar.</div>') +
            (st.ultima_atividade ? '<div class="ben-nota">Última atividade: ' + formatarDataHora(st.ultima_atividade) + '. Total de ' + formatarNumero(total) + ' mensagens.</div>' : ''),
            '<button onclick="abrirMeusBots()">Voltar</button>', true);
    }

    // ---- Partilhar Bot: agora fala de facto com a API (publicar/pausar),
    // gerando o mesmo link ?id= que a app cria — em vez do aviso antigo
    // "só disponível na app Android".
    function abrirPartilharBot() {
        fecharMenu();
        renderizarTelaPartilha();
    }

    // Tela única de partilha, igual à da app Android: cartão com o
    // bot e grelha de ações. Os botões inativos ficam esbatidos.

    // Um cartão por bot (todos os .sql criados), como na app Android.
    // Cada botão de pausa tem id próprio, derivado do índice do bot.
    function cartaoPartilhaHTML(nomeArquivo, indice) {
        const nomeBase = nomeArquivo.includes('/') ? nomeArquivo.slice(nomeArquivo.lastIndexOf('/') + 1) : nomeArquivo;
        const id = lerIdsPublicados()[nomeArquivo];
        const publicado = !!id;
        const nomeAttr = nomeArquivo.replace(/'/g, "\\'");
        const nomeBaseAttr = nomeBase.replace(/'/g, "\\'");
        const link = publicado ? URL_CHAT_PUBLICO + '?id=' + encodeURIComponent(id) : '';
        const linkAttr = link.replace(/'/g, "\\'");
        const dis = publicado ? '' : ' disabled';

        return '<div class="part-cartao">' +
            '<div class="part-cabecalho">' +
            '<span class="part-icone">' + SVG_ROBO_BRANCO + '</span>' +
            '<span class="part-nome">' + escapeHtml(nomeBase) + '</span>' +
            '</div>' +
            '<div class="part-grelha">' +
            '<button class="part-btn' + (publicado ? '' : ' destaque') + '"' + (publicado ? ' disabled' : '') + ' onclick="publicarOuAtualizar(\'' + nomeAttr + '\')">Publicar bot</button>' +
            '<button class="part-btn' + (publicado ? ' destaque' : '') + '"' + dis + ' onclick="publicarOuAtualizar(\'' + nomeAttr + '\')">Atualizar bot</button>' +
            '<button class="part-btn"' + dis + ' onclick="copiarLinkBot(\'' + linkAttr + '\')">Copiar link</button>' +
            '<button class="part-btn"' + dis + ' onclick="partilharLinkBot(\'' + linkAttr + '\', \'' + nomeBaseAttr + '\')">Partilhar link</button>' +
            '<button class="part-btn"' + dis + ' onclick="encurtarLinkBot(\'' + linkAttr + '\')">Encurtar link</button>' +
            '<button class="part-btn pausa" id="btn-pausa-' + indice + '"' + dis + ' onclick="alternarPausaBot(\'' + nomeAttr + '\', ' + indice + ')">Pausar bot</button>' +
            '</div>' +
            (publicado ? '<div class="part-link">' + escapeHtml(link) + '</div>' : '') +
            '</div>';
    }

    function renderizarTelaPartilha() {
        const bots = listarNomesBots();
        if (!bots.length) {
            abrirFolha('Partilhar Bot',
                '<div style="text-align:center;font-weight:normal;color:var(--muted)">Ainda não tens bots. Cria um em "+ Novo bot".</div>', '');
            return;
        }
        // O bot aberto no editor aparece primeiro.
        bots.sort((a, b) => (a === ficheiroAtual ? -1 : 0) - (b === ficheiroAtual ? -1 : 0));

        const publicados = lerIdsPublicados();
        abrirFolha('Partilhar Bot',
            bots.map((nome, i) => cartaoPartilhaHTML(nome, i)).join(''), '');

        bots.forEach((nome, i) => {
            if (publicados[nome]) atualizarBotaoPausaModal(publicados[nome], i);
        });
    }

    // Na app o encurtador abre numa WebView e o link é injetado por JS.
    // No navegador isso não é possível (outro domínio), por isso copia o
    // link e abre o url.gratis numa aba nova para colar.
    function encurtarLinkBot(link) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).catch(() => {});
        }
        window.open(URL_ENCURTADOR, '_blank');
        mostrarToast('Link copiado. Cola no campo do encurtador.');
    }

    function partilharLinkBot(link, nome) {
        if (navigator.share) {
            navigator.share({ title: nome, text: 'Fala com o bot ' + nome, url: link }).catch(() => {});
        } else {
            copiarLinkBot(link);
        }
    }

    async function publicarOuAtualizar(nomeArquivo) {
        if (!(await podePublicar(nomeArquivo))) return;
        const sql = ficheiros[nomeArquivo];
        const nomeBase = nomeArquivo.includes('/') ? nomeArquivo.slice(nomeArquivo.lastIndexOf('/') + 1) : nomeArquivo;
        const nomeBot = nomeBase.replace(/\.sql$/i, '');
        const idExistente = lerIdsPublicados()[nomeArquivo];

        // Ficheiros auxiliares (.txt) do mesmo projeto, com o prefixo da
        // pasta removido — mesmo scoping usado no runBot() local, senão
        // o bot publicado não encontra CONTAINS KEYWORDS/THINK/REPLY
        // indexado e cai sempre na resposta em texto simples.
        const pastaDoBot = nomeArquivo.includes('/') ? nomeArquivo.slice(0, nomeArquivo.lastIndexOf('/')) : '';
        const arquivosAuxiliares = {};
        Object.keys(ficheiros).forEach((nome) => {
            if (nome === nomeArquivo || !nome.endsWith('.txt')) return;
            if (pastaDoBot && nome.startsWith(pastaDoBot + '/')) {
                arquivosAuxiliares[nome.slice(pastaDoBot.length + 1)] = ficheiros[nome];
            } else if (!pastaDoBot && nome.indexOf('/') === -1) {
                arquivosAuxiliares[nome] = ficheiros[nome];
            }
        });

        mostrarToast('A publicar...');
        try {
            const resp = await fetch(URL_API_BOTQL + '/api/botql/publicar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign(credenciais(), {
                    nomeArquivo: nomeArquivo,
                    id: idExistente,
                    nome: nomeBot,
                    sql: sql,
                    arquivos: arquivosAuxiliares
                }))
            });
            const dados = await resp.json();
            if (!resp.ok || !dados.sucesso) {
                if (dados.estado) aplicarEstado(dados.estado);
                if (dados.erro === 'limite_24h') {
                    modalLimite('Limite de publicações atingido',
                        linhaModal('Usaste as ' + LIMITE_FREE_PUBLICACOES_24H + ' publicações permitidas nas últimas 24 horas.') +
                        linhaModal('<br>Com o Premium atualizas sem limite.'));
                    return;
                }
                if (dados.erro === 'limite_publicados') {
                    modalLimite('Limite de bots publicados',
                        linhaModal('O plano gratuito permite ' + pluralizar(LIMITE_FREE_PUBLICADOS, 'bot publicado', 'bots publicados') + '.') +
                        linhaModal('<br>Com o Premium publicas quantos bots quiseres.'));
                    return;
                }
                throw new Error(dados.erro || 'a API recusou o pedido');
            }

            guardarIdPublicado(nomeArquivo, dados.id);
            if (dados.estado) aplicarEstado(dados.estado);
            if (document.getElementById('folha-titulo').textContent === 'Partilhar Bot' &&
                document.getElementById('folha-overlay').classList.contains('show')) renderizarTelaPartilha();
            mostrarToast(idExistente ? 'Bot atualizado.' : 'Bot publicado.');
            setTimeout(avisarUsoAposPublicar, 400);
        } catch (e) {
            mostrarToast('Não foi possível publicar: ' + (e.message || 'erro desconhecido'));
        }
    }

    async function atualizarBotaoPausaModal(id, indice) {
        const btn = document.getElementById('btn-pausa-' + indice);
        try {
            const resp = await fetch(URL_API_BOTQL + '/api/botql/' + encodeURIComponent(id));
            const dados = await resp.json();
            if (btn && resp.ok && dados.sucesso) {
                btn.textContent = dados.pausado ? 'Retomar bot' : 'Pausar bot';
                btn.dataset.pausadoAtual = dados.pausado ? '1' : '0';
            }
        } catch (e) {
            if (btn) btn.textContent = 'Pausar bot';
        }
    }

    async function alternarPausaBot(nomeArquivo, indice) {
        const id = lerIdsPublicados()[nomeArquivo];
        if (!id) return;
        const btn = document.getElementById('btn-pausa-' + indice);
        const pausadoAtual = btn && btn.dataset.pausadoAtual === '1';
        const novoValor = !pausadoAtual;

        try {
            const resp = await fetch(URL_API_BOTQL + '/api/botql/' + encodeURIComponent(id) + '/pausar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign(credenciais(), { pausado: novoValor }))
            });
            const dados = await resp.json();
            if (!resp.ok || !dados.sucesso) throw new Error(dados.erro || 'a API recusou o pedido');
            if (btn) {
                btn.textContent = novoValor ? 'Retomar bot' : 'Pausar bot';
                btn.dataset.pausadoAtual = novoValor ? '1' : '0';
            }
            mostrarToast(novoValor ? 'Bot pausado.' : 'Bot retomado.');
        } catch (e) {
            mostrarToast('Não foi possível alterar o estado.');
        }
    }

    function copiarLinkBot(link) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).catch(() => {});
        }
        mostrarToast('Link copiado.');
    }

    function abrirCustomizarEditor() {
        fecharMenu();
        const escuro = document.body.classList.contains('tema-escuro');
        abrirFolha('Customizar editor',
            'Tema atual: ' + (escuro ? 'escuro' : 'claro'),
            '<button class="primario" onclick="confirmarTema()">Alternar tema</button>' +
            '<button onclick="fecharFolha()">Fechar</button>');
    }
    function confirmarTema() {
        const escuro = !document.body.classList.contains('tema-escuro');
        document.body.classList.toggle('tema-escuro', escuro);
        localStorage.setItem('botql_editor_online_tema', escuro ? 'escuro' : 'claro');
        fecharFolha();
    }

    // ==========================================================
    // Modelos — mesma fonte de dados do app: um indice em JSON no
    // repo (app/index.json) com {nome, descricao, arquivo}, e o
    // conteudo de cada modelo em app/modules/<arquivo>. Servido via
    // raw.githubusercontent.com (github.com/tree só serve a interface
    // web, não o ficheiro em bruto). Guarda o último índice em
    // localStorage para funcionar offline com a última versão
    // conhecida caso o fetch falhe — igual ao comportamento do app.
    // ==========================================================
    function abrirModelos() {
        fecharMenu();
        abrirFolha('Modelos', '<div id="modelos-lista" class="modelos-estado">A carregar...</div>',
            '<button onclick="fecharFolha()">Fechar</button>');
        carregarListaModelos();
    }

    function renderizarListaModelos(modelos, deCache) {
        const lista = document.getElementById('modelos-lista');
        if (!lista) return;
        if (!modelos || modelos.length === 0) {
            lista.innerHTML = '<div class="modelos-estado">Nenhum modelo disponível.</div>';
            return;
        }
        let html = '';
        if (deCache) {
            html += '<div class="modelos-estado">Sem internet — a mostrar a última lista carregada.</div>';
        }
        modelos.forEach((m) => {
            const arquivoEscapado = m.arquivo.replace(/'/g, "\\'");
            html += '<div class="modelo-card" onclick="usarModelo(\'' + arquivoEscapado + '\')">' +
                '<span class="modelo-icone">' + SVG_ROBO_BRANCO + '</span>' +
                '<div class="modelo-corpo">' +
                '<div class="modelo-nome">' + escapeHtml(m.nome) + '</div>' +
                '<div class="modelo-descricao">' + escapeHtml(m.descricao) + '</div>' +
                '</div></div>';
        });
        lista.innerHTML = html;
    }

    function carregarListaModelos() {
        fetch(MODELOS_INDEX_URL)
            .then((resp) => {
                if (!resp.ok) throw new Error('Falha ao buscar índice');
                return resp.json();
            })
            .then((modelos) => {
                localStorage.setItem(MODELOS_CACHE_KEY, JSON.stringify(modelos));
                renderizarListaModelos(modelos, false);
            })
            .catch(() => {
                const lista = document.getElementById('modelos-lista');
                const cache = localStorage.getItem(MODELOS_CACHE_KEY);
                if (cache) {
                    renderizarListaModelos(JSON.parse(cache), true);
                } else if (lista) {
                    lista.innerHTML = '<div class="modelos-estado">Sem internet e sem modelos guardados ainda.</div>';
                }
            });
    }

    function usarModelo(arquivoRemoto) {
        fetch(MODELOS_BASE_URL + arquivoRemoto)
            .then((resp) => {
                if (!resp.ok) throw new Error('Falha ao buscar modelo');
                return resp.text();
            })
            .then((conteudo) => {
                const nomeBase = arquivoRemoto.replace(/\.sql$/i, '');
                let pastaFinal = nomeBase;
                let nomeFinal = nomeBase + '/' + nomeBase + '.sql';
                let sufixo = 1;
                while (ficheiros[nomeFinal]) {
                    sufixo++;
                    pastaFinal = nomeBase + sufixo;
                    nomeFinal = pastaFinal + '/' + pastaFinal + '.sql';
                }
                ficheiros[nomeFinal] = conteudo;
                salvarFicheirosNoDisco();
                pastasAbertas.add(pastaFinal);
                fecharFolha();
                abrirFicheiro(nomeFinal);
            })
            .catch(() => {
                modalAviso('Não foi possível obter este modelo', 'Sem internet ou o repositório está indisponível.');
            });
    }

    function abrirSobre() {
        fecharMenu();
        abrirFolha('Sobre Este Editor',
            '<div style="font-size:19px;margin-bottom:2px"> Web Editor</div>' +
            '<div style="color:var(--muted);font-size:13px;font-weight:normal;margin-bottom:16px">Versão 1.0.0</div>' +
            '<div style="margin-bottom:12px">Este editor foi desenvolvido para criar, testar e publicar bots usando as regras BotQL diretamente no navegador.</div>' +
            '<div style="margin-bottom:16px;color:var(--muted);font-size:14px;font-weight:normal">Outras funcionalidades como o THINK com busca semântica avançada, servidores e muito mais,  continuam exclusivamente disponíveis na app (Android).</div>' +
            '<div style="font-size:13px;color:var(--muted);font-weight:normal">Licença DUAL-MIT</div>' +
            '<div style="font-size:13px"><a href="https://github.com/adilson889/botql" target="_blank" style="color:var(--r)">www.npmjs.com/package/botql</a></div>',
            '<button class="primario" onclick="fecharFolha()"><span class="modal-icone">' + SVG_CHECK + '</span>OK</button>' +
            '<button onclick="window.open(\'' + URL_APP_DOWNLOAD + '\', \'_blank\')">Baixar app</button>');
    }

    // ==========================================================
    // Run — corre o bot num preview real (perguntas/respostas), não
    // só um "arrancou" isolado.
    // ==========================================================
    let botInstancia = null;
    const CLIENTE_PREVIEW = 'preview-' + Math.random().toString(36).slice(2, 8);

    function runBot() {
        const source = editorArea.value;
        if (!source.trim()) {
            modalAviso('Erro', 'O ficheiro está vazio.');
            return;
        }
        // O motor resolve ficheiros auxiliares (.txt) pelo nome simples,
        // relativo à pasta do próprio bot — não pelo caminho completo
        // "Projeto/nome.txt" que usamos para organizar a sidebar. Por
        // isso aqui construímos um filesystem só com os ficheiros do
        // projeto atual, com o prefixo da pasta removido.
        const pastaAtual = ficheiroAtual && ficheiroAtual.includes('/')
            ? ficheiroAtual.slice(0, ficheiroAtual.lastIndexOf('/'))
            : '';
        const fsFicheiros = {};
        Object.keys(ficheiros).forEach((nome) => {
            if (pastaAtual && nome.startsWith(pastaAtual + '/')) {
                fsFicheiros[nome.slice(pastaAtual.length + 1)] = ficheiros[nome];
            } else if (!pastaAtual && nome.indexOf('/') === -1) {
                fsFicheiros[nome] = ficheiros[nome];
            }
        });
        const nomeAtualRelativo = pastaAtual ? ficheiroAtual.slice(pastaAtual.length + 1) : ficheiroAtual;
        fsFicheiros[nomeAtualRelativo] = source;
        const fileSystem = new MemoryFileSystem(fsFicheiros);
        let bot;
        try {
            bot = BotQLInterpreter.fromSource(source, { fileSystem, basePath: '' });
        } catch (e) {
            modalAviso('Erro de sintaxe', e.message);
            return;
        }

        const mensagensRecebidas = [];
        bot.onReply = ({ text }) => { if (text) mensagensRecebidas.push(text); };
        bot.onForward = ({ target }) => mensagensRecebidas.push('[encaminhado para ' + target + ']');
        bot.onSend = ({ target }) => mensagensRecebidas.push('[enviado para ' + target + ']');

        bot.start().then(() => {
            botInstancia = bot;
            abrirModalTeste(bot.botName || '(sem nome)');
        }).catch((e) => {
            modalAviso('Erro', e.message);
        });
    }

    if (typeof marked !== 'undefined') marked.setOptions({ breaks: true, gfm: true });

    const HTML_PERMITIDO_TESTE = {
        ALLOWED_TAGS: [
            'div','span','p','br','hr','section','article','header','footer','main','aside',
            'h1','h2','h3','h4','h5','h6','ul','ol','li','dl','dt','dd',
            'strong','em','b','i','u','s','del','ins','sub','sup','small','mark',
            'a','img','figure','figcaption','picture','source',
            'table','thead','tbody','tfoot','tr','th','td','caption','colgroup','col',
            'blockquote','pre','code','kbd','samp','var','details','summary','style'
        ],
        ALLOWED_ATTR: [
            'class','id','style','title','href','src','alt','width','height',
            'colspan','rowspan','target','rel','srcset','sizes','loading','role','aria-label'
        ],
        FORBID_TAGS: ['script','iframe','object','embed','form','input','textarea','select','option','button','meta','link','base','applet','frame','frameset'],
        FORBID_ATTR: [
            'onclick','ondblclick','onmousedown','onmouseup','onmouseover','onmousemove',
            'onmouseout','onmouseenter','onmouseleave','onload','onerror','onfocus','onblur',
            'onchange','onsubmit','oninput','onkeydown','onkeyup','onkeypress'
        ],
        ALLOW_DATA_ATTR: true,
        FORCE_BODY: true,
        ALLOW_UNKNOWN_PROTOCOLS: false
    };

    const produtosSelecionadosTeste = new Set();

    function rolarTesteParaFim() {
        const container = document.getElementById('teste-chat');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        });
    }

    function adicionarBotaoCopiarCodigoTeste(blocoPre) {
        const codeEl = blocoPre.querySelector('code');
        const classeLinguagem = codeEl ? [...codeEl.classList].find((c) => c.startsWith('language-')) : null;
        const nomeLinguagem = classeLinguagem ? classeLinguagem.replace('language-', '') : 'texto';
        const cabecalho = document.createElement('div');
        cabecalho.className = 'teste-cabecalho-codigo';
        cabecalho.innerHTML = '<span class="nome-linguagem">' + nomeLinguagem + '</span>' +
            '<button class="teste-btn-copiar-codigo" type="button">Copiar</button>';
        cabecalho.querySelector('button').addEventListener('click', () => {
            const texto = codeEl ? codeEl.textContent : blocoPre.textContent;
            if (navigator.clipboard) navigator.clipboard.writeText(texto).catch(() => {});
        });
        blocoPre.insertBefore(cabecalho, blocoPre.firstChild);
    }

    // markdown=true renderiza como Markdown; html (quando vem preenchido,
    // ex. SHOW CATALOG) tem prioridade — já é HTML pronto, não texto a
    // interpretar como Markdown.
    function adicionarMensagemTeste(texto, classe, markdown, html) {
        const container = document.getElementById('teste-chat');
        const d = document.createElement('div');
        d.className = 'teste-msg ' + classe;

        if (html && typeof DOMPurify !== 'undefined') {
            d.classList.add('markdown');
            try {
                d.innerHTML = DOMPurify.sanitize(html, HTML_PERMITIDO_TESTE);
                if (typeof hljs !== 'undefined') {
                    d.querySelectorAll('pre code').forEach((b) => { try { hljs.highlightElement(b); } catch (e) {} });
                }
                d.querySelectorAll('pre').forEach((p) => adicionarBotaoCopiarCodigoTeste(p));
                d.querySelectorAll('img').forEach((img) => img.addEventListener('load', rolarTesteParaFim));
            } catch (e) { d.textContent = texto; }
        } else if (markdown && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            d.classList.add('markdown');
            try {
                const htmlLimpo = DOMPurify.sanitize(marked.parse(texto), HTML_PERMITIDO_TESTE);
                d.innerHTML = htmlLimpo;
                if (typeof hljs !== 'undefined') {
                    d.querySelectorAll('pre code').forEach((b) => { try { hljs.highlightElement(b); } catch (e) {} });
                }
                d.querySelectorAll('pre').forEach((p) => adicionarBotaoCopiarCodigoTeste(p));
                d.querySelectorAll('img').forEach((img) => img.addEventListener('load', rolarTesteParaFim));
            } catch (e) { d.textContent = texto; }
        } else {
            d.textContent = texto;
        }

        container.appendChild(d);
        rolarTesteParaFim();
    }

    function adicionarDigitandoTeste() {
        const container = document.getElementById('teste-chat');
        const d = document.createElement('div');
        d.className = 'teste-msg digitando';
        d.id = 'teste-digitando';
        d.innerHTML = '<span class="ponto"></span><span class="ponto"></span><span class="ponto"></span>';
        container.appendChild(d);
        rolarTesteParaFim();
    }
    function esconderDigitandoTeste() {
        const el = document.getElementById('teste-digitando');
        if (el) el.remove();
    }

    document.getElementById('teste-chat').addEventListener('click', (e) => {
        const alvo = e.target.closest('[data-botql-produto]');
        if (alvo) {
            const nome = alvo.dataset.botqlProduto;
            if (produtosSelecionadosTeste.has(nome)) produtosSelecionadosTeste.delete(nome);
            else produtosSelecionadosTeste.add(nome);
            document.querySelectorAll('#teste-chat [data-botql-produto]').forEach((el) => {
                el.classList.toggle('selecionado', produtosSelecionadosTeste.has(el.dataset.botqlProduto));
            });
            if (produtosSelecionadosTeste.size > 0) {
                document.getElementById('teste-input').value = 'quero comprar: ' + [...produtosSelecionadosTeste].join(', ');
            }
            return;
        }
        const categoria = e.target.closest('[data-botql-categoria]');
        if (categoria) {
            document.getElementById('teste-input').value = categoria.dataset.botqlCategoria;
            enviarMensagemTeste();
        }
    });

    let toastTesteId = null;
    function mostrarToastTeste(texto) {
        const toast = document.getElementById('teste-toast');
        clearTimeout(toastTesteId);
        toast.textContent = texto;
        toast.classList.add('show');
        toastTesteId = setTimeout(() => { toast.classList.remove('show'); }, 2200);
    }

    function abrirModalTeste(nomeBot) {
        document.getElementById('teste-titulo').textContent = nomeBot;
        document.getElementById('teste-chat').innerHTML = '';
        produtosSelecionadosTeste.clear();
        document.getElementById('teste-overlay').classList.add('show');
        const input = document.getElementById('teste-input');
        input.value = '';
        input.focus();
        mostrarToastTeste('Bot pronto. Escreve uma mensagem abaixo.');
    }

    function fecharTeste() {
        document.getElementById('teste-overlay').classList.remove('show');
        botInstancia = null;
    }

    async function enviarMensagemTeste() {
        const input = document.getElementById('teste-input');
        const texto = input.value.trim();
        if (!texto || !botInstancia) return;
        adicionarMensagemTeste(texto, 'usuario', false);
        input.value = '';
        input.style.height = 'auto';
        adicionarDigitandoTeste();

        botInstancia.onReply = ({ text, html }) => {
            esconderDigitandoTeste();
            if (text || html) adicionarMensagemTeste(text || '', 'sistema', true, html);
        };

        try {
            await botInstancia.receiveMessage(CLIENTE_PREVIEW, texto);
            esconderDigitandoTeste();
        } catch (e) {
            esconderDigitandoTeste();
            adicionarMensagemTeste('Erro: ' + e.message, 'erro', false);
        }
    }

    // Expande a textarea conforme o conteudo cresce, ate ao max-height
    // definido em CSS (120px) — igual ao preview do app. Sem isto, o
    // <textarea> fica preso numa linha e o Enter so quebra linha sem
    // o utilizador ver o texto crescer.
    function ajustarAlturaInputTeste(el) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }

    // ==========================================================
    // Inicialização
    // ==========================================================
    (async function init() {
        try {
            const tema = localStorage.getItem('botql_editor_online_tema');
            if (tema === 'escuro') document.body.classList.add('tema-escuro');
        } catch (e) {}

        carregarFicheirosSalvos();
        if (Object.keys(ficheiros).length === 0) {
            ficheiros['MeuBot/MeuBot.sql'] = 'CREATE BOT "MeuBot"\nPLATFORM WHATSAPP\n\nCREATE TABLE Context() PREVENT DEFAULT\n\nON MESSAGE {\n    INSERT INTO Context()\n\n    WHEN CONTAINS "oi" OR CONTAINS "ola" {\n        REPLY "Ola! Como posso ajudar?"\n    }\n\n    OTHERWISE {\n        REPLY "Nao percebi, escreve ajuda."\n    }\n}\n\nRUN BOT\n';
            ficheiroAtual = 'MeuBot/MeuBot.sql';
            pastasAbertas.add('MeuBot');
        }
        if (!ficheiroAtual) ficheiroAtual = Object.keys(ficheiros)[0] || null;

        editorArea.value = ficheiroAtual ? (ficheiros[ficheiroAtual] || '') : '';
        atualizarHighlight();
        atualizarTitulo();
        renderizarListaBots();
        await iniciarConta();
        if (!servidorOnline) {
            const tentar = setInterval(async () => {
                if (await iniciarConta()) {
                    clearInterval(tentar);
                    if (contaNova) setTimeout(avisarContaNova, 300);
                    arrancarPremium();
                    agendarSincronizacao();
                }
            }, 8000);
        }
        if (contaNova) setTimeout(avisarContaNova, 600);
        arrancarPremium();
        agendarSincronizacao();
    })();

    Object.assign(window, {
        abrirSidebar, fecharSidebar, abrirBot, apagarBot,
        mostrarNovoBot, confirmarNovoBot, confirmarApagarBot,
        mostrarNovoFicheiro, confirmarNovoFicheiro, apagarPasta, alternarPasta,
        renomearBot, confirmarRenomearBot,
        carregarFicheiro, exportarFicheiroAtual,
        abrirMenu, fecharMenu, abrirDocumentacao,
        abrirPartilharBot, publicarOuAtualizar, partilharLinkBot, encurtarLinkBot,
        abrirMeusBots, abrirAtividadeBot,
        abrirEcraConta, copiarCodigoConta, confirmarRecuperarConta, irParaPremium,
        avancarParaPagamento, voltarParaBeneficios,
        abrirEcraPremium, fecharFolhaPremium, escolherComprovativo, enviarPedidoPremium,
        escolherMetodoPremium, verDadosPagamento, copiarDadoPagamento,
        copiarLinkBot, alternarPausaBot,
        abrirCustomizarEditor, confirmarTema,
        abrirModelos, usarModelo,
        abrirSobre, fecharModal, abrirFolha, fecharFolha, runBot,
        enviarMensagemTeste, fecharTeste, ajustarAlturaInputTeste
    });
})().catch((e) => {
    console.error('BotQL: falha ao iniciar —', e.message);
    const aviso = document.createElement('div');
    aviso.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#8B0000;color:#fff;padding:14px 16px;font-family:sans-serif;font-size:14px;z-index:2000;box-shadow:0 2px 10px rgba(0,0,0,0.3)';
    aviso.textContent = 'Erro ao carregar o editor: ' + e.message;
    document.body.appendChild(aviso);
});
