import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  emailRaw,
  classificationLog,
  draftQueue,
  sentHistory,
  rejectedHistory,
  historicalSent,
  persona,
  onboarding,
} from './schema.js';

export type EmailRaw = InferSelectModel<typeof emailRaw>;
export type NewEmailRaw = InferInsertModel<typeof emailRaw>;

export type ClassificationLog = InferSelectModel<typeof classificationLog>;
export type NewClassificationLog = InferInsertModel<typeof classificationLog>;

export type DraftQueueRow = InferSelectModel<typeof draftQueue>;
export type NewDraftQueueRow = InferInsertModel<typeof draftQueue>;

export type SentHistory = InferSelectModel<typeof sentHistory>;
export type NewSentHistory = InferInsertModel<typeof sentHistory>;

export type RejectedHistory = InferSelectModel<typeof rejectedHistory>;
export type NewRejectedHistory = InferInsertModel<typeof rejectedHistory>;

export type HistoricalSent = InferSelectModel<typeof historicalSent>;
export type NewHistoricalSent = InferInsertModel<typeof historicalSent>;

export type Persona = InferSelectModel<typeof persona>;
export type NewPersona = InferInsertModel<typeof persona>;

export type Onboarding = InferSelectModel<typeof onboarding>;
export type NewOnboarding = InferInsertModel<typeof onboarding>;
