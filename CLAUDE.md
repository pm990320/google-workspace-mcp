# Google Workspace MCP Server

FastMCP server with 100+ tools for Google Workspace: Docs, Sheets, Drive, Gmail, Calendar, Slides, Forms, and Excel files.

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
| Structure | 7 | `insertTable`, `insertPageBreak`, `insertImageFromUrl`, `insertLocalImage`, `editTableCell`, `findElement`, `fixListFormatting`* |
| Comments | 6 | `listComments`, `getComment`, `addComment`, `replyToComment`, `resolveComment`, `deleteComment` |
| Sheets | 9 | `readSpreadsheet`, `writeSpreadsheet`, `appendSpreadsheetRows`, `clearSpreadsheetRange`, `createSpreadsheet`, `listGoogleSheets`, `downloadSpreadsheet` |
| Drive | 18 | `listGoogleDocs`, `searchGoogleDocs`, `searchDrive`, `listRecentFiles`, `uploadFileToDrive`, `downloadFromDrive`, `getShareableLink`, `createFolder`, `moveFile`, `copyFile`, `createDocument` |
| Gmail | 28 | `listGmailMessages`, `readGmailMessage`, `searchGmail`, `getGmailAttachment`, `downloadGmailAttachment`, `saveAttachmentToDrive`, `markAsRead`, `markAsUnread`, `listGmailThreads`, `readGmailThread`, `listGmailLabels`, `createGmailLabel`, `addGmailLabel`, `removeGmailLabel`, `batchAddGmailLabels`, `batchRemoveGmailLabels`, `createGmailDraft`, `listGmailDrafts`, `readGmailDraft`, `updateGmailDraft`, `addAttachmentToDraft`, `removeAttachmentFromDraft`, `sendGmailDraft`, `deleteGmailDraft`, `deleteGmailMessage`, `listGmailFilters`, `createGmailFilter`, `deleteGmailFilter` |
| Calendar | 6 | `listCalendars`, `listCalendarEvents`, `getCalendarEvent`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent` |
| Slides | 5 | `listPresentations`, `readPresentation`, `createPresentation`, `addSlide`, `addTextToSlide` |
| Forms | 5 | `listForms`, `readForm`, `getFormResponses`, `createForm`, `addFormQuestion` |
| Excel | 12 | `listExcelFiles`, `listExcelSheets`, `getExcelInfo`, `readExcelFile`, `writeExcelCell`, `writeExcelRange`, `appendExcelRows`, `clearExcelRange`, `addExcelSheet`, `deleteExcelSheet`, `renameExcelSheet`, `convertExcelToSheets` |

*Experimental (may not work reliably)

## Response Format Convention

All tools return **human-readable plain text** responses, not JSON. This follows the MCP specification (2025-06-18) recommendation that tool outputs should be optimized for LLM consumption.

**Response patterns used:**
- Markdown-style formatting: `**Bold**`, numbered lists, indentation
- URLs on their own labeled lines: `Link: https://...`
- Clear section headers for multi-part responses
- Success messages followed by relevant details

**Example response:**
```
Successfully created document "My Doc" (ID: abc123)
View Link: https://docs.google.com/document/d/abc123/edit?authuser=user@email.com

Initial content added to document.
```

**Exception:** The `readGoogleDoc` tool has a `format` parameter that can return `'json'` for the document structure when explicitly requested. This is for the document content, not the tool response format.

## Required OAuth Scopes

The server requires these Google OAuth scopes:
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.settings.basic` (for filter management)
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/forms.body`
- `https://www.googleapis.com/auth/forms.responses.readonly`

## Safety Features

- **No permanent deletion:** The `deleteFile` tool always moves files to trash rather than permanently deleting them. Files can be restored from trash within 30 days. This prevents accidental data loss.
- **Draft-only email sending:** Emails cannot be sent directly. The workflow is: `createGmailDraft` → user reviews in Gmail → `sendGmailDraft`. This ensures a human always reviews emails before sending, preventing accidental or AI-generated emails from being sent without approval.
- **Query injection protection:** All user input in Google Drive API queries is sanitized to prevent query injection attacks.
- **File system path restrictions:** File read/write operations are restricted to safe directories (Downloads, Documents, Desktop, temp). Sensitive paths (.ssh, .aws, etc.) are blocked.
- **No-third-party mode:** Optional mode to block all external communications (email sending, sharing, calendar invites).

## Excel Format Support (Sheets)

The server supports editing Excel-format files (.xlsx and .xls) stored on Google Drive without converting them to native Google Sheets format. This extends Sheets functionality to work with Excel files directly.

**How it works:**
1. Download the Excel-format file from Drive
2. Parse it using the xlsx library in memory
3. Make modifications (read/write cells, add sheets, etc.)
4. Upload the modified file back to Drive

**Native Sheets vs Excel-format files:**
| Aspect | Excel-Format Files | Native Google Sheets |
|--------|-------------------|---------------------|
| Latency | Higher (full file download/upload per operation) | Low (direct API calls) |
| Collaboration | No real-time | Real-time |
| Formulas | Preserved but not evaluated | Full support |
| Formatting | Basic preservation | Full support |
| File size | Works well | 10M cell limit |

**When to use Excel-format tools:**
- Files that must stay in .xlsx/.xls format for compatibility
- Automated processing of uploaded Excel files
- Workflows where format conversion isn't desired

**When to convert to native Sheets:**
- Need real-time collaboration
- Want lower latency for many operations
- Need full formula evaluation
- Use `convertExcelToSheets` to create a native Sheets copy

**File ID:** Extract from Drive URL: `drive.google.com/file/d/FILE_ID/view`

## URL Handling

All tools return URLs with the `?authuser=<email>` parameter to ensure the browser opens with the correct Google account. This is critical for multi-account users.

**URL patterns:**
- Docs: `https://docs.google.com/document/d/{id}/edit?authuser=email@example.com`
- Sheets: `https://docs.google.com/spreadsheets/d/{id}/edit?authuser=email@example.com`
- Slides: `https://docs.google.com/presentation/d/{id}/edit?authuser=email@example.com`
- Forms: `https://docs.google.com/forms/d/{id}/edit?authuser=email@example.com`
- Drive files: `https://drive.google.com/file/d/{id}/view?authuser=email@example.com`
- Drive folders: `https://drive.google.com/drive/folders/{id}?authuser=email@example.com`
- Gmail messages: `https://mail.google.com/mail/u/?authuser=email@example.com#inbox/{id}`
- Calendar: `https://calendar.google.com/calendar/u/0/r?authuser=email@example.com`

**Verification:** After any operation, click the returned URL to verify the changes in your browser. The authuser parameter ensures you're viewing with the correct account.

## Known Limitations

- **Comment anchoring:** Programmatically created comments appear in "All Comments" but aren't visibly anchored to text in the UI
- **Resolved status:** May not persist in Google Docs UI (Drive API limitation)
- **fixListFormatting:** Experimental, may not work reliably
- **Heading anchor links:** The Google Docs API does not expose heading anchor IDs (the `#heading=h.xxxxx` fragment in URLs). These are client-side generated by the web UI, so URLs cannot link directly to specific headings or sections programmatically.

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
npx google-workspace-mcp serve --read-only  # Start in read-only mode (blocks write operations)
```

## Security Modes

### Read-Only Mode

Start the server with `--read-only` to disable all write operations:

```bash
npx google-workspace-mcp serve --read-only
# or via environment variable
GOOGLE_MCP_READ_ONLY=true npx google-workspace-mcp serve
```

In read-only mode, tools with `readOnlyHint: false` are blocked at runtime and return an error. This is useful for safe exploration or when you want to prevent accidental modifications.

### No-Third-Party Mode

Start the server with no-third-party mode to block all external communications:

```bash
GOOGLE_MCP_NO_THIRD_PARTY=true npx google-workspace-mcp serve
```

This mode blocks:
- `sendGmailDraft` - sending emails
- `createGmailFilter` with `forward` parameter - auto-forwarding emails
- `createCalendarEvent` with `attendees` or `sendUpdates` - sending calendar invites
- `updateCalendarEvent` / `deleteCalendarEvent` with `sendUpdates` - sending update notifications
- `shareFile` / `getShareableLink` - sharing files with others

Useful for preventing AI-initiated external communications while still allowing document editing.

### Combined Modes

Modes can be combined for maximum safety:

```bash
GOOGLE_MCP_READ_ONLY=true GOOGLE_MCP_NO_THIRD_PARTY=true npx google-workspace-mcp serve
```

### File System Path Security

File operations (upload/download) are restricted to safe directories by default:

**Default allowed write paths:**
- `~/Downloads`
- `~/Documents`
- `~/Desktop`
- System temp directory

**Default allowed read paths:**
- Same as write paths, plus `~/Pictures`, `~/Videos`

**Always forbidden (sensitive paths):**
- `.ssh`, `.gnupg`, `.aws`, `.gcloud`, `.kube`
- Shell configs (`.bashrc`, `.zshrc`, `.env`, etc.)
- Browser data, password stores
- Private keys (`*.pem`, `*_rsa`, etc.)
- System directories (`/etc`, `/var`, `/usr`, etc.)

**Override via environment variables:**
```bash
# Replace allowed paths (comma-separated)
GOOGLE_MCP_ALLOWED_WRITE_PATHS="/custom/path1,/custom/path2"
GOOGLE_MCP_ALLOWED_READ_PATHS="/custom/path1,/custom/path2,/another/path"

# Add additional forbidden patterns (appended to defaults)
GOOGLE_MCP_FORBIDDEN_PATHS="**/my-secrets/**,**/private/**"
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
| `src/tools/excel.tools.ts` | Excel-format file tool definitions (Sheets with .xlsx/.xls) |
| `src/excelHelpers.ts` | Excel-format parsing, cell operations, workbook manipulation |
| `src/serverWrapper.ts` | Read-only mode, no-third-party mode enforcement wrapper |
| `src/securityHelpers.ts` | Query sanitization, path validation, third-party detection |

## See Also

- `README.md` - Setup instructions and usage examples
- `SAMPLE_TASKS.md` - 15 example workflows
- `UPGRADE.md` - Migration guide from a-bonus/google-docs-mcp
