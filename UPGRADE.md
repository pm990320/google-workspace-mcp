# Upgrading from a-bonus/google-docs-mcp

This guide helps you migrate from [a-bonus/google-docs-mcp](https://github.com/a-bonus/google-docs-mcp) to this enhanced Google Workspace MCP Server.

## What's New

This fork extends the original with significant new capabilities:

| Feature | Original | This Fork |
|---------|----------|-----------|
| **Multi-Account Support** | Single account | Multiple Google accounts |
| **Gmail** | - | 8 tools (send, read, search, labels, drafts) |
| **Calendar** | - | 6 tools (events, calendars, CRUD) |
| **Slides** | - | 5 tools (presentations, slides, text) |
| **Forms** | - | 5 tools (forms, questions, responses) |
| **Edit Tool** | - | Claude-like find/replace editing |
| **Total Tools** | ~40 | 65+ |

## Migration Steps

### Step 1: Backup Your Credentials

Before switching, back up your existing authentication:

```bash
# From your old installation directory
cp token.json token.json.backup
cp credentials.json credentials.json.backup
```

### Step 2: Clone This Repository

```bash
git clone https://github.com/YOUR_USERNAME/google-workspace-mcp.git
cd google-workspace-mcp
npm install
npm run build
```

### Step 3: Migrate Credentials

This fork uses a different credential storage location (`~/.google-mcp/`) that supports multiple accounts.

**Option A: Fresh Start (Recommended)**

1. Place your `credentials.json` in `~/.google-mcp/credentials.json`
2. Run `npm run build && node ./dist/server.js`
3. Use the `addAccount` tool to add your Google account

**Option B: Migrate Existing Token**

```bash
# Create the config directory
mkdir -p ~/.google-mcp/tokens

# Copy credentials
cp /path/to/old/credentials.json ~/.google-mcp/credentials.json

# Copy token (rename to your account name)
cp /path/to/old/token.json ~/.google-mcp/tokens/default.json

# Create accounts.json
cat > ~/.google-mcp/accounts.json << 'EOF'
{
  "accounts": {
    "default": {
      "name": "default",
      "tokenPath": "~/.google-mcp/tokens/default.json",
      "addedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
EOF
```

### Step 4: Update Claude Desktop Configuration

Update your `mcp_config.json` (or `claude_desktop_config.json`):

**Before (a-bonus/google-docs-mcp):**
```json
{
  "mcpServers": {
    "google-docs-mcp": {
      "command": "node",
      "args": ["/path/to/mcp-googledocs-server/dist/server.js"]
    }
  }
}
```

**After (this fork):**
```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/path/to/google-workspace-mcp/dist/server.js"]
    }
  }
}
```

### Step 5: Update OAuth Scopes (If Using New Features)

If you want to use Gmail, Calendar, Slides, or Forms, you need to add new OAuth scopes to your Google Cloud project:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **OAuth consent screen**
3. Click **Edit App** → **Scopes** → **Add or Remove Scopes**
4. Add these new scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.settings.basic` (for Gmail filters)
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/presentations`
   - `https://www.googleapis.com/auth/forms.body`
   - `https://www.googleapis.com/auth/forms.responses.readonly`

5. Enable the new APIs in **APIs & Services** → **Library**:
   - Gmail API
   - Google Calendar API
   - Google Slides API
   - Google Forms API

6. **Delete your existing token** and re-authenticate:
   ```bash
   rm ~/.google-mcp/tokens/default.json
   # Then use addAccount tool or run the server to re-auth
   ```

### Step 6: Restart Claude Desktop

Close Claude Desktop completely and reopen it.

## API Changes

### Tool Parameter Changes

All tools now require an `account` parameter to support multi-account:

**Before:**
```
readGoogleDoc(documentId: "abc123")
```

**After:**
```
readGoogleDoc(account: "default", documentId: "abc123")
```

Use `listAccounts` to see available account names.

### New Tools Available

After upgrading, you'll have access to these new tools:

**Account Management:**
- `listAccounts` - List all connected Google accounts
- `addAccount` - Add a new Google account (returns OAuth URL)
- `removeAccount` - Remove a connected account

**Gmail:**
- `listGmailMessages`, `readGmailMessage`, `sendGmailMessage`
- `searchGmail`, `listGmailLabels`, `modifyGmailLabels`
- `createGmailDraft`, `deleteGmailMessage`

**Calendar:**
- `listCalendars`, `listCalendarEvents`, `getCalendarEvent`
- `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`

**Slides:**
- `listPresentations`, `readPresentation`, `createPresentation`
- `addSlide`, `addTextToSlide`

**Forms:**
- `listForms`, `readForm`, `getFormResponses`
- `createForm`, `addFormQuestion`

**Docs (New):**
- `editGoogleDoc` - Claude-like find/replace editing

## Troubleshooting

### "Account not found" Error

Make sure you've set up your accounts correctly:
```bash
# Check if accounts.json exists
cat ~/.google-mcp/accounts.json

# Check if token exists
ls -la ~/.google-mcp/tokens/
```

### "Insufficient scopes" Error

You need to re-authenticate with the new scopes:
1. Delete your token file
2. Use `addAccount` to re-add your account
3. Grant the new permissions in the OAuth flow

### Tools Not Appearing in Claude

1. Verify the server starts without errors: `node ./dist/server.js`
2. Check Claude's MCP config path is correct
3. Restart Claude Desktop completely

### Keeping Both Versions

If you want to run both versions side by side:

```json
{
  "mcpServers": {
    "google-docs-old": {
      "command": "node",
      "args": ["/path/to/old/mcp-googledocs-server/dist/server.js"]
    },
    "google-workspace-new": {
      "command": "node",
      "args": ["/path/to/google-workspace-mcp/dist/server.js"]
    }
  }
}
```

## Getting Help

If you encounter issues during migration:

1. Check the error message in Claude's MCP logs
2. Run the server manually to see startup errors: `node ./dist/server.js`
3. Verify your credentials and tokens are in the correct locations
4. Ensure all required APIs are enabled in Google Cloud Console
