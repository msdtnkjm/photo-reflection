// 写真素材の取得（Lorem Picsum）
// - 元写真はUnsplashライセンス（商用利用可）。キー登録なしで、スマホのブラウザから直接取得できる
// - キーワード検索はしない。全写真のリストからランダムに選ぶ
// - 写真は番号(ID)付きのURLで扱う（Picsum側の写真が増減しても同じ写真を指し続ける）

const PICSUM = 'https://picsum.photos';
export const PER_PAGE = 9;
export const SIZE = { thumb: [400, 300], full: [1080, 810], save: [600, 450] };
const POOL_CACHE_KEY = 'photo-reflection-pool';
const POOL_CACHE_DAYS = 7;

export const picsumUrl = (id, [w, h]) => `${PICSUM}/id/${id}/${w}/${h}.jpg`;

// Picsumのリスト／info APIの1件を、アプリ内の共通フォーマットに変換
export function toPhoto(item) {
  const id = String(item.id);
  return {
    id,
    thumb: picsumUrl(id, SIZE.thumb),
    full: picsumUrl(id, SIZE.full),
    alt: `${item.author} さんの写真`,
    credit: { name: item.author, url: item.url },
    source: { name: 'Unsplash', url: 'https://unsplash.com' },
  };
}

// 候補からランダムにn枚選ぶ
// - seen（この日にもう見せた写真）と chosen（この日に選んだ写真）は避ける
// - 見せた写真が多すぎて足りなくなったら、seenの縛りだけゆるめる（選んだ写真は絶対に出さない）
export function pickRandom(pool, n, { seen = [], chosen = [] } = {}, rng = Math.random) {
  const ng = new Set([...chosen].map(String));
  const seenSet = new Set([...seen].map(String));
  let cands = pool.filter((p) => !ng.has(p.id) && !seenSet.has(p.id));
  if (cands.length < n) cands = pool.filter((p) => !ng.has(p.id));
  cands = cands.slice();
  // フィッシャー–イェーツで先頭n枚だけシャッフル
  for (let i = 0; i < Math.min(n, cands.length); i++) {
    const j = i + Math.floor(rng() * (cands.length - i));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  return cands.slice(0, n);
}

// storage は localStorage 互換のもの（テストでは差しかえる）。使えない環境では null
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function createPhotoSource({ fetchFn = (...a) => fetch(...a), storage = defaultStorage(), now = () => Date.now() } = {}) {
  let poolPromise = null;

  // 全写真リスト（約1,000枚）を取得。毎回15回も通信しないよう、1週間は端末に覚えておく
  async function loadPool() {
    try {
      const cached = JSON.parse(storage?.getItem(POOL_CACHE_KEY) || 'null');
      if (cached && now() - cached.savedAt < POOL_CACHE_DAYS * 86400000 && cached.items?.length) {
        return cached.items.map(toPhoto);
      }
    } catch { /* 壊れていたら取りなおす */ }

    const pages = await Promise.all(Array.from({ length: 15 }, async (_, i) => {
      const res = await fetchFn(`${PICSUM}/v2/list?page=${i + 1}&limit=100`);
      if (!res.ok) throw new Error(`写真リストを取得できませんでした（${res.status}）`);
      return res.json();
    }));
    const items = pages.flat().map(({ id, author, url }) => ({ id, author, url }));
    if (!items.length) throw new Error('写真リストが空でした');
    try { storage?.setItem(POOL_CACHE_KEY, JSON.stringify({ savedAt: now(), items })); } catch { /* 覚えられなくても動く */ }
    return items.map(toPhoto);
  }

  function getPool() {
    if (!poolPromise) poolPromise = loadPool().catch((err) => { poolPromise = null; throw err; });
    return poolPromise;
  }

  async function randomPhotos(opts, rng) {
    return pickRandom(await getPool(), PER_PAGE, opts, rng);
  }

  // 保存用の小さめの画像を取得（Blob）
  async function downloadImage(id) {
    const res = await fetchFn(picsumUrl(id, SIZE.save));
    if (!res.ok) throw new Error(`写真をダウンロードできませんでした（${res.status}）`);
    return res.blob();
  }

  return { randomPhotos, downloadImage };
}
