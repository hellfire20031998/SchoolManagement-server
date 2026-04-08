import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { authRequired, JWT_SECRET } from '../middleware/auth.js'

const router = Router()

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }
    const existing = await User.findOne({ email: String(email).toLowerCase() })
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await User.create({
      email: String(email).toLowerCase(),
      passwordHash,
      name: name ? String(name) : '',
      role: 'admin',
    })
    const token = jwt.sign({ sub: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    res.status(201).json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Registration failed' })
  }
})

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }
    const user = await User.findOne({ email: String(email).toLowerCase() })
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    user.lastLoginAt = new Date()
    await user.save()
    const token = jwt.sign({ sub: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    res.json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Login failed' })
  }
})

router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('email name role isActive')
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found' })
    }
    res.json({
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

export default router
