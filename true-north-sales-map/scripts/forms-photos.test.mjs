import assert from 'node:assert/strict';
import {
  STARTER_TEMPLATES, screensFromFields, canUsePhotoBank, canFillAudience,
  initialAnswers, validateField, validateScreen, PREVIEW_LEAD, formatAddress
} from '../tn-files/logic.js';

const closing = STARTER_TEMPLATES[0];
const screens = screensFromFields(closing.fields);
assert.equal(screens.length, 4);
assert.deepEqual(screens.map((screen) => screen.title), ['Homeowner', 'Insurance', 'Scope of work', 'Signatures']);
assert.equal(screens[3].fields.length, 3);

assert.equal(canUsePhotoBank('salesperson'), true);
assert.equal(canUsePhotoBank('admin'), true);
assert.equal(canUsePhotoBank('manager'), true);
assert.equal(canUsePhotoBank('canvasser'), false);
assert.equal(canUsePhotoBank('appointment_setter'), false);
assert.equal(canUsePhotoBank(null, 'local'), true);

assert.equal(canFillAudience('canvasser', 'setter'), true);
assert.equal(canFillAudience('canvasser', 'rep'), false);
assert.equal(canFillAudience('salesperson', 'rep'), true);
assert.equal(canFillAudience('salesperson', 'both'), true);
assert.equal(canFillAudience('appointment_setter', 'both'), true);
assert.equal(canFillAudience('admin', 'setter'), true);

const answers = initialAnswers(closing.fields, PREVIEW_LEAD, new Date('2026-10-08T15:00:00'));
assert.equal(answers.homeowner_name, 'Alex Morgan');
assert.equal(answers.property_address, formatAddress(PREVIEW_LEAD));
assert.equal(answers.agreement_date, '2026-10-08');
assert.equal(answers.homeowner_signature, null);

assert.equal(validateField(closing.fields[0], ''), 'Fill this in.');
assert.equal(validateField(closing.fields[0], 'Pat'), '');
assert.equal(validateField(closing.fields[5], null), 'Sign in the box.');
assert.equal(validateField(closing.fields[2], ''), '');

const errors = validateScreen(screens[0].fields, { homeowner_name: '', property_address: '1 Main' });
assert.ok(errors.homeowner_name);
assert.equal(errors.property_address, undefined);

const loose = screensFromFields([
  { id: 'a', label: 'Alone', section: '' },
  { id: 'b', label: 'B', section: 'Pair' },
  { id: 'c', label: 'C', section: 'Pair' }
]);
assert.equal(loose.length, 2);
assert.equal(loose[1].fields.length, 2);

assert.equal(STARTER_TEMPLATES[1].name, 'Contingency Agreement');
assert.equal(STARTER_TEMPLATES.every((item) => item.is_draft), true);

console.log('forms-photos tests ok');
