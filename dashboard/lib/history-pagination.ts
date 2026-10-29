/** Per-generation ownership prevents stale refresh/filter data from being appended. */
export type PaginationState = {
  generation: number;
  cursor: string | null;
  phase: 'initial' | 'initial-error' | 'ready' | 'loading-more' | 'page-error';
};
export function historyGeneration(generation: number): PaginationState {
  return { generation, cursor: null, phase: 'initial' };
}
export function historyReady(generation: number, cursor: string | null): PaginationState {
  return { generation, cursor, phase: 'ready' };
}
export function beginNextPage(state: PaginationState, generation: number): PaginationState | null {
  if (state.generation !== generation || !state.cursor || !['ready', 'page-error'].includes(state.phase)) return null;
  return { ...state, phase: 'loading-more' };
}
export function finishNextPage(state: PaginationState, generation: number, cursor: string | null, failed = false): PaginationState {
  if (state.generation !== generation || state.phase !== 'loading-more') return state;
  return failed ? { ...state, phase: 'page-error' } : historyReady(generation, cursor);
}
