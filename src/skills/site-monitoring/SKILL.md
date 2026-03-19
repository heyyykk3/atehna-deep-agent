---
name: site-monitoring
description: Monitor web pages for changes — price drops, stock availability, content updates, new listings. Use when the task involves checking a page repeatedly or watching for specific conditions.
allowedTools:
  - browserNavigate
  - browserSnapshot
  - browserText
  - browserScreenshot
  - browserScroll
---

# Site Monitoring

## Strategy

1. **Navigate to target page**
2. **Extract the value to monitor** (price, stock status, text content)
3. **Compare against expected condition** (price < $X, "In Stock", new items)
4. **Report result** — whether condition is met or current state

## Common Use Cases

### Price Monitoring
- Navigate to product page
- Extract current price from snapshot
- Compare to target price
- Report: current price, target price, whether met

### Stock / Availability
- Navigate to product page
- Look for "In Stock", "Add to Cart", "Out of Stock" indicators
- Report availability status

### Content Changes
- Navigate to page
- Extract text content
- Compare to previous state (from `/memories/` if available)
- Report what changed

### New Listings
- Navigate to listing/search page
- Extract current items
- Compare to previously seen items (from `/memories/`)
- Report new entries

## Data Management

- Save baseline state to `/memories/` on first check
- Compare against baseline on subsequent checks
- Update baseline when reporting changes
- Save monitoring results to `/workspace/research/`

## Output Format

Always include:
- URL monitored
- Current value/state
- Target condition
- Whether condition is met (yes/no)
- Timestamp of check
