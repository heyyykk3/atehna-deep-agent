---
name: video-editing
description: Interact with web-based video editors like CapCut, Clipchamp, Canva Video. Use when the task involves editing videos, adding effects, trimming clips, or exporting through browser-based tools.
allowedTools:
  - browserNavigate
  - browserSnapshot
  - browserScreenshot
  - browserClick
  - browserType
  - browserPress
  - browserEval
  - browserScroll
  - browserHover
---

# Video Editing (Browser-Based)

## Key Insight

Video editors are highly visual — **always use screenshots alongside snapshots**.
The accessibility tree often misses canvas elements, timelines, and visual controls.

## Common Platforms

### CapCut (Web)
- Timeline is canvas-based — snapshot won't show individual clips
- Use screenshot to see timeline state
- Drag operations may require `browserEval()` for custom mouse events
- Export: click Export button, wait for processing, download result

### Clipchamp
- Similar canvas timeline
- Text overlays and effects are in side panels — snapshot works for those
- Export quality options in a dropdown

### Canva Video
- Template-driven — start by selecting a template
- Elements panel for adding text, media, effects
- Timeline at bottom for sequencing

## Workflow

1. **Navigate and screenshot** — always start with screenshot for visual context
2. **Upload media** — use file upload flow from `/workspace/uploads/`
3. **Identify controls** — combine snapshot (for buttons/menus) + screenshot (for canvas)
4. **Make edits** — click controls, use side panels
5. **Verify visually** — screenshot after each edit to confirm
6. **Export** — trigger export, wait for completion, download to `/workspace/downloads/`

## Limitations

- Cannot directly manipulate canvas pixels — only interact with UI controls
- Drag-and-drop on timelines may need `browserEval()` workarounds
- Processing time for exports varies — check status with periodic snapshots
- Some effects require premium accounts
