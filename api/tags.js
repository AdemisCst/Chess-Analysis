/* ========================================================================
   ARQUIVO: api/tags.js
   DESCRIÇÃO: Status do assistente publicado. O cliente usa esta rota para
   exibir "Assistente pronto" sem conhecer a chave do provedor.
   ======================================================================== */

export const config = { runtime: 'edge' };

import { preflight, json, codeAllowed, providerConfig } from './_lib.js';

export default async function handler(request) {
    if (request.method === 'OPTIONS') return preflight();
    if (!codeAllowed(request)) {
        return json({ error: 'Código de acesso ausente ou inválido.' }, 401);
    }

    const primary = providerConfig('AI') || providerConfig('AI_FALLBACK');
    if (!primary) {
        return json({ error: 'Assistente não configurado neste site.' }, 503);
    }

    if (primary.provider === 'ollama') {
        try {
            const response = await fetch(`${primary.base}/api/tags`, {
                headers: primary.key ? { Authorization: `Bearer ${primary.key}` } : {},
            });
            if (response.ok) {
                const data = await response.json();
                return json({ online: true, models: data.models || [], provider: 'ollama' });
            }
        } catch (error) {
            // Cai no retorno abaixo com o modelo configurado.
        }
    }

    const models = primary.model ? [{ name: primary.model }] : [];
    return json({ online: true, models, provider: primary.provider });
}
