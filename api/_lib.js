/* ========================================================================
   ARQUIVO: api/_lib.js
   DESCRIÇÃO: Utilidades compartilhadas pelas funções da Vercel.

   O proxy existe para que o site público use um provedor de IA sem expor a
   chave no navegador. Ele fala o mesmo contrato do Ollama (`/api/chat` em
   NDJSON), então o frontend não precisa saber qual provedor está atrás.

   Variáveis de ambiente (configuradas na Vercel):
     AI_PROVIDER=openai               provedor compatível com OpenAI
     AI_BASE_URL=https://...          obrigatória
     AI_API_KEY=...                   chave real (nunca vai ao navegador)
     AI_MODEL=openai/gpt-oss-120b     modelo usado no servidor
     AI_MAX_TOKENS=4096               teto de tokens de saída (256 a 32768)
     AI_FALLBACK_*                    provedor de reserva opcional
     AI_DAILY_PER_USER=20             ações por IP por dia
     AI_DAILY_GLOBAL=500              ações no total por dia
     UPSTASH_REDIS_REST_URL=...       opcional, para cota durável
     UPSTASH_REDIS_REST_TOKEN=...

   Não existe mais código de acesso: a cota é aplicada por IP. A decisão está
   documentada em docs/AUDITORIA-INICIAL.md e docs/ARQUITETURA-INTEGRACAO.md.
   ======================================================================== */

export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

export function preflight() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(response) {
    const headers = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Identidade usada na cota. Não há mais código de acesso: usamos o IP
 * encaminhado pela Vercel. `unknown` é aceito para não derrubar a função em
 * ambientes de teste, mas a cota global continua valendo.
 */
export function identityOf(request) {
    const ip = request.headers.get('x-forwarded-for')
        || request.headers.get('x-real-ip')
        || request.headers.get('cf-connecting-ip')
        || 'unknown';
    return `ip:${ip.split(',')[0].trim()}`;
}

/* ---------- Redis opcional (Upstash REST) ---------- */
function redisConfig() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

const memory = new Map();

async function redisPipeline(commands) {
    const config = redisConfig();
    if (!config) return null;
    const response = await fetch(`${config.url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
    return response.json();
}

export async function incrementQuota(key, ttlSeconds) {
    const day = todayKey();
    const fullKey = `chessanalysis:${key}:${day}`;
    const config = redisConfig();
    if (!config) {
        const current = (memory.get(fullKey) || 0) + 1;
        memory.set(fullKey, current);
        return current;
    }
    const result = await redisPipeline([['INCR', fullKey], ['EXPIRE', fullKey, ttlSeconds, 'NX']]);
    return Number(result && result[0] && result[0].result) || 0;
}

export async function readCache(key) {
    const config = redisConfig();
    if (!config) return memory.get(`cache:${key}`) || null;
    const response = await fetch(`${config.url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.result || null;
}

export async function writeCache(key, value, ttlSeconds) {
    const config = redisConfig();
    if (!config) {
        memory.set(`cache:${key}`, value);
        return;
    }
    await fetch(`${config.url}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, ex: ttlSeconds }),
    });
}

/** Hash estável para o cache de respostas. */
export async function hashText(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* ---------- provedores ---------- */
export function providerConfig(prefix = 'AI') {
    const base = (process.env[`${prefix}_BASE_URL`] || '').replace(/\/+$/, '');
    if (!base) return null;
    return {
        provider: (process.env[`${prefix}_PROVIDER`] || process.env.AI_PROVIDER || 'openai').toLowerCase(),
        prefix,
        base,
        key: process.env[`${prefix}_API_KEY`] || '',
        model: process.env[`${prefix}_MODEL`] || process.env.AI_MODEL || '',
        path: process.env[`${prefix}_CHAT_PATH`] || '',
    };
}

/**
 * Teto de tokens de saída para provedores compatíveis com OpenAI.
 * Vem apenas do servidor (`AI_MAX_TOKENS` ou `AI_FALLBACK_MAX_TOKENS`):
 * valores enviados pelo navegador são ignorados. Padrão 4096, limitado à
 * faixa segura de 256 a 32768 (o `openai/gpt-oss-120b` aceita até 65536).
 */
export function maxCompletionTokens(prefix = 'AI') {
    const raw = Number(process.env[`${prefix}_MAX_TOKENS`]);
    if (!Number.isFinite(raw) || raw <= 0) return 4096;
    return Math.min(Math.max(Math.floor(raw), 256), 32768);
}

/**
 * Detecta valores de exemplo usados em documentação. Sem isso, o proxy
 * repassaria "sua_chave..." ao provedor e o usuário veria apenas
 * "Invalid API Key", sem saber que a configuração está incompleta.
 */
export function isPlaceholderKey(key) {
    const value = String(key || '').trim();
    if (value.length < 20) return true;
    return /^(sua[_-]?|sk-substitua|coloque-a-chave|chave-de-reserva|exemplo|placeholder|troque)/i.test(value)
        || value.includes('substitua')
        || value.includes('coloque-a-chave');
}

/** Rótulo público do provedor (sem chave, sem caminho completo). */
export function providerLabel(config) {
    if (!config) return 'não configurado';
    try {
        return new URL(config.base).host;
    } catch (error) {
        return config.base;
    }
}

/**
 * Traduz a falha do provedor em uma mensagem segura. O detalhe bruto pode
 * conter a chave ou instruções internas; por isso ele não é repassado.
 */
export function describeProviderError(status, provider) {
    if (status === 401 || status === 403) {
        return `O provedor (${provider}) rejeitou a credencial configurada no servidor. Confira AI_API_KEY na Vercel.`;
    }
    if (status === 404) {
        return `O provedor (${provider}) não encontrou o modelo configurado. Confira AI_MODEL na Vercel.`;
    }
    if (status === 429) {
        return `O provedor (${provider}) atingiu o limite de uso. Tente novamente mais tarde.`;
    }
    if (status === 400 || status === 422) {
        return `O provedor (${provider}) recusou a requisição. Verifique o modelo e o tamanho do contexto.`;
    }
    if (status >= 500) {
        return `O provedor (${provider}) está indisponível no momento (HTTP ${status}).`;
    }
    return `O provedor (${provider}) respondeu HTTP ${status}.`;
}

/** Valida o corpo de conversa antes de gastar cota. */
export function validateMessages(body) {
    if (!body || !Array.isArray(body.messages) || !body.messages.length) {
        return 'Envie ao menos uma mensagem.';
    }
    if (body.messages.length > 24) {
        return 'Histórico longo demais: envie no máximo 24 mensagens.';
    }
    let total = 0;
    for (const message of body.messages) {
        if (!message || typeof message.content !== 'string') {
            return 'Cada mensagem precisa de conteúdo textual.';
        }
        if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
            return 'Papel de mensagem inválido.';
        }
        total += message.content.length;
    }
    if (total > 60000) {
        return 'Contexto grande demais: reduza o histórico ou o texto enviado.';
    }
    return null;
}

export function upstreamUrl(config) {
    if (config.path) return config.base + (config.path.startsWith('/') ? config.path : '/' + config.path);
    return config.provider === 'openai'
        ? `${config.base}/chat/completions`
        : `${config.base}/api/chat`;
}

export function upstreamBody(body, config) {
    if (config.provider === 'openai') {
        return {
            model: config.model || body.model,
            messages: body.messages,
            stream: true,
            temperature: body.options && body.options.temperature != null ? body.options.temperature : 0.3,
            // O teto vem do servidor; `body.options` do navegador não define
            // tokens. Sem isso o provedor usa um padrão baixo e trunca.
            max_completion_tokens: maxCompletionTokens(config.prefix || 'AI'),
        };
    }
    return {
        ...body,
        model: config.model || body.model,
        stream: true,
    };
}

/**
 * Converte SSE da OpenAI em NDJSON no formato do Ollama. Assim o cliente
 * continua com um único leitor, independentemente do provedor.
 */
export function openAiToOllamaStream(upstream) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';
    return new ReadableStream({
        async start(controller) {
            const reader = upstream.body.getReader();
            const send = object => controller.enqueue(encoder.encode(JSON.stringify(object) + '\n'));
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data:')) continue;
                        const payload = trimmed.slice(5).trim();
                        if (!payload || payload === '[DONE]') continue;
                        try {
                            const object = JSON.parse(payload);
                            const content = object.choices && object.choices[0]
                                && object.choices[0].delta && object.choices[0].delta.content;
                            if (content) send({ message: { content }, done: false });
                        } catch (error) {
                            // Linha parcial ou evento sem conteúdo: ignora.
                        }
                    }
                }
                send({ message: { content: '' }, done: true });
                controller.close();
            } catch (error) {
                controller.error(error);
            } finally {
                reader.releaseLock();
            }
        },
    });
}

export function ndjsonText(text) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify({ message: { content: text }, done: false }) + '\n'));
            controller.enqueue(encoder.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'));
            controller.close();
        },
    });
}
