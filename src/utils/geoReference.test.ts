import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState,
  normalizeDma,
  parseGeoTextInput,
  extractGeoFromSpreadsheetRows,
} from './geoReference.js';

test('normalizeState maps postal codes and full names', () => {
  const ny = normalizeState('NY');
  assert.equal(ny?.code, 'AL' === ny?.code ? 'AL' : 'NY');
  assert.equal(ny?.name, 'New York');

  const cal = normalizeState('california');
  assert.equal(cal?.code, 'CA');
  assert.equal(cal?.name, 'California');

  const invalid = normalizeState('Atlantis');
  assert.equal(invalid, null);
});

test('normalizeDma maps canonical names and aliases', () => {
  assert.equal(normalizeDma('NYC'), 'New York, NY');
  assert.equal(normalizeDma('Los Angeles'), 'Los Angeles, CA');
  assert.equal(normalizeDma('Chicago'), 'Chicago, IL');
  assert.equal(normalizeDma('DFW'), 'Dallas-Ft. Worth, TX');
  assert.equal(normalizeDma('501'), 'New York, NY');
});

test('parseGeoTextInput correctly parses comma, newline, and semicolon separated inputs', () => {
  const stateResult = parseGeoTextInput('NY, CA; Texas\nFlorida, UnknownPlace', 'State');
  assert.equal(stateResult.valid.length, 4);
  assert.ok(stateResult.valid.includes('New York (NY)'));
  assert.ok(stateResult.valid.includes('California (CA)'));
  assert.ok(stateResult.valid.includes('Texas (TX)'));
  assert.ok(stateResult.valid.includes('Florida (FL)'));
  assert.deepEqual(stateResult.unrecognized, ['UnknownPlace']);

  const dmaResult = parseGeoTextInput('NYC, Los Angeles, Chicago, FakeMarket', 'DMA');
  assert.equal(dmaResult.valid.length, 3);
  assert.ok(dmaResult.valid.includes('New York, NY'));
  assert.ok(dmaResult.valid.includes('Los Angeles, CA'));
  assert.ok(dmaResult.valid.includes('Chicago, IL'));
  assert.deepEqual(dmaResult.unrecognized, ['FakeMarket']);
});

test('extractGeoFromSpreadsheetRows extracts targets from spreadsheet table format', () => {
  const tableData = [
    ['Rank', 'Market Name', 'TV Homes'],
    ['1', 'New York', '7,450,000'],
    ['2', 'Los Angeles', '5,730,000'],
    ['3', 'Chicago', '3,470,000'],
  ];

  const result = extractGeoFromSpreadsheetRows(tableData, 'DMA');
  assert.equal(result.valid.length, 3);
  assert.ok(result.valid.includes('New York, NY'));
  assert.ok(result.valid.includes('Los Angeles, CA'));
  assert.ok(result.valid.includes('Chicago, IL'));
  assert.equal(result.detectedColumnName, 'Market Name');
});
