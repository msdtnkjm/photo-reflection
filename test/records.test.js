import test from 'node:test';
import assert from 'node:assert';
import { sanitizeRecord, photoIds, displayDate, byNewest } from '../js/records.js';

const today = new Date(2026, 8, 28);

test('日付はいつも「9月27日（日）」の形。今年以外は年も付ける', () => {
  assert.strictEqual(displayDate({ createdAt: new Date(2026, 8, 27, 21).toISOString() }, today), '9月27日（日）');
  assert.strictEqual(displayDate({ id: String(new Date(2026, 8, 27, 21).getTime()) }, today), '9月27日（日）');
  assert.strictEqual(displayDate({ id: 'legacy-0', date: '2026/9/27' }, today), '9月27日（日）');
  assert.strictEqual(displayDate({ id: 'x', date: '2025/12/31' }, today), '2025年12月31日（水）');
  assert.strictEqual(displayDate({ id: 'x', date: 'よくわからない' }, today), 'よくわからない');
});

test('記録は決まった項目だけ通し、https以外のURLは捨てる', () => {
  const rec = sanitizeRecord({
    id: 'a', createdAt: '2026-09-27T12:00:00.000Z', story: 's', commitment: 'c', extra: 'x',
    entries: { morning: { overlap: 'o', photo: { id: '1', thumb: 'javascript:alert(1)', credit: { url: 'https://ok' } } } },
  });
  assert.strictEqual(rec.extra, undefined);
  assert.strictEqual(rec.createdAt, '2026-09-27T12:00:00.000Z');
  assert.strictEqual(rec.entries.morning.photo.thumb, '');
  assert.strictEqual(rec.entries.morning.photo.credit.url, 'https://ok');
  assert.strictEqual(rec.entries.noon.photo, null);
});

test('保存日時のない古い記録は、日付から保存日時を割り出して並べられるようにする', () => {
  const old = sanitizeRecord({ id: 'legacy-0-2026/9/20', date: '2026/9/20' });
  const newer = sanitizeRecord({ id: 'b', createdAt: new Date(2026, 8, 27).toISOString() });
  assert.ok(old.createdAt);
  assert.deepStrictEqual([old, newer].sort(byNewest).map((r) => r.id), ['b', 'legacy-0-2026/9/20']);
});

test('記録にふくまれるPicsumの写真番号だけを取り出す', () => {
  const rec = sanitizeRecord({ entries: { morning: { photo: { id: '10' } }, noon: { photo: { id: 'demo-x' } }, tomorrow: { photo: { id: '11' } } } });
  assert.deepStrictEqual(photoIds(rec), ['10', '11']);
});
