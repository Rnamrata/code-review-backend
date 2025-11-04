export enum SessionState {
  CREATED = 'created',
  UPLOADED = 'uploaded',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export const SESSION_STATES = {
  CREATED: 'created' as const,
  UPLOADED: 'uploaded' as const,
  ANALYZING: 'analyzing' as const,
  COMPLETED: 'completed' as const,
  ERROR: 'error' as const
};