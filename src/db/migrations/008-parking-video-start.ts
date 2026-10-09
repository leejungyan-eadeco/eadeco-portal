// Migration 008: when a run's video started, so clicking a step in its timeline can jump the video to that moment.
export const sql = `
alter table parking_runs add column video_started_at timestamptz;
`;
