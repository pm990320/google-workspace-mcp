// tests/markdown/MarkdownToDoc.test.js
import { MarkdownToDoc } from '../../dist/markdown/MarkdownToDoc.js';
import { MarkdownElementType } from '../../dist/markdown/types.js';
import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

describe('MarkdownToDoc', () => {
  let converter;

  beforeEach(() => {
    converter = new MarkdownToDoc();
  });

  describe('parseMarkdown()', () => {
    it('should parse simple paragraph', () => {
      const elements = converter.parseMarkdown('Hello, world!');
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0].type, MarkdownElementType.PARAGRAPH);
      assert.strictEqual(elements[0].content, 'Hello, world!');
    });

    it('should parse heading levels 1-6', () => {
      const markdown = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 6);
      for (let i = 0; i < 6; i++) {
        assert.strictEqual(elements[i].type, MarkdownElementType.HEADING);
        assert.strictEqual(elements[i].level, i + 1);
        assert.strictEqual(elements[i].content, `H${i + 1}`);
      }
    });

    it('should parse bullet list', () => {
      const markdown = `- Item 1
- Item 2
- Item 3`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 3);
      elements.forEach((el) => {
        assert.strictEqual(el.type, MarkdownElementType.BULLET_LIST_ITEM);
      });
    });

    it('should parse nested bullet list', () => {
      const markdown = `- Parent
  - Child
    - Grandchild`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 3);
      assert.strictEqual(elements[0].indent, 0);
      assert.strictEqual(elements[1].indent, 1);
      assert.strictEqual(elements[2].indent, 2);
    });

    it('should parse numbered list', () => {
      const markdown = `1. First
2. Second
3. Third`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 3);
      elements.forEach((el) => {
        assert.strictEqual(el.type, MarkdownElementType.NUMBERED_LIST_ITEM);
      });
    });

    it('should parse horizontal rule', () => {
      const markdown = `Above
---
Below`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 3);
      assert.strictEqual(elements[1].type, MarkdownElementType.HORIZONTAL_RULE);
    });

    it('should parse image', () => {
      const markdown = '![Alt text](https://example.com/image.png)';
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0].type, MarkdownElementType.IMAGE);
      assert.strictEqual(elements[0].imageAlt, 'Alt text');
      assert.strictEqual(elements[0].imageUrl, 'https://example.com/image.png');
    });

    it('should parse simple table', () => {
      const markdown = `| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0].type, MarkdownElementType.TABLE);
      assert.strictEqual(elements[0].tableRows.length, 3); // Header + 2 data rows
      assert.deepStrictEqual(elements[0].tableRows[0], ['A', 'B']);
      assert.deepStrictEqual(elements[0].tableRows[1], ['1', '2']);
    });

    it('should parse code block', () => {
      const markdown = '```\nconst x = 1;\nconsole.log(x);\n```';
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0].type, MarkdownElementType.CODE_BLOCK);
      assert.strictEqual(elements[0].content, 'const x = 1;\nconsole.log(x);');
    });

    it('should parse blockquote', () => {
      const markdown = '> This is a quote';
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0].type, MarkdownElementType.BLOCKQUOTE);
      assert.strictEqual(elements[0].content, 'This is a quote');
    });

    it('should skip empty lines', () => {
      const markdown = `Line 1

Line 2`;
      const elements = converter.parseMarkdown(markdown);
      assert.strictEqual(elements.length, 2);
    });
  });

  describe('parseInlineFormatting()', () => {
    it('should extract bold formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Hello **world**!');
      assert.strictEqual(text, 'Hello world!');
      assert.strictEqual(formats.length, 1);
      assert.strictEqual(formats[0].bold, true);
      assert.strictEqual(formats[0].start, 6);
      assert.strictEqual(formats[0].end, 11);
    });

    it('should extract italic formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Hello *world*!');
      assert.strictEqual(text, 'Hello world!');
      assert.strictEqual(formats.length, 1);
      assert.strictEqual(formats[0].italic, true);
    });

    it('should extract strikethrough formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Hello ~~world~~!');
      assert.strictEqual(text, 'Hello world!');
      assert.strictEqual(formats.length, 1);
      assert.strictEqual(formats[0].strikethrough, true);
    });

    it('should extract link formatting', () => {
      const { text, formats } = converter.parseInlineFormatting(
        'Visit [Google](https://google.com) today'
      );
      assert.strictEqual(text, 'Visit Google today');
      assert.strictEqual(formats.length, 1);
      assert.strictEqual(formats[0].link, 'https://google.com');
    });

    it('should extract inline code formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Run `npm install` now');
      assert.strictEqual(text, 'Run npm install now');
      assert.strictEqual(formats.length, 1);
      assert.strictEqual(formats[0].code, true);
    });

    it('should handle multiple formats', () => {
      const { text, formats } = converter.parseInlineFormatting(
        '**Bold** and *italic* and `code`'
      );
      assert.strictEqual(text, 'Bold and italic and code');
      assert.strictEqual(formats.length, 3);
    });

    it('should return plain text when no formatting', () => {
      const { text, formats } = converter.parseInlineFormatting('Plain text');
      assert.strictEqual(text, 'Plain text');
      assert.strictEqual(formats.length, 0);
    });
  });

  describe('convert()', () => {
    it('should generate insert text request for paragraph', () => {
      const result = converter.convert('Hello, world!');
      const insertRequest = result.requests.find((r) => r.insertText);
      assert.ok(insertRequest);
      assert.strictEqual(insertRequest.insertText.text, 'Hello, world!\n');
      assert.strictEqual(insertRequest.insertText.location.index, 1);
    });

    it('should generate heading style request', () => {
      const result = converter.convert('# My Heading');
      const styleRequest = result.requests.find((r) => r.updateParagraphStyle);
      assert.ok(styleRequest);
      assert.strictEqual(
        styleRequest.updateParagraphStyle.paragraphStyle.namedStyleType,
        'HEADING_1'
      );
    });

    it('should generate bold formatting request', () => {
      const result = converter.convert('Hello **world**!');
      const boldRequest = result.requests.find(
        (r) => r.updateTextStyle?.textStyle?.bold === true
      );
      assert.ok(boldRequest);
    });

    it('should generate bullet list request', () => {
      const result = converter.convert('- Item 1\n- Item 2');
      const bulletRequests = result.requests.filter((r) => r.createParagraphBullets);
      assert.strictEqual(bulletRequests.length, 2);
    });

    it('should generate numbered list request', () => {
      const result = converter.convert('1. First\n2. Second');
      const bulletRequests = result.requests.filter((r) => r.createParagraphBullets);
      assert.strictEqual(bulletRequests.length, 2);
      assert.strictEqual(
        bulletRequests[0].createParagraphBullets.bulletPreset,
        'NUMBERED_DECIMAL_ALPHA_ROMAN'
      );
    });

    it('should generate link formatting request', () => {
      const result = converter.convert('[Google](https://google.com)');
      const linkRequest = result.requests.find(
        (r) => r.updateTextStyle?.textStyle?.link?.url === 'https://google.com'
      );
      assert.ok(linkRequest);
    });

    it('should generate image insert request', () => {
      const result = converter.convert('![Alt](https://example.com/img.png)');
      const imageRequest = result.requests.find((r) => r.insertInlineImage);
      assert.ok(imageRequest);
      assert.strictEqual(
        imageRequest.insertInlineImage.uri,
        'https://example.com/img.png'
      );
    });

    it('should generate table insert request', () => {
      const result = converter.convert('| A | B |\n|---|---|\n| 1 | 2 |');
      const tableRequest = result.requests.find((r) => r.insertTable);
      assert.ok(tableRequest);
      assert.strictEqual(tableRequest.insertTable.rows, 2); // Header + 1 data row
      assert.strictEqual(tableRequest.insertTable.columns, 2);
    });

    it('should generate delete request for full replace', () => {
      const result = converter.convert('New content', { fullReplace: true }, 100);
      const deleteRequest = result.requests.find((r) => r.deleteContentRange);
      assert.ok(deleteRequest);
      assert.strictEqual(deleteRequest.deleteContentRange.range.startIndex, 1);
      assert.strictEqual(deleteRequest.deleteContentRange.range.endIndex, 99);
    });

    it('should not generate delete request when not full replace', () => {
      const result = converter.convert('New content', {}, 100);
      const deleteRequest = result.requests.find((r) => r.deleteContentRange);
      assert.strictEqual(deleteRequest, undefined);
    });

    it('should not generate delete request for empty document', () => {
      const result = converter.convert('New content', { fullReplace: true }, 1);
      const deleteRequest = result.requests.find((r) => r.deleteContentRange);
      assert.strictEqual(deleteRequest, undefined);
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
      assert.ok(result.requests.length > 5);

      // Should have heading requests
      const headingRequests = result.requests.filter(
        (r) => r.updateParagraphStyle?.paragraphStyle?.namedStyleType?.startsWith('HEADING_')
      );
      assert.strictEqual(headingRequests.length, 2);

      // Should have bullet requests
      const bulletRequests = result.requests.filter((r) => r.createParagraphBullets);
      assert.strictEqual(bulletRequests.length, 4); // 2 bullets + 2 numbers
    });
  });
});
