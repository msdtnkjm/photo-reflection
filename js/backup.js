// 記録の書き出し／読みこみ
// 記録と写真を1つのJSONファイルにまとめる。機種変更やもしものときの備え、PCからの引っ越しに使う
// ファイルの形：{ app, version, exportedAt, records: [...], photos: { 番号: "data:image/jpeg;base64,..." } }

import { sanitizeRecord, photoIds } from './records.js';

export const BACKUP_APP = 'photo-reflection';
export const BACKUP_VERSION = 1;
const MAX_RECORDS = 5000;

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  // 一度に大量の引数を渡すと落ちるので、少しずつ文字列にする
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

export function dataUrlToBlob(s) {
  const m = typeof s === 'string' && s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// getPhotoBlob(番号) → Blob または null
export async function buildBackup(records, getPhotoBlob, now = new Date()) {
  const photos = {};
  for (const id of new Set(records.flatMap(photoIds))) {
    const blob = await getPhotoBlob(id);
    if (blob) photos[id] = await blobToDataUrl(blob);
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), records, photos };
}

export function parseBackup(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { data = null; }
  if (data?.app !== BACKUP_APP || !Array.isArray(data.records)) {
    throw new Error('このアプリで書き出したファイルではないようです');
  }
  const records = data.records.slice(0, MAX_RECORDS).map(sanitizeRecord);
  const photos = new Map();
  for (const [id, dataUrl] of Object.entries(data.photos || {})) {
    if (!/^\d+$/.test(id)) continue;
    const blob = dataUrlToBlob(dataUrl);
    if (blob) photos.set(id, blob);
  }
  return { records, photos };
}

export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `photo-reflection-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`;
}
