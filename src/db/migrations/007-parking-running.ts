// Migration 007: a parking run is recorded as Running while it is in progress, so Activity can show it live.
export const sql = `
alter table parking_runs drop constraint parking_runs_result_check;
alter table parking_runs add constraint parking_runs_result_check check (result in ('Running', 'Created', 'Failed'));
`;
