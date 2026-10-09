// Migration 010: a run whose draft was deleted in NAV is marked Deleted (kept as evidence) when the day is fetched again.
export const sql = `
alter table parking_runs drop constraint parking_runs_result_check;
alter table parking_runs add constraint parking_runs_result_check check (result in ('Running', 'Created', 'Failed', 'Deleted'));
`;
