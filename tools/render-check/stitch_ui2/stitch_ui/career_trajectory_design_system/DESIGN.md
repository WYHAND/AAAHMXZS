---
name: Career Trajectory Design System
colors:
  surface: '#f8f9ff'
  surface-dim: '#d4dae6'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eef4ff'
  surface-container: '#e8eefa'
  surface-container-high: '#e2e9f4'
  surface-container-highest: '#dce3ee'
  on-surface: '#151c24'
  on-surface-variant: '#44474a'
  inverse-surface: '#2a313a'
  inverse-on-surface: '#ebf1fd'
  outline: '#75777a'
  outline-variant: '#c5c6ca'
  surface-tint: '#5d5e61'
  primary: '#06080a'
  on-primary: '#ffffff'
  primary-container: '#1e2022'
  on-primary-container: '#86878a'
  inverse-primary: '#c6c6c9'
  secondary: '#904d00'
  on-secondary: '#ffffff'
  secondary-container: '#fe932c'
  on-secondary-container: '#663500'
  tertiary: '#140400'
  on-tertiary: '#ffffff'
  tertiary-container: '#3a1500'
  on-tertiary-container: '#d36a24'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e5'
  primary-fixed-dim: '#c6c6c9'
  on-primary-fixed: '#1a1c1e'
  on-primary-fixed-variant: '#454749'
  secondary-fixed: '#ffdcc3'
  secondary-fixed-dim: '#ffb77d'
  on-secondary-fixed: '#2f1500'
  on-secondary-fixed-variant: '#6e3900'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb68e'
  on-tertiary-fixed: '#331200'
  on-tertiary-fixed-variant: '#763300'
  background: '#f8f9ff'
  on-background: '#151c24'
  surface-variant: '#dce3ee'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
  caption:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system is engineered for modern professional career development and milestone tracking. The interface communicates deliberate momentum, intellectual rigor, and editorial clarity. Rather than relying on juvenile gamification or hyper-saturated incentive patterns, the aesthetic borrows from high-end executive dashboards and refined productivity instruments.

The target audience consists of career-driven professionals, engineering leads, product strategists, and executives tracking competencies, peer milestones, and structured promotion ladders. 

### Core Tenets
- **Editorial Precision:** Information architecture is presented with strict discipline, clear visual grouping, and measured typographic contrast.
- **Understated Momentum:** Progress is represented not as flashy arcade levels, but as measured, compounding craftsmanship through warm amber cues and disciplined progress bars.
- **Architectural Grounding:** Warm neutral foundations eliminate harsh digital starkness, replacing it with a tactile, paper-adjacent warmth that sustains deep, long-form operational focus.

## Colors

The palette is anchored in an intentional interplay between architectural warm neutrals, crisp white operational surfaces, and restrained amber accents.

### Color Tokens & Roles

- **Canvas Background (`#FAF9F6`):** The primary off-white warm foundation. Provides low glare and an editorial, tactile base.
- **Surface Elevation (`#FFFFFF`):** High-clarity white reserved strictly for interactive cards, dialogs, and workspace containers.
- **Surface Secondary (`#F7F6F2`):** Used for nested containers, table headers, inactive states, and segmented control backgrounds.
- **Border Default (`#E8E6E1`):** Subtle separation hairline for cards, dividers, and modular containers.
- **Border Muted (`#ECEAE5`):** Ultra-subtle interior divider line within component lists.
- **Text Primary (`#1E2022`):** Grounded, low-black ink color for headlines, primary data, and focused reading.
- **Text Secondary (`#666D77`):** Neutral gray calibrated for metadata, task descriptions, and subheaders.
- **Text Muted (`#8C929D`):** Tertiary indicator for completed states, timestamps, and placeholder copy.
- **Brand Accent Primary (`#D97706`):** Precision amber. Signifies active progression, milestones, key indicators, and focused states.
- **Brand Accent Vibrant (`#F59E0B`):** Highlight amber for active progress bar heads and high-impact badges.
- **Brand Accent Deep (`#B45309`):** Grounded cognac/gold for text labels on amber tinted tags to ensure WCAG AA readability.
- **Interactive Dark Base (`#1E2022`):** High-contrast anchor for primary buttons.
- **Interactive Dark Hover (`#2D3139`):** Subtle luminance elevation on dark interactive elements.
- **Success Tone (`#059669`):** Reserved for complete verification badges and completed task marks.

## Typography

Typography prioritizes high functional density, rhythmic tracking, and absolute legibility. Fallbacks map seamlessly across desktop and mobile devices via system sans-serif stacks (`-apple-system`, `PingFang SC`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`).

### Hierarchy & Usage Rules
- **Headline XL & LG:** Reserved for milestone module titles, level evaluations, and executive overview cards.
- **Headline SM & MD:** Assigned to career task grouping headers and card modal headings.
- **Body MD:** The default reading standard for multi-line task requirements, contextual feedback, and verification criteria.
- **Label SM:** Standardized for status pills, progress counters (e.g., `3/5 COMPLETED`), and milestone metrics with uppercase styling.
- **Line Heights:** Tightly disciplined to prevent optical drift within dense task lists while preserving natural line boundaries.

## Layout & Spacing

The layout is structured around an editorial grid combining a focused main tracking column and secondary contextual rail.

### Spacing & Grid Rules
- **Structural Rhythm:** Spacing is anchored to a strict 4px/8px incremental rhythm.
- **Card Padding:** Standardized at `16px` (`space-lg`) across all primary data and task cards to balance content density with breathing room.
- **Card-to-Card Gap:** Restricted to `8px` (`space-sm`) to `12px` (`space-md`) for grouped checklist items, reinforcing vertical continuity without visual separation.
- **Section Offsets:** Larger grouping transitions scale to `24px` (`space-xl`).

### Responsive Adaptation
- **Desktop (≥ 1024px):** 12-column grid. Main tracking stream spans 8 columns, while career objectives, mentor feedback, and competency progress graphs span 4 columns. Outer margin: `32px`, gutter: `16px`.
- **Tablet (768px - 1023px):** 8-column layout. Sidebar tucks beneath primary metrics as collapsible panels. Outer margin: `24px`, gutter: `16px`.
- **Mobile (< 768px):** Single-column fluid stack. Outer margin: `16px`, intra-card spacing: `8px`. Top overview statistics collapse into horizontal swipeable modules.

## Elevation & Depth

This design system avoids heavy shadows, artificial glows, and floating layers. Depth is constructed purely through low-contrast linear definition, tonal layering, and minimal ambient contact shadows.

### Elevation Levels
- **Canvas Base:** `#FAF9F6` establishes the physical desk plane.
- **Surface Elevation 0 (Inline Modules):** `#FFFFFF` cards framed with a `1px` continuous outline of `#E8E6E1`. Zero ambient shadow in resting states.
- **Surface Elevation 1 (Interactive Hover & Drag):** Upon hover, cards lift subtly with an ambient shadow: `0 2px 8px -2px rgba(30, 32, 34, 0.05), 0 1px 3px 0 rgba(30, 32, 34, 0.03)` with border shifting to `#D9D7D1`.
- **Surface Elevation 2 (Flyouts & Dropdowns):** Floating panels sit on `#FFFFFF` with outline `1px solid #E8E6E1` and ambient shadow: `0 8px 24px -4px rgba(30, 32, 34, 0.08), 0 2px 6px -1px rgba(30, 32, 34, 0.04)`.
- **Internal Tonal Nesting:** Inside white cards, code blocks, secondary task checklists, or sub-details reside on `#F7F6F2` with no border, creating inward recessed depth.

## Shapes

The geometric personality balances contemporary softness with architectural structure. 

### Corner Radius System
- **Main Cards & Containers:** Explicitly constrained to `10px` to `12px` (`rounded-lg`), achieving an approachable yet professional appearance.
- **Inputs & Buttons:** Set to `8px` (`rounded`), providing ergonomic tap boundaries while maintaining distinct corners.
- **Pills & Status Badges:** Set to full rounded radius (`rounded-full` / `9999px`) to create clear differentiation between actionable surfaces and informational labels.
- **Progress Track Channels:** Set to `4px` or `rounded-full` with matching rounded inner indicators.

## Components

### Buttons
- **Primary Action:**
  - Background: `#1E2022`
  - Text: `#FFFFFF` (`label-md`)
  - Border: None
  - Padding: `8px 16px`
  - Radius: `8px`
  - Hover: Background `#2D3139`, smooth `150ms ease` transition.
  - Active: Scale `0.99`, background `#111827`.
- **Secondary Action:**
  - Background: `#FFFFFF`
  - Text: `#1E2022`
  - Border: `1px solid #E8E6E1`
  - Hover: Background `#F7F6F2`, border `#D9D7D1`.
- **Ghost Action:**
  - Background: Transparent
  - Text: `#666D77`
  - Hover: Background `#F7F6F2`, text `#1E2022`.

### Cards (Task & Track Cards)
- **Container:** Background `#FFFFFF`, border `1px solid #E8E6E1`, radius `12px`, padding `16px`.
- **Layout:** Horizontal alignment for quick status parsing: Checkbox/Icon (Left) → Title & Subtitle Group (Center/Expand) → Progress Tag & Action (Right).
- **Completed State:** Card background maintains `#FFFFFF`, title switches to `#8C929D` with subtle strikethrough or check indicator, border shifts to `#ECEAE5`.

### Progress Bars & Milestone Tracks
- **Track Channel:** Height `6px`, background `#F0EEE9`, corner radius `9999px`.
- **Active Fill:** Solid amber `#D97706` or linear gradient from `#D97706` to `#F59E0B`.
- **Complete Fill:** Transition to `#059669` or deep ink `#1E2022` upon 100% stage verification.

### Status Chips & Badges
- **In Progress Badge:** Background `#FEF3C7` (Amber 100), text `#B45309` (`label-sm`), radius `9999px`, padding `2px 8px`.
- **Neutral / Draft Badge:** Background `#F7F6F2`, text `#666D77`, border `1px solid #E8E6E1`, radius `9999px`, padding `2px 8px`.
- **Verified Badge:** Background `#ECFDF5`, text `#047857`, radius `9999px`, padding `2px 8px`.

### Checkboxes
- **Base Box:** Size `18px x 18px`, radius `4px`, border `1.5px solid #D9D7D1`, background `#FFFFFF`.
- **Checked Box:** Border `#1E2022`, background `#1E2022`, white checkmark icon centered.
- **Focus Ring:** `2px` offset glow with `#D97706` at 30% opacity.

### Input Fields
- **Container:** Height `40px`, background `#FFFFFF`, border `1px solid #E8E6E1`, radius `8px`, text `#1E2022` (`body-md`), padding `0 12px`.
- **Placeholder:** Text `#8C929D`.
- **Focus State:** Border `#1E2022`, outline `1px solid #1E2022`.

### Lists & Subtasks
- Continuous vertical flow with items separated by `1px solid #ECEAE5`.
- Subtasks sit nested within card parent surfaces on `#F7F6F2` background, padding `10px 12px`, radius `8px`, gap between items `6px`.