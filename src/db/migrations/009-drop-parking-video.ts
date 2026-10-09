// Migration 009: runs are no longer recorded on video (the step screenshots are the evidence).
export const sql = `
alter table parking_runs drop column video_started_at;
`;
