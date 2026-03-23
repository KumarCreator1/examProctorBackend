import mongoose, { Schema, Document } from 'mongoose';

/**
 * Enrollment Model
 * 
 * This is the ACCESS CONTROL layer for exams:
 * - Admins/Proctors create an exam → then enroll students
 * - Students can also self-enroll using an access code (if exam allows)
 * - When a student tries to start an exam, we check this collection
 * 
 * Flow:
 *   Admin creates exam → shares accessCode or enrolls students manually
 *   Student hits POST /exams/:examId/enroll { accessCode } → gets enrolled
 *   Student hits GET /exams/my-exams → returns all exams they're enrolled in
 *   Student hits POST /sessions/:examId/start → only if enrolled
 */
export interface IEnrollment extends Document {
  examId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  enrolledBy: mongoose.Types.ObjectId;   // Who enrolled them (self or admin)
  enrollmentType: 'manual' | 'access_code';
  status: 'enrolled' | 'started' | 'completed' | 'revoked';
  enrolledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const enrollmentSchema = new Schema(
  {
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
      index: true,
    },
    enrolledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    enrollmentType: {
      type: String,
      enum: ['manual', 'access_code'],
      default: 'manual',
    },
    status: {
      type: String,
      enum: ['enrolled', 'started', 'completed', 'revoked'],
      default: 'enrolled',
      index: true,
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(_doc: any, ret: any) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// ─── Compound Index: one enrollment per student per exam ─
enrollmentSchema.index({ examId: 1, studentId: 1 }, { unique: true });
enrollmentSchema.index({ studentId: 1, status: 1 });

export const Enrollment = mongoose.model<IEnrollment>('Enrollment', enrollmentSchema);
