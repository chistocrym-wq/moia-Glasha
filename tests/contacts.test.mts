import assert from "node:assert/strict";
import {
  contactQueryVariants,
  mergeImportedContact,
  normalizeContactKey,
  normalizePhone,
  normalizePickedContact,
  parseVCard,
} from "../src/lib/contacts.ts";

assert.equal(normalizeContactKey("  Контакт-Работа "), "контакт работа");
assert.equal(normalizePhone("+1 (202) 555-0101"), "+12025550101");
assert.ok(contactQueryVariants("бухгалтеру").includes("бухгалтер"));
assert.ok(contactQueryVariants("маме").includes("мама"));

const vcf = `BEGIN:VCARD
VERSION:3.0
FN:Контакт Работа
N:Работа;Контакт;;;
NICKNAME:Рабочий,бухгалтер
TEL;TYPE=CELL:+1 (202) 555-0101
TEL;TYPE=WORK:+1 202 555 0102
EMAIL;TYPE=WORK:work@example.invalid
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Дом
TEL;TYPE=CELL:+1 202 555 0103
END:VCARD`;

const parsed = parseVCard(vcf);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].name, "Контакт Работа");
assert.equal(parsed[0].phones.length, 2);
assert.equal(parsed[0].phones[0].normalized, "+12025550101");
assert.deepEqual(parsed[0].aliases, ["Рабочий", "бухгалтер"]);

const duplicate = parseVCard(vcf + "\n" + vcf);
assert.equal(duplicate.length, 2);

const picked = normalizePickedContact({
  name: ["Выбранный контакт"],
  tel: ["+1 202 555 0199"],
  email: ["picked@example.invalid"],
});
assert.equal(picked?.name, "Выбранный контакт");
assert.equal(picked?.phones[0].normalized, "+12025550199");

const merged = mergeImportedContact(parsed[0], {
  phone_numbers: [{ label: "домашний", value: "+1 202 555 0110", normalized: "+12025550110" }],
  emails: [{ label: "личный", value: "private@example.invalid" }],
  aliases: ["Алиас"],
  notes: "existing",
});
assert.equal(merged.phones.length, 3);
assert.equal(merged.emails.length, 2);
assert.ok(merged.aliases.includes("Алиас"));
assert.equal(merged.notes, "existing");

console.log("contacts import helpers: PASS");
