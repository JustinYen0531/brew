import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DAILY_DIR = path.join(process.cwd(), 'outputs', 'vibe-coding-daily-brew', 'daily');

function send(res, status, body) {
  res.status(status).json(body);
}

async function readEdition(date) {
  return JSON.parse(await readFile(path.join(DAILY_DIR, `${date}.json`), 'utf8'));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: '只接受 GET 請求。' });
  const requestedDate = typeof req.query?.date === 'string' ? req.query.date : '';
  if (requestedDate) {
    const date = requestedDate === 'latest' ? 'latest' : requestedDate;
    if (date !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: '日期格式必須是 YYYY-MM-DD。' });
    try { return send(res, 200, await readEdition(date)); }
    catch (error) { if (error.code === 'ENOENT') return send(res, 404, { error: '找不到這一天的手沖。' }); throw error; }
  }

  const month = typeof req.query?.month === 'string' ? req.query.month : '';
  if (month && !/^\d{4}-\d{2}$/.test(month)) return send(res, 400, { error: '月份格式必須是 YYYY-MM。' });
  let names = [];
  try { names = await readdir(DAILY_DIR); }
  catch (error) { if (error.code === 'ENOENT') return send(res, 200, { dates: [] }); throw error; }
  const dates = names
    .map(name => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter(Boolean)
    .filter(date => !month || date.startsWith(month))
    .sort((a, b) => b.localeCompare(a));
  const summaries = await Promise.all(dates.map(async date => {
    const edition = await readEdition(date);
    return { date, count: Array.isArray(edition.items) ? edition.items.length : 0, generated_at: edition.generated_at || '', mode: edition.mode || 'daily' };
  }));
  return send(res, 200, { dates: summaries });
}
