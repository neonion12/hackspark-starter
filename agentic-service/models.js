import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  sessionId:     { type: String, unique: true, index: true },
  name:          { type: String, default: 'New Chat' },
  createdAt:     { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  sessionId: { type: String, index: true },
  role:      { type: String, enum: ['user', 'assistant'] },
  content:   String,
  timestamp: { type: Date, default: Date.now },
});

export const Session = mongoose.model('Session', sessionSchema);
export const Message = mongoose.model('Message', messageSchema);