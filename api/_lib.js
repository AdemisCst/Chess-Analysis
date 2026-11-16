/* ========================================================================
   ARQUIVO: api/_lib.js
   DESCRIÇÃO: Utilidades compartilhadas pelas funções da Vercel.

   O proxy existe para que o site público possa usar um provedor de IA sem
   expor a chave no navegador. Ele fala o mesmo contrato do Ollama
   (`/api/chat` em NDJSON), então o aplicativo não precisa saber qual
   provedor está atrás.

   Variáveis de ambiente (todas configuradas na Vercel):
     AI_PROVIDER=ollama|openai       padrão: ollama
     AI_BASE_URL=https://...         obrigatória
     AI_API_KEY=...                  chave do provedor
     AI_MODEL=qwen2.5:3b             modelo usado no servidor
     AI_FALLBACK_BASE_URL=...        opcional, segunda tentativa
     AI_FALLBACK_API_KEY=...
     AI_FALLBACK_MODEL=...
     AI_ACCESS_MODE=code|ip          padrão: code
     AI_ACCESS_CODES=ABC123,XYZ999   códigos distribuídos às pessoas
     AI_DAILY_PER_USER=20            ações por pessoa por dia
     AI_DAILY_GLOBAL=500             ações no total por dia
     UPSTASH_REDIS_REST_URL=...      opcional, para cota/cache duráveis
     UPSTASH_REDIS_REST_TOKEN=...
   ======================================================================== */

export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Acervo-Code',
    'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
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

/** Identidade usada na cota: código de acesso ou IP encaminhado pela Vercel. */
export function identityOf(request) {
    const mode = (process.env.AI_ACCESS_MODE || 'code').toLowerCase();
    const code = (request.headers.get('x-acervo-code') || '').trim();
    if (mode === 'code') return code ? `code:${code}` : null;
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    return `ip:${ip.split(',')[0].trim()}`;
}

export function codeAllowed(request) {
    const mode = (process.env.AI_ACCESS_MODE || 'code').toLowerCase();
    if (mode !== 'code') return true;
    const code = (request.headers.get('x-acervo-code') || '').trim();
    if (!code) return false;
    const allowed = String(process.env.AI_ACCESS_CODES || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    return allowed.includes(code);
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
    const fullKey = `acervo64:${key}:${day}`;
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
        provider: (process.env[`${prefix}_PROVIDER`] || process.env.AI_PROVIDER || 'ollama').toLowerCase(),
        base,
        key: process.env[`${prefix}_API_KEY`] || '',
        model: process.env[`${prefix}_MODEL`] || process.env.AI_MODEL || '',
        path: process.env[`${prefix}_CHAT_PATH`] || '',
    };
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
