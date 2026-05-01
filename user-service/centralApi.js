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