# Google Docs MCP Server

FastMCP server with 45 tools for Google Docs, Sheets, and Drive.

## Multi-Account Support

All tools require an `account` parameter. Use `listAccounts` to see available accounts.

| Tool | Description |
|------|-------------|
| `listAccounts` | List all connected Google accounts |
| `addAccount` | Add a new Google account (returns OAuth URL). Optional `credentialsPath` for per-account OAuth apps. |
| `removeAccount` | Remove a connected account |

**Config directory:** `~/.google-mcp/`
```
~/.google-mcp/
├── accounts.json                 # Account registry
├── credentials.json              # Global OAuth credentials (fallback)
├── credentials/
│   └── {accountName}.json        # Per-account OAuth credentials (optional)
└── tokens/
    └── {accountName}.json        # OAuth tokens per account
```

**Credentials lookup priority:**
1. Explicit `credentialsPath` in account config
2. `~/.google-mcp/credentials/{accountName}.json`
3. `~/.google-mcp/credentials.json` (global)

## Tool Categories

| Category | Count | Examples |
|----------|-------|----------|
| Accounts | 3 | `listAccounts`, `addAccount`, `removeAccount` |
| Docs | 5 | `readGoogleDoc`, `appendToGoogleDoc`, `insertText`, `deleteRange`, `listDocumentTabs` |
| Formatting | 3 | `applyTextStyle`, `applyParagraphStyle`, `formatMatchingText` |
| Structure | 7 | `insertTable`, `insertPageBreak`, `insertImageFromUrl`, `insertLocalImage`, `editTableCell`*, `findElement`*, `fixListFormatting`* |
| Comments | 6 | `listComments`, `getComment`, `addComment`, `replyToComment`, `resolveComment`, `deleteComment` |
| Sheets | 8 | `readSpreadsheet`, `writeSpreadsheet`, `appendSpreadsheetRows`, `clearSpreadsheetRange`, `createSpreadsheet`, `listGoogleSheets` |
| Drive | 13 | `listGoogleDocs`, `searchGoogleDocs`, `getDocumentInfo`, `createFolder`, `moveFile`, `copyFile`, `createDocument` |

*Not fully implemented

## Known Limitations

- **Comment anchoring:** Programmatically created comments appear in "All Comments" but aren't visibly anchored to text in the UI
- **Resolved status:** May not persist in Google Docs UI (Drive API limitation)
- **editTableCell:** Not implemented (complex cell index calculation)
- **fixListFormatting:** Experimental, may not work reliably

## Parameter Patterns

- **Account:** Required for all tools. Use `listAccounts` to see available account names.
- **Document ID:** Extract from URL: `docs.google.com/document/d/DOCUMENT_ID/edit`
- **Text targeting:** Use `textToFind` + `matchInstance` OR `startIndex`/`endIndex`
- **Colors:** Hex format `#RRGGBB` or `#RGB`
- **Alignment:** `START`, `END`, `CENTER`, `JUSTIFIED` (not LEFT/RIGHT)
- **Indices:** 1-based, ranges are [start, end)
- **Tabs:** Optional `tabId` parameter (defaults to first tab)

## Source Files (for implementation details)

| File | Contains |
|------|----------|
| `src/accounts.ts` | Multi-account management, OAuth flow, token storage |
| `src/types.ts` | Zod schemas, hex color validation, style parameter definitions |
| `src/googleDocsApiHelpers.ts` | `findTextRange`, `executeBatchUpdate`, style request builders |
| `src/googleSheetsApiHelpers.ts` | A1 notation parsing, range operations |
| `src/server.ts` | All 45 tool definitions with full parameter schemas |

## See Also

- `README.md` - Setup instructions and usage examples
- `SAMPLE_TASKS.md` - 15 example workflows
