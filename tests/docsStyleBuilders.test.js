// tests/docsStyleBuilders.test.js
import {
  buildUpdateTextStyleRequest,
  buildUpdateParagraphStyleRequest,
  getAllTabs,
  getTabTextLength,
  findTabById,
} from '../dist/googleDocsApiHelpers.js';
import { describe, it, expect } from 'vitest';

describe('Docs Style Request Builders', () => {
  describe('buildUpdateTextStyleRequest', () => {
    it('should return null when no styles provided', () => {
      const result = buildUpdateTextStyleRequest(0, 10, {});
      expect(result).toBe(null);
    });

    it('should build request for bold style', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { bold: true });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['bold']);
      expect(result.request.updateTextStyle.textStyle.bold).toBe(true);
      expect(result.request.updateTextStyle.range.startIndex).toBe(0);
      expect(result.request.updateTextStyle.range.endIndex).toBe(10);
    });

    it('should build request for multiple text styles', () => {
      const result = buildUpdateTextStyleRequest(5, 15, {
        bold: true,
        italic: true,
        underline: true,
        strikethrough: false,
      });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['bold', 'italic', 'underline', 'strikethrough']);
      expect(result.request.updateTextStyle.textStyle.bold).toBe(true);
      expect(result.request.updateTextStyle.textStyle.italic).toBe(true);
      expect(result.request.updateTextStyle.textStyle.underline).toBe(true);
      expect(result.request.updateTextStyle.textStyle.strikethrough).toBe(false);
    });

    it('should build request for fontSize', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { fontSize: 14 });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['fontSize']);
      expect(result.request.updateTextStyle.textStyle.fontSize).toEqual({
        magnitude: 14,
        unit: 'PT',
      });
    });

    it('should build request for fontFamily', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { fontFamily: 'Arial' });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['weightedFontFamily']);
      expect(result.request.updateTextStyle.textStyle.weightedFontFamily).toEqual({
        fontFamily: 'Arial',
      });
    });

    it('should build request for foregroundColor', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { foregroundColor: '#FF0000' });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['foregroundColor']);
      expect(result.request.updateTextStyle.textStyle.foregroundColor.color.rgbColor).toEqual({
        red: 1,
        green: 0,
        blue: 0,
      });
    });

    it('should build request for backgroundColor', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { backgroundColor: '#00FF00' });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['backgroundColor']);
      expect(result.request.updateTextStyle.textStyle.backgroundColor.color.rgbColor).toEqual({
        red: 0,
        green: 1,
        blue: 0,
      });
    });

    it('should build request for linkUrl', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { linkUrl: 'https://example.com' });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['link']);
      expect(result.request.updateTextStyle.textStyle.link).toEqual({
        url: 'https://example.com',
      });
    });

    it('should build request for removeLink', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { removeLink: true });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['link']);
      expect(result.request.updateTextStyle.textStyle.link).toEqual({});
    });

    it('should throw UserError for invalid hex color', () => {
      expect(() => buildUpdateTextStyleRequest(0, 10, { foregroundColor: 'invalid' })).toThrow();
      expect(() => buildUpdateTextStyleRequest(0, 10, { backgroundColor: 'notacolor' })).toThrow();
    });

    it('should build fields string correctly', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { bold: true, italic: true });
      expect(result).toBeTruthy();
      expect(result.request.updateTextStyle.fields).toBe('bold,italic');
    });
  });

  describe('buildUpdateParagraphStyleRequest', () => {
    it('should return null when no styles provided', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, {});
      expect(result).toBe(null);
    });

    it('should build request for alignment', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, { alignment: 'CENTER' });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['alignment']);
      expect(result.request.updateParagraphStyle.paragraphStyle.alignment).toBe('CENTER');
    });

    it('should build request for indentation', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, {
        indentStart: 36,
        indentEnd: 18,
      });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['indentStart', 'indentEnd']);
      expect(result.request.updateParagraphStyle.paragraphStyle.indentStart).toEqual({
        magnitude: 36,
        unit: 'PT',
      });
      expect(result.request.updateParagraphStyle.paragraphStyle.indentEnd).toEqual({
        magnitude: 18,
        unit: 'PT',
      });
    });

    it('should build request for spacing', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, {
        spaceAbove: 12,
        spaceBelow: 6,
      });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['spaceAbove', 'spaceBelow']);
      expect(result.request.updateParagraphStyle.paragraphStyle.spaceAbove).toEqual({
        magnitude: 12,
        unit: 'PT',
      });
      expect(result.request.updateParagraphStyle.paragraphStyle.spaceBelow).toEqual({
        magnitude: 6,
        unit: 'PT',
      });
    });

    it('should build request for namedStyleType', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, { namedStyleType: 'HEADING_1' });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['namedStyleType']);
      expect(result.request.updateParagraphStyle.paragraphStyle.namedStyleType).toBe('HEADING_1');
    });

    it('should build request for keepWithNext', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, { keepWithNext: true });
      expect(result).toBeTruthy();
      expect(result.fields).toEqual(['keepWithNext']);
      expect(result.request.updateParagraphStyle.paragraphStyle.keepWithNext).toBe(true);
    });

    it('should set correct range indices', () => {
      const result = buildUpdateParagraphStyleRequest(100, 200, { alignment: 'START' });
      expect(result).toBeTruthy();
      expect(result.request.updateParagraphStyle.range.startIndex).toBe(100);
      expect(result.request.updateParagraphStyle.range.endIndex).toBe(200);
    });
  });
});

describe('Docs Tab Helpers', () => {
  describe('getAllTabs', () => {
    it('should return empty array for document with no tabs', () => {
      const doc = {};
      const result = getAllTabs(doc);
      expect(result).toEqual([]);
    });

    it('should return empty array for document with empty tabs array', () => {
      const doc = { tabs: [] };
      const result = getAllTabs(doc);
      expect(result).toEqual([]);
    });

    it('should return flat list of tabs with level info', () => {
      const doc = {
        tabs: [
          { tabProperties: { tabId: 'tab1', title: 'Tab 1' } },
          { tabProperties: { tabId: 'tab2', title: 'Tab 2' } },
        ],
      };
      const result = getAllTabs(doc);
      expect(result.length).toBe(2);
      expect(result[0].tabProperties.tabId).toBe('tab1');
      expect(result[0].level).toBe(0);
      expect(result[1].tabProperties.tabId).toBe('tab2');
      expect(result[1].level).toBe(0);
    });

    it('should flatten nested child tabs with correct levels', () => {
      const doc = {
        tabs: [
          {
            tabProperties: { tabId: 'parent1', title: 'Parent 1' },
            childTabs: [
              {
                tabProperties: { tabId: 'child1', title: 'Child 1' },
                childTabs: [{ tabProperties: { tabId: 'grandchild1', title: 'Grandchild 1' } }],
              },
              { tabProperties: { tabId: 'child2', title: 'Child 2' } },
            ],
          },
          { tabProperties: { tabId: 'parent2', title: 'Parent 2' } },
        ],
      };
      const result = getAllTabs(doc);
      expect(result.length).toBe(5);

      // Check order and levels
      expect(result[0].tabProperties.tabId).toBe('parent1');
      expect(result[0].level).toBe(0);

      expect(result[1].tabProperties.tabId).toBe('child1');
      expect(result[1].level).toBe(1);

      expect(result[2].tabProperties.tabId).toBe('grandchild1');
      expect(result[2].level).toBe(2);

      expect(result[3].tabProperties.tabId).toBe('child2');
      expect(result[3].level).toBe(1);

      expect(result[4].tabProperties.tabId).toBe('parent2');
      expect(result[4].level).toBe(0);
    });
  });

  describe('getTabTextLength', () => {
    it('should return 0 for undefined documentTab', () => {
      expect(getTabTextLength(undefined)).toBe(0);
    });

    it('should return 0 for documentTab with no body', () => {
      expect(getTabTextLength({})).toBe(0);
    });

    it('should return 0 for documentTab with no content', () => {
      expect(getTabTextLength({ body: {} })).toBe(0);
    });

    it('should count text in paragraphs', () => {
      const documentTab = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Hello ' } }, { textRun: { content: 'World' } }],
              },
            },
          ],
        },
      };
      expect(getTabTextLength(documentTab)).toBe(11); // 'Hello ' + 'World'
    });

    it('should count text in tables', () => {
      const documentTab = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: 'Cell 1' } }],
                            },
                          },
                        ],
                      },
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: 'Cell 2' } }],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };
      expect(getTabTextLength(documentTab)).toBe(12); // 'Cell 1' + 'Cell 2'
    });

    it('should handle mixed content', () => {
      const documentTab = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Intro\n' } }],
              },
            },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            paragraph: {
                              elements: [{ textRun: { content: 'Data' } }],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Outro' } }],
              },
            },
          ],
        },
      };
      expect(getTabTextLength(documentTab)).toBe(15); // 'Intro\n' + 'Data' + 'Outro'
    });
  });

  describe('findTabById', () => {
    it('should return null for document with no tabs', () => {
      const doc = {};
      expect(findTabById(doc, 'tab1')).toBe(null);
    });

    it('should return null for document with empty tabs', () => {
      const doc = { tabs: [] };
      expect(findTabById(doc, 'tab1')).toBe(null);
    });

    it('should find top-level tab', () => {
      const doc = {
        tabs: [
          { tabProperties: { tabId: 'tab1', title: 'Tab 1' } },
          { tabProperties: { tabId: 'tab2', title: 'Tab 2' } },
        ],
      };
      const result = findTabById(doc, 'tab2');
      expect(result).toBeTruthy();
      expect(result.tabProperties.tabId).toBe('tab2');
      expect(result.tabProperties.title).toBe('Tab 2');
    });

    it('should find nested child tab', () => {
      const doc = {
        tabs: [
          {
            tabProperties: { tabId: 'parent', title: 'Parent' },
            childTabs: [
              {
                tabProperties: { tabId: 'child', title: 'Child' },
                childTabs: [{ tabProperties: { tabId: 'grandchild', title: 'Grandchild' } }],
              },
            ],
          },
        ],
      };

      const child = findTabById(doc, 'child');
      expect(child).toBeTruthy();
      expect(child.tabProperties.title).toBe('Child');

      const grandchild = findTabById(doc, 'grandchild');
      expect(grandchild).toBeTruthy();
      expect(grandchild.tabProperties.title).toBe('Grandchild');
    });

    it('should return null for non-existent tab', () => {
      const doc = {
        tabs: [{ tabProperties: { tabId: 'tab1', title: 'Tab 1' } }],
      };
      expect(findTabById(doc, 'nonexistent')).toBe(null);
    });
  });
});
