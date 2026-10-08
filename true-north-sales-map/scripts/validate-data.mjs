import fs from 'node:fs';
import assert from 'node:assert/strict';

const leads = JSON.parse(fs.readFileSync(new URL('../data/leads.json', import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(new URL('../data/manifest.json', import.meta.url)));

assert.equal(manifest.totalRecords, 17232);
assert.equal(manifest.knoxWalkListTotal, 16136);
assert.equal(leads.length, manifest.totalRecords);
assert.equal(manifest.knoxExpected, manifest.knoxWalkListTotal);

const knoxOwner = leads.filter((lead) => lead.source === 'Knox Owner-Occupied');
const knoxWalk = leads.filter((lead) => lead.source === 'Knox Walk List');
const csv = leads.filter((lead) => lead.source === 'Roofing Leads CSV');
const mapped = leads.filter((lead) => Number.isFinite(lead.lat) && Number.isFinite(lead.lng));

assert.equal(knoxOwner.length, manifest.knoxOwnerOccupiedRecords);
assert.equal(knoxWalk.length, manifest.knoxWalkListAdded);
assert.equal(knoxOwner.length + knoxWalk.length, manifest.knoxRecords);
assert.equal(csv.length, manifest.csvRecords);
assert.equal(mapped.length, manifest.mappedRecords);
assert.equal(manifest.knoxOwnerOccupiedRecords + manifest.knoxWalkListAdded, manifest.knoxRecords);
assert.ok(mapped.every((lead) => typeof lead.geocodeMatch === 'string' && lead.geocodeMatch));

console.log(`OK: ${manifest.totalRecords} records, Knox walk-list total ${manifest.knoxWalkListTotal}`);
