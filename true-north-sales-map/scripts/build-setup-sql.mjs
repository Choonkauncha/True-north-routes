import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const parts = [
  ['supabase/schema.sql', '1. Base schema'],
  ['supabase/migrations/20261008_access_clockin.sql', '2. Clock-in, location, and messages'],
  ['supabase/forms_photos.sql', '3. Photos and forms'],
  ['supabase/accounts.sql', '4. Accounts, audit, and first admin'],
  ['supabase/migrations/20261008_role_form_library.sql', '5. Role form library and photo notes'],
  ['supabase/migrations/20261008_document_review.sql', '6. Document review'],
  ['supabase/migrations/20261008_document_library.sql', '7. Document folders, receipts, and estimates'],
  ['supabase/migrations/20261008_library_admin_alerts.sql', '8. Management library, inspection folders, and live messages'],
  ['supabase/migrations/20261008_lead_map_boot.sql', '9. Compact field-map boot'],
  ['supabase/migrations/20261008_training_practice.sql', '10. Training and practice'],
  ['supabase/migrations/20261008_must_change_password.sql', '11. Forced password change and admin privacy'],
  ['supabase/migrations/20261008_inspection_handoff.sql', '12. Unified inspection handoffs']
];

export function buildSetupSql(root) {
  const banner = `-- True North setup, in order, safe to run again.
-- Paste this whole file into the Supabase SQL Editor once on a fresh project.
-- It is schema.sql, then the clock-in migration, then forms_photos.sql, then accounts.sql, then the role form library migration, then the document review migration, then the document library migration, then the management library and live message migration, then the field-map boot migration, then the training migration, then the forced password change and admin privacy migration, then the unified inspection handoff migration.
`;
  const body = parts.map(([path, title]) => {
    const sql = readFileSync(join(root, path), 'utf8').trim();
    return `-- =============================================================================\n-- ${title} (${path})\n-- =============================================================================\n\n${sql}\n`;
  }).join('\n');
  return `${banner}\n${body}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const target = join(root, 'supabase/setup_all.sql');
  writeFileSync(target, buildSetupSql(root));
  console.log('wrote', target);
}
