import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom'
import axios from 'axios'

const API = 'http://localhost:8000'

// ==================== AUTH ====================
function Login() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const res = await axios.post(`${API}/users/login`, form)
      localStorage.setItem('token', res.data.token)
      navigate('/products')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>🔑 Login to RentPi</h2>
        {error && <div style={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <input style={styles.input} type="email" placeholder="Email"
            value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
          <input style={styles.input} type="password" placeholder="Password"
            value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
          <button style={styles.button} type="submit">Login</button>
        </form>
        <p style={{textAlign:'center', marginTop:'1rem'}}>
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  )
}

function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const res = await axios.post(`${API}/users/register`, form)
      localStorage.setItem('token', res.data.token)
      setSuccess('Registered successfully!')
      setTimeout(() => navigate('/products'), 1000)
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed')
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>📝 Register on RentPi</h2>
        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}
        <form onSubmit={handleSubmit}>
          <input style={styles.input} placeholder="Full Name"
            value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
          <input style={styles.input} type="email" placeholder="Email"
            value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
          <input style={styles.input} type="password" placeholder="Password"
            value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
          <button style={styles.button} type="submit">Register</button>
        </form>
        <p style={{textAlign:'center', marginTop:'1rem'}}>
          Have account? <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  )
}

// ==================== PRODUCTS ====================
function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [categories, setCategories] = useState([])

  const CATEGORIES = [
    'ELECTRONICS','FURNITURE','VEHICLES','TOOLS',
    'OUTDOOR','SPORTS','MUSIC','CAMERAS','OFFICE'
  ]

  const fetchProducts = async () => {
    setLoading(true)
    setError('')
    try {
      const params = { page, limit: 12 }
      if (category) params.category = category
      const res = await axios.get(`${API}/rentals/products`, { params })
      setProducts(res.data.data || [])
      setTotalPages(res.data.totalPages || 1)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProducts() }, [page, category])

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>🛍️ Products</h2>
      <div style={{display:'flex', gap:'1rem', marginBottom:'1rem', flexWrap:'wrap'}}>
        <select style={styles.select} value={category}
          onChange={e => { setCategory(e.target.value); setPage(1) }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button style={styles.buttonSm} onClick={() => { setCategory(''); setPage(1) }}>
          Clear Filter
        </button>
      </div>

      {loading && <div style={styles.loading}>⏳ Loading products...</div>}
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.grid}>
        {products.map(p => (
          <div key={p.id} style={styles.productCard}>
            <div style={styles.badge}>{p.category}</div>
            <h3 style={{margin:'0.5rem 0', fontSize:'1rem'}}>{p.name}</h3>
            <p style={{color:'#10b981', fontWeight:'bold', fontSize:'1.1rem'}}>
              ${p.pricePerDay}/day
            </p>
            <p style={{color:'#6b7280', fontSize:'0.8rem'}}>Product #{p.id}</p>
          </div>
        ))}
      </div>

      <div style={{display:'flex', gap:'1rem', justifyContent:'center', marginTop:'1.5rem'}}>
        <button style={styles.buttonSm} onClick={() => setPage(p => Math.max(1, p-1))}
          disabled={page === 1}>← Prev</button>
        <span style={{padding:'0.5rem'}}>Page {page} of {totalPages}</span>
        <button style={styles.buttonSm} onClick={() => setPage(p => Math.min(totalPages, p+1))}
          disabled={page === totalPages}>Next →</button>
      </div>
    </div>
  )
}

// ==================== AVAILABILITY ====================
function Availability() {
  const [productId, setProductId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const checkAvailability = async () => {
    if (!productId || !from || !to) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await axios.get(`${API}/rentals/products/${productId}/availability`, {
        params: { from, to }
      })
      setResult(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check availability')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>📅 Check Availability</h2>
      <div style={styles.card}>
        <input style={styles.input} type="number" placeholder="Product ID"
          value={productId} onChange={e => setProductId(e.target.value)} />
        <input style={styles.input} type="date" placeholder="From"
          value={from} onChange={e => setFrom(e.target.value)} />
        <input style={styles.input} type="date" placeholder="To"
          value={to} onChange={e => setTo(e.target.value)} />
        <button style={styles.button} onClick={checkAvailability} disabled={loading}>
          {loading ? '⏳ Checking...' : 'Check Availability'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.card}>
          <div style={{
            padding:'1rem', borderRadius:'8px', marginBottom:'1rem',
            background: result.available ? '#d1fae5' : '#fee2e2',
            color: result.available ? '#065f46' : '#991b1b'
          }}>
            <strong>{result.available ? '✅ Available!' : '❌ Not Available'}</strong>
            <p>Product #{result.productId} | {result.from} → {result.to}</p>
          </div>

          {result.busyPeriods?.length > 0 && (
            <div>
              <h4>🔴 Busy Periods:</h4>
              {result.busyPeriods.map((b, i) => (
                <div key={i} style={{...styles.periodTag, background:'#fee2e2', color:'#991b1b'}}>
                  {b.start} → {b.end}
                </div>
              ))}
            </div>
          )}

          {result.freeWindows?.length > 0 && (
            <div style={{marginTop:'1rem'}}>
              <h4>🟢 Free Windows:</h4>
              {result.freeWindows.map((f, i) => (
                <div key={i} style={{...styles.periodTag, background:'#d1fae5', color:'#065f46'}}>
                  {f.start} → {f.end}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ==================== TRENDING ====================
function Trending() {
  const [recs, setRecs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchTrending = async () => {
    setLoading(true)
    setError('')
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await axios.get(`${API}/analytics/recommendations`, {
        params: { date: today, limit: 6 }
      })
      setRecs(res.data.recommendations || [])
    } catch (err) {
      setError('Failed to load trending products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTrending() }, [])

  return (
    <div style={styles.page}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h2 style={styles.title}>🔥 Trending Today</h2>
        <button style={styles.buttonSm} onClick={fetchTrending}>🔄 Refresh</button>
      </div>

      {loading && (
        <div style={styles.grid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{...styles.productCard, background:'#f3f4f6', animation:'pulse 1s infinite'}}>
              <div style={{height:'80px', background:'#e5e7eb', borderRadius:'4px'}}></div>
            </div>
          ))}
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {!loading && recs.length === 0 && !error && (
        <div style={styles.empty}>No trending products found for today.</div>
      )}

      <div style={styles.grid}>
        {!loading && recs.map((r, i) => (
          <div key={i} style={styles.productCard}>
            <div style={{...styles.badge, background:'#f59e0b'}}>{r.category}</div>
            <h3 style={{margin:'0.5rem 0', fontSize:'1rem'}}>{r.name}</h3>
            <p style={{color:'#6b7280', fontSize:'0.85rem'}}>Product #{r.productId}</p>
            <p style={{color:'#10b981', fontWeight:'bold'}}>🔥 Score: {r.score}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ==================== CHAT ====================
function Chat() {
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)

  const newSessionId = () => crypto.randomUUID()

  useEffect(() => { fetchSessions() }, [])

  const fetchSessions = async () => {
    try {
      const res = await axios.get(`${API}/chat/sessions`)
      setSessions(res.data.sessions || [])
    } catch {}
  }

  const loadSession = async (sessionId) => {
    try {
      const res = await axios.get(`${API}/chat/${sessionId}/history`)
      setCurrentSession(sessionId)
      setMessages(res.data.messages || [])
    } catch {}
  }

  const startNewChat = () => {
    setCurrentSession(newSessionId())
    setMessages([])
  }

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const sessionId = currentSession || newSessionId()
    if (!currentSession) setCurrentSession(sessionId)

    const userMsg = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setTyping(true)
    setLoading(true)

    try {
      const res = await axios.post(`${API}/chat`, {
        sessionId,
        message: input
      })
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }])
      fetchSessions()
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Sorry, something went wrong. Please try again.'
      }])
    } finally {
      setTyping(false)
      setLoading(false)
    }
  }

  return (
    <div style={{display:'flex', height:'calc(100vh - 80px)', gap:'1rem', padding:'1rem'}}>
      {/* Sidebar */}
      <div style={{width:'260px', background:'white', borderRadius:'12px',
        boxShadow:'0 2px 8px rgba(0,0,0,0.1)', overflow:'hidden', display:'flex', flexDirection:'column'}}>
        <div style={{padding:'1rem', borderBottom:'1px solid #e5e7eb'}}>
          <button style={{...styles.button, margin:0, width:'100%'}} onClick={startNewChat}>
            + New Chat
          </button>
        </div>
        <div style={{overflowY:'auto', flex:1}}>
          {sessions.map(s => (
            <div key={s.sessionId}
              onClick={() => loadSession(s.sessionId)}
              style={{
                padding:'0.75rem 1rem', cursor:'pointer', borderBottom:'1px solid #f3f4f6',
                background: currentSession === s.sessionId ? '#eff6ff' : 'white',
                transition:'background 0.2s'
              }}>
              <div style={{fontWeight:'500', fontSize:'0.9rem', marginBottom:'0.25rem'}}>
                {s.name || 'Chat Session'}
              </div>
              <div style={{color:'#6b7280', fontSize:'0.75rem'}}>
                {new Date(s.lastMessageAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Window */}
      <div style={{flex:1, display:'flex', flexDirection:'column', background:'white',
        borderRadius:'12px', boxShadow:'0 2px 8px rgba(0,0,0,0.1)', overflow:'hidden'}}>
        <div style={{padding:'1rem', borderBottom:'1px solid #e5e7eb', background:'#1d4ed8', color:'white'}}>
          <h3 style={{margin:0}}>🤖 RentPi Assistant</h3>
          <p style={{margin:0, fontSize:'0.8rem', opacity:0.8}}>Ask me about rentals, products, trends...</p>
        </div>

        <div style={{flex:1, overflowY:'auto', padding:'1rem', display:'flex', flexDirection:'column', gap:'0.75rem'}}>
          {messages.length === 0 && (
            <div style={{textAlign:'center', color:'#6b7280', marginTop:'3rem'}}>
              <p style={{fontSize:'2rem'}}>🤖</p>
              <p>Hi! I'm the RentPi Assistant. Ask me about products, availability, trends, or discounts!</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              display:'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'
            }}>
              <div style={{
                maxWidth:'70%', padding:'0.75rem 1rem', borderRadius:'12px',
                background: m.role === 'user' ? '#1d4ed8' : '#f3f4f6',
                color: m.role === 'user' ? 'white' : '#1f2937',
                fontSize:'0.9rem', lineHeight:'1.5'
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {typing && (
            <div style={{display:'flex', justifyContent:'flex-start'}}>
              <div style={{padding:'0.75rem 1rem', borderRadius:'12px', background:'#f3f4f6', color:'#6b7280'}}>
                ⏳ Typing...
              </div>
            </div>
          )}
        </div>

        <div style={{padding:'1rem', borderTop:'1px solid #e5e7eb', display:'flex', gap:'0.5rem'}}>
          <input
            style={{...styles.input, margin:0, flex:1}}
            placeholder="Ask about rentals, products, trends..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            disabled={loading}
          />
          <button style={{...styles.button, margin:0, width:'80px'}}
            onClick={sendMessage} disabled={loading}>
            {loading ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== SURGE CALENDAR ====================
function SurgeCalendar() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchSurge = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get(`${API}/analytics/surge-days`, { params: { month } })
      setData(res.data.data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load surge data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSurge() }, [month])

  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>📊 Surge Calendar</h2>
      <div style={{display:'flex', gap:'1rem', alignItems:'center', marginBottom:'1.5rem'}}>
        <input style={{...styles.input, margin:0, width:'200px'}} type="month"
          value={month} onChange={e => setMonth(e.target.value)} />
        <button style={styles.buttonSm} onClick={fetchSurge}>Fetch</button>
      </div>

      {loading && <div style={styles.loading}>⏳ Loading surge data...</div>}
      {error && <div style={styles.error}>{error}</div>}

      <div style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'0.5rem'}}>
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} style={{textAlign:'center', fontWeight:'bold', color:'#6b7280', padding:'0.5rem'}}>
            {d}
          </div>
        ))}
        {data.map((d, i) => {
          const intensity = d.count / maxCount
          const bg = d.count === 0 ? '#f9fafb' :
            intensity > 0.8 ? '#dc2626' :
            intensity > 0.6 ? '#f97316' :
            intensity > 0.4 ? '#fbbf24' :
            intensity > 0.2 ? '#86efac' : '#d1fae5'
          return (
            <div key={i} style={{
              background: bg, borderRadius:'8px', padding:'0.5rem',
              textAlign:'center', fontSize:'0.8rem', minHeight:'60px',
              display:'flex', flexDirection:'column', justifyContent:'center'
            }}>
              <div style={{fontWeight:'bold'}}>{d.date.split('-')[2]}</div>
              <div style={{fontSize:'0.7rem', color:'#374151'}}>{d.count}</div>
              {d.nextSurgeDate && (
                <div style={{fontSize:'0.6rem', color:'#6b7280'}}>↑{d.daysUntil}d</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ==================== NAVBAR ====================
function Navbar() {
  const token = localStorage.getItem('token')
  return (
    <nav style={styles.nav}>
      <Link to="/" style={styles.navBrand}>🏠 RentPi</Link>
      <div style={{display:'flex', gap:'1rem', alignItems:'center'}}>
        <Link to="/products" style={styles.navLink}>Products</Link>
        <Link to="/availability" style={styles.navLink}>Availability</Link>
        <Link to="/trending" style={styles.navLink}>🔥 Trending</Link>
        <Link to="/surge" style={styles.navLink}>📊 Surge</Link>
        <Link to="/chat" style={styles.navLink}>🤖 Chat</Link>
        {!token ? (
          <>
            <Link to="/login" style={styles.navLink}>Login</Link>
            <Link to="/register" style={{...styles.navLink, background:'white', color:'#1d4ed8',
              padding:'0.4rem 1rem', borderRadius:'8px', fontWeight:'600'}}>Register</Link>
          </>
        ) : (
          <button style={{...styles.navLink, background:'none', border:'none', color:'white',
            cursor:'pointer'}} onClick={() => { localStorage.removeItem('token'); window.location.href='/login' }}>
            Logout
          </button>
        )}
      </div>
    </nav>
  )
}

// ==================== STYLES ====================
const styles = {
  nav: {
    background: '#1d4ed8', color: 'white', padding: '1rem 2rem',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
  },
  navBrand: { color: 'white', textDecoration: 'none', fontWeight: 'bold', fontSize: '1.25rem' },
  navLink: { color: 'white', textDecoration: 'none', fontSize: '0.9rem' },
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#f3f4f6' },
  page: { padding: '2rem', maxWidth: '1200px', margin: '0 auto' },
  card: { background: 'white', borderRadius: '12px', padding: '2rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: '1.5rem' },
  title: { margin: '0 0 1.5rem 0', color: '#1f2937', fontSize: '1.5rem' },
  input: { width: '100%', padding: '0.75rem', marginBottom: '1rem',
    border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '1rem',
    boxSizing: 'border-box' },
  select: { padding: '0.75rem', border: '1px solid #d1d5db',
    borderRadius: '8px', fontSize: '1rem', background: 'white' },
  button: { width: '100%', padding: '0.75rem', background: '#1d4ed8',
    color: 'white', border: 'none', borderRadius: '8px',
    fontSize: '1rem', cursor: 'pointer', marginBottom: '0.5rem' },
  buttonSm: { padding: '0.5rem 1rem', background: '#1d4ed8', color: 'white',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem' },
  error: { background: '#fee2e2', color: '#991b1b', padding: '0.75rem',
    borderRadius: '8px', marginBottom: '1rem' },
  success: { background: '#d1fae5', color: '#065f46', padding: '0.75rem',
    borderRadius: '8px', marginBottom: '1rem' },
  loading: { textAlign: 'center', color: '#6b7280', padding: '2rem' },
  empty: { textAlign: 'center', color: '#6b7280', padding: '2rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' },
  productCard: { background: 'white', borderRadius: '12px', padding: '1.25rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)', transition: 'transform 0.2s',
    cursor: 'pointer' },
  badge: { display: 'inline-block', background: '#dbeafe', color: '#1d4ed8',
    padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem',
    fontWeight: '600', marginBottom: '0.5rem' },
  periodTag: { display: 'inline-block', padding: '0.3rem 0.8rem',
    borderRadius: '20px', margin: '0.25rem', fontSize: '0.85rem' }
}

// ==================== APP ====================
export default function App() {
  return (
    <Router>
      <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' }}>
        <Navbar />
        <Routes>
          <Route path="/" element={<Trending />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/products" element={<Products />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/trending" element={<Trending />} />
          <Route path="/surge" element={<SurgeCalendar />} />
          <Route path="/chat" element={<Chat />} />
        </Routes>
      </div>
    </Router>
  )
}