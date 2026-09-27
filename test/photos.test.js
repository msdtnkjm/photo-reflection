import test from 'node:test';
import assert from 'node:assert';
import { toPhoto, pickRandom, picsumUrl, createPhotoSource, PER_PAGE } from '../js/photos.js';

const item = (id) => ({ id: String(id), author: `作者${id}`, url: `https://unsplash.com/photos/p${id}`, width: 1, height: 1 });
const ITEMS = Array.from({ length: 30 }, (_, i) => item(i));
const pool = ITEMS.map(toPhoto);

// Picsumの代わりに返事をする偽のfetch（ネットにつながなくてもテストできるように）
function fakePicsum() {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const m = url.match(/\/v2\/list\?page=(\d+)/);
    if (m) return { ok: true, json: async () => (+m[1] === 1 ? ITEMS : []) };
    if (/\/id\/\d+\/600\/450\.jpg$/.test(url)) return { ok: true, blob: async () => new Blob(['JPEG'], { type: 'image/jpeg' }) };
    return { ok: false, status: 404 };
  };
  fn.calls = calls;
  return fn;
}

// localStorage の代わり
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test('写真は番号付きURLで扱い、撮影者名とUnsplashのページをクレジットに持つ', () => {
  const p = toPhoto(item(1015));
  assert.strictEqual(p.id, '1015');
  assert.strictEqual(p.thumb, 'https://picsum.photos/id/1015/400/300.jpg');
  assert.deepStrictEqual(p.credit, { name: '作者1015', url: 'https://unsplash.com/photos/p1015' });
  assert.strictEqual(picsumUrl('3', [600, 450]), 'https://picsum.photos/id/3/600/450.jpg');
});

test('ランダムに9枚、重複なしで選ぶ', () => {
  const picked = pickRandom(pool, PER_PAGE);
  assert.strictEqual(picked.length, 9);
  assert.strictEqual(new Set(picked.map((p) => p.id)).size, 9);
});

test('この日に見せた写真・選んだ写真は出さない（Setでも配列でも受けつける）', () => {
  const seen = new Set(Array.from({ length: 20 }, (_, i) => String(i)));
  const picked = pickRandom(pool, 9, { seen, chosen: ['25'] });
  for (const p of picked) {
    assert.ok(+p.id >= 20, `見せた写真 ${p.id} が出ている`);
    assert.notStrictEqual(p.id, '25');
  }
});

test('候補が足りなくなったら「見せた写真」の縛りだけゆるめ、選んだ写真は出さない', () => {
  const picked = pickRandom(pool, 9, { seen: pool.map((p) => p.id), chosen: ['0', '1', '2'] });
  assert.strictEqual(picked.length, 9);
  assert.ok(picked.every((p) => !['0', '1', '2'].includes(p.id)));
});

test('写真リストは端末に1週間覚えておき、そのあいだは取りにいかない', async () => {
  const storage = memoryStorage();
  let t = Date.parse('2026-09-27T12:00:00Z');
  const f1 = fakePicsum();
  await createPhotoSource({ fetchFn: f1, storage, now: () => t }).randomPhotos();
  assert.strictEqual(f1.calls.length, 15);

  // アプリを開きなおしても（新しいsource）、6日後なら通信しない
  t += 6 * 86400000;
  const f2 = fakePicsum();
  const photos = await createPhotoSource({ fetchFn: f2, storage, now: () => t }).randomPhotos();
  assert.strictEqual(f2.calls.length, 0);
  assert.strictEqual(photos.length, 9);

  // 8日後は取りなおす
  t += 2 * 86400000;
  const f3 = fakePicsum();
  await createPhotoSource({ fetchFn: f3, storage, now: () => t }).randomPhotos();
  assert.strictEqual(f3.calls.length, 15);
});

test('写真リストが取れなかったら、次に呼んだときに取りなおす', async () => {
  let fail = true;
  const f = async (url) => (fail ? { ok: false, status: 503 } : fakePicsum()(url));
  const src = createPhotoSource({ fetchFn: f, storage: null });
  await assert.rejects(src.randomPhotos(), /写真リストを取得できませんでした/);
  fail = false;
  assert.strictEqual((await src.randomPhotos()).length, 9);
});

test('保存用の写真は600×450で取得する', async () => {
  const f = fakePicsum();
  const blob = await createPhotoSource({ fetchFn: f, storage: null }).downloadImage('42');
  assert.strictEqual(f.calls.at(-1), 'https://picsum.photos/id/42/600/450.jpg');
  assert.strictEqual(await blob.text(), 'JPEG');
});
