import mongoose, { Schema, Document } from 'mongoose';
import { SESSION_STATUS, SessionStatus } from '../../utils/constants';

/**
 * ExamSession Model
 *
 * Persists each student's exam attempt to MongoDB.
 * The in-memory SessionManager handles real-time state during the exam;
 * this model is the permanent record written at start and updated on events.
 *
 * Lifecycle:
 *   pre-check → waiting → paired → active → paused/frozen → completed/terminated
 */

export interface IHardwareInfo {
  deviceType: string;
  userAgent: string;
  fingerprint: string;
  connectedAt: Date;
}

export interface IExamSession extends Document {
  examId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  enrollmentId: mongoose.Types.ObjectId;

  // Status lifecycle
  status: SessionStatus;

  // Trust score
  trustScore: number;
  trustZone: 'green' | 'yellow' | 'red';
  totalViolations: number;

  // Device pairing
  laptopConnected: boolean;
  phoneConnected: boolean;
  laptopUserAgent: string;
  phoneUserAgent: string;

  // Hardware registry (peripherals reported by Sentinel)
  hardware: string[];

  // Timing
  startedAt?: Date;
  phonePairedAt?: Date;
  completedAt?: Date;
  terminatedAt?: Date;
  terminatedBy?: mongoose.Types.ObjectId;
  terminationReason?: string;

  // Cryptographic resume token (HMAC-SHA256 signed)
  resumeToken?: string;
  resumeTokenExpiresAt?: Date;

  // Freeze tracking  
  freezeCount: number;
  lastFrozenAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const examSessionSchema = new Schema(
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
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Enrollment',
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(SESSION_STATUS),
      default: SESSION_STATUS.WAITING,
      index: true,
    },

    // ─── Trust Score ────────────────────────────────
    trustScore: { type: Number, default: 100 },
    trustZone: {
      type: String,
      enum: ['green', 'yellow', 'red'],
      default: 'green',
    },
    totalViolations: { type: Number, default: 0 },

    // ─── Devices ─────────────────────────────────────
    laptopConnected: { type: Boolean, default: false },
    phoneConnected: { type: Boolean, default: false },
    laptopUserAgent: { type: String, default: '' },
    phoneUserAgent: { type: String, default: '' },

    // ─── Hardware Registry ────────────────────────────
    hardware: { type: [String], default: [] },

    // ─── Timing ──────────────────────────────────────
    startedAt: { type: Date },
    phonePairedAt: { type: Date },
    completedAt: { type: Date },
    terminatedAt: { type: Date },
    terminatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    terminationReason: { type: String },

    // ─── Resume Token ─────────────────────────────────
    resumeToken: { type: String },
    resumeTokenExpiresAt: { type: Date },

    // ─── Freeze Stats ─────────────────────────────────
    freezeCount: { type: Number, default: 0 },
    lastFrozenAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(_doc: any, ret: any) {
        delete ret.__v;
        delete ret.resumeToken; // Never expose resume tokens in API responses
        return ret;
      },
    },
  },
);

// ─── Indexes ─────────────────────────────────────────
examSessionSchema.index({ examId: 1, studentId: 1 }, { unique: true });
examSessionSchema.index({ examId: 1, status: 1 });
examSessionSchema.index({ examId: 1, trustScore: 1 }); // For leaderboard sorting

export const ExamSession = mongoose.model<IExamSession>('ExamSession', examSessionSchema);
