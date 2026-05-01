import fetch from 'node-fetch';

const BASE_URL = process.env.CENTRAL_API_URL || 'https://technocracy.brittoo.xyz';
const TOKEN    = process.env.CENTRAL_API_TOKEN || '';

export async function centralFetch(path, options = {}, attempt = 0) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 429 && attempt < 3) {
    const body = await res.json().catch(() => ({}));
    const base = (body.retryAfterSeconds || 10) * Math.pow(2, attempt);
    const jitter = base * (0.8 + Math.random() * 0.4);
    console.log(`[retry ${attempt + 1}/3] waiting ${Math.round(jitter)}s before retrying ${path}`);
    await new Promise(r => setTimeout(r, jitter * 1000));
    return centralFetch(path, options, attempt + 1);
  }

  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const err = new Error('Rate limit exceeded after retries');
    err.status = 503;
    err.body = {
      error: 'Central API unavailable after 3 retries',
      lastRetryAfter: body.retryAfterSeconds,
      suggestion: 'Try again in ~2 minutes',
    };
    throw err;
  }

  return res;
}

// Get all days in date range with counts (fills in zeros for missing days)
export async function getDailyCountsForRange(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);

  const monthList = [];
  for (let y = fy, m = fm; ; ) {
    monthList.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === ty && m === tm) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const dayMap = {};
  await Promise.all(monthList.map(async (month) => {
    const res = await centralFetch(`/api/data/rentals/stats?group_by=date&month=${month}`);
    if (!res.ok) return;
    const data = await res.json();
    for (const d of data.data) dayMap[d.date] = (dayMap[d.date] || 0) + d.count;
  }));

  // Fill every calendar day in range with 0 if missing
  const startDate = new Date(`${fromMonth}-01`);
  const [endY, endM] = toMonth.split('-').map(Number);
  const lastDay = new Date(endY, endM, 0); // last day of toMonth

  const days = [];
  let cur = new Date(startDate);
  while (cur <= lastDay) {
    const key = cur.toISOString().slice(0, 10);
    days.push({ date: key, count: dayMap[key] || 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}