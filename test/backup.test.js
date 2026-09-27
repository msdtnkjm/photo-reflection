import test from 'node:test';
import assert from 'node:assert';
import { buildBackup, parseBackup, blobToDataUrl, dataUrlToBlob, backupFileName } from '../js/backup.js';

const rec = (id, photoId) => ({
  id, createdAt: '2026-09-27T12:00:00.000Z', story: '物語', commitment: 'やること',
  entries: { morning: { photo: { id: photoId, thumb: `https://picsum.photos/id/${photoId}/400/300.jpg` }, overlap: 'o', reframe: '' } },
});

test('画像はdata URLにして戻しても、中身が変わらない', async () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 256); // 大きめのデータでも落ちないこと
  const url = await blobToDataUrl(new Blob([bytes], { type: 'image/jpeg' }));
  assert.match(url, /^data:image\/jpeg;base64,/);
  const back = new Uint8Array(await dataUrlToBlob(url).arrayBuffer());
  assert.deepStrictEqual(back, bytes);
});

test('画像以外のdata URLは受けつけない', () => {
  assert.strictEqual(dataUrlToBlob('data:text/html;base64,PGh0bWw+'), null);
  assert.strictEqual(dataUrlToBlob('https://example.com/a.jpg'), null);
});

test('書き出したファイルを読みこむと、記録と写真がそろって戻る（同じ写真は1枚だけ入れる）', async () => {
  const blobs = { 10: new Blob(['A'], { type: 'image/jpeg' }), 11: new Blob(['B'], { type: 'image/jpeg' }) };
  const backup = await buildBackup([rec('r1', '10'), rec('r2', '10'), rec('r3', '11'), rec('r4', '99')], async (id) => blobs[id] ?? null);
  assert.deepStrictEqual(Object.keys(backup.photos).sort(), ['10', '11']);

  const { records, photos } = parseBackup(JSON.stringify(backup));
  assert.deepStrictEqual(records.map((r) => r.id), ['r1', 'r2', 'r3', 'r4']);
  assert.strictEqual(records[0].story, '物語');
  assert.strictEqual(await photos.get('10').text(), 'A');
  assert.strictEqual(photos.has('99'), false);
});

test('ほかのファイルを読みこもうとしたら、わかりやすく断る', () => {
  assert.throws(() => parseBackup('{"hello":1}'), /このアプリで書き出したファイルではない/);
  assert.throws(() => parseBackup('こわれたファイル'), /このアプリで書き出したファイルではない/);
});

test('写真の番号がおかしいものは読みこまない', () => {
  const { photos } = parseBackup({ app: 'photo-reflection', records: [], photos: { '../x': 'data:image/jpeg;base64,QQ==', 5: 'data:image/jpeg;base64,QQ==' } });
  assert.deepStrictEqual([...photos.keys()], ['5']);
});

test('ファイル名には日付が入る', () => {
  assert.strictEqual(backupFileName(new Date(2026, 8, 7)), 'photo-reflection-backup-20260907.json');
});
