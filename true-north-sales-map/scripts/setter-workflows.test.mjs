import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

const workspace = read('brand/workspace.js');
assert.ok(workspace.includes('page === "/setter" ? "/account.html" : "/"'));
assert.ok(workspace.includes('page === "/setter" ? "MY ACCOUNT" : "FIELD TOOLS"'));

const forms = read('tn-files/form-wizard.js');
assert.ok(forms.includes('listSubmissions'));
assert.ok(forms.includes('openStoredFile'));
assert.ok(forms.includes('item.submitted_by === ctx.rep?.id'));
assert.ok(forms.includes('data-tn-panel="my-submissions"'));
assert.ok(forms.includes('Documents from management'));

const layers = read('lib/map-layers.js');
assert.ok(layers.includes("LAYER_STORAGE_KEY = 'tnrc2:mapLayers:v3'"));
assert.ok(layers.includes('opportunity: false'));

const messages = read('field-ops.js');
assert.ok(messages.includes("body: { action: 'read', threadId: data.thread.id }"));
assert.ok(messages.includes('state.status.unread = state.status.isAdmin'));

console.log('setter-workflows.test.mjs ok');
