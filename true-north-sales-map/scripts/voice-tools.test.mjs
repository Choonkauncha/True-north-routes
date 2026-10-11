import assert from 'node:assert/strict';
import {toolDefinitions,normalizeToolCall} from '../lib/voice-tools.js';
assert.deepEqual(toolDefinitions('appointment_setter')[0].functionDeclarations.map(t=>t.name),['draft_route']);
assert.deepEqual(toolDefinitions('admin')[0].functionDeclarations.map(t=>t.name),['draft_route','inspect_team_profile']);
assert.deepEqual(normalizeToolCall({name:'draft_route',args:{addresses:['123 Main Street, Mount Vernon, OH']}}).addresses,['123 Main Street, Mount Vernon, OH']);
assert.throws(()=>normalizeToolCall({name:'profile.edit',args:{}}),/not allowed/);
assert.throws(()=>normalizeToolCall({name:'draft_route',args:{addresses:[]}}),/between 1 and 30/);
console.log('Voice tool allowlist and route validation passed');
