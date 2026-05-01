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

// Cache for categories
let cachedCategories = null;
let categoriesFetchedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCategories() {
  if (cachedCategories && Date.now() - categoriesFetchedAt < CACHE_TTL) {
    return cachedCategories;
  }
  const res = await centralFetch('/api/data/categories');
  const data = await res.json();
  cachedCategories = data.categories;
  categoriesFetchedAt = Date.now();
  return cachedCategories;
}

// Fetch all rentals for a product (auto-paginate)
export async function getAllRentalsForProduct(productId) {
  const rentals = [];
  let page = 1;
  while (true) {
    const res = await centralFetch(`/api/data/rentals?product_id=${productId}&page=${page}&limit=100`);
    if (!res.ok) break;
    const data = await res.json();
    rentals.push(...data.data);
    if (rentals.length >= data.total || data.data.length === 0) break;
    page++;
  }
  return rentals;
}

// Fetch all rentals for a renter (auto-paginate)
export async function getAllRentalsForRenter(renterId) {
  const rentals = [];
  let page = 1;
  while (true) {
    const res = await centralFetch(`/api/data/rentals?renter_id=${renterId}&page=${page}&limit=100`);
    if (!res.ok) break;
    const data = await res.json();
    rentals.push(...data.data);
    if (rentals.length >= data.total || data.data.length === 0) break;
    page++;
  }
  return rentals;
}

// Merge overlapping intervals - O(n log n) but merge step is O(n)
export function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => new Date(a.start) - new Date(b.start));
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (new Date(sorted[i].start) <= new Date(last.end)) {
      if (new Date(sorted[i].end) > new Date(last.end)) last.end = sorted[i].end;
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}