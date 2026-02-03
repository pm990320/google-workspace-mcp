# Google Workspace MCP Server

FastMCP server with 65+ tools for Google Workspace: Docs, Sheets, Drive, Gmail, Calendar, Slides, and Forms.

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
| Gmail | 8 | `listGmailMessages`, `readGmailMessage`, `sendGmailMessage`, `searchGmail`, `listGmailLabels`, `modifyGmailLabels`, `createGmailDraft`, `deleteGmailMessage` |
| Calendar | 6 | `listCalendars`, `listCalendarEvents`, `getCalendarEvent`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent` |
| Slides | 5 | `listPresentations`, `readPresentation`, `createPresentation`, `addSlide`, `addTextToSlide` |
| Forms | 5 | `listForms`, `readForm`, `getFormResponses`, `createForm`, `addFormQuestion` |

*Not fully implemented

## Required OAuth Scopes

The server requires these Google OAuth scopes:
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/forms.body`
- `https://www.googleapis.com/auth/forms.responses.readonly`

## Known Limitations

- **Comment anchoring:** Programmatically created comments appear in "All Comments" but aren't visibly anchored to text in the UI
- **Resolved status:** May not persist in Google Docs UI (Drive API limitation)
- **editTableCell:** Not implemented (complex cell index calculation)
- **fixListFormatting:** Experimental, may not work reliably

## Parameter Patterns

- **Account:** Required for all tools. Use `listAccounts` to see available account names.
- **Document ID:** Extract from URL: `docs.google.com/document/d/DOCUMENT_ID/edit`
- **Spreadsheet ID:** Extract from URL: `docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
- **Presentation ID:** Extract from URL: `docs.google.com/presentation/d/PRESENTATION_ID/edit`
- **Form ID:** Extract from URL: `docs.google.com/forms/d/FORM_ID/edit`
- **Text targeting:** Use `textToFind` + `matchInstance` OR `startIndex`/`endIndex`
- **Colors:** Hex format `#RRGGBB` or `#RGB`
- **Alignment:** `START`, `END`, `CENTER`, `JUSTIFIED` (not LEFT/RIGHT)
- **Indices:** 1-based, ranges are [start, end)
- **Tabs:** Optional `tabId` parameter (defaults to first tab)
- **Date/Time:** ISO 8601 format for Calendar events (e.g., "2024-01-15T10:00:00-05:00")

## CLI Commands

```bash
npx google-workspace-mcp serve       # Start the MCP server
npx google-workspace-mcp setup       # Interactive setup wizard
npx google-workspace-mcp accounts list    # List all accounts
npx google-workspace-mcp accounts add <name>   # Add a new account (auto-opens browser)
npx google-workspace-mcp accounts add <name> --no-open  # Add without auto-opening browser
npx google-workspace-mcp accounts remove <name>  # Remove an account
npx google-workspace-mcp accounts test-permissions  # Test API permissions for all accounts
npx google-workspace-mcp accounts test-permissions <name>  # Test a specific account
npx google-workspace-mcp status      # Check server readiness
npx google-workspace-mcp config show # Show configuration
```

## Source Files (for implementation details)

| File | Contains |
|------|----------|
| `src/cli.ts` | CLI entrypoint with Commander.js commands |
| `src/server.ts` | MCP server setup and tool registration |
| `src/accounts.ts` | Multi-account management, OAuth flow, token storage |
| `src/types.ts` | Zod schemas, hex color validation, style parameter definitions |
| `src/googleDocsApiHelpers.ts` | `findTextRange`, `executeBatchUpdate`, style request builders |
| `src/googleSheetsApiHelpers.ts` | A1 notation parsing, range operations |
| `src/tools/docs.tools.ts` | Google Docs tool definitions |
| `src/tools/drive.tools.ts` | Google Drive tool definitions |
| `src/tools/sheets.tools.ts` | Google Sheets tool definitions |
| `src/tools/accounts.tools.ts` | Account management tool definitions |
| `src/tools/gmail.tools.ts` | Gmail tool definitions |
| `src/tools/calendar.tools.ts` | Calendar tool definitions |
| `src/tools/slides.tools.ts` | Slides tool definitions |
| `src/tools/forms.tools.ts` | Forms tool definitions |

## See Also

- `README.md` - Setup instructions and usage examples
- `SAMPLE_TASKS.md` - 15 example workflows
- `UPGRADE.md` - Migration guide from a-bonus/google-docs-mcp
