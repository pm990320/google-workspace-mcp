// tests/markdown/MarkdownToDoc.test.js
import { MarkdownToDoc } from '../../dist/markdown/MarkdownToDoc.js';
import { MarkdownElementType } from '../../dist/markdown/types.js';
import { describe, it, beforeEach, expect } from 'vitest';

describe('MarkdownToDoc', () => {
  let converter;

  beforeEach(() => {
    converter = new MarkdownToDoc();
  });

  describe('parseMarkdown()', () => {
    it('should parse simple paragraph', () => {
      const elements = converter.parseMarkdown('Hello, world!');
      expect(elements.length).toBe(1);
      expect(elements[0].type).toBe(MarkdownElementType.PARAGRAPH);
      expect(elements[0].content).toBe('Hello, world!');
    });

    it('should parse heading levels 1-6', () => {
      const markdown = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(6);
      for (let i = 0; i < 6; i++) {
        expect(elements[i].type).toBe(MarkdownElementType.HEADING);
        expect(elements[i].level).toBe(i + 1);
        expect(elements[i].content).toBe(`H${i + 1}`);
      }
    });

    it('should parse bullet list', () => {
      const markdown = `- Item 1
- Item 2
- Item 3`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(3);
      elements.forEach((el) => {
        expect(el.type).toBe(MarkdownElementType.BULLET_LIST_ITEM);
      });
    });

    it('should parse nested bullet list', () => {
      const markdown = `- Parent
  - Child
    - Grandchild`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(3);
      expect(elements[0].indent).toBe(0);
      expect(elements[1].indent).toBe(1);
      expect(elements[2].indent).toBe(2);
    });

    it('should parse numbered list', () => {
      const markdown = `1. First
2. Second
3. Third`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(3);
      elements.forEach((el) => {
        expect(el.type).toBe(MarkdownElementType.NUMBERED_LIST_ITEM);
      });
    });

    it('should parse horizontal rule', () => {
      const markdown = `Above
---
Below`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(3);
      expect(elements[1].type).toBe(MarkdownElementType.HORIZONTAL_RULE);
    });

    it('should parse image', () => {
      const markdown = '![Alt text](https://example.com/image.png)';
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(1);
      expect(elements[0].type).toBe(MarkdownElementType.IMAGE);
      expect(elements[0].imageAlt).toBe('Alt text');
      expect(elements[0].imageUrl).toBe('https://example.com/image.png');
    });

    it('should parse simple table', () => {
      const markdown = `| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(1);
      expect(elements[0].type).toBe(MarkdownElementType.TABLE);
      expect(elements[0].tableRows.length).toBe(3); // Header + 2 data rows
      expect(elements[0].tableRows[0]).toEqual(['A', 'B']);
      expect(elements[0].tableRows[1]).toEqual(['1', '2']);
    });

    it('should parse code block', () => {
      const markdown = '```\nconst x = 1;\nconsole.log(x);\n```';
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(1);
      expect(elements[0].type).toBe(MarkdownElementType.CODE_BLOCK);
      expect(elements[0].content).toBe('const x = 1;\nconsole.log(x);');
    });

    it('should parse blockquote', () => {
      const markdown = '> This is a quote';
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(1);
      expect(elements[0].type).toBe(MarkdownElementType.BLOCKQUOTE);
      expect(elements[0].content).toBe('This is a quote');
    });

    it('should skip empty lines', () => {
      const markdown = `Line 1

Line 2`;
      const elements = converter.parseMarkdown(markdown);
      expect(elements.length).toBe(2);
    });
  });

  describe('parseInlineFormatting()', () => {
    it('should extract bold formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Hello **world**!');
      expect(text).toBe('Hello world!');
      expect(formats.length).toBe(1);
      expect(formats[0].bold).toBe(true);
      expect(formats[0].start).toBe(6);
      expect(formats[0].end).toBe(11);
    });

    it('should extract italic formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Hello *world*!');
      expect(text).toBe('Hello world!');
      expect(formats.length).toBe(1);
      expect(formats[0].italic).toBe(true);
    });

    it('should extract strikethrough formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Hello ~~world~~!');
      expect(text).toBe('Hello world!');
      expect(formats.length).toBe(1);
      expect(formats[0].strikethrough).toBe(true);
    });

    it('should extract link formatting', () => {
      const { text, formats } = converter.parseInlineFormatting(
        'Visit [Google](https://google.com) today'
      );
      expect(text).toBe('Visit Google today');
      expect(formats.length).toBe(1);
      expect(formats[0].link).toBe('https://google.com');
    });

    it('should extract inline code formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Run `npm install` now');
      expect(text).toBe('Run npm install now');
      expect(formats.length).toBe(1);
      expect(formats[0].code).toBe(true);
    });

    it('should handle multiple formats', () => {
      const { text, formats } = converter.parseInlineFormatting('**Bold** and *italic* and `code`');
      expect(text).toBe('Bold and italic and code');
      expect(formats.length).toBe(3);
    });

    it('should return plain text when no formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Plain text');
      expect(text).toBe('Plain text');
      expect(formats.length).toBe(0);
    });
  });

  describe('convert()', () => {
    it('should generate insert text request for paragraph', () => {
      const result = converter.convert('Hello, world!');
      const insertRequest = result.requests.find((r) => r.insertText);
      expect(insertRequest).toBeTruthy();
      expect(insertRequest.insertText.text).toBe('Hello, world!\n');
      expect(insertRequest.insertText.location.index).toBe(1);
    });

    it('should generate heading style request', () => {
      const result = converter.convert('# My Heading');
      const styleRequest = result.requests.find((r) => r.updateParagraphStyle);
      expect(styleRequest).toBeTruthy();
      expect(styleRequest.updateParagraphStyle.paragraphStyle.namedStyleType).toBe('HEADING_1');
    });

    it('should generate bold formatting request', () => {
      const result = converter.convert('Hello **world**!');
      const boldRequest = result.requests.find((r) => r.updateTextStyle?.textStyle?.bold === true);
      expect(boldRequest).toBeTruthy();
    });

    it('should generate bullet list request', () => {
      const result = converter.convert('- Item 1\n- Item 2');
      const bulletRequests = result.requests.filter((r) => r.createParagraphBullets);
      expect(bulletRequests.length).toBe(2);
    });

    it('should generate numbered list request', () => {
      const result = converter.convert('1. First\n2. Second');
      const bulletRequests = result.requests.filter((r) => r.createParagraphBullets);
      expect(bulletRequests.length).toBe(2);
      expect(bulletRequests[0].createParagraphBullets.bulletPreset).toBe(
        'NUMBERED_DECIMAL_ALPHA_ROMAN'
      );
    });

    it('should generate link formatting request', () => {
      const result = converter.convert('[Google](https://google.com)');
      const linkRequest = result.requests.find(
        (r) => r.updateTextStyle?.textStyle?.link?.url === 'https://google.com'
      );
      expect(linkRequest).toBeTruthy();
    });

    it('should generate image insert request', () => {
      const result = converter.convert('![Alt](https://example.com/img.png)');
      const imageRequest = result.requests.find((r) => r.insertInlineImage);
      expect(imageRequest).toBeTruthy();
      expect(imageRequest.insertInlineImage.uri).toBe('https://example.com/img.png');
    });

    it('should generate table insert request', () => {
      const result = converter.convert('| A | B |\n|---|---|\n| 1 | 2 |');
      const tableRequest = result.requests.find((r) => r.insertTable);
      expect(tableRequest).toBeTruthy();
      expect(tableRequest.insertTable.rows).toBe(2); // Header + 1 data row
      expect(tableRequest.insertTable.columns).toBe(2);
    });

    it('should generate delete request for full replace', () => {
      const result = converter.convert('New content', { fullReplace: true }, 100);
      const deleteRequest = result.requests.find((r) => r.deleteContentRange);
      expect(deleteRequest).toBeTruthy();
      expect(deleteRequest.deleteContentRange.range.startIndex).toBe(1);
      expect(deleteRequest.deleteContentRange.range.endIndex).toBe(99);
    });

    it('should not generate delete request when not full replace', () => {
      const result = converter.convert('New content', {}, 100);
      const deleteRequest = result.requests.find((r) => r.deleteContentRange);
      expect(deleteRequest).toBeUndefined();
    });

    it('should not generate delete request for empty document', () => {
      const result = converter.convert('New content', { fullReplace: true }, 1);
      const deleteRequest = result.requests.find((r) => r.deleteContentRange);
      expect(deleteRequest).toBeUndefined();
    });

    it('should handle complex document with multiple elements', () => {
      const markdown = `# Title

This is a paragraph with **bold** and *italic*.

- Bullet 1
- Bullet 2

1. Number 1
2. Number 2

---

## Subheading

[Link](https://example.com)`;

      const result = converter.convert(markdown);

      // Should have multiple requests
      expect(result.requests.length).toBeGreaterThan(5);

      // Should have heading requests
      const headingRequests = result.requests.filter((r) =>
        r.updateParagraphStyle?.paragraphStyle?.namedStyleType?.startsWith('HEADING_')
      );
      expect(headingRequests.length).toBe(2);

      // Should have bullet requests
      const bulletRequests = result.requests.filter((r) => r.createParagraphBullets);
      expect(bulletRequests.length).toBe(4); // 2 bullets + 2 numbers
    });

    it('should return table info for second pass population', () => {
      const result = converter.convert('| Name | Value |\n|---|---|\n| Alice | 100 |\n| Bob | 200 |');
      expect(result.tables).toBeDefined();
      expect(result.tables.length).toBe(1);
      expect(result.tables[0].rows).toBe(3); // Header + 2 data rows
      expect(result.tables[0].columns).toBe(2);
      expect(result.tables[0].cellContent).toEqual([
        ['Name', 'Value'],
        ['Alice', '100'],
        ['Bob', '200'],
      ]);
    });

    it('should generate visible horizontal rule with styling', () => {
      const result = converter.convert('Above\n\n---\n\nBelow');

      // Should have insert text for the horizontal rule line
      const hrInsert = result.requests.find(
        (r) => r.insertText?.text?.includes('─')
      );
      expect(hrInsert).toBeTruthy();

      // Should have center alignment style for the rule
      const alignmentRequest = result.requests.find(
        (r) => r.updateParagraphStyle?.paragraphStyle?.alignment === 'CENTER'
      );
      expect(alignmentRequest).toBeTruthy();

      // Should have color styling for the rule
      const colorRequest = result.requests.find(
        (r) => r.updateTextStyle?.textStyle?.foregroundColor
      );
      expect(colorRequest).toBeTruthy();
    });

    it('should not truncate content after tables', () => {
      const markdown = `# Before

| A | B |
|---|---|
| 1 | 2 |

## After Table

This paragraph should not be truncated.`;

      const result = converter.convert(markdown);

      // Find all insert text requests
      const textInserts = result.requests.filter((r) => r.insertText);

      // Should contain both "Before" and "After Table" and "truncated"
      const allText = textInserts.map((r) => r.insertText.text).join('');
      expect(allText).toContain('Before');
      expect(allText).toContain('After Table');
      expect(allText).toContain('truncated');

      // Should have table info
      expect(result.tables.length).toBe(1);
    });
  });
});
