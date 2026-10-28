import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

console.error('Đồng bộ Lark đã tạm ngắt.');
process.exit(1);

const execFileAsync = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const profile = 'cli_aa535e128479df04';
loadEnvFile(path.join(root, '.env'));
const baseToken = process.env.LARK_BASE_TOKEN;
if (!baseToken) throw new Error('Thiếu LARK_BASE_TOKEN trong file .env.');
const tableId = 'tblxQ8XstkpuUT62';
const fieldIds = { count: 'fldWZ1JLhv', score: 'fldMuuUk7h' };
const cli = '/opt/homebrew/bin/lark-cli';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const stateDir = path.join(os.homedir(), 'Library/Logs/Siris');
const statePath = path.join(stateDir, 'review-ota.json');
const supported = new Set(['agoda.com', 'traveloka.com', 'expedia.com.vn', 'expedia.com', 'trip.com', 'airbnb.com']);
const now = () => new Date().toISOString();
const localDate = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value instanceof Date ? value : new Date(value));

function mondayOf(value) {
  const date = new Date(`${localDate(value)}T12:00:00+07:00`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return localDate(date);
}

function safeError(error) {
  const detail = String(error?.stderr || error?.message || error || 'Không đọc được trạng thái đồng bộ.')
    .replaceAll(baseToken, '[đã ẩn]')
    .replace(/^Command failed:[^\n]*\n?/m, '')
    .trim();
  return (detail || 'Lark CLI không hoàn tất thao tác.').slice(0, 500);
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch { return { lastAttemptAt: null, lastSuccessAt: null, lastRunStatus: 'not-run', results: [] }; }
}

async function saveState(state) {
  await mkdir(stateDir, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await import('node:fs/promises').then(({ rename }) => rename(temporary, statePath));
}

async function listReviews() {
  const dir = await mkdtemp(path.join(root, '.review-sync-'));
  const output = path.join(dir, 'reviews.ndjson');
  try {
    await execFileAsync(cli, ['--profile', profile, 'base', '+record-list', '--base-token', baseToken, '--table-id', tableId,
      '--field-id', 'OTA', '--field-id', 'Đường dẫn', '--field-id', 'Toà nhà', '--field-id', 'Ghi chú',
      '--field-id', 'Số lượng review', '--field-id', 'Điểm review', '--as', 'user', '--format', 'ndjson', '--output', output],
    { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    const manifest = JSON.parse(await readFile(output.replace(/\.ndjson$/, '.manifest.json'), 'utf8'));
    if (manifest.has_more || manifest.query_context?.record_scope !== 'all_records') throw new Error('Bảng Review chưa được đọc đầy đủ.');
    const body = await readFile(output, 'utf8');
    const rows = body.trim() ? body.trim().split('\n').map(line => JSON.parse(line)) : [];
    if (rows.length !== manifest.records_count) throw new Error('Số bản ghi Review không khớp; đã dừng để tránh cập nhật thiếu.');
    return rows;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function directUrl(raw) {
  const text = String(raw || '').trim();
  const markdown = /^\[[^\]]+\]\((https?:\/\/[^\s)]+)\)$/.exec(text);
  const url = new URL(markdown?.[1] || text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Link không phải HTTP/HTTPS.');
  return url;
}

function platformFrom(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return [...supported].find(domain => host === domain || host.endsWith(`.${domain}`)) || '';
}

function decodeHtml(text) {
  return text.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/gi, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractRating(document, originalUrl) {
  const scripts = document.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const candidates = [];
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value.aggregateRating && typeof value.aggregateRating === 'object') {
      const rating = value.aggregateRating;
      const name = String(value.name || '');
      const url = String(value.url || '');
      const canonicalMatch = !url || url.includes(new URL(originalUrl).hostname) || url.includes(new URL(originalUrl).pathname.split('/').filter(Boolean).at(-1));
      candidates.push({
        score: toNumber(rating.ratingValue ?? rating.rating),
        count: toNumber(rating.reviewCount ?? rating.ratingCount ?? rating.ratingCountValue),
        name, canonicalMatch,
        priority: (name ? 1 : 0) + (canonicalMatch ? 2 : 0)
      });
    }
    for (const [key, item] of Object.entries(value)) if (key !== 'aggregateRating') walk(item);
  };
  for (const script of scripts) {
    const body = decodeHtml(script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim());
    try { walk(JSON.parse(body)); } catch { /* Ignore malformed or unrelated structured data. */ }
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.find(item => item.canonicalMatch && (item.count !== null || item.score !== null)) || null;
}

async function loadPage(url, userDataDir) {
  const { stdout } = await execFileAsync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', `--user-data-dir=${userDataDir}`, '--dump-dom', url], { timeout: 60000, maxBuffer: 12 * 1024 * 1024 });
  return stdout;
}

function identify(platform, url, page) {
  const host = url.hostname.toLowerCase();
  const title = decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (platform === 'agoda.com') {
    const building = url.pathname.toLowerCase();
    return title.includes('siris') && (building.includes('lune') ? title.includes('lune') : building.includes('mia') ? title.includes('mia') : true);
  }
  if (platform === 'trip.com') return page.includes(url.pathname.split('/').filter(Boolean).at(-1)) || host.endsWith('trip.com');
  if (platform === 'airbnb.com') return url.pathname.startsWith('/rooms/') && title.length > 0;
  return false;
}

function expectedProperty(row, url, page) {
  const building = String(row['Toà nhà']?.[0] || '').toLowerCase();
  const note = String(row['Ghi chú'] || '').toLowerCase();
  if (url.hostname.includes('agoda.com')) {
    const title = decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] || '').toLowerCase();
    return title.includes('siris') && (building === 'lune' ? title.includes('lune') : building === 'mia' ? title.includes('mia') : false);
  }
  if (url.hostname.includes('trip.com')) return url.pathname.includes('hotel-detail-');
  if (url.hostname.includes('airbnb.com')) return /^\/rooms\/\d+/.test(url.pathname) && (Boolean(note) || building === 'lune' || building === 'mia');
  return false;
}

function validResult(row, url, page, rating) {
  if (!rating || !expectedProperty(row, url, page) || !identify(platformFrom(url), url, page)) return false;
  if (rating.count === null && rating.score === null) return false;
  if (rating.count !== null && !Number.isInteger(rating.count)) return false;
  return true;
}

function existingNumber(value) {
  if (Array.isArray(value)) value = value[0];
  return toNumber(value);
}

async function run({ force = false, dryRun = false, retry = false } = {}) {
  const previous = await readState();
  const timestamp = now();
  const status = { ...previous, lastAttemptAt: timestamp, lastRunStatus: 'running', results: [] };
  delete status.error;
  if (!dryRun) {
    if (retry) {
      status.lastWeeklyAttemptAt = previous.lastWeeklyAttemptAt || previous.lastAttemptAt || timestamp;
      status.retryUsed = true;
    } else {
      status.lastWeeklyAttemptAt = timestamp;
      status.retryUsed = false;
    }
  }
  await saveState(status);
  const browserProfile = await mkdtemp(path.join(os.tmpdir(), 'siris-ota-chrome-'));
  try {
    const rows = await listReviews();
    const updates = {};
    for (const row of rows) {
      const ota = Array.isArray(row.OTA) ? row.OTA[0] : row.OTA;
      let url;
      try { url = directUrl(row['Đường dẫn']); }
      catch (error) { status.results.push({ recordId: row.record_id, ota, building: row['Toà nhà']?.[0] || '', room: row['Ghi chú'] || '', status: 'error', message: error.message }); continue; }
      const host = platformFrom(url);
      if (!host || !supported.has(host)) { status.results.push({ recordId: row.record_id, ota, status: 'unsupported', message: 'Nguồn OTA chưa được hỗ trợ.' }); continue; }
      const result = { recordId: row.record_id, ota, building: row['Toà nhà']?.[0] || '', room: row['Ghi chú'] || '', status: 'error', checkedAt: now() };
      try {
        const page = await loadPage(url.href, browserProfile);
        const rating = extractRating(page, url.href);
        if (!validResult(row, url, page, rating)) throw new Error(/captcha|challenge|datadome|robot/i.test(page) ? 'OTA yêu cầu kiểm tra trình duyệt; giữ nguyên số hiện tại.' : 'Không tìm thấy điểm/số review hợp lệ hoặc chưa xác minh đúng chỗ lưu trú.');
        result.score = rating.score;
        result.count = rating.count;
        result.status = 'read';
        const fields = {};
        const oldCount = existingNumber(row['Số lượng review']);
        const oldScore = existingNumber(row['Điểm review']);
        if (rating.count !== null && oldCount !== rating.count) fields[fieldIds.count] = rating.count;
        if (rating.score !== null && oldScore !== rating.score) fields[fieldIds.score] = rating.score;
        if (Object.keys(fields).length) updates[row.record_id] = fields;
      } catch (error) { result.message = error.killed ? 'Trang OTA tải quá lâu; giữ nguyên số hiện tại.' : String(error.message || 'Không đọc được OTA.').slice(0, 220); }
      status.results.push(result);
    }
    const updateCount = Object.keys(updates).length;
    if (updateCount && !dryRun) {
      const payload = JSON.stringify({ update_records: updates });
      await execFileAsync(cli, ['--profile', profile, 'base', '+record-batch-update', '--base-token', baseToken,
        '--table-id', tableId, '--json', payload, '--as', 'user', '--format', 'json'], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    }
    status.updatedRecords = dryRun ? 0 : updateCount;
    status.dryRun = dryRun;
    const changed = new Set(Object.keys(updates));
    if (!dryRun) for (const item of status.results) if (item.status === 'read') item.status = changed.has(item.recordId) ? 'updated' : 'current';
    status.lastRunStatus = dryRun ? 'dry-run' : status.results.some(item => item.status === 'error' || item.status === 'unsupported') ? 'partial' : 'success';
    if (!dryRun && status.lastRunStatus === 'success') status.lastSuccessAt = timestamp;
    status.finishedAt = now();
    await saveState(status);
    return status;
  } catch (error) {
    status.lastRunStatus = 'failed'; status.finishedAt = now(); status.error = safeError(error);
    await saveState(status);
    return status;
  } finally { await rm(browserProfile, { recursive: true, force: true }); }
}

const args = new Set(process.argv.slice(2));
const oldState = await readState();
const lastAttempt = oldState.lastAttemptAt ? Date.parse(oldState.lastAttemptAt) : 0;
const retryAfterFailure = oldState.lastRunStatus === 'partial' || oldState.lastRunStatus === 'failed';
const lastWeeklyAttempt = oldState.lastWeeklyAttemptAt || oldState.lastAttemptAt || oldState.lastSuccessAt || '';
const today = localDate(new Date());
const mondayToday = mondayOf(new Date());
const isMonday = new Date(`${today}T12:00:00+07:00`).getUTCDay() === 1;
const weeklyDue = !lastWeeklyAttempt || mondayOf(lastWeeklyAttempt) < mondayToday || (isMonday && localDate(new Date(lastWeeklyAttempt)) !== today);
const retryDue = retryAfterFailure && !oldState.retryUsed && lastAttempt > 0 && localDate(new Date(lastAttempt)) < today;
const due = weeklyDue || retryDue;
if (args.has('--status')) console.log(JSON.stringify(oldState, null, 2));
else if (!due && !args.has('--run-now') && !args.has('--dry-run')) console.log('Chưa tới lịch đồng bộ tuần; bỏ qua lần chạy này.');
else {
  const result = await run({ force: args.has('--run-now'), dryRun: args.has('--dry-run'), retry: retryDue && !weeklyDue });
  console.log(JSON.stringify({ status: result.lastRunStatus, updatedRecords: result.updatedRecords || 0, results: result.results?.map(({ recordId, ota, building, room, status, score, count, message }) => ({ recordId, ota, building, room, status, score, count, message })), error: result.error }, null, 2));
  if (result.lastRunStatus === 'failed') process.exitCode = 1;
}
