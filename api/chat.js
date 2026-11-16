/* ========================================================================
   ARQUIVO: api/chat.js
   DESCRIÇÃO: Proxy de IA para o site publicado na Vercel.

   O navegador nunca vê a chave do provedor. Ele envia o mesmo corpo que
   enviaria ao Ollama e recebe NDJSON no mesmo formato. O proxy:
     1. valida o código de acesso (ou o IP, conforme AI_ACCESS_MODE);
     2. aplica cota diária por pessoa e global;
     3. tenta o provedor principal e, se falhar, o provedor de reserva;
     4. repassa a resposta em streaming, sem guardar o conteúdo.

   Rotas:
     POST /api/chat   conversa (compatível com Ollama)
     GET  /api/tags   status/modelos para a tela de ajustes
   ======================================================================== */

export const config = { runtime: 'edge' };

import {
    CORS_HEADERS, preflight, identityOf, codeAllowed,
    incrementQuota, providerConfig, upstreamUrl, upstreamBody,
    openAiToOllamaStream, json as jsonResponse,
} from './_lib.js';

function quotaLimit(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function applyQuota(identity) {
    const perUser = quotaLimit('AI_DAILY_PER_USER', 20);
    const global = quotaLimit('AI_DAILY_GLOBAL', 500);
    try {
        const usedByUser = await incrementQuota(`quota:user:${identity}`, 90000);
        if (usedByUser > perUser) {
            const label = perUser === 1 ? 'ação' : 'ações';
            return { ok: false, message: `Limite diário de ${perUser} ${label} atingido. Tente novamente amanhã.`, usedByUser, perUser };
        }
        const usedGlobal = await incrementQuota('quota:global', 90000);
        if (usedGlobal > global) {
            return { ok: false, message: 'O limite diário do assistente foi atingido. Tente novamente amanhã.', usedByUser, perUser };
        }
        return { ok: true, usedByUser, perUser };
    } catch (error) {
        // Se o Redis falhar, não derruba o assistente: segue sem cota rígida.
        console.warn('Falha na cota:', error.message);
        return { ok: true, usedByUser: null, perUser };
    }
}

async function fetchProvider(config, body, signal) {
    const response = await fetch(upstreamUrl(config), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
        },
        body: JSON.stringify(upstreamBody(body, config)),
        signal,
    });
    return response;
}

export default async function handler(request) {
    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405);

    if (!codeAllowed(request)) {
        return jsonResponse({ error: 'Código de acesso ausente ou inválido. Peça o código a quem compartilhou o site.' }, 401);
    }
    const identity = identityOf(request);
    if (!identity) return jsonResponse({ error: 'Não foi possível identificar o acesso.' }, 401);

    let body;
    try {
        body = await request.json();
    } catch (error) {
        return jsonResponse({ error: 'Corpo inválido: envie JSON.' }, 400);
    }
    if (!body || !Array.isArray(body.messages) || !body.messages.length) {
        return jsonResponse({ error: 'Envie ao menos uma mensagem.' }, 400);
    }

    const primary = providerConfig('AI');
    const fallback = providerConfig('AI_FALLBACK');
    if (!primary && !fallback) {
        return jsonResponse({ error: 'O assistente ainda não foi configurado neste site. Veja a documentação de publicação.' }, 503);
    }

    const quota = await applyQuota(identity);
    if (!quota.ok) {
        return jsonResponse({ error: quota.message, quota: { used: quota.usedByUser, limit: quota.perUser } }, 429);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const providers = [primary, fallback].filter(Boolean);

    try {
        let lastError = 'Provedor indisponível.';
        for (const provider of providers) {
            let response;
            try {
                response = await fetchProvider(provider, body, controller.signal);
            } catch (error) {
                lastError = error.message || lastError;
                continue;
            }
            if (!response.ok) {
                let detail = `HTTP ${response.status}`;
                try {
                    const payload = await response.json();
                    detail = payload.error && (payload.error.message || payload.error) || detail;
                } catch (error) { /* sem JSON */ }
                lastError = String(detail);
                continue;
            }

            clearTimeout(timer);
            const headers = new Headers(CORS_HEADERS);
            headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
            headers.set('Cache-Control', 'no-store');
            if (quota.usedByUser != null) headers.set('X-Acervo-Quota-Used', String(quota.usedByUser));
            headers.set('X-Acervo-Quota-Limit', String(quota.perUser));

            const stream = provider.provider === 'openai'
                ? openAiToOllamaStream(response)
                : response.body;
            return new Response(stream, { status: 200, headers });
        }
        return jsonResponse({ error: `O assistente não respondeu. ${lastError}` }, 502);
    } catch (error) {
        return jsonResponse({ error: 'Falha ao consultar o assistente: ' + error.message }, 502);
    } finally {
        clearTimeout(timer);
    }
}
