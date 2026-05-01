import express from 'express';
import mongoose from 'mongoose';
import fetch from 'node-fetch';
import { Session, Message } from './models.js';

const app = express();
app.use(express.json());

const PORT               = process.env.PORT || 8004;
const MONGO_URI          = process.env.MONGO_URI || 'mongodb://localhost:27017/rentpi_agentic';
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY || '';
const CENTRAL_API_URL    = process.env.CENTRAL_API_URL || 'https://technocracy.brittoo.xyz';
const CENTRAL_API_TOKEN  = process.env.CENTRAL_API_TOKEN || '';
const ANALYTICS_URL      = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:8003';
const RENTAL_URL         = process.env.RENTAL_SERVICE_URL || 'http://rental-service:8002';

// P1
app.get('/status', (req, res) => {
  res.json({ service: 'agentic-service', status: 'OK' });
});

// ── Topic guard ──────────────────────────────────────────────────────────────
const RENTPI_KEYWORDS = [
  'rental', 'rent', 'product', 'category', 'categories', 'price', 'discount',
  'available', 'availability', 'renter', 'owner', 'rentpi', 'booking', 'gear',
  'surge', 'peak', 'trending', 'recommend', 'busy', 'free', 'streak', 'electronics',
  'tools', 'outdoor', 'vehicle', 'furniture', 'sports', 'music',
];

function isOnTopic(msg) {
  const lower = msg.toLowerCase();
  return RENTPI_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Data grounding ───────────────────────────────────────────────────────────
async function gatherContext(message) {
  const lower = message.toLowerCase();
  const ctx = [];

  try {
    if (lower.includes('category') || lower.includes('most rent') || lower.includes('popular category')) {
      const res = await fetch(`${CENTRAL_API_URL}/api/data/rentals/stats?group_by=category`, {
        headers: { Authorization: `Bearer ${CENTRAL_API_TOKEN}` },
      });
      if (res.ok) {
        const data = await res.json();
        ctx.push(`Category rental stats: ${JSON.stringify(data.data?.slice(0, 10))}`);
      }
    }

    if (lower.includes('recommend') || lower.includes('trending')) {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`${ANALYTICS_URL}/analytics/recommendations?date=${today}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        ctx.push(`Today's recommendations: ${JSON.stringify(data.recommendations)}`);
      }
    }

    if (lower.includes('peak') || lower.includes('busiest')) {
      const now = new Date();
      const fromM = `${now.getFullYear()}-01`;
      const toM   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`${ANALYTICS_URL}/analytics/peak-window?from=${fromM}&to=${toM}`);
      if (res.ok) {
        const data = await res.json();
        ctx.push(`Peak window this year: ${JSON.stringify(data.peakWindow)}`);
      }
    }

    if (lower.includes('surge')) {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`${ANALYTICS_URL}/analytics/surge-days?month=${month}`);
      if (res.ok) {
        const data = await res.json();
        ctx.push(`Surge days this month: ${JSON.stringify(data.data?.slice(0, 7))}`);
      }
    }
  } catch (e) {
    console.error('Context gathering error:', e.message);
  }

  return ctx.join('\n\n');
}

// ── Gemini LLM call ──────────────────────────────────────────────────────────
async function callLLM(messages) {
  if (!GEMINI_API_KEY) {
    return "I'm sorry, the AI service is not configured. Please set GEMINI_API_KEY.";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = { contents, generationConfig: { maxOutputTokens: 512 } };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Gemini error:', err);
    return 'Sorry, the AI service is temporarily unavailable.';
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
}

async function generateSessionName(firstMessage) {
  try {
    const nameMessages = [{
      role: 'user',
      content: `Given this first user message: "${firstMessage}", reply with ONLY a short 3-5 word title for this conversation. No punctuation, no explanation.`,
    }];
    const name = await callLLM(nameMessages);
    return name.trim().slice(0, 60);
  } catch {
    return firstMessage.slice(0, 30);
  }
}

// P15 & P16: Chat endpoint
app.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message)
    return res.status(400).json({ error: 'sessionId and message are required' });

  // P15: Topic guard
  if (!isOnTopic(message)) {
    return res.json({
      sessionId,
      reply: "I can only help with RentPi-related questions: rentals, products, categories, availability, pricing, discounts, and trends. Please ask me something about the RentPi platform!",
    });
  }

  try {
    // P16: Load session history
    let session = await Session.findOne({ sessionId });
    const isNewSession = !session;
    if (!session) {
      session = await Session.create({ sessionId, name: 'New Chat' });
    }

    const history = await Message.find({ sessionId }).sort({ timestamp: 1 });

    // Gather data context
    const context = await gatherContext(message);

    // Build messages for LLM
    const systemPrompt = `You are RentPi Assistant, an AI helper for the RentPi rental platform. 
Only answer questions about rentals, products, categories, pricing, availability, discounts, and platform trends.
Always base your answers on the provided data. Do not invent numbers.
If data is unavailable, say so honestly.
${context ? `\n\nCurrent platform data:\n${context}` : ''}`;

    const llmMessages = [
      { role: 'user', content: systemPrompt },
      { role: 'assistant', content: 'Understood. I am RentPi Assistant, ready to help with rental platform questions.' },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const reply = await callLLM(llmMessages);

    // P16: Persist messages
    const now = new Date();
    await Message.create([
      { sessionId, role: 'user',      content: message, timestamp: now },
      { sessionId, role: 'assistant', content: reply,   timestamp: new Date(now.getTime() + 1) },
    ]);

    await Session.updateOne({ sessionId }, { lastMessageAt: now });

    // P16: Generate name for new sessions
    if (isNewSession) {
      const name = await generateSessionName(message);
      await Session.updateOne({ sessionId }, { name });
    }

    res.json({ sessionId, reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// P16: List sessions
app.get('/chat/sessions', async (req, res) => {
  try {
    const sessions = await Session.find().sort({ lastMessageAt: -1 });
    res.json({
      sessions: sessions.map(s => ({
        sessionId:     s.sessionId,
        name:          s.name,
        lastMessageAt: s.lastMessageAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// P16: Get session history
app.get('/chat/:sessionId/history', async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const messages = await Message.find({ sessionId: req.params.sessionId }).sort({ timestamp: 1 });
    res.json({
      sessionId: session.sessionId,
      name:      session.name,
      messages:  messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// P16: Delete session
app.delete('/chat/:sessionId', async (req, res) => {
  try {
    await Session.deleteOne({ sessionId: req.params.sessionId });
    await Message.deleteMany({ sessionId: req.params.sessionId });
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Connect and start
mongoose.connect(MONGO_URI).then(() => {
  console.log('Connected to MongoDB');
  app.listen(PORT, () => console.log(`agentic-service running on port ${PORT}`));
}).catch(err => {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
});