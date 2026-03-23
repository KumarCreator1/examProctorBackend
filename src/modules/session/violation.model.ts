import mongoose, { Schema, Document } from 'mongoose';
import { ViolationType, ViolationSeverity, VIOLATION_SEVERITY } from '../../utils/constants';

/**
 * Violation Model
 *
 * Persists every Sentinel flag to MongoDB.
 * These are the raw events from the client-side Edge AI,
 * stored after processing for the evidence log, leaderboard,
 * and post-exam analytics (question leakage heatmap).
 */
export interface IViolation extends Document {
  sessionId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  examId: mongoose.Types.ObjectId;

  type: ViolationType;
  severity: ViolationSeverity;
  confidence: number;           // 0-1 from Edge AI
  deduction: number;            // Actual points deducted
  trustScoreAfter: number;      // Trust score after this violation
  streakCount: number;          // How many times this type has occurred in session

  // Sentinel metadata (optional, sent by Edge AI)
  metadata: {
    questionId?: string;        // Which question was being viewed (for leakage heatmap)
    gazeDirection?: string;     // e.g., "left", "right", "down"
    objectLabel?: string;       // e.g., "cell phone", "book"
    audioLevel?: number;        // dB level for audio violations
    durationMs?: number;        // How long the violation lasted
  };

  timestamp: Date;
  createdAt: Date;
}

const violationSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ExamSession',
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    examId: {
      type: Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: Object.values(VIOLATION_SEVERITY),
      required: true,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    deduction: { type: Number, default: 0 },
    trustScoreAfter: { type: Number, required: true },
    streakCount: { type: Number, default: 1 },

    metadata: {
      questionId: { type: String },
      gazeDirection: { type: String },
      objectLabel: { type: String },
      audioLevel: { type: Number },
      durationMs: { type: Number },
    },

    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Violations are immutable
    toJSON: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(_doc: any, ret: any) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// ─── Compound Indexes ─────────────────────────────────
violationSchema.index({ examId: 1, timestamp: -1 });     // Evidence log (latest first)
violationSchema.index({ sessionId: 1, type: 1 });        // Streak queries
violationSchema.index({ examId: 1, type: 1, timestamp: 1 }); // Leakage heatmap aggregation

export const Violation = mongoose.model<IViolation>('Violation', violationSchema);
