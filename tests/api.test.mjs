/* Testes das utilidades do proxy de IA. Executar com: npm test */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isPlaceholderKey,
    validateMessages,
    upstreamUrl,
    upstreamBody,
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
    const provider = { provider: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', path: '' };
    assert.equal(upstreamUrl(provider), 'https://api.deepseek.com/v1/chat/completions');
    const body = upstreamBody({ model: 'enviado-pelo-cliente', messages: [{ role: 'user', content: 'oi' }] }, provider);
    assert.equal(body.model, 'deepseek-chat');
    assert.equal(body.stream, true);
});

test('rótulo do provedor expõe apenas o host, nunca a chave', () => {
    assert.equal(providerLabel({ base: 'https://api.deepseek.com/v1' }), 'api.deepseek.com');
    assert.equal(providerLabel(null), 'não configurado');
});

test('erros do provedor têm mensagens seguras e acionáveis', () => {
    assert.match(describeProviderError(401, 'api.deepseek.com'), /AI_API_KEY/);
    assert.match(describeProviderError(404, 'api.deepseek.com'), /AI_MODEL/);
    assert.match(describeProviderError(429, 'api.deepseek.com'), /limite de uso/i);
    assert.match(describeProviderError(503, 'api.deepseek.com'), /indisponível/i);
});

test('/api/tags recusa chave de exemplo sem chamar a rede', async () => {
    const original = { ...process.env };
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.AI_MODEL = 'deepseek-chat';
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
    process.env.AI_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.AI_MODEL = 'deepseek-chat';
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
