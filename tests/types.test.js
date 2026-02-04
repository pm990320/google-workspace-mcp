// tests/types.test.js
import { hexToRgbColor, validateHexColor } from '../dist/types.js';
import { describe, it, expect } from 'vitest';

describe('Color Validation and Conversion', () => {
  // Test hypothesis 3: Hex color validation and conversion

  describe('validateHexColor', () => {
    it('should validate correct hex colors with hash', () => {
      expect(validateHexColor('#FF0000')).toBe(true); // 6 digits red
      expect(validateHexColor('#F00')).toBe(true); // 3 digits red
      expect(validateHexColor('#00FF00')).toBe(true); // 6 digits green
      expect(validateHexColor('#0F0')).toBe(true); // 3 digits green
    });

    it('should validate correct hex colors without hash', () => {
      expect(validateHexColor('FF0000')).toBe(true); // 6 digits red
      expect(validateHexColor('F00')).toBe(true); // 3 digits red
      expect(validateHexColor('00FF00')).toBe(true); // 6 digits green
      expect(validateHexColor('0F0')).toBe(true); // 3 digits green
    });

    it('should reject invalid hex colors', () => {
      expect(validateHexColor('')).toBe(false); // Empty
      expect(validateHexColor('#XYZ')).toBe(false); // Invalid characters
      expect(validateHexColor('#12345')).toBe(false); // Invalid length (5)
      expect(validateHexColor('#1234567')).toBe(false); // Invalid length (7)
      expect(validateHexColor('invalid')).toBe(false); // Not a hex color
      expect(validateHexColor('#12')).toBe(false); // Too short
    });
  });

  describe('hexToRgbColor', () => {
    it('should convert 6-digit hex colors with hash correctly', () => {
      const result = hexToRgbColor('#FF0000');
      expect(result).toEqual({ red: 1, green: 0, blue: 0 }); // Red

      const resultGreen = hexToRgbColor('#00FF00');
      expect(resultGreen).toEqual({ red: 0, green: 1, blue: 0 }); // Green

      const resultBlue = hexToRgbColor('#0000FF');
      expect(resultBlue).toEqual({ red: 0, green: 0, blue: 1 }); // Blue

      const resultPurple = hexToRgbColor('#800080');
      expect(resultPurple).toEqual({
        red: 0.5019607843137255,
        green: 0,
        blue: 0.5019607843137255,
      }); // Purple
    });

    it('should convert 3-digit hex colors correctly', () => {
      const result = hexToRgbColor('#F00');
      expect(result).toEqual({ red: 1, green: 0, blue: 0 }); // Red from shorthand

      const resultWhite = hexToRgbColor('#FFF');
      expect(resultWhite).toEqual({ red: 1, green: 1, blue: 1 }); // White from shorthand
    });

    it('should convert hex colors without hash correctly', () => {
      const result = hexToRgbColor('FF0000');
      expect(result).toEqual({ red: 1, green: 0, blue: 0 }); // Red without hash
    });

    it('should return null for invalid hex colors', () => {
      expect(hexToRgbColor('')).toBe(null); // Empty
      expect(hexToRgbColor('#XYZ')).toBe(null); // Invalid characters
      expect(hexToRgbColor('#12345')).toBe(null); // Invalid length
      expect(hexToRgbColor('invalid')).toBe(null); // Not a hex color
    });
  });
});
