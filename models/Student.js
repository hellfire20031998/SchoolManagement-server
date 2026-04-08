import mongoose from 'mongoose'

const studentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', required: true },
    rollNumber: { type: String, trim: true, default: null },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    dateOfBirth: { type: Date },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

export const Student = mongoose.model('Student', studentSchema)
