import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'

const GW = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8000'

// ── Auth helpers ─────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('jwt')
const setToken = t => localStorage.setItem('jwt', t)
const clearToken = () => localStorage.removeItem('jwt')

async function apiFetch(path, opts = {}) {
  const token = getToken()
  const res = await fetch(`${GW}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  return res
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  nav: { background: '#1e293b', padding: '12px 24px', display: 'flex', gap: 20, alignItems: 'center', borderBottom: '1px solid #334155' },
  navLink: { color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500 },
  page: { maxWidth: 900, margin: '32px auto', padding: '0 16px' },
  card: { background: '#1e293b', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #334155' },
  btn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  input: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#e2e8f0', width: '100%', fontSize: 14 },
  label: { display: 'block', marginBottom: 6, fontSize: 13, color: '#94a3b8' },
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 20, color: '#f1f5f9' },
  h2: { fontSize: 18, fontWeight: 600, marginBottom: 12, color: '#f1f5f9' },
  error: { color: '#f87171', fontSize: 13, marginTop: 8 },
  badge: { display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: '#312e81', color: '#a5b4fc' },
  skeleton: { background: '#334155', borderRadius: 8, height: 80, marginBottom: 12, animation: 'pulse 1.5s infinite' },
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function Nav() {
  const nav = useNavigate()
  const logout = () => { clearToken(); nav('/login') }
  return (
    <nav style={s.nav}>
      <span style={{ color: '#6366f1', fontWeight: 800, fontSize: 18, marginRight: 12 }}>🏠 RentPi</span>
      {[['/', 'Home'], ['/products', 'Products'], ['/availability', 'Availability'],
        ['/trending', 'Trending'], ['/surge', 'Surge Calendar'], ['/chat', 'Chat']].map(([to, label]) => (
        <Link key={to} to={to} style={s.navLink}>{label}</Link>
      ))}
      <span style={{ flex: 1 }} />
      {getToken()
        ? <button onClick={logout} style={{ ...s.btn, background: '#475569', padding: '6px 14px' }}>Logout</button>
        : <Link to="/login" style={{ ...s.btn, textDecoration: 'none', padding: '6px 14px' }}>Login</Link>}
    </nav>
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = React.useState('')
  const [pass, setPass] = React.useState('')
  const [err, setErr] = React.useState('')
  const nav = useNavigate()

  const submit = async () => {
    setErr('')
    const res = await apiFetch('/users/login', { method: 'POST', body: JSON.stringify({ email, password: pass }) })
    const data = await res.json()
    if (!res.ok) return setErr(data.error || 'Login failed')
    setToken(data.token)
    nav('/')
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Sign In</h1>
      <div style={s.card}>
        <label style={s.label}>Email</label>
        <input style={{ ...s.input, marginBottom: 12 }} value={email} onChange={e => setEmail(e.target.value)} type="email" />
        <label style={s.label}>Password</label>
        <input style={{ ...s.input, marginBottom: 16 }} value={pass} onChange={e => setPass(e.target.value)} type="password" onKeyDown={e => e.key === 'Enter' && submit()} />
        <button style={s.btn} onClick={submit}>Login</button>
        {err && <div style={s.error}>{err}</div>}
        <div style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>No account? <Link to="/register" style={{ color: '#6366f1' }}>Register</Link></div>
      </div>
    </div>
  )
}

// ── Register ──────────────────────────────────────────────────────────────────
function Register() {
  const [form, setForm] = React.useState({ name: '', email: '', password: '' })
  const [err, setErr] = React.useState('')
  const nav = useNavigate()

  const submit = async () => {
    setErr('')
    const res = await apiFetch('/users/register', { method: 'POST', body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) return setErr(data.error || 'Registration failed')
    setToken(data.token)
    nav('/')
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Create Account</h1>
      <div style={s.card}>
        {['name', 'email', 'password'].map(f => (
          <div key={f} style={{ marginBottom: 12 }}>
            <label style={s.label}>{f.charAt(0).toUpperCase() + f.slice(1)}</label>
            <input style={s.input} value={form[f]} type={f === 'password' ? 'password' : 'text'}
              onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} />
          </div>
        ))}
        <button style={{ ...s.btn, marginTop: 4 }} onClick={submit}>Register</button>
        {err && <div style={s.error}>{err}</div>}
      </div>
    </div>
  )
}

// ── Products ──────────────────────────────────────────────────────────────────
function Products() {
  const [products, setProducts] = React.useState([])
  const [categories, setCategories] = React.useState([])
  const [cat, setCat] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  React.useEffect(() => {
    const load = async () => {
      setLoading(true); setErr('')
      const qs = new URLSearchParams({ page, limit: 10, ...(cat ? { category: cat } : {}) })
      const res = await apiFetch(`/rentals/products?${qs}`)
      if (!res.ok) { setErr('Failed to load products'); setLoading(false); return }
      const data = await res.json()
      setProducts(data.data || [])
      setTotal(data.total || 0)
      setLoading(false)
    }
    load()
  }, [cat, page])

  React.useEffect(() => {
    apiFetch('/rentals/products?limit=1').then(r => r.json()).then(d => {
      // fetch categories from a product sample
    })
    // Static fallback categories
    setCategories(['ELECTRONICS','FURNITURE','VEHICLES','TOOLS','OUTDOOR','SPORTS','MUSIC','CAMERAS','OFFICE'])
  }, [])

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Products</h1>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select style={{ ...s.input, width: 200 }} value={cat} onChange={e => { setCat(e.target.value); setPage(1) }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {err && <div style={s.error}>{err}</div>}
      {loading ? Array(5).fill(0).map((_, i) => <div key={i} style={s.skeleton} />) :
        products.map(p => (
          <div key={p.id} style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
                <span style={s.badge}>{p.category}</span>
              </div>
              <div style={{ color: '#6366f1', fontWeight: 700, fontSize: 18 }}>${p.pricePerDay}/day</div>
            </div>
          </div>
        ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button style={{ ...s.btn, background: page < 2 ? '#334155' : '#6366f1' }} disabled={page < 2} onClick={() => setPage(p => p - 1)}>← Prev</button>
        <span style={{ padding: '10px 16px', color: '#94a3b8', fontSize: 13 }}>Page {page} · {total.toLocaleString()} total</span>
        <button style={s.btn} onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>
    </div>
  )
}

// ── Availability ──────────────────────────────────────────────────────────────
function Availability() {
  const [pid, setPid] = React.useState('')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  const check = async () => {
    setErr(''); setResult(null); setLoading(true)
    const res = await apiFetch(`/rentals/products/${pid}/availability?from=${from}&to=${to}`)
    const data = await res.json()
    setLoading(false)
    if (!res.ok) return setErr(data.error || 'Failed to check')
    setResult(data)
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Availability Checker</h1>
      <div style={s.card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div><label style={s.label}>Product ID</label><input style={s.input} value={pid} onChange={e => setPid(e.target.value)} /></div>
          <div><label style={s.label}>From</label><input style={s.input} type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label style={s.label}>To</label><input style={s.input} type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <button style={s.btn} onClick={check} disabled={!pid || !from || !to}>Check Availability</button>
        {err && <div style={s.error}>{err}</div>}
      </div>
      {loading && <div style={s.skeleton} />}
      {result && (
        <div style={s.card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: result.available ? '#34d399' : '#f87171' }}>
            {result.available ? '✅ Available' : '❌ Not Available'}
          </div>
          {result.busyPeriods?.length > 0 && <>
            <h2 style={s.h2}>Busy Periods</h2>
            {result.busyPeriods.map((p, i) => <div key={i} style={{ ...s.card, background: '#1a1f2e', padding: 12 }}>{p.start} → {p.end}</div>)}
          </>}
          {result.freeWindows?.length > 0 && <>
            <h2 style={{ ...s.h2, marginTop: 12 }}>Free Windows</h2>
            {result.freeWindows.map((w, i) => <div key={i} style={{ ...s.card, background: '#0f2030', padding: 12, color: '#34d399' }}>{w.start} → {w.end}</div>)}
          </>}
        </div>
      )}
    </div>
  )
}

// ── Trending ──────────────────────────────────────────────────────────────────
function Trending() {
  const [recs, setRecs] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState('')

  const load = async () => {
    setLoading(true); setErr('')
    const today = new Date().toISOString().slice(0, 10)
    const res = await apiFetch(`/analytics/recommendations?date=${today}&limit=6`)
    if (!res.ok) { setErr('Failed to load recommendations'); setLoading(false); return }
    const data = await res.json()
    setRecs(data.recommendations || [])
    setLoading(false)
  }

  React.useEffect(() => { load() }, [])

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ ...s.h1, marginBottom: 0 }}>🔥 Trending Today</h1>
        <button style={s.btn} onClick={load}>↻ Refresh</button>
      </div>
      {err && <div style={{ ...s.error, fontSize: 15 }}>{err}</div>}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {Array(6).fill(0).map((_, i) => <div key={i} style={{ ...s.skeleton, height: 120 }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {recs.map((r, i) => (
            <div key={r.productId} style={{ ...s.card, textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{'🥇🥈🥉🎖️🎖️🎖️'[i]}</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{r.name}</div>
              <span style={s.badge}>{r.category}</span>
              <div style={{ marginTop: 8, color: '#6366f1', fontWeight: 700 }}>Score: {r.score}</div>
            </div>
          ))}
          {!recs.length && <div style={{ color: '#64748b', gridColumn: 'span 3', textAlign: 'center' }}>No recommendations available.</div>}
        </div>
      )}
    </div>
  )
}

// ── Surge Calendar ────────────────────────────────────────────────────────────
function SurgeCalendar() {
  const [month, setMonth] = React.useState(new Date().toISOString().slice(0, 7))
  const [data, setData] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState('')

  const load = async () => {
    setLoading(true); setErr('')
    const res = await apiFetch(`/analytics/surge-days?month=${month}`)
    if (!res.ok) { setErr('Failed to load surge data'); setLoading(false); return }
    const d = await res.json()
    setData(d.data || [])
    setLoading(false)
  }

  React.useEffect(() => { load() }, [month])

  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <div style={s.page}>
      <h1 style={s.h1}>📈 Surge Calendar</h1>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input type="month" style={{ ...s.input, width: 200 }} value={month} onChange={e => setMonth(e.target.value)} />
        <button style={s.btn} onClick={load}>Load</button>
      </div>
      {err && <div style={s.error}>{err}</div>}
      {loading ? Array(5).fill(0).map((_, i) => <div key={i} style={s.skeleton} />) :
        data.map(d => (
          <div key={d.date} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 16, padding: 12 }}>
            <div style={{ width: 100, fontSize: 13, color: '#94a3b8', flexShrink: 0 }}>{d.date}</div>
            <div style={{ flex: 1, background: '#0f172a', borderRadius: 6, height: 20, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(d.count / maxCount) * 100}%`, background: '#6366f1', borderRadius: 6 }} />
            </div>
            <div style={{ width: 60, textAlign: 'right', fontWeight: 600 }}>{d.count}</div>
            {d.nextSurgeDate && <div style={{ width: 160, fontSize: 12, color: '#34d399', flexShrink: 0 }}>↑ Next surge: {d.nextSurgeDate} (+{d.daysUntil}d)</div>}
          </div>
        ))}
    </div>
  )
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function Chat() {
  const [sessions, setSessions] = React.useState([])
  const [activeSession, setActiveSession] = React.useState(null)
  const [messages, setMessages] = React.useState([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const messagesEndRef = React.useRef(null)

  const loadSessions = async () => {
    const res = await apiFetch('/chat/sessions')
    if (res.ok) { const d = await res.json(); setSessions(d.sessions || []) }
  }

  const loadHistory = async (sid) => {
    const res = await apiFetch(`/chat/${sid}/history`)
    if (res.ok) { const d = await res.json(); setMessages(d.messages || []) }
  }

  React.useEffect(() => { loadSessions() }, [])
  React.useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const newChat = () => {
    const sid = crypto.randomUUID()
    setActiveSession(sid)
    setMessages([])
  }

  const selectSession = async (sid) => {
    setActiveSession(sid)
    await loadHistory(sid)
  }

  const send = async () => {
    if (!input.trim() || loading) return
    const sid = activeSession || crypto.randomUUID()
    if (!activeSession) setActiveSession(sid)
    const userMsg = { role: 'user', content: input, timestamp: new Date() }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)
    const res = await apiFetch('/chat', { method: 'POST', body: JSON.stringify({ sessionId: sid, message: userMsg.content }) })
    const data = await res.json()
    setMessages(m => [...m, { role: 'assistant', content: data.reply || 'Error', timestamp: new Date() }])
    setLoading(false)
    loadSessions()
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
      {/* Sidebar */}
      <div style={{ width: 260, background: '#1e293b', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 12px' }}>
          <button style={{ ...s.btn, width: '100%' }} onClick={newChat}>+ New Chat</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {sessions.map(sess => (
            <div key={sess.sessionId} onClick={() => selectSession(sess.sessionId)}
              style={{ padding: '12px 16px', cursor: 'pointer', background: activeSession === sess.sessionId ? '#334155' : 'transparent', borderBottom: '1px solid #1e293b' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#e2e8f0' }}>{sess.name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(sess.lastMessageAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!messages.length && <div style={{ color: '#475569', textAlign: 'center', marginTop: 60 }}>Ask me anything about RentPi 🏠</div>}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              <div style={{ maxWidth: '70%', padding: '12px 16px', borderRadius: 12, background: m.role === 'user' ? '#6366f1' : '#1e293b', fontSize: 14, lineHeight: 1.5 }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div style={{ display: 'flex', marginBottom: 12 }}>
            <div style={{ padding: '12px 16px', borderRadius: 12, background: '#1e293b', color: '#64748b' }}>Thinking...</div>
          </div>}
          <div ref={messagesEndRef} />
        </div>
        <div style={{ padding: 16, borderTop: '1px solid #334155', display: 'flex', gap: 8 }}>
          <input style={{ ...s.input, flex: 1 }} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()} placeholder="Ask about RentPi..." disabled={loading} />
          <button style={{ ...s.btn, flexShrink: 0 }} onClick={send} disabled={loading || !input.trim()}>Send</button>
        </div>
      </div>
    </div>
  )
}

// ── Home ──────────────────────────────────────────────────────────────────────
function Home() {
  return (
    <div style={s.page}>
      <h1 style={s.h1}>Welcome to RentPi 🏠</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[
          { to: '/products', icon: '📦', title: 'Browse Products', desc: 'Explore 500,000+ rental listings' },
          { to: '/availability', icon: '📅', title: 'Check Availability', desc: 'See if a product is free for your dates' },
          { to: '/trending', icon: '🔥', title: 'Trending Today', desc: "See what's popular right now" },
          { to: '/chat', icon: '🤖', title: 'RentPi Assistant', desc: 'AI-powered rental advisor' },
          { to: '/surge', icon: '📈', title: 'Surge Calendar', desc: 'Visualize peak rental days' },
        ].map(({ to, icon, title, desc }) => (
          <Link key={to} to={to} style={{ ...s.card, textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{title}</div>
            <div style={{ color: '#64748b', fontSize: 13 }}>{desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/"            element={<Home />} />
        <Route path="/login"       element={<Login />} />
        <Route path="/register"    element={<Register />} />
        <Route path="/products"    element={<Products />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/trending"    element={<Trending />} />
        <Route path="/surge"       element={<SurgeCalendar />} />
        <Route path="/chat"        element={<Chat />} />
        <Route path="*"            element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)