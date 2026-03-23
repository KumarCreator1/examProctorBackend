import mongoose, { Schema, Document } from 'mongoose';
import { EXAM_STATUS, ExamStatus } from '../../utils/constants';

// ─── Proctoring Settings (embedded sub-doc) ──────────
export interface IProctoringSettings {
  enabled: boolean;
  dualCamera: boolean;           // Require phone as secondary camera
  objectDetection: boolean;      // Detect unauthorized objects
  gazeTracking: boolean;         // Track eye movement
  audioMonitoring: boolean;      // Detect whispering / earpiece
  livenessChecks: boolean;       // Random "Look Left" prompts
  antiVM: boolean;               // Detect virtual machines
  screenRecording: boolean;      // Monitor screen share
  heartbeatInterval: number;     // Phone heartbeat interval (ms)
  heartbeatTimeout: number;      // Freeze session after this many ms missed
  honeypotWatermark: boolean;    // Embed zero-width chars in questions
}

// ─── Exam Interface ──────────────────────────────────
export interface IExam extends Document {
  title: string;
  description: string;
  instructions: string;
  createdBy: mongoose.Types.ObjectId;
  institution: string;

  // Scheduling
  scheduledStart: Date;
  scheduledEnd: Date;
  duration: number;           // Duration in minutes
  timezone: string;

  // Status lifecycle
  status: ExamStatus;

  // Exam Settings
  settings: {
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    showResults: boolean;       // Show results to student after submission
    maxAttempts: number;
    passingScore: number;       // Percentage
    allowBackNavigation: boolean;
    autoSubmit: boolean;        // Auto-submit when time runs out
  };

  // Proctoring configuration
  proctoring: IProctoringSettings;

  // Access control
  accessCode: string;           // 6-char alphanumeric code students use to join
  isPublic: boolean;            // If true, any student with the code can join

  // Metadata
  totalQuestions: number;
  totalPoints: number;
  tags: string[];

  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ──────────────────────────────────────────
const proctoringSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    dualCamera: { type: Boolean, default: true },
    objectDetection: { type: Boolean, default: true },
    gazeTracking: { type: Boolean, default: true },
    audioMonitoring: { type: Boolean, default: true },
    livenessChecks: { type: Boolean, default: true },
    antiVM: { type: Boolean, default: true },
    screenRecording: { type: Boolean, default: true },
    heartbeatInterval: { type: Number, default: 5000 },   // 5s
    heartbeatTimeout: { type: Number, default: 15000 },    // 15s
    honeypotWatermark: { type: Boolean, default: true },
  },
  { _id: false },
);

const examSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Exam title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
      index: 'text', // Full-text search
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    instructions: {
      type: String,
      trim: true,
      default: '',
      maxlength: [5000, 'Instructions cannot exceed 5000 characters'],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    institution: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    // ─── Scheduling ────────────────────────────────────
    scheduledStart: {
      type: Date,
      required: [true, 'Scheduled start time is required'],
      index: true,
    },
    scheduledEnd: {
      type: Date,
      required: [true, 'Scheduled end time is required'],
    },
    duration: {
      type: Number,
      required: [true, 'Exam duration is required'],
      min: [1, 'Duration must be at least 1 minute'],
      max: [480, 'Duration cannot exceed 8 hours'],
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },

    // ─── Status ────────────────────────────────────────
    status: {
      type: String,
      enum: Object.values(EXAM_STATUS),
      default: EXAM_STATUS.DRAFT,
      index: true,
    },

    // ─── Exam Settings ─────────────────────────────────
    settings: {
      shuffleQuestions: { type: Boolean, default: true },
      shuffleOptions: { type: Boolean, default: true },
      showResults: { type: Boolean, default: false },
      maxAttempts: { type: Number, default: 1 },
      passingScore: { type: Number, default: 40 },
      allowBackNavigation: { type: Boolean, default: true },
      autoSubmit: { type: Boolean, default: true },
    },

    // ─── Proctoring ────────────────────────────────────
    proctoring: {
      type: proctoringSettingsSchema,
      default: () => ({}), // All proctoring ON by default
    },

    // ─── Access ────────────────────────────────────────
    accessCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      index: true,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },

    // ─── Metadata ──────────────────────────────────────
    totalQuestions: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
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

// ─── Compound Indexes ────────────────────────────────
examSchema.index({ createdBy: 1, status: 1 });
examSchema.index({ institution: 1, status: 1 });
examSchema.index({ scheduledStart: 1, status: 1 });

export const Exam = mongoose.model<IExam>('Exam', examSchema);
