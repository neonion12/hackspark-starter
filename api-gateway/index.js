import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;
const USER_SERVICE_URL    = process.env.USER_SERVICE_URL    || 'http://localhost:8001';
const RENTAL_SERVICE_URL  = process.env.RENTAL_SERVICE_URL  || 'http://localhost:8002';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:8003';
const AGENTIC_SERVICE_URL = process.env.AGENTIC_SERVICE_URL || 'http://localhost:8004';

// P1: Health check - aggregate all downstream services
app.get('/status', async (req, res) => {
  const services = {
    'user-service':      USER_SERVICE_URL,
    'rental-service':    RENTAL_SERVICE_URL,
    'analytics-service': ANALYTICS_SERVICE_URL,
    'agentic-service':   AGENTIC_SERVICE_URL,
  };

  const results = await Promise.allSettled(
    Object.entries(services).map(async ([name, url]) => {
      const r = await fetch(`${url}/status`, { signal: AbortSignal.timeout(3000) });
      const body = await r.json();
      return [name, body.status || 'OK'];
    })
  );

  const downstream = {};
  let idx = 0;
  for (const [name] of Object.entries(services)) {
    const result = results[idx++];
    downstream[name] = result.status === 'fulfilled' ? result.value[1] : 'UNREACHABLE';
  }

  res.json({ service: 'api-gateway', status: 'OK', downstream });
});

// Proxy middleware factory
function proxy(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    on: {
      error: (err, req, res) => {
        res.status(502).json({ error: 'Service unavailable', details: err.message });
      }
    }
  });
}

// Route to user-service
app.use('/users', proxy(USER_SERVICE_URL));

// Route to rental-service
app.use('/rentals', proxy(RENTAL_SERVICE_URL));

// Route to analytics-service
app.use('/analytics', proxy(ANALYTICS_SERVICE_URL));

// Route to agentic-service
app.use('/chat', proxy(AGENTIC_SERVICE_URL));

app.listen(PORT, () => {
  console.log(`api-gateway running on port ${PORT}`);
});