# MINREPORT: Login UI/UX Design Standards

This document establishes the official design line for all MINREPORT login interfaces, ensuring a consistent **"Elite Industrial Minimalism"** aesthetic across Web and Admin portals.

## 1. Core Philosophy
- **Industrial-Mineral Aesthetic**: High-contrast, technical surfaces with mineral textures and refined gradients.
- **Zero-Clutter Policy**: Minimize text labels in favor of intuitive iconography.
- **Bi-Chromatic Harmony**: Perfect readability in both Light and Dark modes using theme-aware contrast.
- **Security Visibility**: Visual cues (ShieldCheck) indicating a secure isolation zone.

## 2. Visual Palette

### Colors
- **Copper Accent**: `rgb(198, 131, 70)` - Used for the "MINREPORT®" branding and decorative horizontal lines.
- **Security Green**: 
  - Light Mode: `text-emerald-600`
  - Dark Mode: `text-emerald-400`
- **Surface Grays**:
  - `bg-black/5` | `bg-white/5` (Inputs)
  - `bg-white` | `bg-black` (Surface Backgrounds)
  - `text-black/40` | `text-white/40` (Icon Labels & HUD text)

### Backgrounds
- **Light Mode**: `industrial-mineral-gradient` 
  - Linear: `#FAFAFA` to `#E5E5E5`.
- **Dark Mode**: Radial gradient 
  - Center: `#1a1a1a` to Edge: `#000000`.

## 3. Typography & Textures
- **Standard Font**: **Atkinson Hyperlegible** (for all interfaces).
- **HUD Labels**: Mono-spaced, bold, uppercase, tracking `[0.25em]`.
- **Technical Grid**: 20px x 20px grid background with `opacity-20` for a technical drafting feel.

## 4. Component Anatomy

### Branding Header
- **Isotype**: Floating, unframed element. 
- **Sizing**: Exactly `1/3` of the form container width.
- **Spacing**: Separated from the form by the Copper branding line.
- **Label**: "MINREPORT®" centered between two 1px copper horizontal lines.

### Forms & Inputs (`.premium-input`)
- **Visuals**: Seamless, sharp corners (no rounded edges).
- **Icons**: Use Google Material Symbols Rounded (`alternate_email`, `key`, `id_card`).
- **Indicators**: Small mono-spaced identifiers (e.g., `[01]`, `[02]`) in `text-black/20` | `text-white/20`.
- **Security**: `autocomplete='off'`, `spellcheck='false'`, `data-lpignore='true'`.

### Primary Actions (Buttons)
- **Primary Submit**: Icon-only, 150% size (`ArrowRight` size 27 or `LogIn` size 27).
- **States**:
  - Light Mode: `bg-black` with `text-white`.
  - Dark Mode: `bg-white` with `text-black`.
- **Animation**: `active:scale-[0.98]` with `transition-all`.

### Footer
- **Copyright**: Standard uppercase tracking `[0.3em]`.
- **Shield Icon**: `ShieldCheck` size 14, centered above copyright.

## 5. Persistence & Memory
- **Zero Memory Policy**: All states must be cleared when navigating away from the login page.
- **Emulator Persistence**: Graceful shutdown (`SIGTERM`) to ensure `--export-on-exit` functions correctly.

---
**Standardized on: 2026-02-16**
