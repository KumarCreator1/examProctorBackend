import mongoose, { Schema, Document } from 'mongoose';

/**
 * Answer Model
 *
 * Stores a student's submitted answer for each question in an exam session.
 * Answers are persisted via REST (POST /sessions/:id/submit) — NOT via WebSocket —
 * to guarantee delivery with HTTP 200 acknowledgment.
 *
 * One document per question per session. Bulk-upserted on submission.
 */
export interface IAnswer extends Document {
  sessionId: mongoose.Types.ObjectId;
  examId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  questionId: mongoose.Types.ObjectId;

  // Answer content
  answer: string;                    // Text answer (MCQ option index, subjective text, code)
  selectedOptions?: number[];        // For MCQ: indices of selected options (multi-select)

  // Scoring (populated after grading)
  isCorrect?: boolean;               // Auto-graded for MCQ
  score?: number;                    // Points awarded
  maxScore: number;                  // Max points for this question

  // Metadata
  timeSpentMs: number;               // Time spent on this question (ms)
  answeredAt: Date;                  // When the student last modified this answer
  submittedAt: Date;                 // When the final submission happened

  createdAt: Date;
  updatedAt: Date;
}

const answerSchema = new Schema(
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
      index: true,
    },
    questionId: {
      type: Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },

    answer: { type: String, default: '' },
    selectedOptions: { type: [Number], default: [] },

    isCorrect: { type: Boolean },
    score: { type: Number },
    maxScore: { type: Number, required: true, default: 1 },

    timeSpentMs: { type: Number, default: 0 },
    answeredAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: Date.now },
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

// ─── Indexes ─────────────────────────────────────────
answerSchema.index({ sessionId: 1, questionId: 1 }, { unique: true }); // One answer per question per session
answerSchema.index({ examId: 1, studentId: 1 });
answerSchema.index({ examId: 1, questionId: 1 }); // For aggregate scoring

export const Answer = mongoose.model<IAnswer>('Answer', answerSchema);
