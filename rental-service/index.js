import express from 'express';
import fetch from 'node-fetch';
import { centralFetch, getCategories, getAllRentalsForProduct, getAllRentalsForRenter, mergeIntervals } from './centralApi.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8002;

// P1: Status
app.get('/status', (req, res) => {
  res.json({ service: 'rental-service', status: 'OK' });
});

// P3 & P5: Product proxy with category validation and caching
app.get('/rentals/products', async (req, res) => {
  try {
    const { category } = req.query;

    // P5: Category validation with caching
    if (category) {
      const validCategories = await getCategories();
      if (!validCategories.includes(category.toUpperCase())) {
        return res.status(400).json({
          error: 'Invalid category',
          validCategories,
        });
      }
    }

    const qs = new URLSearchParams(req.query).toString();
    const apiRes = await centralFetch(`/api/data/products${qs ? '?' + qs : ''}`);

    if (!apiRes.ok) {
      const body = await apiRes.json().catch(() => ({}));
      return res.status(apiRes.status).json({ error: 'Central API error', details: body });
    }

    const data = await apiRes.json();
    res.json(data);
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P3: Single product proxy
app.get('/rentals/products/:id', async (req, res) => {
  try {
    const apiRes = await centralFetch(`/api/data/products/${req.params.id}`);
    if (!apiRes.ok) {
      const body = await apiRes.json().catch(() => ({}));
      return res.status(apiRes.status).json({ error: 'Central API error', details: body });
    }
    res.json(await apiRes.json());
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P7: Availability check
app.get('/rentals/products/:id/availability', async (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;

  if (!from || !to) return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });

  const fromDate = new Date(from);
  const toDate   = new Date(to);
  if (isNaN(fromDate) || isNaN(toDate)) return res.status(400).json({ error: 'Invalid date format' });
  if (fromDate > toDate) return res.status(400).json({ error: 'from must not be after to' });

  try {
    const rentals = await getAllRentalsForProduct(id);
    const raw = rentals.map(r => ({ start: r.rentalStart.slice(0, 10), end: r.rentalEnd.slice(0, 10) }));
    const busyPeriods = mergeIntervals(raw);

    // Check conflict with requested window
    const available = !busyPeriods.some(
      p => new Date(p.start) <= toDate && new Date(p.end) >= fromDate
    );

    // Compute free windows within [from, to]
    const freeWindows = [];
    let cursor = new Date(from);
    for (const busy of busyPeriods) {
      const bs = new Date(busy.start);
      const be = new Date(busy.end);
      if (be < fromDate || bs > toDate) continue;
      const winEnd = new Date(Math.min(bs - 86400000, toDate));
      if (cursor <= winEnd) {
        freeWindows.push({ start: cursor.toISOString().slice(0, 10), end: winEnd.toISOString().slice(0, 10) });
      }
      cursor = new Date(Math.max(be.getTime() + 86400000, cursor.getTime()));
    }
    if (cursor <= toDate) {
      freeWindows.push({ start: cursor.toISOString().slice(0, 10), end: to });
    }

    res.json({
      productId: Number(id),
      from,
      to,
      available,
      busyPeriods: busyPeriods.filter(p => new Date(p.start) <= toDate && new Date(p.end) >= fromDate),
      freeWindows: freeWindows.filter(w => w.start <= w.end),
    });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P8: kth-busiest-date  (optimized with min-heap / partial sort using selection)
app.get('/rentals/kth-busiest-date', async (req, res) => {
  const { from, to, k } = req.query;

  // Validation
  const monthRx = /^\d{4}-\d{2}$/;
  if (!from || !to || !monthRx.test(from) || !monthRx.test(to))
    return res.status(400).json({ error: 'from and to must be valid YYYY-MM strings' });
  if (!k || !Number.isInteger(Number(k)) || Number(k) < 1)
    return res.status(400).json({ error: 'k must be a positive integer' });
  if (from > to) return res.status(400).json({ error: 'from must not be after to' });

  // Max 12-month range
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const monthCount = (ty - fy) * 12 + (tm - fm) + 1;
  if (monthCount > 12) return res.status(400).json({ error: 'Max range is 12 months' });

  try {
    // Fetch all months' daily stats
    const monthList = [];
    for (let y = fy, m = fm; ; ) {
      monthList.push(`${y}-${String(m).padStart(2, '0')}`);
      if (y === ty && m === tm) break;
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const allDays = {}; // date -> count
    await Promise.all(monthList.map(async (month) => {
      const apiRes = await centralFetch(`/api/data/rentals/stats?group_by=date&month=${month}`);
      if (!apiRes.ok) return;
      const data = await apiRes.json();
      for (const d of data.data) allDays[d.date] = (allDays[d.date] || 0) + d.count;
    }));

    const entries = Object.entries(allDays).map(([date, count]) => ({ date, count }));
    if (entries.length < Number(k)) return res.status(404).json({ error: `k=${k} exceeds total distinct dates (${entries.length})` });

    // Optimized: use quickselect-style partial sort O(n) avg instead of full O(n log n) sort
    // We use a simple min-heap of size k to achieve O(n log k)
    const kNum = Number(k);
    const heap = entries.slice(0, kNum);
    // Build min-heap
    heapify(heap);
    for (let i = kNum; i < entries.length; i++) {
      if (entries[i].count > heap[0].count) {
        heap[0] = entries[i];
        siftDown(heap, 0);
      }
    }
    // The root of the min-heap is the kth largest
    const result = heap[0];

    res.json({ from, to, k: kNum, date: result.date, rentalCount: result.count });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Min-heap helpers
function heapify(arr) {
  for (let i = Math.floor(arr.length / 2) - 1; i >= 0; i--) siftDown(arr, i);
}
function siftDown(arr, i) {
  const n = arr.length;
  while (true) {
    let smallest = i;
    const l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && arr[l].count < arr[smallest].count) smallest = l;
    if (r < n && arr[r].count < arr[smallest].count) smallest = r;
    if (smallest === i) break;
    [arr[i], arr[smallest]] = [arr[smallest], arr[i]];
    i = smallest;
  }
}

// P9: Top categories for a renter (optimized with min-heap)
app.get('/rentals/users/:id/top-categories', async (req, res) => {
  const { id } = req.params;
  const kNum = Number(req.query.k);
  if (!req.query.k || !Number.isInteger(kNum) || kNum < 1)
    return res.status(400).json({ error: 'k must be a positive integer' });

  try {
    const rentals = await getAllRentalsForRenter(id);
    if (!rentals.length) return res.json({ userId: Number(id), topCategories: [] });

    // Batch fetch product details (max 50 per call)
    const productIds = [...new Set(rentals.map(r => r.productId))];
    const productMap = {};
    for (let i = 0; i < productIds.length; i += 50) {
      const batch = productIds.slice(i, i + 50).join(',');
      const apiRes = await centralFetch(`/api/data/products/batch?ids=${batch}`);
      if (!apiRes.ok) continue;
      const data = await apiRes.json();
      for (const p of data.data) productMap[p.id] = p;
    }

    // Tally categories
    const categoryCounts = {};
    for (const r of rentals) {
      const product = productMap[r.productId];
      if (!product) continue;
      categoryCounts[product.category] = (categoryCounts[product.category] || 0) + 1;
    }

    const entries = Object.entries(categoryCounts).map(([category, rentalCount]) => ({ category, rentalCount }));
    const actualK = Math.min(kNum, entries.length);

    // Optimized: min-heap of size k — O(n log k)
    if (entries.length === 0) return res.json({ userId: Number(id), topCategories: [] });

    const heap = entries.slice(0, actualK);
    heapifyBy(heap, e => e.rentalCount);
    for (let i = actualK; i < entries.length; i++) {
      if (entries[i].rentalCount > heap[0].rentalCount) {
        heap[0] = entries[i];
        siftDownBy(heap, 0, e => e.rentalCount);
      }
    }
    heap.sort((a, b) => b.rentalCount - a.rentalCount);

    res.json({ userId: Number(id), topCategories: heap });
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
    let smallest = i;
    const l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && key(arr[l]) < key(arr[smallest])) smallest = l;
    if (r < n && key(arr[r]) < key(arr[smallest])) smallest = r;
    if (smallest === i) break;
    [arr[i], arr[smallest]] = [arr[smallest], arr[i]];
    i = smallest;
  }
}

// P10: Longest free streak in a year
app.get('/rentals/products/:id/free-streak', async (req, res) => {
  const { id } = req.params;
  const year = Number(req.query.year);
  if (!req.query.year || isNaN(year)) return res.status(400).json({ error: 'year must be a valid integer' });

  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

  try {
    const rentals = await getAllRentalsForProduct(id);

    // Clip rentals to within the year
    const raw = rentals
      .map(r => ({
        start: r.rentalStart.slice(0, 10),
        end:   r.rentalEnd.slice(0, 10),
      }))
      .filter(r => r.start <= yearEnd && r.end >= yearStart)
      .map(r => ({
        start: r.start < yearStart ? yearStart : r.start,
        end:   r.end   > yearEnd   ? yearEnd   : r.end,
      }));

    const busyPeriods = mergeIntervals(raw);

    // Find longest free gap
    let longestFreeStreak = null;
    let cursor = new Date(yearStart);
    const yEnd = new Date(yearEnd);

    const gaps = [];
    for (const busy of busyPeriods) {
      const bs = new Date(busy.start);
      if (cursor < bs) {
        const gapEnd = new Date(bs - 86400000);
        if (cursor <= gapEnd) {
          gaps.push({ from: cursor.toISOString().slice(0, 10), to: gapEnd.toISOString().slice(0, 10) });
        }
      }
      cursor = new Date(new Date(busy.end).getTime() + 86400000);
    }
    if (cursor <= yEnd) {
      gaps.push({ from: cursor.toISOString().slice(0, 10), to: yearEnd });
    }

    if (!gaps.length) {
      // Entire year is busy
      longestFreeStreak = { from: yearStart, to: yearEnd, days: 0 };
    } else {
      longestFreeStreak = gaps.reduce((best, g) => {
        const days = Math.round((new Date(g.to) - new Date(g.from)) / 86400000) + 1;
        return days > best.days ? { ...g, days } : best;
      }, { from: '', to: '', days: 0 });
    }

    res.json({ productId: Number(id), year, longestFreeStreak });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P12: Merged feed (K-way merge using pairs)
app.get('/rentals/merged-feed', async (req, res) => {
  const { productIds, limit } = req.query;
  if (!productIds) return res.status(400).json({ error: 'productIds required (comma-separated, 1-10)' });

  const ids = [...new Set(productIds.split(',').map(s => s.trim()).filter(Boolean).map(Number))];
  if (ids.length < 1 || ids.length > 10 || ids.some(isNaN))
    return res.status(400).json({ error: 'productIds must be 1-10 comma-separated integers' });

  const lim = Number(limit || 50);
  if (!Number.isInteger(lim) || lim < 1 || lim > 100)
    return res.status(400).json({ error: 'limit must be a positive integer, max 100' });

  try {
    // Fetch all rentals for each product
    const streams = await Promise.all(ids.map(id => getAllRentalsForProduct(id)));

    // Sort each stream
    for (const s of streams) s.sort((a, b) => new Date(a.rentalStart) - new Date(b.rentalStart));

    // K-way merge using recursive pair-merge
    function mergeTwoSorted(a, b) {
      const result = [];
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        if (new Date(a[i].rentalStart) <= new Date(b[j].rentalStart)) result.push(a[i++]);
        else result.push(b[j++]);
      }
      while (i < a.length) result.push(a[i++]);
      while (j < b.length) result.push(b[j++]);
      return result;
    }

    function mergeAll(arrays) {
      if (!arrays.length) return [];
      if (arrays.length === 1) return arrays[0];
      const mid = Math.floor(arrays.length / 2);
      return mergeTwoSorted(mergeAll(arrays.slice(0, mid)), mergeAll(arrays.slice(mid)));
    }

    const merged = mergeAll(streams).slice(0, lim);

    const feed = merged.map(r => ({
      rentalId:    r.id,
      productId:   r.productId,
      rentalStart: r.rentalStart.slice(0, 10),
      rentalEnd:   r.rentalEnd.slice(0, 10),
    }));

    res.json({ productIds: ids, limit: lim, feed });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => console.log(`rental-service running on port ${PORT}`));