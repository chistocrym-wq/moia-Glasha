import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sw = readFileSync("public/sw.js", "utf8");
assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
assert.match(sw, /url\.pathname\.startsWith\("\/auth\/"\)/);
assert.doesNotMatch(sw, /CORE\s*=\s*\[[\s\S]*?["']\/["']/);
assert.match(sw, /pathname\.startsWith\("\/_next\/static\/"\)/);
assert.match(sw, /pathname\.startsWith\("\/glasha\/"\)/);

const documentsRoute = readFileSync("src/app/api/documents/route.ts", "utf8");
assert.match(documentsRoute, /direct_upload_required/);
assert.match(documentsRoute, /createSignedUrl/);

const directUpload = readFileSync("src/lib/document-upload.ts", "utf8");
assert.match(directUpload, /supabase\.storage/);
assert.match(directUpload, /new Upload|tus/i);
assert.doesNotMatch(directUpload, /fetch\(["']\/api\/documents["'][\s\S]*method:\s*["']POST["']/);

const migrations = [
  "supabase/migrations/006_task_achievements_lifecycle.sql",
  "supabase/migrations/006_life_os_phase1.sql",
  "supabase/migrations/007_phase1_projects_achievements.sql",
  "supabase/migrations/008_phase1_phonebook_contacts.sql",
  "supabase/migrations/009_phase1_projects_achievements_hotfix.sql",
  "supabase/tests/phase1_acceptance.sql",
  "supabase/tests/phase1_phonebook_acceptance.sql",
];
for (const path of migrations) {
  const sql = readFileSync(path, "utf8");
  assert.doesNotMatch(sql, /\b(?:as|do) \$(?!\$)/i, `${path} contains an invalid single-dollar SQL delimiter`);
  assert.doesNotMatch(sql, /\n\$(?!\$);/, `${path} contains an invalid single-dollar SQL terminator`);
  assert.doesNotMatch(sql, /end \$(?!\$);/i, `${path} contains an invalid single-dollar PL/pgSQL block terminator`);
}

for (const path of ["supabase/tests/phase1_acceptance.sql", "supabase/tests/phase1_phonebook_acceptance.sql"]) {
  const sql = readFileSync(path, "utf8");
  assert.doesNotMatch(sql, /raw_app_meta_data,raw_user_meta_data[\s\S]{0,500}?\'\{\}\',\'\{\}\'/i, `${path} must cast auth metadata fixtures to jsonb`);
}

const phonebook = readFileSync("src/components/PhonebookImport.tsx", "utf8");
assert.match(phonebook, /file\.text\(\)/);
assert.doesNotMatch(phonebook, /OPENAI_API_KEY|\/api\/assistant/);

console.log("Phase 1 architecture guards: PASS");
