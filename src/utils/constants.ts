/**
 * Application-wide constants
 */
export const DB_NAME = 'Integrity';

// ─── User Roles ──────────────────────────────────────
export const USER_ROLES = {
  STUDENT: 'student',
  PROCTOR: 'proctor',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// ─── Exam Statuses ───────────────────────────────────
export const EXAM_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const;

export type ExamStatus = (typeof EXAM_STATUS)[keyof typeof EXAM_STATUS];

// ─── Session Statuses ────────────────────────────────
export const SESSION_STATUS = {
  WAITING: 'waiting',
  PAIRED: 'paired',
  ACTIVE: 'active',
  PAUSED: 'paused',
  FROZEN: 'frozen',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

// ─── Violation Types ─────────────────────────────────
export const VIOLATION_TYPES = {
  PHONE_DETECTED: 'phone_detected',
  PERSON_DETECTED: 'person_detected',
  GAZE_AWAY: 'gaze_away',
  OBJECT_DETECTED: 'object_detected',
  AUDIO_ANOMALY: 'audio_anomaly',
  TAB_SWITCH: 'tab_switch',
  SCREEN_SHARE_STOPPED: 'screen_share_stopped',
  DEVICE_DISCONNECTED: 'device_disconnected',
  VM_DETECTED: 'vm_detected',
  HDMI_SPLITTER: 'hdmi_splitter',
  LIVENESS_FAILED: 'liveness_failed',
  CAMERA_OBSTRUCTED: 'camera_obstructed',
  MULTIPLE_FACES: 'multiple_faces',
  WHISPERING_DETECTED: 'whispering_detected',
  SUSPICIOUS_MOVEMENT: 'suspicious_movement',
  FACE_NOT_VISIBLE: 'face_not_visible',
} as const;

export type ViolationType = (typeof VIOLATION_TYPES)[keyof typeof VIOLATION_TYPES];

// ─── Violation Severity ──────────────────────────────
export const VIOLATION_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type ViolationSeverity = (typeof VIOLATION_SEVERITY)[keyof typeof VIOLATION_SEVERITY];

// ─── Trust Score Zones ───────────────────────────────
export const TRUST_ZONES = {
  GREEN: 'green',   // 80-100
  YELLOW: 'yellow', // 50-79
  RED: 'red',       // 0-49
} as const;

export type TrustZone = (typeof TRUST_ZONES)[keyof typeof TRUST_ZONES];

// ─── Trust Score Deductions (per violation type) ─────
// These are BASE deductions for a FIRST occurrence.
// Repeated violations escalate via VIOLATION_STREAK_MULTIPLIERS.
// Formula: actualDeduction = base × confidence × streakMultiplier
export const TRUST_DEDUCTIONS: Record<string, number> = {
  gaze_away: 1,             // Very mild — could just be thinking
  object_detected: 3,       // Mild — might be an innocent object
  audio_anomaly: 2,         // Mild — could be background noise
  tab_switch: 3,            // Moderate — first time could be accidental
  phone_detected: 5,        // Moderate — clearly visible phone near desk
  whispering_detected: 4,   // Moderate — ambiguous
  suspicious_movement: 4,   // Moderate — could be stretching
  face_not_visible: 6,      // High — face must be visible at all times
  camera_obstructed: 8,     // High — likely intentional
  multiple_faces: 8,        // High — someone else in the room
  person_detected: 6,       // High — another person visible
  liveness_failed: 10,      // High — failed identity check
  screen_share_stopped: 8,  // High — stopped screen sharing
  device_disconnected: 10,  // High — phone disconnected
  vm_detected: 25,          // Critical — virtual machine is a hard red flag
  hdmi_splitter: 25,        // Critical — hardware cheating device
};

// ─── Streak Multipliers ──────────────────────────────
// Escalates deductions for repeated violations of the same type.
// Streak is tracked per session in the SessionManager.
export const VIOLATION_STREAK_MULTIPLIERS = [
  1.0,   // 1st occurrence — base deduction
  1.2,   // 2nd occurrence — 20% more
  1.5,   // 3rd occurrence — 50% more
  2.0,   // 4th occurrence — double
  2.5,   // 5+ occurrences — 2.5× (capped)
];

// ─── Question Types ──────────────────────────────────
export const QUESTION_TYPES = {
  MCQ: 'mcq',
  SUBJECTIVE: 'subjective',
  CODING: 'coding',
} as const;

export type QuestionType = (typeof QUESTION_TYPES)[keyof typeof QUESTION_TYPES];

// ─── Socket Events ───────────────────────────────────
export const SOCKET_EVENTS = {
  // Device Pairing
  DEVICE_PAIR_REQUEST: 'device:pair:request',
  DEVICE_PAIR_SUCCESS: 'device:paired',
  DEVICE_PAIR_FAILED: 'device:pair:failed',
  DEVICE_HEARTBEAT: 'device:heartbeat',
  DEVICE_DISCONNECTED: 'device:disconnected',

  // Session
  SESSION_START: 'session:start',
  SESSION_FREEZE: 'session:freeze',
  SESSION_RESUME: 'session:resume',
  SESSION_TERMINATE: 'session:terminate',
  SESSION_UPDATE: 'session:update',
  SESSION_RECONNECT: 'session:reconnect',
  SESSION_RECONNECT_ACK: 'session:reconnect:ack',
  SESSION_RECONNECT_TOKEN: 'session:reconnect_token',

  // Exam Lifecycle (REST-triggered broadcasts)
  EXAM_START: 'exam:start',
  EXAM_END: 'exam:end',
  EXAM_PAUSE_ALL: 'exam:pause_all',
  EXAM_RESUME_ALL: 'exam:resume_all',

  // Student
  STUDENT_READY: 'student:ready',
  STUDENT_COMPLETE: 'student:complete',

  // Violations
  VIOLATION_DETECTED: 'violation:detected',
  VIOLATION_PROCESSED: 'violation:processed',

  // Trust Score
  TRUST_SCORE_UPDATE: 'trustscore:update',

  // Proctor
  PROCTOR_WARN: 'proctor:warn',
  PROCTOR_BROADCAST: 'proctor:broadcast',
  PROCTOR_PAUSE: 'proctor:pause',
  PROCTOR_RESUME: 'proctor:resume',
  PROCTOR_TERMINATE: 'proctor:terminate',
  PROCTOR_REQUEST_LIVENESS: 'proctor:request_liveness',
  PROCTOR_REQUEST_HARDWARE: 'proctor:request_hardware',

  // Liveness
  LIVENESS_CHALLENGE: 'liveness:challenge',
  LIVENESS_RESPONSE: 'liveness:response',
  LIVENESS_RESULT: 'liveness:result',

  // Evidence Snapshot
  EVIDENCE_REQUEST: 'evidence:request',
  EVIDENCE_UPLOAD: 'evidence:upload',
  EVIDENCE_AVAILABLE: 'evidence:available',

  // General
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
} as const;

// ─── HTTP Status Codes ───────────────────────────────
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;
