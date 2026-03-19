---
name: job-application
description: Apply to jobs on career sites — LinkedIn, Indeed, Greenhouse, Lever, Workday. Use when the task involves job searching, resume submission, or filling application forms.
allowedTools:
  - browserNavigate
  - browserSnapshot
  - browserFill
  - browserClick
  - browserType
  - browserPress
  - browserScreenshot
  - browserScroll
  - browserEval
  - browserText
  - browserTabs
---

# Job Application

## Common Platforms

### LinkedIn Easy Apply
- Login is 2-step: email page, then password page
- "Easy Apply" opens a modal, not a new page — snapshot after clicking
- Forms are multi-step within the modal (Next → Next → Submit)
- Resume upload via file input in the modal
- May ask screening questions (years of experience, work authorization)

### Indeed
- "Apply" may open a popup or redirect to external site
- Indeed's own apply flow is multi-step
- Always snapshot after clicking Apply to see which flow you're in

### Greenhouse / Lever
- Clean, predictable form layouts
- Usually: personal info → resume → cover letter → custom questions
- File upload for resume is straightforward

### Workday
- Complex, multi-page flows with many fields
- Auto-save on each page — safe to proceed step by step
- Address fields may have autocomplete — type slowly and select from suggestions

## Workflow

1. **Navigate to job listing** — search or use direct URL
2. **Read job description** — extract key requirements (for screening questions)
3. **Click Apply** — snapshot to see which application flow appears
4. **Fill personal info** — name, email, phone, location
5. **Upload resume** — from `/workspace/uploads/`
6. **Answer screening questions** — use job description context
7. **Review before submit** — snapshot the review page, show user via HITL
8. **Submit** — only after user approval
9. **Save confirmation** — screenshot the confirmation page

## Rules

- NEVER submit without HITL approval on the final step
- NEVER fabricate work history, education, or qualifications
- If a screening question is ambiguous, use `ask_user`
- Save confirmation screenshots to `/workspace/screenshots/`
