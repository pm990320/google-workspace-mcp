// tests/sheetsHelpers.test.js
import { a1ToRowCol, rowColToA1, normalizeRange } from '../dist/googleSheetsApiHelpers.js';
import assert from 'node:assert';
import { describe, it } from 'node:test';

describe('Sheets A1 Notation Helpers', () => {
  describe('a1ToRowCol', () => {
    it('should convert simple A1 notation correctly', () => {
      assert.deepStrictEqual(a1ToRowCol('A1'), { row: 0, col: 0 });
      assert.deepStrictEqual(a1ToRowCol('B1'), { row: 0, col: 1 });
      assert.deepStrictEqual(a1ToRowCol('A2'), { row: 1, col: 0 });
      assert.deepStrictEqual(a1ToRowCol('B2'), { row: 1, col: 1 });
    });

    it('should handle double-letter columns', () => {
      assert.deepStrictEqual(a1ToRowCol('AA1'), { row: 0, col: 26 });
      assert.deepStrictEqual(a1ToRowCol('AB1'), { row: 0, col: 27 });
      assert.deepStrictEqual(a1ToRowCol('AZ1'), { row: 0, col: 51 });
      assert.deepStrictEqual(a1ToRowCol('BA1'), { row: 0, col: 52 });
    });

    it('should handle triple-letter columns', () => {
      assert.deepStrictEqual(a1ToRowCol('AAA1'), { row: 0, col: 702 });
    });

    it('should handle large row numbers', () => {
      assert.deepStrictEqual(a1ToRowCol('A1000'), { row: 999, col: 0 });
      assert.deepStrictEqual(a1ToRowCol('Z999'), { row: 998, col: 25 });
    });

    it('should be case-insensitive', () => {
      assert.deepStrictEqual(a1ToRowCol('a1'), { row: 0, col: 0 });
      assert.deepStrictEqual(a1ToRowCol('aa1'), { row: 0, col: 26 });
    });

    it('should throw UserError for invalid notation', () => {
      assert.throws(() => a1ToRowCol(''), { name: 'UserError' });
      assert.throws(() => a1ToRowCol('1'), { name: 'UserError' });
      assert.throws(() => a1ToRowCol('A'), { name: 'UserError' });
      assert.throws(() => a1ToRowCol('1A'), { name: 'UserError' });
      assert.throws(() => a1ToRowCol('A-1'), { name: 'UserError' });
      assert.throws(() => a1ToRowCol('A1:B2'), { name: 'UserError' }); // Range, not cell
    });

    it('should handle A0 notation (returns row -1)', () => {
      // Note: The function doesn't validate row >= 1, so A0 returns {row: -1, col: 0}
      // This behavior could be considered a bug but matches current implementation
      assert.deepStrictEqual(a1ToRowCol('A0'), { row: -1, col: 0 });
    });
  });

  describe('rowColToA1', () => {
    it('should convert simple indices correctly', () => {
      assert.strictEqual(rowColToA1(0, 0), 'A1');
      assert.strictEqual(rowColToA1(0, 1), 'B1');
      assert.strictEqual(rowColToA1(1, 0), 'A2');
      assert.strictEqual(rowColToA1(1, 1), 'B2');
    });

    it('should handle double-letter columns', () => {
      assert.strictEqual(rowColToA1(0, 26), 'AA1');
      assert.strictEqual(rowColToA1(0, 27), 'AB1');
      assert.strictEqual(rowColToA1(0, 51), 'AZ1');
      assert.strictEqual(rowColToA1(0, 52), 'BA1');
    });

    it('should handle triple-letter columns', () => {
      assert.strictEqual(rowColToA1(0, 702), 'AAA1');
    });

    it('should handle large row numbers', () => {
      assert.strictEqual(rowColToA1(999, 0), 'A1000');
      assert.strictEqual(rowColToA1(998, 25), 'Z999');
    });

    it('should throw UserError for negative indices', () => {
      assert.throws(() => rowColToA1(-1, 0), { name: 'UserError' });
      assert.throws(() => rowColToA1(0, -1), { name: 'UserError' });
      assert.throws(() => rowColToA1(-1, -1), { name: 'UserError' });
    });

    it('should be inverse of a1ToRowCol', () => {
      // Test round-trip conversion
      const testCases = ['A1', 'Z1', 'AA1', 'AZ1', 'BA1', 'ZZ1', 'AAA1', 'A100', 'Z999'];
      for (const cell of testCases) {
        const { row, col } = a1ToRowCol(cell);
        assert.strictEqual(rowColToA1(row, col), cell.toUpperCase());
      }
    });
  });

  describe('normalizeRange', () => {
    it('should prepend default sheet name when no sheet specified', () => {
      assert.strictEqual(normalizeRange('A1'), 'Sheet1!A1');
      assert.strictEqual(normalizeRange('A1:B2'), 'Sheet1!A1:B2');
    });

    it('should prepend custom sheet name when provided', () => {
      assert.strictEqual(normalizeRange('A1', 'MySheet'), 'MySheet!A1');
      assert.strictEqual(normalizeRange('A1:B2', 'Data'), 'Data!A1:B2');
    });

    it('should not modify ranges that already have sheet name', () => {
      assert.strictEqual(normalizeRange('Sheet1!A1'), 'Sheet1!A1');
      assert.strictEqual(normalizeRange('MyData!A1:B2'), 'MyData!A1:B2');
      assert.strictEqual(normalizeRange("'Sheet Name'!A1"), "'Sheet Name'!A1");
    });

    it('should not add sheet name if already present even when sheetName provided', () => {
      // The function prioritizes existing sheet name in the range
      assert.strictEqual(normalizeRange('ExistingSheet!A1', 'NewSheet'), 'ExistingSheet!A1');
    });
  });
});
