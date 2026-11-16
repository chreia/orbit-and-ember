import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emberChat } from '../server/emberChat.mjs';
const request = (message, ip) => new Request('https://test/api/ember/chat', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ message, context: { evidence: 'Brazil: 12 detections' } }) });
test('Ember rejects invalid input and missing configuration without calling provider', async () => {
  assert.equal((await emberChat(request('hello', 'a'), {})).status, 503);
  assert.equal((await emberChat(request('', 'b'), { OPENAI_API_KEY: 'test' })).status, 400);
});
test('Ember caps outputs, sends context, and extracts Responses text', async () => {
  const result = await emberChat(request('Explain this area', 'c'), { OPENAI_API_KEY: 'test' }, async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1-mini' }] });
    const body = JSON.parse(options.body);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 250);
    assert.match(body.input[0].content, /12 detections/);
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Satellite detections need ground confirmation.' }] }] });
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'model');
});
test('Ember reports quota errors instead of pretending a fallback is an AI answer', async () => {
  const result = await emberChat(request('Explain fire', 'd'), { OPENAI_API_KEY: 'test' }, async () => Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }));
  assert.equal(result.status, 503);
  assert.match(result.body.error, /API credits/);
});
