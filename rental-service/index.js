const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const CENTRAL_API = 'https://technocracy.brittoo.xyz';
const TOKEN = process.env.CENTRAL_API_TOKEN;

// Helper: Central API call
async function centralGet(path, params = {}) {
  const response = await axios.get(`${CENTRAL_API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    params,
  });
  return response.data;
}

// ==================== P1: Health Check ====================
app.get('/status', (req, res) => {
  res.json({ service: 'rental-service', status: 'OK' });
});

// ==================== Category Cache (P5) ====================
let cachedCategories = null;
let categoryCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getCategories() {
  if (cachedCategories && Date.now() - categoryCacheTime < CACHE_TTL) {
    return cachedCategories;
  }
  const data = await centralGet('/api/data/categories');
  cachedCategories = data.categories;
  categoryCacheTime = Date.now();
  return cachedCategories;
}

// ==================== P3 & P5: Products ====================
app.get('/rentals/products', async (req, res) => {
  try {
    const { category, page, limit, owner_id } = req.query;

    // P5: Validate category
    if (category) {
      const validCategories = await getCategories();
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category: "${category}"`,
          validCategories,
        });
      }
    }

    const data = await centralGet('/api/data/products', { category, page, limit, owner_id });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || 'Central API error' });
  }
});

app.get('/rentals/products/:id/availability', async (req, res) => {
  // P7 handled below
  try {
    const productId = parseInt(req.params.id);
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Fetch all rentals for product
    let allRentals = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await centralGet('/api/data/rentals', {
        product_id: productId,
        page,
        limit: 100,
      });
      allRentals = allRentals.concat(data.data);
      hasMore = page < data.totalPages;
      page++;
      if (page > 50) break; // Safety limit
    }

    // P7: Merge overlapping intervals
    const intervals = allRentals.map(r => ({
      start: new Date(r.rentalStart),
      end: new Date(r.rentalEnd),
    }));

    // Sort by start date
    intervals.sort((a, b) => a.start - b.start);

    // Merge overlapping
    const merged = [];
    for (const interval of intervals) {
      if (merged.length === 0 || interval.start > merged[merged.length - 1].end) {
        merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
      } else {
        merged[merged.length - 1].end = new Date(
          Math.max(merged[merged.length - 1].end.getTime(), interval.end.getTime())
        );
      }
    }

    // Filter busy periods that overlap with requested range
    const busyPeriods = merged.filter(
      m => m.start <= toDate && m.end >= fromDate
    );

    // Check availability
    let available = true;
    for (const busy of busyPeriods) {
      if (busy.start <= toDate && busy.end >= fromDate) {
        available = false;
        break;
      }
    }

    // Compute free windows within [from, to]
    const freeWindows = [];
    let cursor = new Date(fromDate);

    for (const busy of busyPeriods) {
      const busyStart = busy.start < fromDate ? fromDate : busy.start;
      const busyEnd = busy.end > toDate ? toDate : busy.end;

      if (cursor < busyStart) {
        const freeEnd = new Date(busyStart);
        freeEnd.setDate(freeEnd.getDate() - 1);
        if (cursor <= freeEnd) {
          freeWindows.push({
            start: cursor.toISOString().split('T')[0],
            end: freeEnd.toISOString().split('T')[0],
          });
        }
      }
      cursor = new Date(busyEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    if (cursor <= toDate) {
      freeWindows.push({
        start: cursor.toISOString().split('T')[0],
        end: toDate.toISOString().split('T')[0],
      });
    }

    res.json({
      productId,
      from,
      to,
      available,
      busyPeriods: busyPeriods.map(b => ({
        start: b.start.toISOString().split('T')[0],
        end: b.end.toISOString().split('T')[0],
      })),
      freeWindows,
    });
  } catch (err) {
    console.error('Availability error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

// P3: Product by ID
app.get('/rentals/products/:id', async (req, res) => {
  try {
    const data = await centralGet(`/api/data/products/${req.params.id}`);
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || 'Central API error' });
  }
});

// ==================== P8: Kth Busiest Date ====================
app.get('/rentals/kth-busiest-date', async (req, res) => {
  try {
    const { from, to, k } = req.query;

    // Validation
    const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!from || !monthRegex.test(from)) {
      return res.status(400).json({ error: 'from must be a valid YYYY-MM string' });
    }
    if (!to || !monthRegex.test(to)) {
      return res.status(400).json({ error: 'to must be a valid YYYY-MM string' });
    }

    const kInt = parseInt(k);
    if (!k || isNaN(kInt) || kInt <= 0) {
      return res.status(400).json({ error: 'k must be a positive integer' });
    }

    if (from > to) {
      return res.status(400).json({ error: 'from must not be after to' });
    }

    // Check max 12 months
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);
    const monthDiff = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
    if (monthDiff > 12) {
      return res.status(400).json({ error: 'Max range is 12 months' });
    }

    // Fetch stats for each month
    let allDateCounts = [];
    let currentYear = fromYear;
    let currentMonth = fromMonth;

    while (currentYear < toYear || (currentYear === toYear && currentMonth <= toMonth)) {
      const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      try {
        const data = await centralGet('/api/data/rentals/stats', {
          group_by: 'date',
          month: monthStr,
        });
        allDateCounts = allDateCounts.concat(data.data);
      } catch (err) {
        // If a month has no data, skip
      }

      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    if (kInt > allDateCounts.length) {
      return res.status(404).json({ error: `k=${kInt} exceeds available dates (${allDateCounts.length})` });
    }

    // BONUS: Use quickselect / min-heap for better than O(n log n)
    // Using a min-heap of size k (O(n log k))
    const minHeap = [];

    function heapPush(heap, item) {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (heap[parent].count > heap[i].count) {
          [heap[parent], heap[i]] = [heap[i], heap[parent]];
          i = parent;
        } else break;
      }
    }

    function heapPop(heap) {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        while (true) {
          let smallest = i;
          const left = 2 * i + 1;
          const right = 2 * i + 2;
          if (left < heap.length && heap[left].count < heap[smallest].count) smallest = left;
          if (right < heap.length && heap[right].count < heap[smallest].count) smallest = right;
          if (smallest !== i) {
            [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
            i = smallest;
          } else break;
        }
      }
      return top;
    }

    for (const item of allDateCounts) {
      heapPush(minHeap, item);
      if (minHeap.length > kInt) {
        heapPop(minHeap);
      }
    }

    // The top of the min-heap is the kth busiest
    const result = heapPop(minHeap);

    res.json({
      from,
      to,
      k: kInt,
      date: result.date,
      rentalCount: result.count,
    });
  } catch (err) {
    console.error('Kth busiest error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

// ==================== P9: Top Categories ====================
app.get('/rentals/users/:id/top-categories', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const kInt = parseInt(req.query.k);

    if (!req.query.k || isNaN(kInt) || kInt <= 0) {
      return res.status(400).json({ error: 'k must be a positive integer' });
    }

    // Fetch all rentals by this user
    let allRentals = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await centralGet('/api/data/rentals', {
        renter_id: userId,
        page,
        limit: 100,
      });
      allRentals = allRentals.concat(data.data);
      hasMore = page < data.totalPages;
      page++;
      if (page > 100) break;
    }

    if (allRentals.length === 0) {
      return res.json({ userId, topCategories: [] });
    }

    // Get unique product IDs
    const productIds = [...new Set(allRentals.map(r => r.productId))];

    // Batch fetch products (max 50 per call)
    const productMap = {};
    for (let i = 0; i < productIds.length; i += 50) {
      const batch = productIds.slice(i, i + 50);
      const data = await centralGet('/api/data/products/batch', {
        ids: batch.join(','),
      });
      for (const product of data.data) {
        productMap[product.id] = product;
      }
    }

    // Count categories
    const categoryCounts = {};
    for (const rental of allRentals) {
      const product = productMap[rental.productId];
      if (product) {
        const cat = product.category;
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    }

    // BONUS: Use min-heap of size k (O(n log k))
    const entries = Object.entries(categoryCounts).map(([category, rentalCount]) => ({
      category,
      rentalCount,
    }));

    const minHeap = [];

    function heapPush(heap, item) {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (heap[parent].rentalCount > heap[i].rentalCount) {
          [heap[parent], heap[i]] = [heap[i], heap[parent]];
          i = parent;
        } else break;
      }
    }

    function heapPop(heap) {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        while (true) {
          let smallest = i;
          const left = 2 * i + 1;
          const right = 2 * i + 2;
          if (left < heap.length && heap[left].rentalCount < heap[smallest].rentalCount) smallest = left;
          if (right < heap.length && heap[right].rentalCount < heap[smallest].rentalCount) smallest = right;
          if (smallest !== i) {
            [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
            i = smallest;
          } else break;
        }
      }
      return top;
    }

    for (const item of entries) {
      heapPush(minHeap, item);
      if (minHeap.length > kInt) {
        heapPop(minHeap);
      }
    }

    // Extract from heap and sort descending
    const topCategories = [];
    while (minHeap.length > 0) {
      topCategories.push(heapPop(minHeap));
    }
    topCategories.sort((a, b) => b.rentalCount - a.rentalCount);

    res.json({ userId, topCategories });
  } catch (err) {
    console.error('Top categories error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

// ==================== P10: Longest Free Streak ====================
app.get('/rentals/products/:id/free-streak', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const year = parseInt(req.query.year);

    if (!req.query.year || isNaN(year)) {
      return res.status(400).json({ error: 'year query param required' });
    }

    const yearStart = new Date(`${year}-01-01`);
    const yearEnd = new Date(`${year}-12-31`);

    // Fetch all rentals for this product
    let allRentals = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await centralGet('/api/data/rentals', {
        product_id: productId,
        page,
        limit: 100,
      });
      allRentals = allRentals.concat(data.data);
      hasMore = page < data.totalPages;
      page++;
      if (page > 50) break;
    }

    // Filter rentals that overlap with the year
    const yearRentals = allRentals.filter(r => {
      const start = new Date(r.rentalStart);
      const end = new Date(r.rentalEnd);
      return start <= yearEnd && end >= yearStart;
    });

    // No rentals = entire year free
    if (yearRentals.length === 0) {
      const days = Math.floor((yearEnd - yearStart) / (1000 * 60 * 60 * 24)) + 1;
      return res.json({
        productId,
        year,
        longestFreeStreak: {
          from: `${year}-01-01`,
          to: `${year}-12-31`,
          days,
        },
      });
    }

    // Clamp intervals to the year
    const intervals = yearRentals.map(r => ({
      start: new Date(Math.max(new Date(r.rentalStart).getTime(), yearStart.getTime())),
      end: new Date(Math.min(new Date(r.rentalEnd).getTime(), yearEnd.getTime())),
    }));

    // Sort by start
    intervals.sort((a, b) => a.start - b.start);

    // Merge overlapping
    const merged = [];
    for (const interval of intervals) {
      if (merged.length === 0 || interval.start > merged[merged.length - 1].end) {
        merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
      } else {
        merged[merged.length - 1].end = new Date(
          Math.max(merged[merged.length - 1].end.getTime(), interval.end.getTime())
        );
      }
    }

    // Find longest free gap
    let longestFrom = null;
    let longestTo = null;
    let longestDays = 0;

    // Gap before first rental
    if (merged[0].start > yearStart) {
      const gapEnd = new Date(merged[0].start);
      gapEnd.setDate(gapEnd.getDate() - 1);
      const days = Math.floor((gapEnd - yearStart) / (1000 * 60 * 60 * 24)) + 1;
      if (days > longestDays) {
        longestDays = days;
        longestFrom = yearStart.toISOString().split('T')[0];
        longestTo = gapEnd.toISOString().split('T')[0];
      }
    }

    // Gaps between rentals
    for (let i = 0; i < merged.length - 1; i++) {
      const gapStart = new Date(merged[i].end);
      gapStart.setDate(gapStart.getDate() + 1);
      const gapEnd = new Date(merged[i + 1].start);
      gapEnd.setDate(gapEnd.getDate() - 1);
      const days = Math.floor((gapEnd - gapStart) / (1000 * 60 * 60 * 24)) + 1;
      if (days > longestDays) {
        longestDays = days;
        longestFrom = gapStart.toISOString().split('T')[0];
        longestTo = gapEnd.toISOString().split('T')[0];
      }
    }

    // Gap after last rental
    if (merged[merged.length - 1].end < yearEnd) {
      const gapStart = new Date(merged[merged.length - 1].end);
      gapStart.setDate(gapStart.getDate() + 1);
      const days = Math.floor((yearEnd - gapStart) / (1000 * 60 * 60 * 24)) + 1;
      if (days > longestDays) {
        longestDays = days;
        longestFrom = gapStart.toISOString().split('T')[0];
        longestTo = yearEnd.toISOString().split('T')[0];
      }
    }

    res.json({
      productId,
      year,
      longestFreeStreak: {
        from: longestFrom,
        to: longestTo,
        days: longestDays,
      },
    });
  } catch (err) {
    console.error('Free streak error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

// ==================== P12: Merged Feed ====================
app.get('/rentals/merged-feed', async (req, res) => {
  try {
    const { productIds: productIdsStr, limit: limitStr } = req.query;

    if (!productIdsStr) {
      return res.status(400).json({ error: 'productIds query param required' });
    }

    const productIds = [...new Set(
      productIdsStr.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
    )];

    if (productIds.length < 1 || productIds.length > 10) {
      return res.status(400).json({ error: 'productIds must be 1-10 comma-separated integers' });
    }

    const limit = parseInt(limitStr) || 30;
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be 1-100' });
    }

    // Fetch rentals for each product
    const streams = await Promise.all(
      productIds.map(async (pid) => {
        try {
          const data = await centralGet('/api/data/rentals', {
            product_id: pid,
            limit: 100,
          });
          return data.data.map(r => ({
            rentalId: r.id,
            productId: r.productId,
            rentalStart: r.rentalStart,
            rentalEnd: r.rentalEnd,
          }));
        } catch {
          return [];
        }
      })
    );

    // K-way merge using divide and conquer
    function mergeTwoSorted(a, b) {
      const result = [];
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        if (new Date(a[i].rentalStart) <= new Date(b[j].rentalStart)) {
          result.push(a[i++]);
        } else {
          result.push(b[j++]);
        }
      }
      while (i < a.length) result.push(a[i++]);
      while (j < b.length) result.push(b[j++]);
      return result;
    }

    function mergeKSorted(arrays) {
      if (arrays.length === 0) return [];
      if (arrays.length === 1) return arrays[0];

      const mid = Math.floor(arrays.length / 2);
      const left = mergeKSorted(arrays.slice(0, mid));
      const right = mergeKSorted(arrays.slice(mid));
      return mergeTwoSorted(left, right);
    }

    const merged = mergeKSorted(streams);
    const feed = merged.slice(0, limit);

    res.json({ productIds, limit, feed });
  } catch (err) {
    console.error('Merged feed error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

const PORT = 8002;
app.listen(PORT, () => {
  console.log(`rental-service running on port ${PORT}`);
});