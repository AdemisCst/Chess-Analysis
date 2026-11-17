/* ========================================================================
   ARQUIVO: api/tags.js
   DESCRIÇÃO: Status do Treinador IA publicado.

   Diferente da versão anterior, esta rota NÃO responde "online" apenas porque
   existe um modelo configurado. Ela consulta o provedor de verdade
   (GET /models na API compatível com OpenAI) e só então confirma que a
   credencial funciona. Assim a interface não promete um assistente que vai
   falhar na primeira pergunta.

   A chave nunca sai do servidor. A resposta inclui apenas o host do provedor,
   o modelo e a lista de modelos disponíveis.
   ======================================================================== */

export const config = { runtime: 'edge' };

import {
    preflight,
    json,
    providerConfig,
    providerLabel,
    isPlaceholderKey,
    describeProviderError,
} from './_lib.js';

function modelsUrl(provider) {
    return provider.provider === 'openai'
        ? `${provider.base}/models`
        : `${provider.base}/api/tags`;
}

function modelList(payload) {
    const list = payload && Array.isArray(payload.data) ? payload.data : (payload && payload.models) || [];
    return list
        .map(item => ({ name: item && (item.id || item.name) }))
        .filter(item => !!item.name);
}

export default async function handler(request) {
    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);

    const primary = providerConfig('AI');
    const fallback = providerConfig('AI_FALLBACK');
    const candidates = [primary, fallback].filter(Boolean);

    if (!candidates.length) {
        return json({
            error: 'O Treinador IA não está configurado neste site. A biblioteca, o Stockfish e as estatísticas continuam funcionando.',
            code: 'not_configured',
            providerLabel: 'não configurado',
            models: [],
        }, 503);
    }

    const errors = [];

    for (const provider of candidates) {
        const label = providerLabel(provider);
        if (provider.provider === 'openai' && isPlaceholderKey(provider.key)) {
            errors.push(`A chave configurada para ${label} é um exemplo, não uma credencial real.`);
            continue;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(modelsUrl(provider), {
                headers: provider.key ? { Authorization: `Bearer ${provider.key}` } : {},
                signal: controller.signal,
            });

            if (!response.ok) {
                errors.push(describeProviderError(response.status, label));
                continue;
            }

            let payload = {};
            try { payload = await response.json(); } catch (error) { payload = {}; }
            const models = modelList(payload);
            return json({
                online: true,
                models: models.length ? models : (provider.model ? [{ name: provider.model }] : []),
                provider: provider.provider,
                providerLabel: label,
                model: provider.model,
                checkedAt: new Date().toISOString(),
            });
        } catch (error) {
            errors.push(error.name === 'AbortError'
                ? `O provedor ${label} demorou demais para responder.`
                : `Não foi possível falar com o provedor ${label}.`);
        } finally {
            clearTimeout(timer);
        }
    }

    return json({
        error: errors[0] || 'O Treinador IA não está disponível.',
        code: 'credential_rejected',
        providerLabel: providerLabel(candidates[0]),
        models: [],
    }, 503);
}
