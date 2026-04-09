# BennuNote — 莫兰迪 UI 重设计 Spec

**Date:** 2026-04-08  
**Scope:** Pure UI reskin — no functional changes  
**Primary color:** `#A6B3A7` (Morandi grey-green)

---

## Context

The current UI uses Bilibili's brand blue (`#00a1d6`) as accent, a mixed warm/cold grey palette, and a dark terminal for the Log tab. The redesign replaces the entire visual language with a minimalist Morandi palette — muted dusty tones, generous whitespace, clean typography, and a single accent color. No behavior, data flow, or DOM structure changes.

---

## Color System

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#A6B3A7` | Active tabs, primary buttons, focus rings, status dots |
| `--accent-hover` | `#96A497` | Hover state for primary buttons |
| `--accent-subtle` | `#EBF0EB` | Badge background, info box background |
| `--accent-text` | `#6B8A6E` | Badge text, subtle labels |
| `--bg-page` | `#F4F5F3` | Panel backdrop (`:host` background), log panel background |
| `--bg-surface` | `#FFFFFF` | Panel body, cards, inputs |
| `--bg-footer` | `#FAFBFA` | Header, footer, settings rows background |
| `--bg-hover` | `#F4F5F3` | Row hover, subtitle item hover |
| `--text-primary` | `#2D3530` | Main body text, titles |
| `--text-secondary` | `#5A6358` | Secondary labels, button text |
| `--text-muted` | `#9AA097` | Inactive tabs, placeholders, tertiary text |
| `--text-time` | `#B5BCBA` | Timestamp monospace in subtitle list |
| `--border` | `#E8EBEA` | All borders (tabs, header/footer dividers, rows) |
| `--border-input` | `#D8DDD9` | Input and secondary button borders |
| `--shadow` | `0 2px 16px rgba(45,53,48,.10), 0 0 0 1px rgba(45,53,48,.05)` | Panel shadow |

**Semantic state colors (Morandi-tinted):**
| State | Color | Background |
|-------|-------|------------|
| Success / ok | `#5C8C6A` | `#EBF0EB` |
| Warning | `#B89A5C` | `#F5EFE0` |
| Error | `#B86060` | `#F5E8E8` |

---

## Typography

- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif`
- **Monospace:** `'SF Mono', Monaco, Consolas, monospace`
- No external font loading (avoid CDN dependency in extension)

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Panel title | 14px | 600 | `--text-primary` |
| Tab labels | 12.5px | 400 (inactive) / 500 (active) | `--text-muted` / `--accent` |
| Subtitle text | 13.5px | 400 | `--text-primary` |
| Timestamp | 11px monospace | 400 | `--text-time` |
| Button text | 12.5px | 400 | `--text-secondary` / white |
| Section header (settings) | 10px | 600 | `--text-muted` (uppercase, 0.8px letter-spacing) |
| Body text | 13px | 400 | `#4A5248` |
| Log text | 11.5px monospace | 400 | `#4A5248` |

---

## Layout & Spacing

- Panel: `width: 380px`, `border-radius: 14px`, shadow as above
- Header padding: `13px 16px 12px`
- Tab bar: padding `0 16px`, tabs use `padding: 9px 14px`
- Subtitle row: `padding: 9px 16px`, `gap: 12px`
- Footer: `padding: 11px 16px 13px`
- Settings section margin: `16px` between sections
- Input/button border-radius: `7px`
- Settings row border-radius: `7px`
- Badge border-radius: `8px`

---

## Component Specs

### Header
- Background: `--bg-surface`
- Border-bottom: `1px solid --border`
- Title: 14px/600, `--text-primary`
- Badge: bg `--accent-subtle`, color `--accent-text`, 10px, border-radius 8px
- Icon buttons: 28×28px, hover bg `#F0F2F1`, border-radius 7px, color `--text-muted`

### Tab Bar
- Background: `--bg-surface`
- Border-bottom: `1px solid --border`
- Active tab: color `--accent`, border-bottom `2px solid --accent`, weight 500
- Inactive tab: color `--text-muted`, weight 400

### Subtitle List
- Background: `--bg-surface`
- Row hover: `--bg-hover`
- No bottom border per row (remove current `#f5f5f5` borders for cleaner look)
- Timestamp: `--text-time`, monospace 11px

### Footer
- Background: `--bg-footer`
- Border-top: `1px solid --border`
- Primary button: bg `--accent`, color white, hover `--accent-hover`
- Secondary button: bg `--bg-surface`, border `--border-input`, color `--text-secondary`, hover bg `#F0F2F1`

### Log Tab
- Background: `--bg-page` (`#F4F5F3`)
- Font: monospace 11.5px, line-height 1.7
- Border: `1px solid --border`
- Colors: timestamp `--accent`, info `#7A9880`, ok `#5C8C6A`, warn `#B89A5C`, err `#B86060`, step `#7A6E8C`
- **Remove** the dark `#1e1e1e` background entirely

### Summary Tab
- Text area background: `--bg-surface`
- Heading style: 13px/600, color `--accent`
- Body text: 13px, `#4A5248`, line-height 1.7
- Action row: same as footer

### Settings Tab
- Background: `--bg-surface`
- Section titles: 10px/600 uppercase, `--text-muted`
- Secret rows: bg `--bg-footer`, border `--border`, border-radius 7px
- Status dot set: `--accent`; unset: `#C8CEC9`
- Inputs/selects: border `--border-input`, focus border `--accent`, focus shadow `0 0 0 2px rgba(166,179,167,.18)`
- Provider tabs active: bg `#EBF0EB`, color `--accent`

### Popup (`popup.html`)
- Button: bg `--accent`, hover `--accent-hover`
- Status dot: `--accent`
- Input focus: border `--accent`

### Options Page (`options.html`)
- Button: bg `--accent`, hover `--accent-hover`
- All focus states: border `--accent`, shadow `rgba(166,179,167,.18)`

### Progress Bar
- Fill: `--accent`

### Toast Notifications
- Success: `#5C8C6A`
- Warning: `#B89A5C`
- Error: `#B86060`

### Feishu Integration
- Confirm button: keep `#3370ff` (Feishu brand color, not changed)
- Info box: bg `--accent-subtle`, border `#D4DDD5`
- Wiki space name color: `--accent`
- Refresh/link colors: `--accent`

---

## Files to Change

| File | Changes |
|------|---------|
| `src/content/subtitle-panel.css` | Full color/typography/spacing reskin (918 lines) |
| `src/popup/popup.html` | Inline CSS: button, status dot, input focus colors |
| `src/options/options.html` | Inline CSS: button, input focus, status indicator colors |

No changes to: `.ts` files, `messages.ts`, `background.ts`, server code.

---

## What Does NOT Change

- Panel structure and DOM layout
- Tab order and names
- All interactive behaviors
- Feishu brand blue `#3370ff` (used only on Feishu confirm button — keep brand identity)
- The dark command box in token setup form (`#1e1e1e` bg for code display — keep for readability)
- All shadow DOM class names (`bennu-*` prefix)

---

## Verification

1. Build: `npm run build` — no TypeScript errors
2. Load `dist/` as unpacked extension
3. Open a Bilibili video, trigger subtitle extraction
4. Check all 4 tabs visually: Log (light bg), Subtitles, Summary, Settings
5. Verify hover states on subtitle rows and buttons
6. Verify active tab underline in `--accent` green
7. Verify primary buttons use `#A6B3A7`
8. Verify Feishu confirm button still shows `#3370ff`
9. Check popup button color
10. Check options page button and focus states
