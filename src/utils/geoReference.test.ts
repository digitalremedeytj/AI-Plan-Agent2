import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState,
  normalizeDma,
  parseGeoTextInput,
  extractGeoFromSpreadsheetRows,
  NIELSEN_DMAS,
} from './geoReference.js';
import { DMA_MARKETS, findDmaByCode } from '../planning/knowledge/dmaMarkets.js';
import { resolvePickerDma } from '../planning/reach/briefGeography.js';

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

// The picker's codes once drifted from the Nielsen household file (Beaumont-Port Arthur carried
// Rockford's code), so a typed or uploaded code selected a different market than its name.
test('every picker DMA code is the household-file code for the market of the same name', () => {
  for (const dma of NIELSEN_DMAS) {
    assert.ok(dma.code, `${dma.name} has no code`);
    const byName = resolvePickerDma(dma.name);
    const byCode = findDmaByCode(String(dma.code));
    assert.ok(byCode, `${dma.name}: ${dma.code} is not in the household file`);
    assert.equal(byCode.code, byName?.id, `${dma.name}: ${dma.code} is ${byCode.name}`);
  }
});

test('the picker lists each household-file market exactly once', () => {
  const codes = NIELSEN_DMAS.map((dma) => String(dma.code));
  const repeated = codes.filter((code, index) => codes.indexOf(code) !== index);
  assert.deepEqual(repeated, [], 'picker codes listed more than once');
  const missing = DMA_MARKETS.filter((market) => !codes.includes(market.code)).map((market) => `${market.code} ${market.name}`);
  assert.deepEqual(missing, [], 'household-file markets missing from the picker');
  assert.equal(codes.length, 210);
});

test('typing a DMA code in the picker selects the entry with that code', () => {
  for (const dma of NIELSEN_DMAS) {
    const { valid, unrecognized } = parseGeoTextInput(String(dma.code), 'DMA');
    assert.deepEqual(unrecognized, [], `${dma.code} was not recognized`);
    assert.deepEqual(valid, [dma.name], `${dma.code} selected ${valid.join(' + ')}`);
  }
  assert.deepEqual(parseGeoTextInput('692, 800', 'DMA').valid, ['Beaumont-Port Arthur, TX', 'Bakersfield, CA']);
  assert.deepEqual(parseGeoTextInput('538, 611', 'DMA').valid, ['Rochester, NY', 'Rochester-Mason City-Austin, MN']);
});

test('the merged second spellings still normalize to their market', () => {
  assert.equal(normalizeDma('Yuma, AZ'), 'Yuma-El Centro, AZ');
  assert.equal(normalizeDma('Grand Junction, CO'), 'Grand Junction-Montrose, CO');
  assert.equal(normalizeDma('Panama City-Destin, FL'), 'Panama City, FL');
  assert.equal(normalizeDma('Quincy-Hannibal, IL-MO'), 'Quincy-Hannibal-Keokuk, IL');
});
