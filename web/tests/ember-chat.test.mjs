import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emberChat } from '../server/emberChat.mjs';
const request = (message, ip, lang) => new Request('https://test/api/ember/chat', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ message, lang, context: { evidence: 'Brazil: 12 detections' } }) });
const text = (t) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: t }] }] });
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
    assert.equal(body.max_output_tokens, 1200);
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
test('Ember asks again with a higher ceiling when a reply is cut off, and returns the complete one', async () => {
  const ceilings = [];
  const result = await emberChat(request('Explain this area', 'e'), { OPENAI_API_KEY: 'test' }, async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1-mini' }] });
    const body = JSON.parse(options.body);
    ceilings.push(body.max_output_tokens);
    if (ceilings.length === 1) return Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, ...text('Satellite detections need') });
    return Response.json({ status: 'completed', ...text('Satellite detections need ground confirmation.') });
  });
  assert.deepEqual(ceilings, [1200, 3000]);
  assert.equal(result.status, 200);
  assert.equal(result.body.reply, 'Satellite detections need ground confirmation.');
});
test('Ember never returns cut-off text: after a second cut-off the browser keeps its own answer', async () => {
  const result = await emberChat(request('Explain this area', 'f'), { OPENAI_API_KEY: 'test' }, async (url) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1-mini' }] });
    return Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, ...text('Satellite detections') });
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'guide');
  assert.equal(result.body.reply, undefined);
});
test('Ember answers in the reader\'s language, English when the language is unknown', async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4.1-mini' }] });
    seen.push(JSON.parse(options.body).instructions);
    return Response.json(text('Wi a look pon di satellite data.'));
  };
  await emberChat(request('Wah mi a see?', 'g', 'jam'), { OPENAI_API_KEY: 'test' }, fetcher);
  await emberChat(request('¿Qué estoy viendo?', 'h', 'es'), { OPENAI_API_KEY: 'test' }, fetcher);
  await emberChat(request('What am I seeing?', 'i', 'xx'), { OPENAI_API_KEY: 'test' }, fetcher);
  assert.match(seen[0], /Answer in Jamaican Patwa/);
  assert.match(seen[1], /Answer in Rioplatense Spanish/);
  assert.match(seen[2], /Answer in English\.$/);
});
