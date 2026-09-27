// 写真で一日をふりかえる内省アプリ（PWA・画面まわり）
// 設計方針：フレームワークなしの素のJS。状態(state)を1か所に持ち、render()で画面を丸ごと描き直すシンプル構成。
// サーバーは持たない。写真はスマホからPicsumへ直接取りにいき、記録と写真はスマホの中（IndexedDB）に保存する。

import { createPhotoSource } from './photos.js';
import { sanitizeRecord, photoIds, displayDate, byNewest } from './records.js';
import * as db from './db.js';
import { buildBackup, parseBackup, backupFileName } from './backup.js';

const source = createPhotoSource();

// ---- アイコン（絵文字の代わりに使う線画SVG。色は文字色に追従） ----
const ICON_PATHS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sunrise: '<path d="M12 3v5"/><path d="m9 5.5 3-2.5 3 2.5"/><path d="M4.9 11.9l1.4 1.4"/><path d="m17.7 13.3 1.4-1.4"/><path d="M2 18h2M20 18h2"/><path d="M16 18a4 4 0 0 0-8 0"/><path d="M2 21h20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunset: '<path d="M12 8V3"/><path d="m9 5.5 3 2.5 3-2.5"/><path d="M4.9 11.9l1.4 1.4"/><path d="m17.7 13.3 1.4-1.4"/><path d="M2 18h2M20 18h2"/><path d="M16 18a4 4 0 0 0-8 0"/><path d="M2 21h20"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6z"/><path d="M12 10c0-3 2.5-5 6.5-5 0 3.5-2.5 5-6.5 5z"/><path d="M8 21h8"/>',
  book: '<path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2z"/><path d="M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  shuffle: '<path d="M3 7h3.5c3 0 4.5 10 8 10H21"/><path d="M3 17h3.5c1.2 0 2.1-1.4 2.9-3.2M21 7h-6.5c-1.2 0-2.1 1.4-2.9 3.2"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 16V5"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M10 11v6M14 11v6"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

// ---- 場面の定義（朝・昼・夕方は夜にふりかえる前提なので過去形） ----
const SCENES = [
  {
    key: 'morning', label: '朝', icon: 'sunrise',
    lead: '並んだ写真の中から、今朝の自分にピンときた1枚を。',
  },
  {
    key: 'noon', label: '昼', icon: 'sun',
    lead: '昼はどんな時間でしたか。目に留まった1枚をどうぞ。',
  },
  {
    key: 'evening', label: '夕方', icon: 'sunset',
    lead: '夕方の自分はどれに近かったでしょう。理由はあとから考えれば大丈夫です。',
  },
];

const TOMORROW = {
  key: 'tomorrow', label: '明日', icon: 'sprout',
  lead: '最後に、明日を思わせる写真を1枚。',
};

const QUESTION = 'この写真と、あなたのどこが重なりましたか？';
const STEPS = ['intro', 'morning', 'noon', 'evening', 'review', 'tomorrow', 'summary'];
const STEP_LABELS = ['はじめに', '朝', '昼', '夕方', '今日の物語', '明日', 'きろく'];

// ---- 状態 ----
const blankEntry = () => ({ photo: null, overlap: '', reframe: '' });
let state = newState();
let lastRenderedStep = -1;  // 画面切りかえアニメーションを「ステップが変わったときだけ」出すため
let viewingHistory = null;  // 過去の記録を見ているときだけセット
let historyList = null;     // スマホの中から読んだ履歴（読み込み前は null）
let backupMsg = { text: '', error: false };
const photoUrls = new Map(); // 保存済み写真の番号 → 表示用URL
let saving = { busy: false, error: '' };
let confirmingDelete = null; // 「消しますか？」を出している記録のID
let historyError = '';

function newState() {
  return {
    step: 0,
    recordId: String(Date.now()),
    entries: { morning: blankEntry(), noon: blankEntry(), evening: blankEntry(), tomorrow: blankEntry() },
    story: '',       // 3枚をつなげた今日の物語
    commitment: '',  // 明日へのコミットメント
    search: { scene: '', photos: [], loading: false, error: '' },
    seen: new Set(),  // この日にもう見せた写真の番号（同じ写真をくり返し出さないため）
  };
}

// ---- ユーティリティ ----
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stepName = () => STEPS[state.step];
const sceneFor = (key) => (key === 'tomorrow' ? TOMORROW : SCENES.find((s) => s.key === key));

// 表示する画像：スマホに保存済みならそちらを優先（Picsumが止まっても、電波がなくても見られる）
const imgSrc = (p) => photoUrls.get(p.id) || p.thumb;

async function loadPhotoUrls(records) {
  for (const id of new Set(records.flatMap(photoIds))) {
    if (photoUrls.has(id)) continue;
    const blob = await db.getPhoto(id);
    if (blob) photoUrls.set(id, URL.createObjectURL(blob));
  }
}

async function loadHistory() {
  try {
    const records = (await db.allRecords()).sort(byNewest);
    await loadPhotoUrls(records);
    historyList = records;
  } catch (err) {
    historyList = [];
    historyError = `記録を読みこめませんでした：${err.message}`;
  }
  if (stepName() === 'intro') render();
}

// 選んだ写真をスマホの中にコピー（失敗しても記録そのものは保存する）
async function keepPhotos(rec) {
  for (const id of photoIds(rec)) {
    try {
      if (!(await db.hasPhoto(id))) await db.putPhoto(id, await source.downloadImage(id));
    } catch (err) {
      console.warn(`写真 ${id} を保存できませんでした`, err);
    }
  }
  await loadPhotoUrls([rec]);
}

// 記録を1件削除（行が縮んで消える動きと、削除を同時に進める）
// その記録にしか使っていない写真も消す。ほかの記録と共有の写真は残す
async function deleteRecord(id, row) {
  row?.classList.add('removing');
  const wait = new Promise((r) => setTimeout(r, 350));
  try {
    const target = historyList.find((r) => r.id === id);
    await db.deleteRecord(id);
    const rest = historyList.filter((r) => r.id !== id);
    const stillUsed = new Set(rest.flatMap(photoIds));
    for (const pid of photoIds(target)) {
      if (stillUsed.has(pid)) continue;
      await db.deletePhoto(pid);
      URL.revokeObjectURL(photoUrls.get(pid));
      photoUrls.delete(pid);
    }
    await wait;
    historyList = rest;
    historyError = '';
  } catch (err) {
    historyError = `消せませんでした：${err.message}`;
  }
  confirmingDelete = null;
  render();
}

// ---- 書き出し／読みこみ ----
async function exportBackup() {
  try {
    const backup = await buildBackup(historyList || [], db.getPhoto);
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = backupFileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    backupMsg = { text: `${backup.records.length}件の記録を書き出しました（ダウンロードフォルダに保存されます）`, error: false };
  } catch (err) {
    backupMsg = { text: `書き出せませんでした：${err.message}`, error: true };
  }
  render();
}

async function importBackup(file) {
  backupMsg = { text: '読みこんでいます…', error: false };
  render();
  try {
    const { records, photos } = parseBackup(await file.text());
    for (const [id, blob] of photos) if (!(await db.hasPhoto(id))) await db.putPhoto(id, blob);
    const have = new Set((historyList || []).map((r) => r.id));
    const fresh = records.filter((r) => !have.has(r.id));
    for (const rec of fresh) await db.putRecord(rec);
    backupMsg = {
      text: fresh.length ? `${fresh.length}件の記録を読みこみました` : '新しい記録はありませんでした（すでに入っている記録は飛ばします）',
      error: false,
    };
    await loadHistory();
  } catch (err) {
    backupMsg = { text: `読みこめませんでした：${err.message}`, error: true };
  }
  render();
}

async function saveRecord() {
  saving = { busy: true, error: '' };
  render();
  try {
    const saved = sanitizeRecord(currentRecord());
    await keepPhotos(saved);
    await db.putRecord(saved);
    historyList = [saved, ...(historyList || []).filter((r) => r.id !== saved.id)];
    viewingHistory = saved;
    saving = { busy: false, error: '' };
    go(state.step + 1);
  } catch (err) {
    saving = { busy: false, error: `保存できませんでした：${err.message}` };
    render();
  }
}

function go(step) {
  state.step = step;
  const name = stepName();
  if (sceneFor(name) && !state.entries[name].photo && state.search.scene !== name) {
    fetchPhotos();
  } else {
    render();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- 写真の取得（Picsumの全写真リストからランダムに選ぶ） ----
// 選んだ写真（chosen）と、この日にもう見せた写真（seen）は出さない
async function fetchPhotos() {
  const scene = stepName();
  const chosen = Object.values(state.entries).filter((e) => e.photo).map((e) => e.photo.id);
  state.search = { scene, photos: [], loading: true, error: '' };
  render();
  try {
    const photos = await source.randomPhotos({ seen: state.seen, chosen });
    photos.forEach((p) => state.seen.add(p.id));
    state.search = { scene, photos, loading: false, error: '' };
  } catch (err) {
    state.search = { scene, photos: [], loading: false, error: `写真を取得できませんでした。ネットにつながっているか確かめてください。（${err.message}）` };
  }
  if (stepName() === scene) render();
}

function selectPhoto(key, photo) {
  state.entries[key].photo = photo;
  render();
}

// ---- 描画パーツ ----
function renderChrome() {
  document.getElementById('brand').innerHTML = `${icon('camera')}<span>写真で一日をふりかえる</span>`;
  document.getElementById('progress').innerHTML = STEP_LABELS
    .map((l, i) => `<li class="${i === state.step ? 'now' : i < state.step ? 'done' : ''}"><span>${esc(l)}</span></li>`)
    .join('');
  // 場面に合わせて背景の色味を切りかえる（CSS側でゆっくり色が移り変わる）
  document.body.dataset.scene = stepName();
}

function credit(photo) {
  return `<p class="credit">Photo by <a href="${esc(photo.credit.url)}" target="_blank" rel="noopener">${esc(photo.credit.name)}</a>
    / <a href="${esc(photo.source.url)}" target="_blank" rel="noopener">${esc(photo.source.name)}</a></p>`;
}

function photoPicker() {
  const s = state.search;
  let grid;
  if (s.loading) {
    // 読み込み中はふわっと光る仮の枠を出す
    grid = `<div class="grid">${'<div class="thumb skeleton"></div>'.repeat(9)}</div>`;
  } else if (s.error) {
    grid = `<p class="error">${esc(s.error)}</p>`;
  } else if (!s.photos.length) {
    grid = '<p class="muted">写真が見つかりませんでした。もう一度ためしてみてください。</p>';
  } else {
    grid = `<div class="grid">${s.photos.map((p, i) => `
      <button class="thumb" style="--i:${i}" data-pick="${i}" aria-label="${esc(p.alt || '写真' + (i + 1))}を選ぶ">
        <img src="${esc(p.thumb)}" alt="${esc(p.alt)}" loading="lazy">
      </button>`).join('')}</div>`;
  }

  return `
    <div class="picker">
      ${grid}
      <div class="picker-foot">
        <span class="muted">ピンとくるものがなければ</span>
        <button type="button" class="soft" id="shuffle" ${s.loading ? 'disabled' : ''}>${icon('shuffle')}ほかの写真</button>
      </div>
    </div>`;
}

function sceneHead(scene) {
  return `<div class="scene-head"><span class="badge">${icon(scene.icon)}</span><h2>${esc(scene.label)}の1枚</h2></div>`;
}

function sceneView(scene, isTomorrow) {
  const e = state.entries[scene.key];
  if (!e.photo) {
    return `<section class="card">${sceneHead(scene)}<p class="lead">${esc(scene.lead)}</p>${photoPicker()}</section>`;
  }

  const questions = isTomorrow
    ? `
      <label>この写真から、どんな明日が浮かびますか？
        <textarea id="overlap" rows="4" placeholder="たとえば：扉の向こうの光は、後回しにしていた企画書。明日はその扉を開ける日。">${esc(e.overlap)}</textarea>
      </label>
      <label>明日、やると決めたこと
        <textarea id="commitment" rows="2" placeholder="たとえば：朝いちばんの30分で、企画書の骨子を書き出す">${esc(state.commitment)}</textarea>
      </label>`
    : `
      <label>${esc(QUESTION)}
        <textarea id="overlap" rows="4" placeholder="こじつけで大丈夫です。浮かんだことをそのまま。">${esc(e.overlap)}</textarea>
      </label>
      <label class="sub">前向きに言いかえるなら（書かなくても大丈夫です）
        <textarea id="reframe" rows="2" placeholder="たとえば：バタバタした → それだけ頼られていた">${esc(e.reframe)}</textarea>
      </label>`;

  const ready = (isTomorrow ? e.overlap.trim() && state.commitment.trim() : e.overlap.trim()) && !saving.busy;
  return `
    <section class="card">
      ${sceneHead(scene)}
      <figure class="chosen">
        <div class="frame"><img src="${esc(e.photo.full)}" alt="${esc(e.photo.alt)}"></div>
        <figcaption>${credit(e.photo)}</figcaption>
      </figure>
      <button class="link" id="repick">${icon('refresh')}写真を選びなおす</button>
      <div class="qa">${questions}</div>
      ${isTomorrow && saving.error ? `<p class="error">${esc(saving.error)}</p>` : ''}
      <div class="nav">
        <button class="ghost" id="back">${icon('back')}もどる</button>
        <button class="primary" id="next" ${ready ? '' : 'disabled'}>${isTomorrow ? (saving.busy ? '保存しています…' : 'きろくにまとめる') : 'つぎへ'}${icon('next')}</button>
      </div>
    </section>`;
}

function introView() {
  const history = historyList || [];
  const row = (h, i) => {
    const tail = confirmingDelete === h.id
      ? `<span class="confirm">消しますか？
          <button class="danger" data-delete-yes="${i}">消す</button>
          <button class="soft" data-delete-no>やめる</button></span>`
      : `<button class="icon-btn" data-delete="${i}" aria-label="${esc(displayDate(h))}の記録を削除" title="この記録を削除">${icon('trash')}</button>`;
    return `<li style="--i:${i}" class="${confirmingDelete === h.id ? 'asking' : ''}">
        <button class="link" data-history="${i}">${esc(displayDate(h))}</button>
        <span class="muted">${esc(h.commitment)}</span>${tail}</li>`;
  };
  const list = history.length
    ? `<h3>これまでのきろく</h3><ul class="history">${history.map(row).join('')}</ul>`
    : historyList === null ? '<p class="muted">これまでのきろくを読み込んでいます…</p>' : '';
  const err = historyError ? `<p class="error">${esc(historyError)}</p>` : '';
  return `
    <section class="card intro">
      <p class="hello">今日も、おつかれさまでした。</p>
      <h2>写真を手がかりに、一日をふりかえってみましょう。</h2>
      <ol class="howto">
        <li style="--i:0"><span class="badge">${icon('sunrise')}</span><span>朝・昼・夕方の自分に近い写真を、直感で1枚ずつ選びます。</span></li>
        <li style="--i:1"><span class="badge">${icon('leaf')}</span><span>「${esc(QUESTION)}」に答えます。こじつけで構いません。</span></li>
        <li style="--i:2"><span class="badge">${icon('book')}</span><span>3枚をつなげて、今日をひとつの物語にします。</span></li>
        <li style="--i:3"><span class="badge">${icon('sprout')}</span><span>明日の1枚を選んで、明日やることを決めます。</span></li>
      </ol>
      <div class="nav"><span></span><button class="primary" id="start">はじめる${icon('next')}</button></div>
      ${list}${err}
      <div class="backup">
        <h3>記録の保存</h3>
        <p class="muted">記録はこのスマホの中だけに保存されます。機種変更やもしものときのために、ときどき書き出しておくと安心です。</p>
        <div class="backup-actions">
          <button class="soft" id="export" ${historyList?.length ? '' : 'disabled'}>${icon('download')}書き出す</button>
          <label class="soft file">${icon('upload')}読みこむ<input type="file" id="import" accept=".json,application/json"></label>
        </div>
        ${backupMsg.text ? `<p class="${backupMsg.error ? 'error' : 'note'}">${esc(backupMsg.text)}</p>` : ''}
      </div>
    </section>`;
}

function miniCard(key, i) {
  const e = state.entries[key];
  const scene = sceneFor(key);
  return `
    <article class="mini" style="--i:${i}">
      <img src="${esc(imgSrc(e.photo))}" alt="${esc(e.photo.alt)}">
      <div>
        <h4>${icon(scene.icon)}${esc(scene.label)}</h4>
        <p>${esc(e.overlap)}</p>
        ${e.reframe ? `<p class="reframe">${esc(e.reframe)}</p>` : ''}
      </div>
    </article>`;
}

function reviewView() {
  return `
    <section class="card">
      <div class="scene-head"><span class="badge">${icon('book')}</span><h2>3枚をつなげると</h2></div>
      <p class="lead">並べてみると、どんな一日だったと言えそうですか。少し強引でも、前を向ける物語にしてみてください。</p>
      <div class="minis">${SCENES.map((s, i) => miniCard(s.key, i)).join('')}</div>
      <label>今日は、どんな物語でしたか？
        <textarea id="story" rows="4" placeholder="たとえば：霧の朝から始まって、橋を渡るように人とつながり、夕焼けでひと区切り。遠回りに見えて、ちゃんと前に進んだ一日だった。">${esc(state.story)}</textarea>
      </label>
      <div class="nav">
        <button class="ghost" id="back">${icon('back')}もどる</button>
        <button class="primary" id="next" ${state.story.trim() ? '' : 'disabled'}>明日の1枚へ${icon('next')}</button>
      </div>
    </section>`;
}

function summaryText(rec) {
  const lines = [`${displayDate(rec)} のふりかえり`, ''];
  for (const s of SCENES) {
    const e = rec.entries[s.key];
    lines.push(`【${s.label}】${e.overlap}${e.reframe ? `（${e.reframe}）` : ''}`);
  }
  lines.push('', `【今日の物語】${rec.story}`, '', `【明日】${rec.entries.tomorrow.overlap}`, `【明日やること】${rec.commitment}`);
  return lines.join('\n');
}

function summaryView(rec) {
  const photos = [...SCENES, TOMORROW].map((s, i) => {
    const p = rec.entries[s.key].photo;
    return `<figure style="--i:${i}"><div class="frame"><img src="${esc(imgSrc(p))}" alt="${esc(p.alt)}"></div>
      <figcaption>${icon(s.icon)}${esc(s.label)}</figcaption>${credit(p)}</figure>`;
  }).join('');
  return `
    <section class="card summary">
      <p class="hello">${esc(displayDate(rec))}</p>
      <h2>今日の物語</h2>
      <div class="strip">${photos}</div>
      <div class="story">
        <p>${esc(rec.story)}</p>
        <h3>${icon('sprout')}そして明日へ</h3>
        <p>${esc(rec.entries.tomorrow.overlap)}</p>
        <p class="commit">${icon('check')}<span>明日やること<strong>${esc(rec.commitment)}</strong></span></p>
      </div>
      <div class="nav">
        <button class="ghost" id="copy">${icon('copy')}テキストをコピー</button>
        <button class="primary" id="restart">トップにもどる</button>
      </div>
    </section>`;
}

// ---- メイン描画 ----
function render() {
  renderChrome();
  const name = stepName();
  let html;
  if (name === 'intro') html = introView();
  else if (name === 'review') html = reviewView();
  else if (name === 'summary') html = summaryView(viewingHistory || currentRecord());
  else html = sceneView(sceneFor(name), name === 'tomorrow');

  // ステップが変わったときだけ「ふわっと入ってくる」動きを付ける
  const entering = state.step !== lastRenderedStep;
  lastRenderedStep = state.step;
  $app.innerHTML = `<div class="view ${entering ? 'enter' : ''}">${html}</div>`;
  bind();
}

function currentRecord() {
  const rec = {
    id: state.recordId,
    createdAt: new Date().toISOString(),
    entries: state.entries,
    story: state.story,
    commitment: state.commitment,
  };
  // 履歴ファイルを直接開いたときにも読めるよう、表示用の日付も残しておく
  return { ...rec, date: displayDate(rec) };
}

// ---- イベント登録 ----
function bind() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  const name = stepName();
  const entry = state.entries[name];

  on('start', 'click', () => { viewingHistory = null; confirmingDelete = null; state = newState(); go(1); });
  on('back', 'click', () => go(state.step - 1));
  on('next', 'click', () => (name === 'tomorrow' ? saveRecord() : go(state.step + 1)));
  on('restart', 'click', () => { viewingHistory = null; backupMsg = { text: '', error: false }; saving = { busy: false, error: '' }; state = newState(); render(); });
  on('copy', 'click', async (ev) => {
    const btn = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(summaryText(viewingHistory || currentRecord()));
      btn.lastChild.textContent = 'コピーしました';
    } catch { btn.lastChild.textContent = 'コピーできませんでした'; }
  });
  // 選びなおし：さっき並んでいた写真に戻る（別の場面で取った写真なら取りなおす）
  on('repick', 'click', () => {
    entry.photo = null;
    state.search.scene === name ? render() : fetchPhotos();
  });
  on('shuffle', 'click', () => fetchPhotos());

  // 入力欄：再描画すると入力中のカーソルが飛ぶので、値だけ保存してボタンの活性だけ更新する
  const syncNext = () => {
    const btn = document.getElementById('next');
    if (!btn) return;
    const ok = name === 'review' ? state.story.trim()
      : name === 'tomorrow' ? entry.overlap.trim() && state.commitment.trim()
      : entry?.overlap.trim();
    btn.disabled = !ok;
  };
  on('overlap', 'input', (ev) => { entry.overlap = ev.target.value; syncNext(); });
  on('reframe', 'input', (ev) => { entry.reframe = ev.target.value; });
  on('commitment', 'input', (ev) => { state.commitment = ev.target.value; syncNext(); });
  on('story', 'input', (ev) => { state.story = ev.target.value; syncNext(); });

  $app.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => selectPhoto(name, state.search.photos[b.dataset.pick])));
  on('export', 'click', () => exportBackup());
  on('import', 'change', (ev) => { const f = ev.target.files?.[0]; if (f) importBackup(f); });
  $app.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => {
    confirmingDelete = historyList[b.dataset.delete].id;
    render();
    $app.querySelector('[data-delete-no]')?.focus();
  }));
  $app.querySelectorAll('[data-delete-yes]').forEach((b) => b.addEventListener('click', () => {
    b.disabled = true;
    deleteRecord(historyList[b.dataset.deleteYes].id, b.closest('li'));
  }));
  $app.querySelectorAll('[data-delete-no]').forEach((b) => b.addEventListener('click', () => {
    confirmingDelete = null;
    render();
  }));
  $app.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => {
    viewingHistory = historyList[b.dataset.history];
    state.step = STEPS.indexOf('summary');
    render();
  }));
  // 画像は読み込み終わってからふわっと表示する
  $app.querySelectorAll('img').forEach((img) => {
    if (img.complete) img.classList.add('loaded');
    else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  });
}

render();
loadHistory();
db.askPersistentStorage();

// 電波がなくても開けるように、Service Worker を登録する
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn(err)));
}
