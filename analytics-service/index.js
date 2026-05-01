const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const CENTRAL_API = 'https://technocracy.brittoo.xyz';
const TOKEN = process.env.CENTRAL_API_TOKEN;

async function centralGet(path, params = {}) {
  const response = await axios.get(`${CENTRAL_API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    params,
  });
  return response.data;
}

// ==================== P1: Health Check ====================
app.get('/status', (req, res) => {
  res.json({ service: 'analytics-service', status: 'OK' });
});

// ==================== P11: Peak 7-Day Window ====================
app.get('/analytics/peak-window', async (req, res) => {
  try {
    const { from, to } = req.query;
    const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

    if (!from || !monthRegex.test(from)) {
      return res.status(400).json({ error: 'from must be a valid YYYY-MM string' });
    }
    if (!to || !monthRegex.test(to)) {
      return res.status(400).json({ error: 'to must be a valid YYYY-MM string' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'from must not be after to' });
    }

    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);
    const monthDiff = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
    if (monthDiff > 12) {
      return res.status(400).json({ error: 'Max range is 12 months' });
    }

    // Build date range
    const rangeStart = new Date(`${from}-01`);
    const lastMonth = new Date(toYear, toMonth, 0); // Last day of to month
    const rangeEnd = lastMonth;

    const totalDays = Math.floor((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1;
    if (totalDays < 7) {
      return res.status(400).json({ error: 'Not enough data for a 7-day window' });
    }

    // Fetch stats for each month
    const dateCountMap = {};
    let currentYear = fromYear;
    let currentMonth = fromMonth;

    while (currentYear < toYear || (currentYear === toYear && currentMonth <= toMonth)) {
      const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      try {
        const data = await centralGet('/api/data/rentals/stats', {
          group_by: 'date',
          month: monthStr,
        });
        for (const item of data.data) {
          dateCountMap[item.date] = item.count;
        }
      } catch (err) {
        // Skip months with errors
      }

      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    // Fill all dates in range with counts (missing = 0)
    const allDates = [];
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const dateStr = cursor.toISOString().split('T')[0];
      allDates.push({
        date: dateStr,
        count: dateCountMap[dateStr] || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    // Sliding window of size 7 - O(n)
    let windowSum = 0;
    for (let i = 0; i < 7; i++) {
      windowSum += allDates[i].count;
    }

    let maxSum = windowSum;
    let maxStart = 0;

    for (let i = 7; i < allDates.length; i++) {
      windowSum += allDates[i].count;
      windowSum -= allDates[i - 7].count;
      if (windowSum > maxSum) {
        maxSum = windowSum;
        maxStart = i - 6;
      }
    }

    res.json({
      from,
      to,
      peakWindow: {
        from: allDates[maxStart].date,
        to: allDates[maxStart + 6].date,
        totalRentals: maxSum,
      },
    });
  } catch (err) {
    console.error('Peak window error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

// ==================== P13: Surge Days (Monotonic Stack) ====================
app.get('/analytics/surge-days', async (req, res) => {
  try {
    const { month } = req.query;
    const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

    if (!month || !monthRegex.test(month)) {
      return res.status(400).json({ error: 'month must be a valid YYYY-MM string' });
    }

    // Fetch stats for the month
    const statsData = await centralGet('/api/data/rentals/stats', {
      group_by: 'date',
      month,
    });

    const dateCountMap = {};
    for (const item of statsData.data) {
      dateCountMap[item.date] = item.count;
    }

    // Fill all days of the month
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const allDays = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      allDays.push({
        date: dateStr,
        count: dateCountMap[dateStr] || 0,
      });
    }

    // Monotonic stack - O(n) approach
    // For each element, find the next greater element
    const result = new Array(allDays.length).fill(null);
    const stack = []; // Stack stores indices

    for (let i = 0; i < allDays.length; i++) {
      // Pop all elements from stack whose count is less than current
      while (stack.length > 0 && allDays[stack[stack.length - 1]].count < allDays[i].count) {
        const idx = stack.pop();
        result[idx] = i;
      }
      stack.push(i);
    }

    // Build response
    const data = allDays.map((day, i) => ({
      date: day.date,
      count: day.count,
      nextSurgeDate: result[i] !== null ? allDays[result[i]].date : null,
      daysUntil: result[i] !== null ? result[i] - i : null,
    }));

    res.json({ month, data });
  } catch (err) {
    console.error('Surge days error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

// ==================== P14: Seasonal Recommendations ====================
app.get('/analytics/recommendations', async (req, res) => {
  try {
    const { date, limit: limitStr } = req.query;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date || !dateRegex.test(date)) {
      return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD string' });
    }

    const limitInt = parseInt(limitStr) || 10;
    if (limitInt < 1 || limitInt > 50) {
      return res.status(400).json({ error: 'limit must be 1-50' });
    }

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    // 15-day window: 7 days before and after
    const windowStart = new Date(targetDate);
    windowStart.setDate(windowStart.getDate() - 7);
    const windowEnd = new Date(targetDate);
    windowEnd.setDate(windowEnd.getDate() + 7);

    // Past 2 years
    const years = [targetDate.getFullYear() - 1, targetDate.getFullYear() - 2];

    const productCounts = {};

    for (const year of years) {
      // Adjust window for each year
      const yearWindowStart = new Date(windowStart);
      yearWindowStart.setFullYear(year);
      const yearWindowEnd = new Date(windowEnd);
      yearWindowEnd.setFullYear(year);

      const fromStr = yearWindowStart.toISOString().split('T')[0];
      const toStr = yearWindowEnd.toISOString().split('T')[0];

      try {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const data = await centralGet('/api/data/rentals', {
            from: fromStr,
            to: toStr,
            page,
            limit: 100,
          });
          for (const rental of data.data) {
            productCounts[rental.productId] = (productCounts[rental.productId] || 0) + 1;
          }
          hasMore = page < data.totalPages;
          page++;
          if (page > 20) break; // Safety limit
        }
      } catch (err) {
        // Skip if error
      }
    }

    if (Object.keys(productCounts).length === 0) {
      return res.json({ date, recommendations: [] });
    }

    // Sort by count, take top limit
    const sorted = Object.entries(productCounts)
      .map(([id, score]) => ({ productId: parseInt(id), score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limitInt);

    // Batch fetch product details
    const ids = sorted.map(s => s.productId);
    const productMap = {};

    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      try {
        const data = await centralGet('/api/data/products/batch', {
          ids: batch.join(','),
        });
        for (const product of data.data) {
          productMap[product.id] = product;
        }
      } catch (err) {
        // Skip
      }
    }

    const recommendations = sorted.map(s => {
      const product = productMap[s.productId] || {};
      return {
        productId: s.productId,
        name: product.name || `Product #${s.productId}`,
        category: product.category || 'UNKNOWN',
        score: s.score,
      };
    });

    res.json({ date, recommendations });
  } catch (err) {
    console.error('Recommendations error:', err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || 'Internal server error',
    });
  }
});

const PORT = 8003;
app.listen(PORT, () => {
  console.log(`analytics-service running on port ${PORT}`);
});