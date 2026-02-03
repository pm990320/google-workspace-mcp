// tests/docsStyleBuilders.test.js
import {
  buildUpdateTextStyleRequest,
  buildUpdateParagraphStyleRequest,
  getAllTabs,
  getTabTextLength,
  findTabById,
} from '../dist/googleDocsApiHelpers.js';
import assert from 'node:assert';
import { describe, it } from 'node:test';

describe('Docs Style Request Builders', () => {
  describe('buildUpdateTextStyleRequest', () => {
    it('should return null when no styles provided', () => {
      const result = buildUpdateTextStyleRequest(0, 10, {});
      assert.strictEqual(result, null);
    });

    it('should build request for bold style', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { bold: true });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['bold']);
      assert.strictEqual(result.request.updateTextStyle.textStyle.bold, true);
      assert.strictEqual(result.request.updateTextStyle.range.startIndex, 0);
      assert.strictEqual(result.request.updateTextStyle.range.endIndex, 10);
    });

    it('should build request for multiple text styles', () => {
      const result = buildUpdateTextStyleRequest(5, 15, {
        bold: true,
        italic: true,
        underline: true,
        strikethrough: false,
      });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['bold', 'italic', 'underline', 'strikethrough']);
      assert.strictEqual(result.request.updateTextStyle.textStyle.bold, true);
      assert.strictEqual(result.request.updateTextStyle.textStyle.italic, true);
      assert.strictEqual(result.request.updateTextStyle.textStyle.underline, true);
      assert.strictEqual(result.request.updateTextStyle.textStyle.strikethrough, false);
    });

    it('should build request for fontSize', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { fontSize: 14 });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['fontSize']);
      assert.deepStrictEqual(result.request.updateTextStyle.textStyle.fontSize, {
        magnitude: 14,
        unit: 'PT',
      });
    });

    it('should build request for fontFamily', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { fontFamily: 'Arial' });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['weightedFontFamily']);
      assert.deepStrictEqual(result.request.updateTextStyle.textStyle.weightedFontFamily, {
        fontFamily: 'Arial',
      });
    });

    it('should build request for foregroundColor', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { foregroundColor: '#FF0000' });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['foregroundColor']);
      assert.deepStrictEqual(
        result.request.updateTextStyle.textStyle.foregroundColor.color.rgbColor,
        {
          red: 1,
          green: 0,
          blue: 0,
        }
      );
    });

    it('should build request for backgroundColor', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { backgroundColor: '#00FF00' });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['backgroundColor']);
      assert.deepStrictEqual(
        result.request.updateTextStyle.textStyle.backgroundColor.color.rgbColor,
        {
          red: 0,
          green: 1,
          blue: 0,
        }
      );
    });

    it('should build request for linkUrl', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { linkUrl: 'https://example.com' });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['link']);
      assert.deepStrictEqual(result.request.updateTextStyle.textStyle.link, {
        url: 'https://example.com',
      });
    });

    it('should build request for removeLink', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { removeLink: true });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['link']);
      assert.deepStrictEqual(result.request.updateTextStyle.textStyle.link, {});
    });

    it('should throw UserError for invalid hex color', () => {
      assert.throws(() => buildUpdateTextStyleRequest(0, 10, { foregroundColor: 'invalid' }), {
        name: 'UserError',
      });
      assert.throws(() => buildUpdateTextStyleRequest(0, 10, { backgroundColor: 'notacolor' }), {
        name: 'UserError',
      });
    });

    it('should build fields string correctly', () => {
      const result = buildUpdateTextStyleRequest(0, 10, { bold: true, italic: true });
      assert.ok(result);
      assert.strictEqual(result.request.updateTextStyle.fields, 'bold,italic');
    });
  });

  describe('buildUpdateParagraphStyleRequest', () => {
    it('should return null when no styles provided', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, {});
      assert.strictEqual(result, null);
    });

    it('should build request for alignment', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, { alignment: 'CENTER' });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['alignment']);
      assert.strictEqual(result.request.updateParagraphStyle.paragraphStyle.alignment, 'CENTER');
    });

    it('should build request for indentation', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, {
        indentStart: 36,
        indentEnd: 18,
      });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['indentStart', 'indentEnd']);
      assert.deepStrictEqual(result.request.updateParagraphStyle.paragraphStyle.indentStart, {
        magnitude: 36,
        unit: 'PT',
      });
      assert.deepStrictEqual(result.request.updateParagraphStyle.paragraphStyle.indentEnd, {
        magnitude: 18,
        unit: 'PT',
      });
    });

    it('should build request for spacing', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, {
        spaceAbove: 12,
        spaceBelow: 6,
      });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['spaceAbove', 'spaceBelow']);
      assert.deepStrictEqual(result.request.updateParagraphStyle.paragraphStyle.spaceAbove, {
        magnitude: 12,
        unit: 'PT',
      });
      assert.deepStrictEqual(result.request.updateParagraphStyle.paragraphStyle.spaceBelow, {
        magnitude: 6,
        unit: 'PT',
      });
    });

    it('should build request for namedStyleType', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, { namedStyleType: 'HEADING_1' });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['namedStyleType']);
      assert.strictEqual(
        result.request.updateParagraphStyle.paragraphStyle.namedStyleType,
        'HEADING_1'
      );
    });

    it('should build request for keepWithNext', () => {
      const result = buildUpdateParagraphStyleRequest(0, 10, { keepWithNext: true });
      assert.ok(result);
      assert.deepStrictEqual(result.fields, ['keepWithNext']);
      assert.strictEqual(result.request.updateParagraphStyle.paragraphStyle.keepWithNext, true);
    });

    it('should set correct range indices', () => {
      const result = buildUpdateParagraphStyleRequest(100, 200, { alignment: 'START' });
      assert.ok(result);
      assert.strictEqual(result.request.updateParagraphStyle.range.startIndex, 100);
      assert.strictEqual(result.request.updateParagraphStyle.range.endIndex, 200);
    });
  });
});

describe('Docs Tab Helpers', () => {
  describe('getAllTabs', () => {
    it('should return empty array for document with no tabs', () => {
      const doc = {};
      const result = getAllTabs(doc);
      assert.deepStrictEqual(result, []);
    });

    it('should return empty array for document with empty tabs array', () => {
      const doc = { tabs: [] };
      const result = getAllTabs(doc);
      assert.deepStrictEqual(result, []);
    });

    it('should return flat list of tabs with level info', () => {
      const doc = {
        tabs: [
          { tabProperties: { tabId: 'tab1', title: 'Tab 1' } },
          { tabProperties: { tabId: 'tab2', title: 'Tab 2' } },
        ],
      };
      const result = getAllTabs(doc);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].tabProperties.tabId, 'tab1');
      assert.strictEqual(result[0].level, 0);
      assert.strictEqual(result[1].tabProperties.tabId, 'tab2');
      assert.strictEqual(result[1].level, 0);
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
      assert.strictEqual(result.length, 5);

      // Check order and levels
      assert.strictEqual(result[0].tabProperties.tabId, 'parent1');
      assert.strictEqual(result[0].level, 0);

      assert.strictEqual(result[1].tabProperties.tabId, 'child1');
      assert.strictEqual(result[1].level, 1);

      assert.strictEqual(result[2].tabProperties.tabId, 'grandchild1');
      assert.strictEqual(result[2].level, 2);

      assert.strictEqual(result[3].tabProperties.tabId, 'child2');
      assert.strictEqual(result[3].level, 1);

      assert.strictEqual(result[4].tabProperties.tabId, 'parent2');
      assert.strictEqual(result[4].level, 0);
    });
  });

  describe('getTabTextLength', () => {
    it('should return 0 for undefined documentTab', () => {
      assert.strictEqual(getTabTextLength(undefined), 0);
    });

    it('should return 0 for documentTab with no body', () => {
      assert.strictEqual(getTabTextLength({}), 0);
    });

    it('should return 0 for documentTab with no content', () => {
      assert.strictEqual(getTabTextLength({ body: {} }), 0);
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
      assert.strictEqual(getTabTextLength(documentTab), 11); // 'Hello ' + 'World'
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
      assert.strictEqual(getTabTextLength(documentTab), 12); // 'Cell 1' + 'Cell 2'
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
      assert.strictEqual(getTabTextLength(documentTab), 15); // 'Intro\n' + 'Data' + 'Outro'
    });
  });

  describe('findTabById', () => {
    it('should return null for document with no tabs', () => {
      const doc = {};
      assert.strictEqual(findTabById(doc, 'tab1'), null);
    });

    it('should return null for document with empty tabs', () => {
      const doc = { tabs: [] };
      assert.strictEqual(findTabById(doc, 'tab1'), null);
    });

    it('should find top-level tab', () => {
      const doc = {
        tabs: [
          { tabProperties: { tabId: 'tab1', title: 'Tab 1' } },
          { tabProperties: { tabId: 'tab2', title: 'Tab 2' } },
        ],
      };
      const result = findTabById(doc, 'tab2');
      assert.ok(result);
      assert.strictEqual(result.tabProperties.tabId, 'tab2');
      assert.strictEqual(result.tabProperties.title, 'Tab 2');
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
      assert.ok(child);
      assert.strictEqual(child.tabProperties.title, 'Child');

      const grandchild = findTabById(doc, 'grandchild');
      assert.ok(grandchild);
      assert.strictEqual(grandchild.tabProperties.title, 'Grandchild');
    });

    it('should return null for non-existent tab', () => {
      const doc = {
        tabs: [{ tabProperties: { tabId: 'tab1', title: 'Tab 1' } }],
      };
      assert.strictEqual(findTabById(doc, 'nonexistent'), null);
    });
  });
});
