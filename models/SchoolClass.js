import mongoose from 'mongoose'

const schoolClassSchema = new mongoose.Schema(
  {
    classNumber: { type: Number, required: true, min: 1 },
    section: { type: String, required: true, trim: true, uppercase: true, maxlength: 2 },
    batchYear: { type: Number, required: true, min: 1990, max: 2100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

schoolClassSchema.index({ classNumber: 1, section: 1, batchYear: 1 }, { unique: true })

export const SchoolClass = mongoose.model('SchoolClass', schoolClassSchema)
