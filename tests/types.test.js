// tests/types.test.js
import { hexToRgbColor, validateHexColor } from '../dist/types.js';
import assert from 'node:assert';
import { describe, it } from 'node:test';

describe('Color Validation and Conversion', () => {
  // Test hypothesis 3: Hex color validation and conversion

  describe('validateHexColor', () => {
    it('should validate correct hex colors with hash', () => {
      assert.strictEqual(validateHexColor('#FF0000'), true); // 6 digits red
      assert.strictEqual(validateHexColor('#F00'), true); // 3 digits red
      assert.strictEqual(validateHexColor('#00FF00'), true); // 6 digits green
      assert.strictEqual(validateHexColor('#0F0'), true); // 3 digits green
    });

    it('should validate correct hex colors without hash', () => {
      assert.strictEqual(validateHexColor('FF0000'), true); // 6 digits red
      assert.strictEqual(validateHexColor('F00'), true); // 3 digits red
      assert.strictEqual(validateHexColor('00FF00'), true); // 6 digits green
      assert.strictEqual(validateHexColor('0F0'), true); // 3 digits green
    });

    it('should reject invalid hex colors', () => {
      assert.strictEqual(validateHexColor(''), false); // Empty
      assert.strictEqual(validateHexColor('#XYZ'), false); // Invalid characters
      assert.strictEqual(validateHexColor('#12345'), false); // Invalid length (5)
      assert.strictEqual(validateHexColor('#1234567'), false); // Invalid length (7)
      assert.strictEqual(validateHexColor('invalid'), false); // Not a hex color
      assert.strictEqual(validateHexColor('#12'), false); // Too short
    });
  });

  describe('hexToRgbColor', () => {
    it('should convert 6-digit hex colors with hash correctly', () => {
      const result = hexToRgbColor('#FF0000');
      assert.deepStrictEqual(result, { red: 1, green: 0, blue: 0 }); // Red

      const resultGreen = hexToRgbColor('#00FF00');
      assert.deepStrictEqual(resultGreen, { red: 0, green: 1, blue: 0 }); // Green

      const resultBlue = hexToRgbColor('#0000FF');
      assert.deepStrictEqual(resultBlue, { red: 0, green: 0, blue: 1 }); // Blue

      const resultPurple = hexToRgbColor('#800080');
      assert.deepStrictEqual(resultPurple, {
        red: 0.5019607843137255,
        green: 0,
        blue: 0.5019607843137255,
      }); // Purple
    });

    it('should convert 3-digit hex colors correctly', () => {
      const result = hexToRgbColor('#F00');
      assert.deepStrictEqual(result, { red: 1, green: 0, blue: 0 }); // Red from shorthand

      const resultWhite = hexToRgbColor('#FFF');
      assert.deepStrictEqual(resultWhite, { red: 1, green: 1, blue: 1 }); // White from shorthand
    });

    it('should convert hex colors without hash correctly', () => {
      const result = hexToRgbColor('FF0000');
      assert.deepStrictEqual(result, { red: 1, green: 0, blue: 0 }); // Red without hash
    });

    it('should return null for invalid hex colors', () => {
      assert.strictEqual(hexToRgbColor(''), null); // Empty
      assert.strictEqual(hexToRgbColor('#XYZ'), null); // Invalid characters
      assert.strictEqual(hexToRgbColor('#12345'), null); // Invalid length
      assert.strictEqual(hexToRgbColor('invalid'), null); // Not a hex color
    });
  });
});
