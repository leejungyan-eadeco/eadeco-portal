// Migration 011: a run that failed for a temporary reason is tried again 5, 10 and 15 minutes later; retry_at is when
// the next attempt starts (null: no more automatic attempts).
export const sql = `
alter table parking_runs add column retry_at timestamptz;
`;
