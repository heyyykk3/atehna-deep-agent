---
name: web-scraping
description: Extract structured data from web pages — tables, lists, product info, prices, article text. Use when the task involves reading and collecting information from one or more pages.
allowedTools:
  - browserNavigate
  - browserSnapshot
  - browserText
  - browserScreenshot
  - browserScroll
  - browserClick
  - browserTabs
---

# Web Scraping

## Strategy

1. **Snapshot first** — always start with `browserSnapshot()` to see the page structure
2. **Use text for bulk extraction** — `browserText()` gets all visible text cheaply
3. **Scroll for lazy-loaded content** — many sites load content on scroll; scroll down and re-snapshot
4. **Paginate** — if there's a "Next" or page number link, click through all pages
5. **Use screenshot for visual data** — tables rendered as images, charts, infographics

## Patterns

### Tables
- Snapshot shows table rows with refs — extract by reading the snapshot text
- If table is complex (merged cells, nested), use `browserText()` for raw text
- For very large tables, scroll and extract in chunks

### Lists (search results, product listings)
- Each item usually has a consistent structure (title, price, link, image)
- Extract by identifying the repeating pattern in the snapshot
- Click "Load More" or paginate to get all results

### Articles
- `browserText()` is usually best for article content
- Snapshot helps identify the main content area vs sidebar/nav
- For multi-page articles, follow "Next page" links

### Prices & Product Info
- Look for structured elements: price tags usually have specific formatting
- Compare across tabs if doing price comparison
- Note currency and availability

## Output Format

Return data in a structured format:
- For tables: describe columns and rows clearly
- For lists: use consistent formatting per item
- For articles: clean text with sections preserved
- Always include the source URL
