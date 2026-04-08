import mongoose from 'mongoose'
import { Router } from 'express'
import { Task } from '../models/Task.js'
import { Student } from '../models/Student.js'
import { SchoolClass } from '../models/SchoolClass.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
router.use(authRequired)

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 10

const studentPopulate = {
  path: 'studentId',
  select: 'fullName classId',
  populate: {
    path: 'classId',
    model: 'SchoolClass',
    select: 'classNumber section batchYear',
  },
}

function parsePagination(query) {
  const page = Math.max(1, parseInt(String(query.page), 10) || 1)
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(String(query.limit), 10) || DEFAULT_PAGE_SIZE),
  )
  return { page, limit, skip: (page - 1) * limit }
}

router.get('/', async (req, res) => {
  try {
    const { studentId, status, search } = req.query
    const andParts = []
    if (studentId) {
      if (!mongoose.isValidObjectId(String(studentId))) {
        return res.status(400).json({ error: 'Invalid studentId' })
      }
      andParts.push({ studentId })
    }
    if (status === 'pending' || status === 'completed') {
      andParts.push({ status })
    }
    const q = search != null ? String(search).trim() : ''
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = new RegExp(escaped, 'i')
      const studentMatches = await Student.find({ fullName: rx }).distinct('_id')
      const orClause = [{ title: rx }, { description: rx }]
      if (studentMatches.length > 0) {
        orClause.push({ studentId: { $in: studentMatches } })
      }
      andParts.push({ $or: orClause })
    }
    const filter =
      andParts.length === 0 ? {} : andParts.length === 1 ? andParts[0] : { $and: andParts }
    const { page, limit, skip } = parsePagination(req.query)
    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate(studentPopulate)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter),
    ])
    const totalPages = Math.max(1, Math.ceil(total / limit))
    res.json({
      tasks,
      pagination: { page, limit, total, totalPages },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list tasks' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { studentId, title, description, dueDate } = req.body
    if (!studentId || !title) {
      return res.status(400).json({ error: 'studentId and title are required' })
    }
    const student = await Student.findById(studentId)
    if (!student) return res.status(404).json({ error: 'Student not found' })
    const task = await Task.create({
      studentId,
      title: String(title).trim(),
      description: description ? String(description) : '',
      dueDate: dueDate ? new Date(dueDate) : undefined,
      status: 'pending',
      assignedBy: req.userId,
    })
    const populated = await Task.findById(task._id).populate(studentPopulate).lean()
    res.status(201).json({ task: populated })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

/** Assign the same task to every active student in a class. Must be registered before /:id */
router.post('/bulk-by-class', async (req, res) => {
  try {
    const { classId, title, description, dueDate } = req.body
    if (!classId || !title) {
      return res.status(400).json({ error: 'classId and title are required' })
    }
    if (!mongoose.isValidObjectId(classId)) {
      return res.status(400).json({ error: 'Invalid classId' })
    }
    const cls = await SchoolClass.findById(classId)
    if (!cls) return res.status(404).json({ error: 'Class not found' })
    const studentIds = await Student.find({
      classId,
      isActive: { $ne: false },
    }).distinct('_id')
    if (studentIds.length === 0) {
      return res.status(400).json({ error: 'No active students in this class' })
    }
    const titleTrim = String(title).trim()
    const desc = description != null ? String(description) : ''
    const due = dueDate ? new Date(dueDate) : undefined
    const docs = studentIds.map((studentId) => ({
      studentId,
      title: titleTrim,
      description: desc,
      dueDate: due,
      status: 'pending',
      assignedBy: req.userId,
    }))
    await Task.insertMany(docs)
    res.status(201).json({ createdCount: studentIds.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create class tasks' })
  }
})

const MAX_BULK_STUDENTS = 200
const MAX_BULK_TASK_IDS = 200

/** Same task for an explicit list of students (single or batch). Must be registered before /:id */
router.post('/bulk', async (req, res) => {
  try {
    const { studentIds, title, description, dueDate } = req.body
    if (!title) {
      return res.status(400).json({ error: 'title is required' })
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds must be a non-empty array' })
    }
    const unique = [...new Set(studentIds.map((id) => String(id)))]
    if (unique.length > MAX_BULK_STUDENTS) {
      return res.status(400).json({ error: `At most ${MAX_BULK_STUDENTS} students per assignment` })
    }
    for (const id of unique) {
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid student id in list' })
      }
    }
    const found = await Student.find({
      _id: { $in: unique },
      isActive: { $ne: false },
    })
      .select('_id')
      .lean()
    if (found.length !== unique.length) {
      return res.status(400).json({
        error: 'One or more students were not found or are inactive',
      })
    }
    const titleTrim = String(title).trim()
    const desc = description != null ? String(description) : ''
    const due = dueDate ? new Date(dueDate) : undefined
    const docs = unique.map((studentId) => ({
      studentId,
      title: titleTrim,
      description: desc,
      dueDate: due,
      status: 'pending',
      assignedBy: req.userId,
    }))
    await Task.insertMany(docs)
    res.status(201).json({ createdCount: unique.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create tasks' })
  }
})

router.post('/bulk-status', async (req, res) => {
  try {
    const { taskIds, status } = req.body
    if (status !== 'pending' && status !== 'completed') {
      return res.status(400).json({ error: 'status must be pending or completed' })
    }
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds must be a non-empty array' })
    }
    const unique = [...new Set(taskIds.map((id) => String(id)))]
    if (unique.length > MAX_BULK_TASK_IDS) {
      return res.status(400).json({ error: `At most ${MAX_BULK_TASK_IDS} tasks per request` })
    }
    for (const id of unique) {
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid task id in list' })
      }
    }
    const now = new Date()
    const update =
      status === 'completed'
        ? { $set: { status: 'completed', completedAt: now } }
        : { $set: { status: 'pending' }, $unset: { completedAt: 1 } }
    const result = await Task.updateMany({ _id: { $in: unique } }, update)
    res.json({ modifiedCount: result.modifiedCount })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update task status' })
  }
})

router.post('/bulk-delete', async (req, res) => {
  try {
    const { taskIds } = req.body
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds must be a non-empty array' })
    }
    const unique = [...new Set(taskIds.map((id) => String(id)))]
    if (unique.length > MAX_BULK_TASK_IDS) {
      return res.status(400).json({ error: `At most ${MAX_BULK_TASK_IDS} tasks per request` })
    }
    for (const id of unique) {
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid task id in list' })
      }
    }
    const result = await Task.deleteMany({ _id: { $in: unique } })
    res.json({ deletedCount: result.deletedCount })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete tasks' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate(studentPopulate).lean()
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json({ task })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load task' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const { title, description, dueDate, status } = req.body
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (title !== undefined) task.title = String(title).trim()
    if (description !== undefined) task.description = String(description)
    if (dueDate !== undefined) task.dueDate = dueDate ? new Date(dueDate) : null
    if (status === 'completed' || status === 'pending') {
      task.status = status
      task.completedAt = status === 'completed' ? new Date() : null
    }
    await task.save()
    const populated = await Task.findById(task._id).populate(studentPopulate).lean()
    res.json({ task: populated })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

router.patch('/:id/complete', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    task.status = 'completed'
    task.completedAt = new Date()
    await task.save()
    const populated = await Task.findById(task._id).populate(studentPopulate).lean()
    res.json({ task: populated })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to complete task' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id)
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

export default router
