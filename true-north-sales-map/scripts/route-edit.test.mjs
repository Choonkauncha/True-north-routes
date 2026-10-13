import assert from 'node:assert/strict';
import { orderedRouteIds, reviseBuiltRoute, routeStopOrder, selectionOnlyChange } from '../lib/route-edit.js';

const leads = new Map([
  ['a', { id: 'a', lat: 40, lng: -82, address: '10 North' }],
  ['b', { id: 'b', lat: 40.1, lng: -82.1, address: '14 North' }],
  ['c', { id: 'c', lat: 40.2, lng: -82.2, address: '18 North' }],
  ['d', { id: 'd', address: 'No map point' }]
]);
const built = [leads.get('a'), leads.get('b')];

assert.equal(selectionOnlyChange('driving:25:a,b', 'driving:25:a,b,c'), true);
assert.equal(selectionOnlyChange('driving:25:a,b', 'walking:25:a,b'), false);
assert.equal(selectionOnlyChange('driving:25:a,b', 'driving:10:a,b'), false);
assert.equal(selectionOnlyChange('', 'driving:25:a'), false);

const added = reviseBuiltRoute(built, new Set(['a', 'b', 'c', 'd']), leads);
assert.deepEqual(added.stops.map((stop) => stop.id), ['a', 'b', 'c']);
assert.equal(added.appended, 1);
assert.equal(added.removed, 0);

const removed = reviseBuiltRoute(added.stops, new Set(['b', 'c']), leads);
assert.deepEqual(removed.stops.map((stop) => stop.id), ['b', 'c']);
assert.equal(removed.removed, 1);
assert.deepEqual(routeStopOrder(removed.stops, ['c', 'b']), ['b', 'c']);
assert.deepEqual(routeStopOrder([], ['c', 'b']), ['c', 'b']);
assert.deepEqual(orderedRouteIds(removed.stops, ['b', 'c', 'd']), ['b', 'c', 'd']);

console.log('Built routes keep added and removed stops until re-optimize');

for (const point of [{lat:null,lng:null},{lat:'',lng:''},{lat:91,lng:0},{lat:0,lng:181}]) {
  assert.deepEqual(reviseBuiltRoute([], ['invalid'], new Map([['invalid',{id:'invalid',...point}]])).stops, []);
}
