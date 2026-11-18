/* Testes das utilidades do proxy de IA. Executar com: npm test */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isPlaceholderKey,
    validateMessages,
    upstreamUrl,
    upstreamBody,
    maxCompletionTokens,
    providerLabel,
    describeProviderError,
} from '../api/_lib.js';

test('chaves de exemplo são recusadas antes de chamar o provedor', () => {
    assert.equal(isPlaceholderKey(''), true);
    assert.equal(isPlaceholderKey('sua_chave_aqui'), true);
    assert.equal(isPlaceholderKey('coloque-a-chave-real'), true);
    assert.equal(isPlaceholderKey('sk-substitua'), true);
    assert.equal(isPlaceholderKey('curta'), true);
    assert.equal(isPlaceholderKey('sk-1234567890abcdefghijklmnop'), false);
});

test('validação de mensagens rejeita corpo vazio e papéis inválidos', () => {
    assert.match(validateMessages(null), /ao menos uma mensagem/i);
    assert.match(validateMessages({ messages: [] }), /ao menos uma mensagem/i);
    assert.match(validateMessages({ messages: [{ role: 'hacker', content: 'oi' }] }), /Papel de mensagem inválido/i);
    assert.match(validateMessages({ messages: [{ role: 'user', content: 'a'.repeat(60001) }] }), /Contexto grande demais/i);
    assert.equal(validateMessages({ messages: [{ role: 'user', content: 'Analise esta partida.' }] }), null);
});

test('OpenAI usa /chat/completions e preserva o modelo configurado no servidor', () => {
    const provider = { provider: 'openai', prefix: 'AI', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', path: '' };
    assert.equal(upstreamUrl(provider), 'https://api.groq.com/openai/v1/chat/completions');
    const body = upstreamBody({ model: 'enviado-pelo-cliente', messages: [{ role: 'user', content: 'oi' }] }, provider);
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.stream, true);
    assert.equal(body.max_completion_tokens, 4096);
});

test('teto de tokens vem só do servidor, com padrão e faixa segura', () => {
    const original = { ...process.env };
    try {
        delete process.env.AI_MAX_TOKENS;
        assert.equal(maxCompletionTokens('AI'), 4096);

        process.env.AI_MAX_TOKENS = '8192';
        assert.equal(maxCompletionTokens('AI'), 8192);

        process.env.AI_MAX_TOKENS = '10';
        assert.equal(maxCompletionTokens('AI'), 256);

        process.env.AI_MAX_TOKENS = '999999';
        assert.equal(maxCompletionTokens('AI'), 32768);

        process.env.AI_MAX_TOKENS = 'abc';
        assert.equal(maxCompletionTokens('AI'), 4096);

        // O corpo do navegador não consegue elevar o teto.
        const body = upstreamBody(
            { model: 'x', messages: [{ content: 'oi' }], options: { max_tokens: 60000 } },
            { provider: 'openai', prefix: 'AI', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' }
        );
        assert.equal(body.max_completion_tokens, 4096);
    } finally {
        process.env = original;
    }
});

test('rótulo do provedor expõe apenas o host, nunca a chave', () => {
    assert.equal(providerLabel({ base: 'https://api.groq.com/openai/v1' }), 'api.groq.com');
    assert.equal(providerLabel(null), 'não configurado');
});

test('erros do provedor têm mensagens seguras e acionáveis', () => {
    assert.match(describeProviderError(401, 'api.groq.com'), /AI_API_KEY/);
    assert.match(describeProviderError(404, 'api.groq.com'), /AI_MODEL/);
    assert.match(describeProviderError(429, 'api.groq.com'), /limite de uso/i);
    assert.match(describeProviderError(503, 'api.groq.com'), /indisponível/i);
});

test('/api/tags recusa chave de exemplo sem chamar a rede', async () => {
    const original = { ...process.env };
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.AI_MODEL = 'openai/gpt-oss-120b';
    process.env.AI_API_KEY = 'sua_chave_de_exemplo';
    delete process.env.AI_FALLBACK_BASE_URL;
    try {
        const { default: handler } = await import('../api/tags.js');
        const response = await handler(new Request('https://example.com/api/tags'));
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.code, 'credential_rejected');
        assert.match(body.error, /exemplo, não uma credencial real/i);
    } finally {
        process.env = original;
    }
});

test('/api/chat recusa configuração incompleta antes de gastar cota', async () => {
    const original = { ...process.env };
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.AI_MODEL = 'openai/gpt-oss-120b';
    process.env.AI_API_KEY = 'sua_chave_de_exemplo';
    delete process.env.AI_FALLBACK_BASE_URL;
    try {
        const { default: handler } = await import('../api/chat.js');
        const response = await handler(new Request('https://example.com/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'Analise esta partida.' }] }),
        }));
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.code, 'not_configured');
        assert.match(body.error, /AI_API_KEY/);
    } finally {
        process.env = original;
    }
});
