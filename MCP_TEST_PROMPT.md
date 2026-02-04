# Google Workspace MCP Comprehensive Test Prompt

You are testing the Google Workspace MCP server, which provides tools for interacting with Google Docs, Sheets, Drive, Gmail, Calendar, Slides, and Forms.

---

## ⚠️ IMPORTANT: PERMISSION REQUIRED FOR EXTERNAL ACTIONS

**BEFORE SENDING ANY EMAILS OR TAKING ANY ACTIONS THAT INVOLVE THIRD PARTIES, YOU MUST:**

1. **STOP AND ASK THE USER FOR EXPLICIT PERMISSION**
2. **CLEARLY STATE WHAT ACTION YOU ARE ABOUT TO TAKE** (e.g., "I am about to send an email to test@example.com")
3. **WAIT FOR USER CONFIRMATION BEFORE PROCEEDING**

**THIS APPLIES TO:**
- Sending drafts (`sendGmailDraft`)
- Creating calendar events with attendees
- Any action that could notify or contact external parties

**DO NOT PROCEED WITH THESE ACTIONS WITHOUT EXPLICIT USER APPROVAL.**

---

## Instructions

1. **Create a TODO list** at the start with all test phases and individual tool tests
2. **Mark each TODO as in-progress** when you start it, and **completed** when done
3. **Verify URLs in browser** - For every operation that returns a URL, open it in the browser and verify the changes are visible (see URL Verification section below)
4. **Generate a final report** at the end showing pass/fail status for each test with explanations
5. **Clean up all resources** you create - nothing should remain after testing

## URL Verification

All tools return **plain text responses** (not JSON) with URLs containing the `?authuser=<email>` parameter to ensure the browser opens with the correct Google account. **For every tool operation that modifies or creates a resource:**

1. **Extract the URL** from the tool response (look for lines like `View Link:`, `Link:`, `Open presentation:`, etc.)
2. **Open the URL in a browser** using the Playwright browser tools (e.g., `mcp__playwright__browser_navigate`)
3. **Take a snapshot or screenshot** of the page to verify the content
4. **Verify the expected changes are visible** - confirm that:
   - For **create** operations: the new resource exists and has the expected content
   - For **edit** operations: the modification is visible (text changed, formatting applied, etc.)
   - For **delete** operations: the resource no longer exists or shows as deleted
5. **Record the verification result** in the test report (VERIFIED/NOT_VERIFIED)

**Example verification flow:**
```
1. Call createDocument tool → returns plain text like:
   Successfully created document "My Doc" (ID: xxx)
   View Link: https://docs.google.com/document/d/xxx/edit?authuser=user@email.com
2. Extract the URL from the "View Link:" line
3. Navigate to the URL using browser_navigate
4. Take a snapshot using browser_snapshot
5. Verify the document title and content match what was created
6. Mark test as PASS + VERIFIED
```

**Note:** If browser verification is not possible (e.g., requires login, page load issues), note this in the report and mark as PASS + UNVERIFIED.

## Setup

First, list available accounts and use one for all subsequent tests. Store the account name for reuse.

---

## Phase 1: Google Docs Lifecycle

**Goal:** Create a document, manipulate it with all available tools, then delete it.

### Tests to perform:

1. **Create a test document** with a unique name containing "MCP-Test" and some initial paragraphs of content including a bullet list (using - or * characters)
2. **Search for the document** by name to verify it can be found
3. **List recent documents** and verify the new document appears
4. **Get document metadata** (title, ID, modification time, etc.)
5. **Read the document** in plain text format
6. **Read the document** in markdown format
7. **Read the document** in JSON format (limited length)
8. **List the document's tabs** with content information
9. **Find elements in the document** - search for paragraphs containing specific text
10. **Find tables in the document** - after inserting one, verify it can be found
11. **Find and replace text** in the document (change some word to uppercase)
12. **Append text** to the end of the document
13. **Insert text** at the beginning of the document
14. **Apply bold and color styling** to a specific phrase
15. **Format text with italic and underline** using the simpler formatting tool
16. **Center-align a paragraph** containing specific text
17. **Insert a small table** (2x2 or 3x3) at a known position in the document
18. **Edit a table cell** - add text content to a cell in the table you just created
19. **Insert a page break** somewhere in the document
20. **Insert an image from URL** (use any public image URL)
21. **Delete a range of characters** from the document
22. **Fix list formatting** - convert the text bullet list (- or *) into a proper Google Docs list (experimental, note any issues)
23. **Add a comment** anchored to some text in the document
24. **List all comments** on the document
25. **Get details of the comment** you just added
26. **Reply to the comment** with a test reply
27. **Resolve the comment** (note: may have API limitations)
28. **Delete the comment**
29. **Delete the document**

---

## Phase 2: Google Drive Lifecycle

**Goal:** Create a folder structure, manage files within it, then clean up everything.

### Tests to perform:

1. **Create a test folder** with a unique name containing "MCP-Test"
2. **Get folder metadata** to verify it was created correctly
3. **Create a document inside the folder** with some content
4. **List the folder contents** to verify the document appears
5. **Copy the document** to create a duplicate with a new name
6. **Rename the copied document** to something different
7. **Move the copied document** to the Drive root
8. **Create a document from template** using the original document, with text replacements
9. **List Google Docs** filtered by "MCP-Test" to see all test documents
10. **Delete all created files and the folder**

---

## Phase 3: Google Sheets Lifecycle

**Goal:** Create a spreadsheet, manipulate sheets and data, then delete it.

### Tests to perform:

1. **Create a test spreadsheet** with a unique name and initial data (a few rows with headers)
2. **Search for the spreadsheet** by name to verify it can be found
3. **Get spreadsheet metadata** including sheet names and dimensions
4. **Read a range of cells** from the spreadsheet
5. **Write data to a new column** in the spreadsheet
6. **Append new rows** to the existing data
7. **Add a new sheet tab** called "Summary" to the spreadsheet
8. **Clear a range** in the new sheet tab
9. **Delete the sheet tab** you just created
10. **Delete the spreadsheet**

---

## Phase 4: Gmail Lifecycle

**Goal:** Test email operations using the safe draft-based workflow. Emails cannot be sent directly - they must go through the draft workflow: create → review → send.

### Tests to perform:

**Basic Message Operations:**
1. **List all Gmail labels** available in the account
2. **List recent inbox messages** and note one message ID for testing
3. **Search Gmail** for messages matching a simple query
4. **Read a message** in full format using the ID from step 2
5. **Mark a message as read** using `markAsRead`
6. **Mark the message as unread** using `markAsUnread`

**Thread Operations:**
7. **List Gmail threads** to see conversation groupings
8. **Read a complete thread** using `readGmailThread` to see all messages in a conversation

**Attachment Operations:**
9. **Read a message with attachments** (find one using `searchGmail` with `has:attachment`)
10. **Get attachment metadata** from `readGmailMessage` (note the attachmentId)
11. **Get attachment preview** using `getGmailAttachment` (returns truncated base64 data)
12. **Download full attachment** using `downloadGmailAttachment` (returns complete base64 data)
13. **Download attachment to file** using `downloadGmailAttachment` with `savePath` parameter (save to a temp file, verify it was created, then delete)

**Draft Operations:**
14. **Create a draft email** addressed to a test address with test subject and body
15. **List all drafts** to verify your draft appears
16. **Read the draft** to verify its content
17. **Update the draft** - change the subject line
18. **Add an attachment to the draft** using `addAttachmentToDraft` (use a small base64 text file)
19. **Read the draft again** to verify the attachment was added
20. **Remove the attachment from the draft** using `removeAttachmentFromDraft`
21. **Add a star label** to the draft's message using `addGmailLabel`
22. **Remove the star label** from the message using `removeGmailLabel`
23. **Send the draft** to actually send it (will go to the test address)

**Batch Operations:**
24. **Search for multiple messages** to get several message IDs
25. **Batch add labels** to multiple messages using `batchAddGmailLabels`
26. **Batch remove labels** from multiple messages using `batchRemoveGmailLabels`

**Filter Management:**
27. **List all Gmail filters** using `listGmailFilters`
28. **Create a test filter** using `createGmailFilter` (e.g., from:test@example.com → add label)
29. **List filters again** to verify the filter was created
30. **Delete the test filter** using `deleteGmailFilter`

**Cleanup:**
31. **Create another draft** for cleanup testing
32. **Delete the draft** (permanent deletion)
33. **Delete the sent message** (moves to trash)

---

## Phase 5: Google Calendar Lifecycle

**Goal:** Create an event, manipulate it, then delete it.

### Tests to perform:

1. **List all calendars** accessible to the account
2. **List upcoming events** from the primary calendar
3. **Create a test event** for tomorrow with a unique summary containing "MCP-Test"
4. **Search for the event** by its summary text
5. **Get the event details** using its ID
6. **Update the event** to change the title and add a location
7. **Delete the event** without sending notifications

---

## Phase 6: Google Slides Lifecycle

**Goal:** Create a presentation, add content, then delete it.

### Tests to perform:

1. **List presentations** and search for any containing "MCP-Test"
2. **Create a new presentation** with a unique title containing "MCP-Test"
3. **Read the presentation** to see its structure
4. **Add a new slide** with a title and body layout
5. **Add a text box** to the new slide with some content
6. **Search for the presentation** by name to verify it appears
7. **Delete the presentation**

---

## Phase 7: Google Forms Lifecycle

**Goal:** Create a form, add questions, then delete it.

### Tests to perform:

1. **List forms** and search for any containing "MCP-Test"
2. **Create a new form** with a unique title containing "MCP-Test" and a description
3. **Add a short text question** that is required
4. **Add a multiple choice question** with several options
5. **Add a scale/rating question** from 1 to 5
6. **Read the form structure** to verify all questions were added
7. **Get form responses** (should be empty for a new form)
8. **Search for the form** by name to verify it appears
9. **Delete the form**

---

## Tools Not Being Tested

The following tools have known limitations and are excluded:

| Tool | Reason |
|------|--------|
| `insertLocalImage` | Requires local file path on the server |
| `addAccount` / `removeAccount` | Requires interactive OAuth flow |

**Note:** `findElement`, `editTableCell`, and `fixListFormatting` are now included in the tests. The `fixListFormatting` tool is experimental - note any issues encountered.

---

## Expected Test Count

| Phase | Category | Approximate Tool Tests |
|-------|----------|----------------------|
| Setup | Accounts | 1 |
| 1 | Docs | 29 |
| 2 | Drive | 10 |
| 3 | Sheets | 10 |
| 4 | Gmail | 33 |
| 5 | Calendar | 7 |
| 6 | Slides | 7 |
| 7 | Forms | 9 |
| **Total** | | **~106** |

---

## Final Report Format

After completing all tests, generate a report in this format:

```
# MCP Test Report

**Date:** [date]
**Account Used:** [account name]

## Summary
- Total Tests: X
- Passed: X
- Failed: X
- Skipped: X
- URL Verifications: X verified / Y total

## Phase 1: Google Docs
| Test | Tool Used | Result | URL Verified | Notes |
|------|-----------|--------|--------------|-------|
| Create test document | createDocument | PASS | YES | Created doc ID: xxx, verified in browser |
| Search for document | searchGoogleDocs | PASS | N/A | Found 1 result (read-only, no URL to verify) |
| Edit document | editGoogleDoc | PASS | YES | Verified text change visible in browser |
| ... | ... | ... | ... | ... |

## Phase 2: Google Drive
...

## Phase 3: Google Sheets
...

## Phase 4: Gmail
...

## Phase 5: Google Calendar
...

## Phase 6: Google Slides
...

## Phase 7: Google Forms
...

## Cleanup Verification
| Resource Type | Created | Deleted | Status |
|--------------|---------|---------|--------|
| Documents | 4 | 4 | CLEAN |
| Folders | 1 | 1 | CLEAN |
| Spreadsheets | 1 | 1 | CLEAN |
| Drafts | 1 | 1 | CLEAN |
| Events | 1 | 1 | CLEAN |
| Presentations | 1 | 1 | CLEAN |
| Forms | 1 | 1 | CLEAN |

## URL Verification Summary
| Phase | URLs Tested | Verified | Not Verified | Issues |
|-------|-------------|----------|--------------|--------|
| Docs | 15 | 14 | 1 | Login required for one |
| Drive | 8 | 8 | 0 | - |
| Sheets | 6 | 6 | 0 | - |
| Gmail | 4 | 3 | 1 | Draft URL required auth |
| Calendar | 3 | 3 | 0 | - |
| Slides | 4 | 4 | 0 | - |
| Forms | 5 | 5 | 0 | - |

## Issues Found
- [List any tool bugs, unclear descriptions, or unexpected behaviors]
- [List any URL verification failures - URLs that didn't show expected content]

## Recommendations
- [List any suggested improvements to tool descriptions or functionality]
```

---

## Important Notes

- **Natural language intent:** Use your understanding of the tool descriptions to figure out how to accomplish each test. This validates that the tool descriptions are clear and useful.
- **Error handling:** If a tool fails, note the error and continue with other tests.
- **Cleanup is critical:** Verify at the end that no test resources remain in Drive, Gmail, Calendar, etc.
- **Be thorough:** Each test should actually verify the expected outcome, not just call the tool.
- **URL verification is essential:** The returned URLs contain `?authuser=` parameters for multi-account support. Verify that:
  - URLs open correctly in the browser
  - The authuser parameter switches to the correct account
  - The content visible matches what was created/modified by the tool
  - For write operations, the changes are actually visible in the UI (not just returned in the API response)
