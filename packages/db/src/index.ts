export {
  getUserRole,
  listVisibleConsultations,
  getConsultationDetail,
  updateConsultationStatus,
  normalizeVisibility,
} from './queries.ts';

export type {
  D1ResultLike,
  D1BatchResultLike,
  D1PreparedStatementLike,
  D1DatabaseClient,
  AiRunStage,
  AiRunStatus,
  AiRunRow,
  AiRunEventRow,
  AiGenerationContext,
  CreateQueuedRunInput,
  TransitionRunInput,
  MarkRunGeneratingInput,
  CompleteRunReplyInput,
  CompleteRunUsageInput,
  CompleteRunAtomicInput,
  CompleteRunAtomicResult,
  FailRunInput,
  CreateConsultationWithQueuedRunInput,
  CreateConsultationWithQueuedRunResult,
  InsertHumanMessageWithQueuedRunInput,
  InsertHumanMessageWithQueuedRunResult,
} from './types.ts';

export { DbConflictError, InvalidTransitionError } from './types.ts';
