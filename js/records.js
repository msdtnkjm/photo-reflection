// 記録（ふりかえり1回分）の形をそろえる・日付を表示する

export const SCENE_KEYS = ['morning', 'noon', 'evening', 'tomorrow'];
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_TEXT = 4000;

// 外から来たデータ（読みこんだバックアップなど）は、決まった項目・決まった長さ・https のURLだけを通す
const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
const url = (v) => {
  const s = str(v, 500);
  return /^https:\/\//.test(s) ? s : '';
};

function sanitizePhoto(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: str(p.id, 100),
    thumb: url(p.thumb),
    full: url(p.full),
    alt: str(p.alt, 200),
    credit: { name: str(p.credit?.name, 200), url: url(p.credit?.url) },
    source: { name: str(p.source?.name, 50), url: url(p.source?.url) },
  };
}

export function sanitizeRecord(r) {
  const entries = {};
  for (const key of SCENE_KEYS) {
    const e = r?.entries?.[key] || {};
    entries[key] = { photo: sanitizePhoto(e.photo), overlap: str(e.overlap), reframe: str(e.reframe) };
  }
  const rec = {
    id: str(r?.id, 50) || String(Date.now()),
    createdAt: str(r?.createdAt, 40),
    date: str(r?.date, 50),
    story: str(r?.story),
    commitment: str(r?.commitment),
    entries,
  };
  // 古い記録で保存日時がなければ、IDや日付から割り出しておく（並び順に使う）
  if (!rec.createdAt) {
    const d = recordDate(rec);
    if (d && !Number.isNaN(d.getTime())) rec.createdAt = d.toISOString();
  }
  return rec;
}

// 記録にふくまれる写真の番号（Picsumの番号だけ）
export const photoIds = (rec) =>
  SCENE_KEYS.map((k) => rec.entries?.[k]?.photo?.id).filter((id) => /^\d+$/.test(id || ''));

// 新しい記録は createdAt（保存した日時）を持つ。古い記録は id（作成時刻の数字）や「2026/9/27」形式の date から割り出す
export function recordDate(rec) {
  if (rec.createdAt) return new Date(rec.createdAt);
  if (/^\d{12,}$/.test(rec.id || '')) return new Date(Number(rec.id));
  const m = (rec.date || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
}

// いつも同じ形（例：9月27日（日））で表示。今年以外なら年も付ける
export function displayDate(rec, today = new Date()) {
  const d = recordDate(rec);
  if (!d || Number.isNaN(d.getTime())) return rec.date || '';
  const year = d.getFullYear() !== today.getFullYear() ? `${d.getFullYear()}年` : '';
  return `${year}${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}

// 新しい順に並べる
export const byNewest = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');
