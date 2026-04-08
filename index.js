import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import authRoutes from './routes/auth.js'
import classRoutes from './routes/classes.js'
import studentRoutes from './routes/students.js'
import taskRoutes from './routes/tasks.js'

const app = express()
const PORT = process.env.PORT || 5000
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/school_management'

if (!process.env.MONGODB_URI) {
  console.warn(
    'MONGODB_URI is not set — using local MongoDB default. For Atlas, copy server/.env.example to server/.env and set MONGODB_URI.',
  )
} else if (
  /CLUSTER\.mongodb\.net/i.test(MONGODB_URI) ||
  /\/\/USER:/i.test(MONGODB_URI) ||
  /:PASSWORD@/i.test(MONGODB_URI)
) {
  console.error(
    'MONGODB_URI still contains template text (e.g. CLUSTER or USER:PASSWORD). In Atlas: Database → Connect → Drivers → copy the full connection string into server/.env.',
  )
  process.exit(1)
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  const dbState = mongoose.connection.readyState
  const dbOk = dbState === 1
  res.json({
    ok: true,
    message: dbOk
      ? 'Server and MongoDB are connected'
      : 'Server is running (MongoDB not connected — check MONGODB_URI)',
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/classes', classRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/tasks', taskRoutes)

async function start() {
  try {
    await mongoose.connect(MONGODB_URI)
    console.log('MongoDB connected')
  } catch (err) {
    console.error('MongoDB connection failed:', err.message)
    if (String(err.message).includes('querySrv ENOTFOUND')) {
      console.error(
        'SRV DNS lookup failed — the hostname in MONGODB_URI is wrong or unreachable. Paste the exact URI from Atlas (Connect → Drivers), including your real cluster subdomain (not CLUSTER.mongodb.net).',
      )
    }
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`)
  })
}

start()
