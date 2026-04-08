import mongoose from 'mongoose'

const taskSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    dueDate: { type: Date },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    completedAt: { type: Date },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

taskSchema.index({ studentId: 1, createdAt: -1 })
taskSchema.index({ status: 1 })

export const Task = mongoose.model('Task', taskSchema)
