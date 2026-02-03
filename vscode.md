# VS Code Integration Guide

This guide shows you how to integrate the Google Workspace MCP Server with VS Code using the MCP extension.

## Prerequisites

Before setting up VS Code integration, make sure you have:

1. **Completed the main setup** - Follow the [README.md](README.md) setup instructions first
2. **VS Code installed** - Download from [code.visualstudio.com](https://code.visualstudio.com/)
3. **Working MCP server** - Verify your server works with Claude Desktop first

## Installation

### Step 1: Install the MCP Extension

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "MCP" or "Model Context Protocol"
4. Install the official MCP extension

### Step 2: Configure the MCP Server

1. Open VS Code Settings (Ctrl+, / Cmd+,)
2. Search for "MCP" in settings
3. Find "MCP: Servers" configuration
4. Add a new server configuration:

```json
{
  "google-workspace": {
    "command": "node",
    "args": ["${workspaceFolder}/dist/server.js"],
    "env": {
      "NODE_ENV": "production"
    }
  }
}
```

### Step 3: Verify Configuration

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type "MCP: Restart Servers" and run it
3. Check the Output panel and select "MCP" from the dropdown
4. You should see your server connecting successfully

## Usage

Once configured, you can use the MCP server with AI assistants in VS Code:

### Document Operations

```
"List my recent Google Docs from the last 7 days"
"Read the content of document ID: 1ABC..."
"Create a new document called 'Project Notes' in my Work folder"
"Search for documents containing 'meeting notes'"
```

### File Management

```
"Show me the contents of my root Drive folder"
"Create a folder called 'Project X' in folder ID: 1DEF..."
"Move document ID: 1GHI... to the Project X folder"
"Copy my template document and rename it to 'New Report'"
```

### Document Editing

```
"Add a heading 'Summary' to the beginning of document ID: 1JKL..."
"Format all text containing 'important' as bold in my document"
"Insert a table with 3 columns and 5 rows at the end of the document"
"Apply paragraph formatting to make all headings centered"
```

## Troubleshooting

### Server Not Starting

1. **Check the path** - Ensure the absolute path in your configuration is correct
2. **Verify build** - Run `npm run build` in your project directory
3. **Check permissions** - Ensure `token.json` and `credentials.json` exist and are readable

### Authentication Issues

1. **Re-authorize** - Delete `token.json` and run the server manually once:
   ```bash
   cd /path/to/your/google-docs-mcp
   node dist/server.js
   ```
2. **Follow the authorization flow** again
3. **Restart VS Code** after successful authorization

### Tool Not Found Errors

1. **Restart MCP servers** using Command Palette
2. **Check server logs** in VS Code Output panel (MCP channel)

## Available Tools

The server provides these tools in VS Code:

### Document Discovery
- `listGoogleDocs` - List documents with filtering
- `searchGoogleDocs` - Search by name/content
- `getRecentGoogleDocs` - Get recently modified docs
- `getDocumentInfo` - Get detailed document metadata

### Document Editing
- `readGoogleDoc` - Read document content
- `appendToGoogleDoc` - Add text to end
- `insertText` - Insert at specific position
- `deleteRange` - Remove content
- `applyTextStyle` - Format text (bold, italic, colors)
- `applyParagraphStyle` - Format paragraphs (alignment, spacing)
- `formatMatchingText` - Find and format text
- `insertTable` - Create tables
- `insertPageBreak` - Add page breaks

### File Management
- `createFolder` - Create new folders
- `listFolderContents` - List folder contents
- `getFolderInfo` - Get folder metadata
- `moveFile` - Move files/folders
- `copyFile` - Copy files/folders
- `renameFile` - Rename files/folders
- `deleteFile` - Delete files/folders
- `createDocument` - Create new documents
- `createFromTemplate` - Create from templates

## Tips for Better Integration

1. **Use specific document IDs** - More reliable than document names
2. **Combine operations** - Create and format documents in single requests
3. **Check tool results** - Review what was actually done before proceeding
4. **Use templates** - Create template documents for consistent formatting

## Security Notes

- The server uses OAuth 2.0 for secure authentication
- Credentials are stored locally in `token.json` and `credentials.json`
- Never share these files or commit them to version control
- The server only has access to your Google Drive, not other Google services

## Example Workflows

### Create a Formatted Report

```
1. "Create a new document called 'Monthly Report' in my Reports folder"
2. "Add the title 'Monthly Performance Report' as a centered Heading 1"
3. "Insert a table with 4 columns and 6 rows for the data"
4. "Add section headings for Executive Summary, Key Metrics, and Action Items"
```

### Organize Project Documents

```
1. "Create a folder called 'Q1 Project' in my Work folder"
2. "Search for all documents containing 'Q1' in the title"
3. "Move the found documents to the Q1 Project folder"
4. "Create a new document called 'Q1 Project Overview' in that folder"
```

This integration brings the full power of Google Docs and Drive management directly into your VS Code workflow!
