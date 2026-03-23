import mongoose, { Schema, Document } from 'mongoose';

/**
 * Evidence Model
 *
 * Stores metadata for evidence snapshots (camera/screen captures).
 * Actual files are stored on disk under /uploads/evidence/.
 * Proctor requests a snapshot → student captures + uploads via REST →
 * server stores file + creates this document → proctors see evidence:available.
 */
export interface IEvidence extends Document {
  sessionId: mongoose.Types.ObjectId;
  examId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  requestId: string;                  // UUID4, links socket request to upload

  type: 'camera_snapshot' | 'screen_snapshot';
  reason: string;                     // Why the proctor requested it
  requestedBy: mongoose.Types.ObjectId; // Proctor userId

  // File storage
  filePath: string;                   // Relative path to /uploads/evidence/
  fileSize: number;                   // Bytes
  mimeType: string;                   // image/png, image/jpeg, image/webp

  uploadedAt: Date;
  createdAt: Date;
}

const evidenceSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ExamSession',
      required: true,
      index: true,
    },
    examId: {
      type: Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['camera_snapshot', 'screen_snapshot'],
      required: true,
    },
    reason: { type: String, default: '' },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    filePath: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: 'image/png' },

    uploadedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Evidence is immutable
    toJSON: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(_doc: any, ret: any) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// ─── Indexes ─────────────────────────────────────────
evidenceSchema.index({ sessionId: 1, uploadedAt: -1 });
evidenceSchema.index({ examId: 1, uploadedAt: -1 });

export const Evidence = mongoose.model<IEvidence>('Evidence', evidenceSchema);
