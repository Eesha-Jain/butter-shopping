import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanStoreName,
  describeSelection,
  groupStores,
  matchStoresForQuery,
  storeDisplayName,
  storeKey,
  toggleGroupIds,
} from './store-names.ts';

const store = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  ...extra,
});

test('cleanStoreName strips store numbers and location suffixes', () => {
  assert.equal(cleanStoreName('Safeway #1234'), 'Safeway');
  assert.equal(cleanStoreName('QFC - 0612'), 'QFC');
  assert.equal(cleanStoreName('Fred Meyer - Ballard'), 'Fred Meyer');
  assert.equal(cleanStoreName('Whole Foods Market – Roosevelt Square'), 'Whole Foods Market');
  assert.equal(cleanStoreName('QFC (Capitol Hill)'), 'QFC');
  assert.equal(cleanStoreName('Safeway 1523'), 'Safeway');
  assert.equal(cleanStoreName('Safeway-1523'), 'Safeway');
  assert.equal(cleanStoreName('Trader Joe\'s'), 'Trader Joe\'s');
  assert.equal(cleanStoreName('7-Eleven'), '7-Eleven');
  assert.equal(cleanStoreName('#123'), '#123');
});

test('cleanStoreName drops a trailing city', () => {
  assert.equal(cleanStoreName('Fred Meyer Ballard', 'Ballard'), 'Fred Meyer');
  assert.equal(cleanStoreName('Ballard', 'Ballard'), 'Ballard');
});

test('storeKey ignores case, punctuation and spacing', () => {
  const key = storeKey('Fred Meyer');
  assert.equal(storeKey('FRED MEYER'), key);
  assert.equal(storeKey('Fred Meyer - Ballard'), key);
  assert.equal(storeKey('fred  meyer #0012'), key);
  assert.equal(storeKey("Trader Joe's"), storeKey('TRADER JOES'));
  assert.equal(storeKey('Albertsons & Sons'), storeKey('albertsons and sons'));
});

test('storeDisplayName fixes shouting but keeps acronyms', () => {
  assert.equal(storeDisplayName('FRED MEYER'), 'Fred Meyer');
  assert.equal(storeDisplayName('QFC #12'), 'QFC');
  assert.equal(storeDisplayName('Fred Meyer - Ballard'), 'Fred Meyer');
});

test('groupStores merges variants of one chain and keeps nearest-first order', () => {
  const groups = groupStores([
    store('1', 'FRED MEYER', { distance_km: 3 }),
    store('2', 'Safeway #1', { distance_km: 4 }),
    store('3', 'Fred Meyer - Ballard', { distance_km: 5 }),
    store('4', 'Fred Meyer', { distance_km: 1, accepts_snap: true }),
    store('5', 'QFC - 0612', { distance_km: 6 }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.name),
    ['Fred Meyer', 'Safeway', 'QFC'],
  );
  assert.deepEqual(groups[0].ids, ['1', '3', '4']);
  assert.equal(groups[0].nearestKm, 1);
  assert.equal(groups[0].acceptsSnap, true);
  assert.equal(groups[1].acceptsSnap, false);
});

test('groupStores prefers a properly-cased variant for the label', () => {
  const [group] = groupStores([store('1', 'FRED MEYER'), store('2', 'Fred Meyer - Ballard')]);
  assert.equal(group.name, 'Fred Meyer');
});

test('toggleGroupIds selects then clears a whole chain', () => {
  const [group] = groupStores([store('1', 'Fred Meyer'), store('2', 'FRED MEYER - Ballard')]);
  const on = toggleGroupIds(group, ['9']);
  assert.deepEqual(on.sort(), ['1', '2', '9']);
  assert.deepEqual(toggleGroupIds(group, on), ['9']);
  // Partial selection completes the chain instead of clearing it.
  assert.deepEqual(toggleGroupIds(group, ['1']).sort(), ['1', '2']);
});

test('describeSelection names whole chains and annotates partial ones', () => {
  const groups = groupStores([
    store('1', 'Fred Meyer', { city: 'Seattle' }),
    store('2', 'Fred Meyer - Ballard', { city: 'Ballard' }),
    store('3', 'QFC', { city: 'Seattle' }),
  ]);
  assert.deepEqual(describeSelection(groups, ['1', '2', '3']), ['Fred Meyer', 'QFC']);
  assert.deepEqual(describeSelection(groups, ['2']), ['Fred Meyer · Ballard']);
  assert.deepEqual(describeSelection(groups, []), []);
});

test('matchStoresForQuery matches name and location, not product words', () => {
  const stores = [
    store('1', 'Fred Meyer', { city: 'Seattle', postal_code: '98107', address_line1: '915 NW 45th St' }),
    store('2', 'QFC', { city: 'Bellevue', postal_code: '98004', address_line1: '10116 NE 8th St' }),
  ];
  assert.deepEqual(matchStoresForQuery('seattle', stores).map((s) => s.id), ['1']);
  assert.deepEqual(matchStoresForQuery('98004', stores).map((s) => s.id), ['2']);
  assert.deepEqual(matchStoresForQuery('fred seat', stores).map((s) => s.id), ['1']);
  assert.deepEqual(matchStoresForQuery('qfc bellevue', stores).map((s) => s.id), ['2']);
  assert.deepEqual(matchStoresForQuery('qfc seattle', stores), []);
  assert.deepEqual(matchStoresForQuery('milk', stores), []);
  assert.deepEqual(matchStoresForQuery('wa', stores), []);
  assert.deepEqual(matchStoresForQuery('', stores), []);
});
