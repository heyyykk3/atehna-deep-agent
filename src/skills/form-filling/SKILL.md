---
name: form-filling
description: Fill web forms accurately — registration, checkout, applications, booking. Use when the task involves entering data into form fields, selecting options, or submitting forms.
allowedTools:
  - browserSnapshot
  - browserFill
  - browserClick
  - browserType
  - browserPress
  - browserScreenshot
  - browserScroll
  - browserEval
---

# Form Filling

## Strategy

1. **Snapshot to map all fields** — identify every input, dropdown, checkbox, radio button
2. **Fill top to bottom** — forms validate in order; filling out of order can cause issues
3. **Verify after filling** — snapshot again to confirm values are set correctly
4. **Handle dynamic forms** — some fields appear after others are filled (conditional logic)

## Field Types

### Text Inputs
- Use `browserFill(ref, value)` — clears existing value and sets new one
- For fields needing keystroke events (autocomplete, search): use `browserType(text)` instead

### Dropdowns / Select
- Click the dropdown to open it, then snapshot to see options
- Click the desired option
- For custom dropdowns (not native `<select>`): may need to type to filter

### Checkboxes & Radio Buttons
- Use `browserClick(ref)` to toggle
- Snapshot after to confirm checked state

### Date Pickers
- Try `browserFill()` first — some accept typed dates
- If custom picker: click to open, navigate months/years, click the date
- Format varies by site — check what the field expects

### File Uploads
- Use `browserEval()` to programmatically set the file (requires HITL approval)
- File must be in `/workspace/uploads/`
- Verify upload with snapshot after

## Sensitive Fields

Fields matching these patterns trigger HITL approval:
- Password, credit card number, CVV, SSN, social security
- Always let the user review before submitting sensitive data
- Never guess or fabricate sensitive values — use `ask_user` if not provided

## Multi-Step Forms

Many forms span multiple pages:
1. Fill current page
2. Click "Next" / "Continue"
3. Snapshot new page
4. Repeat until final submit

Always snapshot after each step transition to verify progress.

## Common Pitfalls

- **Stale refs**: after page updates (AJAX), re-snapshot to get fresh refs
- **Hidden required fields**: scroll down to check for fields below the fold
- **Auto-format**: phone numbers, dates may auto-format — verify the final value
- **Terms checkbox**: often missed at the bottom of forms
