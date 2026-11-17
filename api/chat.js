/* ========================================================================
   ARQUIVO: api/chat.js
   DESCRIÇÃO: Proxy de IA para o site publicado na Vercel.

   O navegador nunca vê a chave do provedor. Ele envia o mesmo corpo que
   enviaria ao Ollama e recebe NDJSON no mesmo formato. O proxy:
     1. valida o corpo e o tamanho do contexto;
     2. recusa chaves de exemplo antes de chamar o provedor;
     3. aplica cota diária por IP e global;
     4. tenta o provedor principal e, se falhar, o de reserva;
     5. repassa a resposta em streaming, sem guardar o conteúdo;
     6. traduz erros (401, 404, 429, 5xx, timeout) em mensagens seguras.

   Não existe código de acesso. A cota é por IP, conforme decisão da Fase 1.
   ======================================================================== */

export const config = { runtime: 'edge' };

import {
    CORS_HEADERS,
    preflight,
    identityOf,
    incrementQuota,
    providerConfig,
    providerLabel,
    isPlaceholderKey,
    describeProviderError,
    validateMessages,
    upstreamUrl,
    upstreamBody,
    openAiToOllamaStream,
    json as jsonResponse,
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
            return {
                ok: false,
                message: `Limite diário de ${perUser} ${label} atingido. Tente novamente amanhã.`,
                usedByUser,
                perUser,
            };
        }
        const usedGlobal = await incrementQuota('quota:global', 90000);
        if (usedGlobal > global) {
            return {
                ok: false,
                message: 'O limite diário do assistente foi atingido. Tente novamente amanhã.',
                usedByUser,
                perUser,
            };
        }
        return { ok: true, usedByUser, perUser };
    } catch (error) {
        // Se o Redis falhar, não derruba o assistente: segue sem cota rígida.
        console.warn('Falha na cota:', error.message);
        return { ok: true, usedByUser: null, perUser };
    }
}

function providerBlockReason(provider) {
    if (!provider) return 'Provedor não configurado.';
    if (!provider.model) return 'Modelo não configurado (AI_MODEL).';
    if (provider.provider === 'openai' && isPlaceholderKey(provider.key)) {
        return 'Chave de API ausente ou de exemplo (AI_API_KEY).';
    }
    return null;
}

async function fetchProvider(provider, body, signal) {
    return fetch(upstreamUrl(provider), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}),
        },
        body: JSON.stringify(upstreamBody(body, provider)),
        signal,
    });
}

export default async function handler(request) {
    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405);

    let body;
    try {
        body = await request.json();
    } catch (error) {
        return jsonResponse({ error: 'Corpo inválido: envie JSON.' }, 400);
    }

    const invalid = validateMessages(body);
    if (invalid) return jsonResponse({ error: invalid }, 400);

    const primary = providerConfig('AI');
    const fallback = providerConfig('AI_FALLBACK');
    if (!primary && !fallback) {
        return jsonResponse({
            error: 'O Treinador IA ainda não foi configurado neste site. A biblioteca, o Stockfish e as estatísticas continuam funcionando.',
            code: 'not_configured',
        }, 503);
    }

    const usable = [primary, fallback]
        .filter(Boolean)
        .filter(provider => !providerBlockReason(provider));
    if (!usable.length) {
        const blocks = [primary, fallback]
            .filter(Boolean)
            .map(provider => `${providerLabel(provider)}: ${providerBlockReason(provider)}`);
        return jsonResponse({
            error: 'O Treinador IA está desabilitado porque a configuração do servidor está incompleta. '
                + blocks.join(' '),
            code: 'not_configured',
        }, 503);
    }

    const identity = identityOf(request);
    const quota = await applyQuota(identity);
    if (!quota.ok) {
        return jsonResponse({
            error: quota.message,
            code: 'quota',
            quota: { used: quota.usedByUser, limit: quota.perUser },
        }, 429);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const errors = [];

    try {
        for (const provider of usable) {
            const label = providerLabel(provider);
            let response;
            try {
                response = await fetchProvider(provider, body, controller.signal);
            } catch (error) {
                if (error.name === 'AbortError') {
                    return jsonResponse({
                        error: 'O provedor demorou demais para responder. Tente novamente.',
                        code: 'timeout',
                    }, 504);
                }
                errors.push(`Falha de rede com ${label}.`);
                continue;
            }

            if (!response.ok) {
                errors.push(describeProviderError(response.status, label));
                continue;
            }

            clearTimeout(timer);
            const headers = new Headers(CORS_HEADERS);
            headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
            headers.set('Cache-Control', 'no-store');
            if (quota.usedByUser != null) headers.set('X-AI-Quota-Used', String(quota.usedByUser));
            headers.set('X-AI-Quota-Limit', String(quota.perUser));

            const stream = provider.provider === 'openai'
                ? openAiToOllamaStream(response)
                : response.body;
            return new Response(stream, { status: 200, headers });
        }

        return jsonResponse({
            error: errors[0] || 'O assistente não respondeu.',
            code: 'provider_error',
        }, 502);
    } catch (error) {
        return jsonResponse({
            error: 'Falha ao consultar o assistente. Tente novamente.',
            code: 'proxy_error',
        }, 502);
    } finally {
        clearTimeout(timer);
    }
}
