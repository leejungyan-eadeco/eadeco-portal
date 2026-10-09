// Migration 004: customers and vendors are read from light custom pages (same rows, ~20x faster than the card
// pages, which work out balances for every row). Only names still on the old default are changed.
export const sql = `
update nav_services set service_name = 'ws_DRM_Customer', updated_at = now() where key = 'customers' and service_name = 'CustomerCard';
update nav_services set service_name = 'ws_VMS_Vendor', updated_at = now() where key = 'vendors' and service_name = 'VendorCard';
`;
