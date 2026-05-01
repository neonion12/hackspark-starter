import express from 'express';
import { centralFetch, getDailyCountsForRange } from './centralApi.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8003;

// P1: Status
app.get('/status', (req, res) => {
  res.json({ service: 'analytics-service', status: 'OK' });
});

// P11: Peak 7-day window (sliding window O(n))
app.get('/analytics/peak-window', async (req, res) => {
  const { from, to } = req.query;
  const monthRx = /^\d{4}-\d{2}$/;
  if (!from || !to || !monthRx.test(from) || !monthRx.test(to))
    return res.status(400).json({ error: 'from and to must be valid YYYY-MM strings' });
  if (from > to) return res.status(400).json({ error: 'from must not be after to' });

  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const monthCount = (ty - fy) * 12 + (tm - fm) + 1;
  if (monthCount > 12) return res.status(400).json({ error: 'Max range is 12 months' });

  try {
    const days = await getDailyCountsForRange(from, to);
    if (days.length < 7) return res.status(400).json({ error: 'Not enough data for a 7-day window' });

    // Sliding window O(n)
    let windowSum = days.slice(0, 7).reduce((s, d) => s + d.count, 0);
    let best = { sum: windowSum, start: 0 };

    for (let i = 7; i < days.length; i++) {
      windowSum += days[i].count - days[i - 7].count;
      if (windowSum > best.sum) best = { sum: windowSum, start: i - 6 };
    }

    res.json({
      from,
      to,
      peakWindow: {
        from:         days[best.start].date,
        to:           days[best.start + 6].date,
        totalRentals: best.sum,
      },
    });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P13: Surge days (next higher day) — monotonic stack O(n)
app.get('/analytics/surge-days', async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    return res.status(400).json({ error: 'month must be a valid YYYY-MM string' });

  try {
    const days = await getDailyCountsForRange(month, month);

    // Monotonic stack: O(n) - we keep indices of days still "waiting" for a higher day
    const result = days.map(d => ({ ...d, nextSurgeDate: null, daysUntil: null }));
    const stack = []; // indices waiting for a higher day

    for (let i = 0; i < result.length; i++) {
      while (stack.length && result[i].count > result[stack[stack.length - 1]].count) {
        const idx = stack.pop();
        result[idx].nextSurgeDate = result[i].date;
        result[idx].daysUntil = i - idx;
      }
      stack.push(i);
    }

    res.json({ month, data: result });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P14: Seasonal recommendations
app.get('/analytics/recommendations', async (req, res) => {
  const { date, limit } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date)))
    return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD string' });

  const lim = Number(limit || 10);
  if (!Number.isInteger(lim) || lim < 1 || lim > 50)
    return res.status(400).json({ error: 'limit must be a positive integer, max 50' });

  try {
    const center = new Date(date);
    const currentYear = center.getFullYear();

    // Build 15-day window across past 2 years
    const windows = [];
    for (let yearOffset = 1; yearOffset <= 2; yearOffset++) {
      const windowCenter = new Date(center);
      windowCenter.setFullYear(currentYear - yearOffset);
      const wFrom = new Date(windowCenter); wFrom.setDate(wFrom.getDate() - 7);
      const wTo   = new Date(windowCenter); wTo.setDate(wTo.getDate() + 7);
      windows.push({ from: wFrom, to: wTo });
    }

    // Fetch rentals in each window
    const productCounts = {};

    for (const { from, to } of windows) {
      const fromStr = from.toISOString().slice(0, 10);
      const toStr   = to.toISOString().slice(0, 10);

      let page = 1;
      while (true) {
        const apiRes = await centralFetch(`/api/data/rentals?from=${fromStr}&to=${toStr}&page=${page}&limit=100`);
        if (!apiRes.ok) break;
        const data = await apiRes.json();
        for (const r of data.data) {
          productCounts[r.productId] = (productCounts[r.productId] || 0) + 1;
        }
        if (data.data.length === 0 || data.page >= data.totalPages) break;
        page++;
      }
    }

    if (!Object.keys(productCounts).length) return res.json({ date, recommendations: [] });

    // Get top lim products by count using min-heap
    const entries = Object.entries(productCounts).map(([id, score]) => ({ productId: Number(id), score }));
    const actualK = Math.min(lim, entries.length);
    const heap = entries.slice(0, actualK);
    heapifyBy(heap, e => e.score);
    for (let i = actualK; i < entries.length; i++) {
      if (entries[i].score > heap[0].score) {
        heap[0] = entries[i];
        siftDownBy(heap, 0, e => e.score);
      }
    }
    heap.sort((a, b) => b.score - a.score);

    // Enrich with product details
    const batchIds = heap.map(e => e.productId).join(',');
    const batchRes = await centralFetch(`/api/data/products/batch?ids=${batchIds}`);
    let productMap = {};
    if (batchRes.ok) {
      const batchData = await batchRes.json();
      for (const p of batchData.data) productMap[p.id] = p;
    }

    const recommendations = heap.map(e => ({
      productId: e.productId,
      name:      productMap[e.productId]?.name || 'Unknown',
      category:  productMap[e.productId]?.category || 'Unknown',
      score:     e.score,
    }));

    res.json({ date, recommendations });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

function heapifyBy(arr, key) {
  for (let i = Math.floor(arr.length / 2) - 1; i >= 0; i--) siftDownBy(arr, i, key);
}
function siftDownBy(arr, i, key) {
  const n = arr.length;
  while (true) {
    let s = i;
    const l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && key(arr[l]) < key(arr[s])) s = l;
    if (r < n && key(arr[r]) < key(arr[s])) s = r;
    if (s === i) break;
    [arr[i], arr[s]] = [arr[s], arr[i]];
    i = s;
  }
}

app.listen(PORT, () => console.log(`analytics-service running on port ${PORT}`));