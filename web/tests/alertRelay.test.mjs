import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { candidateSignals, createAlertRelay } from '../server/alertRelay.mjs';

const now = Date.now();
const fire = (latest = now - 60_000) => ({ fetchedAt: new Date(now).toISOString(), latestObservation: latest, startHour: now - 24 * 3_600_000, cells: [{ lat: 39.25, lon: -120.25, latest, hours: [...Array(18).fill(0), 1, 1, 2, 2, 2, 2] }] });

test('candidate requires a fresh feed, new observations and a within-day surge', () => {
  assert.equal(candidateSignals(fire(), now).length, 1);
  assert.equal(candidateSignals({ ...fire(), fetchedAt: new Date(now - 31 * 60_000).toISOString() }, now).length, 0);
  assert.equal(candidateSignals({ ...fire(), cells: [{ ...fire().cells[0], hours: [...Array(18).fill(3), ...Array(6).fill(1)] }] }, now).length, 0);
});

test('only a confirmed nearby contact receives a new signal, and delivery is recorded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'focos-relay-'));
  try {
    const sent = [];
    let current = fire(now - 5 * 60_000);
    await writeFile(join(dir, 'partners.json'), JSON.stringify([{ email: 'test@example.org', role: 'scientist', organization: 'Test Lab', logoUrl: 'https://example.org/logo.png' }]));
    const relay = createAlertRelay({ file: join(dir, 'relay.json'), partnersFile: join(dir, 'partners.json'), feed: async () => current, emailReady: () => true, publicUrl: () => 'https://focos.example', send: async email => { sent.push(email); return `provider-${sent.length}`; } });
    const input = { name: 'Test Scientist', email: 'test@example.org', organization: 'Test Lab', role: 'scientist', lat: 39.25, lon: -120.25, radiusKm: 50, publicName: true };
    await relay.subscribe(input, 'https://focos.example');
    await relay.check();
    assert.equal(sent.length, 1); // confirmation only
    assert.equal(relay.status(39.25, -120.25).count, 0);
    const verifyToken = sent[0].text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal(await relay.verify(verifyToken), true);
    assert.equal(relay.status(39.25, -120.25).count, 1);
    assert.equal(relay.status(39.25, -120.25).recipients[0].logoUrl, 'https://example.org/logo.png');
    await relay.check();
    assert.equal(sent.length, 1); // existing observations are not replayed
    current = fire(now - 60_000);
    await relay.check();
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /not a confirmed wildfire/);
    await relay.check();
    assert.equal(sent.length, 2); // no duplicate during the cooldown
    const stored = JSON.parse(await readFile(join(dir, 'relay.json'), 'utf8'));
    assert.equal(stored.deliveries.at(-1).status, 'accepted');
    const unsubscribeToken = sent[1].text.match(/unsubscribe\?token=([a-f0-9]{64})/)[1];
    assert.equal(await relay.unsubscribe(unsubscribeToken), true);
    assert.equal(relay.status(39.25, -120.25).count, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('without an email provider, sign-up is closed rather than pretending to send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'focos-relay-'));
  try {
    const relay = createAlertRelay({ file: join(dir, 'relay.json'), feed: async () => fire(), emailReady: () => false });
    await assert.rejects(relay.subscribe({ email: 'test@example.org' }, 'https://focos.example'), { status: 503 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
