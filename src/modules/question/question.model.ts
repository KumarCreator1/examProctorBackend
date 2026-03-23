import mongoose, { Schema, Document } from 'mongoose';
import { QUESTION_TYPES, QuestionType } from '../../utils/constants';

// ─── Option sub-doc (for MCQ) ────────────────────────
export interface IQuestionOption {
  text: string;
  isCorrect: boolean;
}

// ─── Question Interface ──────────────────────────────
export interface IQuestion extends Document {
  examId: mongoose.Types.ObjectId;
  type: QuestionType;
  text: string;
  options: IQuestionOption[];          // Only for MCQ
  correctAnswer: string;              // For subjective/coding: model answer
  explanation: string;                 // Post-exam explanation
  points: number;
  difficulty: 'easy' | 'medium' | 'hard';
  order: number;                       // Question order in exam
  
  // Honeypot watermarking (PRD: zero-width character metadata)
  watermarkId: string;                 // Unique watermark ID per question copy
  watermarkEnabled: boolean;

  // Media
  imageUrl?: string;
  
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ──────────────────────────────────────────
const optionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: false },
);

const questionSchema = new Schema(
  {
    examId: {
      type: Schema.Types.ObjectId,
      ref: 'Exam',
      required: [true, 'Exam ID is required'],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(QUESTION_TYPES),
      required: [true, 'Question type is required'],
    },
    text: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
      maxlength: [5000, 'Question text cannot exceed 5000 characters'],
    },
    options: {
      type: [optionSchema],
      default: [],
      validate: {
        validator: function (this: IQuestion, opts: IQuestionOption[]) {
          if (this.type === QUESTION_TYPES.MCQ) {
            // MCQ must have 2-6 options and exactly one correct
            if (opts.length < 2 || opts.length > 6) return false;
            const correctCount = opts.filter((o) => o.isCorrect).length;
            return correctCount >= 1;
          }
          return true;
        },
        message: 'MCQ questions must have 2-6 options with at least one correct answer',
      },
    },
    correctAnswer: {
      type: String,
      trim: true,
      default: '',
    },
    explanation: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Explanation cannot exceed 2000 characters'],
    },
    points: {
      type: Number,
      required: true,
      min: [0, 'Points cannot be negative'],
      default: 1,
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    order: {
      type: Number,
      default: 0,
    },

    // ─── Honeypot Watermark ──────────────────────────
    watermarkId: {
      type: String,
      default: '',
    },
    watermarkEnabled: {
      type: Boolean,
      default: true,
    },

    imageUrl: { type: String, default: '' },
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

// ─── Indexes ─────────────────────────────────────────
questionSchema.index({ examId: 1, order: 1 });
questionSchema.index({ examId: 1, type: 1 });

export const Question = mongoose.model<IQuestion>('Question', questionSchema);
