import { Router } from 'express'
import mongoose from 'mongoose'
import { Student } from '../models/Student.js'
import { SchoolClass } from '../models/SchoolClass.js'
import { Task } from '../models/Task.js'
import { authRequired } from '../middleware/auth.js'
import { formatClassLabel } from '../lib/classLabel.js'

const router = Router()
router.use(authRequired)

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 10

function parsePagination(query) {
  const page = Math.max(1, parseInt(String(query.page), 10) || 1)
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(String(query.limit), 10) || DEFAULT_PAGE_SIZE),
  )
  return { page, limit, skip: (page - 1) * limit }
}

function mapStudentLean(s) {
  if (!s) return s
  const classId = s.classId
  const classLabel = formatClassLabel(classId)
  return { ...s, classLabel }
}

/** Lightweight list for dropdowns (assign task). Must be registered before /:id */
router.get('/minimal', async (_req, res) => {
  try {
    const students = await Student.find()
      .select('_id fullName classId isActive')
      .populate('classId', 'classNumber section batchYear')
      .sort({ fullName: 1 })
      .lean()
    res.json({ students: students.map(mapStudentLean) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list students' })
  }
})

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

router.get('/', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query)
    const searchRaw = String(req.query.search || '').trim()
    if (searchRaw.length > 200) {
      return res.status(400).json({ error: 'Search query is too long' })
    }
    const classIdParam = req.query.classId
    const hasSearch = Boolean(searchRaw)
    const classFilter =
      classIdParam && mongoose.isValidObjectId(String(classIdParam))
        ? new mongoose.Types.ObjectId(String(classIdParam))
        : null

    if (!hasSearch) {
      const filter = {}
      if (classFilter) filter.classId = classFilter
      const [students, total] = await Promise.all([
        Student.find(filter)
          .populate('classId', 'classNumber section batchYear')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Student.countDocuments(filter),
      ])
      const totalPages = Math.max(1, Math.ceil(total / limit))
      return res.json({
        students: students.map(mapStudentLean),
        pagination: { page, limit, total, totalPages },
      })
    }

    const tokens = searchRaw.split(/\s+/).filter(Boolean)
    const classCollection = SchoolClass.collection.name
    const pipeline = []
    const initialMatch = {}
    if (classFilter) initialMatch.classId = classFilter
    if (Object.keys(initialMatch).length) pipeline.push({ $match: initialMatch })

    pipeline.push(
      { $lookup: { from: classCollection, localField: 'classId', foreignField: '_id', as: 'c' } },
      { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          __hay: {
            $toLower: {
              $concat: [
                { $ifNull: ['$fullName', ''] },
                ' ',
                { $toString: { $ifNull: ['$rollNumber', ''] } },
                ' ',
                { $ifNull: [{ $toString: '$c.classNumber' }, ''] },
                ' ',
                { $toLower: { $ifNull: ['$c.section', ''] } },
                ' ',
                { $ifNull: [{ $toString: '$c.batchYear' }, ''] },
              ],
            },
          },
        },
      },
      {
        $match: {
          $and: tokens.map((t) => ({
            __hay: { $regex: escapeRegex(t), $options: 'i' },
          })),
        },
      },
    )

    const [countAgg] = await Student.aggregate([...pipeline, { $count: 'total' }])
    const total = countAgg?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / limit))

    const students = await Student.aggregate([
      ...pipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $addFields: { classId: '$c' } },
      { $project: { c: 0, __hay: 0 } },
    ])

    res.json({
      students: students.map(mapStudentLean),
      pagination: { page, limit, total, totalPages },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list students' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { fullName, classId, rollNumber, email, phone, dateOfBirth } = req.body
    if (!fullName || !classId) {
      return res.status(400).json({ error: 'fullName and classId are required' })
    }
    if (!mongoose.isValidObjectId(classId)) {
      return res.status(400).json({ error: 'Invalid classId' })
    }
    const cls = await SchoolClass.findById(classId)
    if (!cls) return res.status(404).json({ error: 'Class not found' })
    const student = await Student.create({
      fullName: String(fullName).trim(),
      classId,
      rollNumber:
        rollNumber != null && String(rollNumber).trim() !== ''
          ? String(rollNumber).trim()
          : null,
      email: email ? String(email).trim() : undefined,
      phone: phone ? String(phone).trim() : undefined,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      createdBy: req.userId,
    })
    const populated = await Student.findById(student._id)
      .populate('classId', 'classNumber section batchYear')
      .lean()
    res.status(201).json({ student: mapStudentLean(populated) })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate key — this record conflicts with existing data' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to create student' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate('classId', 'classNumber section batchYear')
      .lean()
    if (!student) return res.status(404).json({ error: 'Student not found' })
    res.json({ student: mapStudentLean(student) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load student' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const { fullName, classId, rollNumber, email, phone, dateOfBirth, isActive } = req.body
    const student = await Student.findById(req.params.id)
    if (!student) return res.status(404).json({ error: 'Student not found' })
    if (fullName !== undefined) student.fullName = String(fullName).trim()
    if (classId !== undefined) {
      if (!mongoose.isValidObjectId(classId)) {
        return res.status(400).json({ error: 'Invalid classId' })
      }
      const cls = await SchoolClass.findById(classId)
      if (!cls) return res.status(404).json({ error: 'Class not found' })
      student.classId = classId
    }
    if (rollNumber !== undefined) {
      student.rollNumber =
        rollNumber != null && String(rollNumber).trim() !== ''
          ? String(rollNumber).trim()
          : null
    }
    if (email !== undefined) student.email = email ? String(email).trim() : ''
    if (phone !== undefined) student.phone = phone ? String(phone).trim() : ''
    if (dateOfBirth !== undefined) student.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : undefined
    if (isActive !== undefined) student.isActive = Boolean(isActive)
    await student.save()
    const populated = await Student.findById(student._id)
      .populate('classId', 'classNumber section batchYear')
      .lean()
    res.json({ student: mapStudentLean(populated) })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate key — this record conflicts with existing data' })
    }
    console.error(err)
    res.status(500).json({ error: 'Failed to update student' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id)
    if (!student) return res.status(404).json({ error: 'Student not found' })
    await Task.deleteMany({ studentId: student._id })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete student' })
  }
})

export default router
