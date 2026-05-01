const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SERVICES = {
  'user-service':      'http://user-service:8001',
  'rental-service':    'http://rental-service:8002',
  'analytics-service': 'http://analytics-service:8003',
  'agentic-service':   'http://agentic-service:8004',
};

// ==================== P1: Health Check ====================
app.get('/status', async (req, res) => {
  const downstream = {};
  await Promise.all(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const response = await axios.get(`${url}/status`, { timeout: 3000 });
        downstream[name] = response.data.status || 'OK';
      } catch (err) {
        downstream[name] = 'UNREACHABLE';
      }
    })
  );
  res.json({ service: 'api-gateway', status: 'OK', downstream });
});

// ==================== Generic Proxy Function ====================
async function proxyRequest(req, res, serviceUrl) {
  try {
    const url = `${serviceUrl}${req.path}`;
    const params = req.query;
    const data = req.body;
    const headers = {
      'Content-Type': 'application/json',
    };

    // Forward Authorization header if present
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const response = await axios({
      method: req.method,
      url,
      params,
      data: Object.keys(data).length > 0 ? data : undefined,
      headers,
      timeout: 30000,
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: 'Service error' };
    res.status(status).json(data);
  }
}

// ==================== User Service Routes ====================
app.all('/users/*', (req, res) => {
  proxyRequest(req, res, SERVICES['user-service']);
});

// ==================== Rental Service Routes ====================
app.all('/rentals/*', (req, res) => {
  proxyRequest(req, res, SERVICES['rental-service']);
});

// ==================== Analytics Service Routes ====================
app.all('/analytics/*', (req, res) => {
  proxyRequest(req, res, SERVICES['analytics-service']);
});

// ==================== Chat / Agentic Service Routes ====================
app.all('/chat/*', (req, res) => {
  proxyRequest(req, res, SERVICES['agentic-service']);
});

// Also handle /chat without trailing path
app.all('/chat', (req, res) => {
  proxyRequest(req, res, SERVICES['agentic-service']);
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`api-gateway running on port ${PORT}`);
});