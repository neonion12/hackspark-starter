const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const CENTRAL_API = 'https://technocracy.brittoo.xyz';
const TOKEN = process.env.CENTRAL_API_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/rentpi';

// MongoDB connection
mongoose.connect(MONGO_URI).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err.message);
});

// MongoDB Schemas
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true, index: true },
  name: String,
  createdAt: { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  sessionId: { type: String, index: true },
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,
  timestamp: { type: Date, default: Date.now },
});

const Session = mongoose.model('Session', sessionSchema);
const Message = mongoose.model('Message', messageSchema);

// ==================== P1: Health Check ====================
app.get('/status', (req, res) => {
  res.json({ service: 'agentic-service', status: 'OK' });
});

// ==================== Topic Guard ====================
const RENTPI_KEYWORDS = [
  'rental', 'rent', 'product', 'category', 'price', 'discount',
  'available', 'availability', 'renter', 'owner', 'rentpi',
  'booking', 'gear', 'surge', 'peak', 'trending', 'recommend',
  'busy', 'free', 'streak', 'electronics', 'furniture', 'vehicles',
  'tools', 'outdoor', 'sports', 'music', 'cameras', 'office',
  'season', 'popular', 'top', 'most', 'least', 'busiest',
  'how many', 'which', 'what', 'when', 'score', 'security',
  'hello', 'hi', 'hey', 'help',
];

function isOnTopic(message) {
  const lower = message.toLowerCase();
  return RENTPI_KEYWORDS.some(kw => lower.includes(kw));
}

// ==================== LLM Call ====================
async function callGemini(prompt, history = []) {
  try {
    const contents = [];

    for (const msg of history) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents,
        systemInstruction: {
          parts: [{
            text: `You are RentPi Assistant, a helpful AI for the RentPi rental marketplace platform. 
            You answer questions about rentals, products, categories, pricing, availability, discounts, and trends.
            Always base your answers on the data provided to you. Never make up numbers or facts.
            If data is unavailable, say so honestly. Be concise and friendly.`
          }]
        }
      }
    );

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not generate a response.';
  } catch (err) {
    console.error('Gemini error:', err.response?.data || err.message);
    return 'Sorry, I encountered an error processing your request.';
  }
}

async function generateSessionName(message) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          role: 'user',
          parts: [{ text: `Given this first user message, reply with ONLY a short 3-5 word title for this conversation. No punctuation. Message: "${message}"` }],
        }],
      }
    );
    return response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'New Chat';
  } catch {
    return 'New Chat';
  }
}

// ==================== Data Grounding ====================
async function fetchGroundingData(message) {
  const lower = message.toLowerCase();
  let context = '';

  try {
    // Category stats
    if (lower.includes('category') || lower.includes('most rent') || lower.includes('popular')) {
      const data = await axios.get(`${CENTRAL_API}/api/data/rentals/stats?group_by=category`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      context += `\nCategory rental stats: ${JSON.stringify(data.data.data)}`;
    }

    // Recommendations / trending
    if (lower.includes('trending') || lower.includes('recommend') || lower.includes('season') || lower.includes('popular')) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const data = await axios.get(`http://analytics-service:8003/analytics/recommendations?date=${today}&limit=5`);
        context += `\nTrending recommendations: ${JSON.stringify(data.data.recommendations)}`;
      } catch (e) {
        // Skip
      }
    }

    // Peak / surge
    if (lower.includes('peak') || lower.includes('busiest') || lower.includes('rush')) {
      try {
        const data = await axios.get(`http://analytics-service:8003/analytics/peak-window?from=2024-01&to=2024-06`);
        context += `\nPeak window data: ${JSON.stringify(data.data.peakWindow)}`;
      } catch (e) {
        // Skip
      }
    }

    // Surge
    if (lower.includes('surge')) {
      try {
        const data = await axios.get(`http://analytics-service:8003/analytics/surge-days?month=2024-03`);
        context += `\nSurge days sample: ${JSON.stringify(data.data.data?.slice(0, 5))}`;
      } catch (e) {
        // Skip
      }
    }

    // Availability
    if (lower.includes('available') || lower.includes('availability')) {
      const idMatch = message.match(/product\s*#?\s*(\d+)/i) || message.match(/(\d+)/);
      if (idMatch) {
        try {
          const pid = idMatch[1];
          const data = await axios.get(
            `http://rental-service:8002/rentals/products/${pid}/availability?from=2024-01-01&to=2024-12-31`
          );
          context += `\nAvailability for product ${pid}: ${JSON.stringify(data.data)}`;
        } catch (e) {
          context += `\nCould not fetch availability data.`;
        }
      }
    }

    // Discount
    if (lower.includes('discount') || lower.includes('score') || lower.includes('security')) {
      const idMatch = message.match(/user\s*#?\s*(\d+)/i) || message.match(/(\d+)/);
      if (idMatch) {
        try {
          const uid = idMatch[1];
          const data = await axios.get(`http://user-service:8001/users/${uid}/discount`);
          context += `\nDiscount info for user ${uid}: ${JSON.stringify(data.data)}`;
        } catch (e) {
          context += `\nCould not fetch discount data.`;
        }
      }
    }
  } catch (err) {
    console.error('Grounding error:', err.message);
  }

  return context;
}

// ==================== P15: Chat ====================
app.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message required' });
    }

    // Topic guard
    if (!isOnTopic(message)) {
      return res.json({
        sessionId,
        reply: "I'm the RentPi Assistant and can only help with rental-related questions — products, availability, categories, pricing, discounts, and trends. Please ask me something about RentPi!",
      });
    }

    // Check if session exists
    let session = await Session.findOne({ sessionId });
    const isNewSession = !session;

    // Load history for existing sessions
    let history = [];
    if (session) {
      const messages = await Message.find({ sessionId }).sort({ timestamp: 1 });
      history = messages.map(m => ({ role: m.role, content: m.content }));
    }

    // Save user message
    await new Message({ sessionId, role: 'user', content: message }).save();

    // Fetch grounding data
    const groundingContext = await fetchGroundingData(message);

    // Build prompt with grounding
    let fullPrompt = message;
    if (groundingContext) {
      fullPrompt = `User question: ${message}\n\nHere is real data from the RentPi platform to base your answer on:\n${groundingContext}\n\nAnswer the user's question using ONLY the data provided above. Do not make up any numbers.`;
    }

    // Call LLM
    const reply = await callGemini(fullPrompt, history);

    // Save assistant message
    await new Message({ sessionId, role: 'assistant', content: reply }).save();

    // Create or update session
    if (isNewSession) {
      const name = await generateSessionName(message);
      session = new Session({
        sessionId,
        name,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      });
      await session.save();
    } else {
      session.lastMessageAt = new Date();
      await session.save();
    }

    res.json({ sessionId, reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== P16: Sessions ====================
app.get('/chat/sessions', async (req, res) => {
  try {
    const sessions = await Session.find().sort({ lastMessageAt: -1 });
    res.json({
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        name: s.name,
        lastMessageAt: s.lastMessageAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/chat/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messages = await Message.find({ sessionId }).sort({ timestamp: 1 });

    res.json({
      sessionId,
      name: session.name,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/chat/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await Session.deleteOne({ sessionId });
    await Message.deleteMany({ sessionId });
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 8004;
app.listen(PORT, () => {
  console.log(`agentic-service running on port ${PORT}`);
});