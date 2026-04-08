import { Router } from 'express'
import { SchoolClass } from '../models/SchoolClass.js'
import { Student } from '../models/Student.js'
import { authRequired } from '../middleware/auth.js'
import { formatClassLabel } from '../lib/classLabel.js'

const router = Router()
router.use(authRequired)

function attachLabel(doc) {
  if (!doc) return doc
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  o.label = formatClassLabel(o)
  return o
}

function classMatchesSearch(doc, searchRaw) {
  const tokens = String(searchRaw)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  const label = formatClassLabel(doc).toLowerCase()
  const hay = `${label} ${doc.classNumber} ${String(doc.section).toLowerCase()} ${doc.batchYear}`
  return tokens.every((t) => hay.includes(t))
}

router.get('/', async (req, res) => {
  try {
    const searchRaw = String(req.query.search ?? '').trim()
    if (searchRaw.length > 120) {
      return res.status(400).json({ error: 'Search query is too long' })
    }
    const list = await SchoolClass.find().sort({ batchYear: -1, classNumber: 1, section: 1 }).lean()
    const filtered = searchRaw ? list.filter((c) => classMatchesSearch(c, searchRaw)) : list
    res.json({
      classes: filtered.map((c) => ({ ...c, label: formatClassLabel(c) })),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list classes' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { classNumber, section, batchYear } = req.body
    const num = parseInt(String(classNumber), 10)
    const year = parseInt(String(batchYear), 10)
    const sec = section != null ? String(section).trim().toUpperCase() : ''
    if (!Number.isFinite(num) || num < 1) {
      return res.status(400).json({ error: 'classNumber must be a positive integer' })
    }
    if (!/^[A-Z]{1,2}$/.test(sec)) {
      return res.status(400).json({ error: 'section must be 1–2 letters (A–Z)' })
    }
    if (!Number.isFinite(year) || year < 1990 || year > 2100) {
      return res.status(400).json({ error: 'batchYear must be a year between 1990 and 2100' })
    }
    const doc = await SchoolClass.create({
      classNumber: num,
      section: sec,
      batchYear: year,
      createdBy: req.userId,
    })
    res.status(201).json({ schoolClass: attachLabel(doc) })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A class with this number, section, and batch already exists' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to create class' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const { classNumber, section, batchYear } = req.body
    const doc = await SchoolClass.findById(req.params.id)
    if (!doc) return res.status(404).json({ error: 'Class not found' })
    if (classNumber !== undefined) {
      const num = parseInt(String(classNumber), 10)
      if (!Number.isFinite(num) || num < 1) {
        return res.status(400).json({ error: 'classNumber must be a positive integer' })
      }
      doc.classNumber = num
    }
    if (section !== undefined) {
      const sec = String(section).trim().toUpperCase()
      if (!/^[A-Z]{1,2}$/.test(sec)) {
        return res.status(400).json({ error: 'section must be 1–2 letters (A–Z)' })
      }
      doc.section = sec
    }
    if (batchYear !== undefined) {
      const year = parseInt(String(batchYear), 10)
      if (!Number.isFinite(year) || year < 1990 || year > 2100) {
        return res.status(400).json({ error: 'batchYear must be a year between 1990 and 2100' })
      }
      doc.batchYear = year
    }
    await doc.save()
    res.json({ schoolClass: attachLabel(doc) })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A class with this number, section, and batch already exists' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to update class' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const count = await Student.countDocuments({ classId: req.params.id })
    if (count > 0) {
      return res.status(409).json({ error: 'Cannot delete a class that still has students assigned' })
    }
    const doc = await SchoolClass.findByIdAndDelete(req.params.id)
    if (!doc) return res.status(404).json({ error: 'Class not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete class' })
  }
})

export default router
