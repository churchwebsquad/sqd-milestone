/**
 * Design system spec for a project — single source of truth for brand
 * tokens that drive the ACSS variable export and the Figma Tokens
 * Studio import file.
 *
 * Shape was chosen to honor two downstream consumers at once:
 *
 *   1. ACSS Pro (Bricks). Anchors only — `--primary`, `--secondary`,
 *      `--accent`, `--base`. ACSS Pro auto-generates the 7-step tonal
 *      scale from anchors. Typography / spacing / radius emit as fluid
 *      `clamp()` values from the desktop + mobile pairs the strategist
 *      enters.
 *
 *   2. Tokens Studio plugin (Figma). Figma variables don't auto-derive
 *      scales, so the export emits the full 50→900 tonal scale per role.
 *      Generated from anchors via HSL lightness manipulation. Reference
 *      syntax (`{color.brand.primary}`) keeps the variable graph
 *      maintainable on brand updates.
 *
 * The spec is authored in the Design workspace and persisted on
 * `strategy_web_projects.design_system` (jsonb).
 */

// ── ACSS naming conventions ────────────────────────────────────────
//
// Token names in the export follow the ACSS vocabulary (see the
// `acss-token-generator` skill). The spec stores anchors as raw
// inputs; ACSS-shaped tokens only materialize via role × shade
// slot assignment below.
//
//   Roles      — primary, secondary, tertiary, accent, action, base,
//                neutral, shade
//   Shade step — ultra-light, light, semi-light, medium (the role's
//                anchor — exported as `--{role}` without suffix),
//                semi-dark, dark, ultra-dark

export const ACSS_ROLES = [
  'primary', 'secondary', 'tertiary', 'accent',
  'action',  'base',      'neutral',  'shade',
] as const
export type AcssRole = typeof ACSS_ROLES[number]

export const ACSS_SHADE_STEPS = [
  'ultra-light', 'light', 'semi-light',
  'medium',
  'semi-dark', 'dark', 'ultra-dark',
] as const
export type AcssShadeStep = typeof ACSS_SHADE_STEPS[number]

// ── Spec types ─────────────────────────────────────────────────────

export interface DesignSystemSpec {
  schema_version: 2
  /** Brand anchors — canonical named colors from the brand guide.
   *  Pure inputs: an id (stable slug), a display name ("Oxblood"),
   *  and a hex. They do NOT carry token names; ACSS tokens
   *  materialize only when an anchor is placed into a role × shade
   *  slot below. The same anchor can fill multiple slots. */
  brand_anchors: BrandAnchor[]
  /** Role × shade matrix. For each ACSS role (primary, secondary,
   *  tertiary, accent, action, base, neutral, shade) the designer
   *  fills slots in the 7-step scale (ultra-light → ultra-dark) with
   *  anchor ids. Empty slots are skipped on export — ACSS Pro
   *  auto-generates them downstream. The `medium` slot in any role
   *  becomes the role's `--{role}` anchor; the rest become
   *  `--{role}-{shade}`. */
  role_shades: RoleShadeMatrix
  typography: TypographySpec
  spacing:    SpacingSpec
  radius:     RadiusSpec
  /** Per-project Figma binding — the URL of the Style Guide frame
   *  (or the parsed file key + node id). Powers the plugin generator:
   *  scripts run in this same Figma file and walk the frame's children
   *  by name to find each Brixies layout. The designer's workflow:
   *
   *    1. Open this project's Figma file (or create one).
   *    2. Open the Brixies team library and drag in every layout
   *       the project uses (the list of `web_content_templates` rows
   *       below).
   *    3. Right-click each → Detach from library.
   *    4. Wrap each in a new local Component (Cmd+Opt+K).
   *    5. Place all those new components into a single auto-layout
   *       frame named "Style Guide" (the names should match the
   *       Brixies layer name verbatim — that's the key the plugin
   *       uses to find the right component for each section).
   *    6. Copy that frame's URL (right-click → Copy link, or use
   *       the URL bar after selecting). Paste here.
   *
   *  No component "key" hunting needed — the plugin uses
   *  `figma.getNodeByIdAsync(<style-guide-node-id>)` against this
   *  same file and walks `.findAll()` by name.
   */
  figma?: FigmaBinding
  /** External URL of an organized-images folder for this project
   *  (Drive, Dropbox, Notion gallery, etc.). Shown on both the Design
   *  Handoff and Dev Handoff workspaces so designers and engineers
   *  pull imagery from one canonical place. Optional; staff fills it
   *  in when assets are prepped. */
  organized_images_folder_url?: string
  meta: {
    updated_at: string  // ISO
  }
}

export interface FigmaBinding {
  /** Full Figma URL with the `?node-id=…` query param. The parser
   *  derives the file key + node id from this; the raw URL is also
   *  useful for handing off to the Figma MCP server downstream. */
  style_guide_url?: string
  /** Cached parse of the URL (regenerated on save so dev tools have
   *  immediate access without re-parsing). */
  file_key?: string
  style_guide_node_id?: string
  /** Designer's progress checklist — template ids they've already
   *  loaded (detached + re-componentized) into the Style Guide frame.
   *  Pure progress-tracking; doesn't affect the plugin export. */
  loaded_template_ids?: string[]
  /** Designer-added templates that aren't in the auto-derived `used`
   *  set. The auto-derived list comes from web_sections.content_template_id;
   *  this lets the designer record templates they pulled into Figma
   *  for layouts that aren't bound back to a section yet (e.g. they
   *  decided to use a different hero variant after the strategist
   *  picked one, or they added a sub-component the strategist hadn't
   *  budgeted). The checklist surfaces these alongside the auto-set. */
  extra_template_ids?: string[]
  /** Designer-removed auto-derived templates. When the designer
   *  decides NOT to use an auto-derived template in Figma (template
   *  swap, scope cut), they remove it from the checklist; the id
   *  goes here so it's filtered out of the rendered list without
   *  losing the underlying section binding. */
  excluded_template_ids?: string[]
}

/** Map of role → shade-step → anchor id. Undefined / missing keys
 *  mean "unset" for that slot. */
export type RoleShadeMatrix = Partial<Record<AcssRole, Partial<Record<AcssShadeStep, string>>>>

export interface BrandAnchor {
  /** Stable id for cross-referencing — typically `slugify(name)` plus
   *  a numeric suffix if name collisions occur. NOT an ACSS token
   *  name; tokens come from the role × shade slot the anchor sits in. */
  id: string
  /** Display name from the brand guide ("Oxblood", "Antique White"). */
  name: string
  /** #RRGGBB. */
  hex: string
}

/** Sources for typography font URLs the designer can click through to.
 *  Captured at intake on `strategy_brand_typography` and surfaced under
 *  the font name inputs in the Design workspace. Designer uses these
 *  to download the actual font file or grab the Google Fonts embed. */
export interface FontResource {
  /** Native font family the brand specified (e.g. "Monument Extended"). */
  family_name?: string
  /** Web-compatible fallback or actual web family (e.g. "Barlow"). */
  web_font_family?: string
  /** Where to source the font (Google Fonts page, MyFonts, etc.). */
  font_url?: string
  /** Free alternative family + URL if the primary is paid. */
  free_alt_family?: string
  /** Designer-facing notes (e.g. weight, letter-case rules). */
  notes?: string
}

export interface TypographySpec {
  font_heading: string   // CSS font-family stack (incl. fallbacks)
  font_body:    string
  /** Per-role font sizes, desktop + mobile px. Generates fluid
   *  `clamp()` values on export. */
  sizes: Record<TypographyRole, { desktop: number; mobile: number }>
  /** Auto-populated font source links + free alternatives for the
   *  designer to click through (Google Fonts, MyFonts, etc.). Optional
   *  — populated by `populateFromBrandGuide`, editable in the UI. */
  heading_resource?: FontResource
  body_resource?:    FontResource
}

export type TypographyRole =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5'
  | 'body' | 'small' | 'eyebrow'

export interface SpacingSpec {
  /** Semantic spacing scale, desktop + mobile px. */
  steps: Record<SpacingStep, { desktop: number; mobile: number }>
}

export type SpacingStep = 'xxs' | 'xs' | 's' | 'm' | 'l' | 'xl' | 'xxl'

export interface RadiusSpec {
  /** Role-based radius scale (per design-system-builder skill —
   *  never t-shirt sized). */
  sm:   { desktop: number; mobile: number }  // buttons / inputs / inline interactives
  md:   { desktop: number; mobile: number }  // cards / content surfaces
  lg:   { desktop: number; mobile: number }  // large atmospheric surfaces
  full: number                               // circular / pill
}

// ── Default spec (used when a project has no design_system yet) ─────

export function emptyDesignSystemSpec(): DesignSystemSpec {
  return {
    schema_version: 2,
    brand_anchors: [],
    // Pre-seed all eight ACSS roles with empty shade maps so the UI
    // can render every row even before the designer touches anything.
    role_shades: ACSS_ROLES.reduce<RoleShadeMatrix>((acc, r) => {
      acc[r] = {}
      return acc
    }, {}),
    typography: {
      font_heading: 'Inter, system-ui, sans-serif',
      font_body:    'Inter, system-ui, sans-serif',
      sizes: {
        h1:      { desktop: 64, mobile: 40 },
        h2:      { desktop: 48, mobile: 32 },
        h3:      { desktop: 32, mobile: 24 },
        h4:      { desktop: 24, mobile: 20 },
        h5:      { desktop: 20, mobile: 18 },
        body:    { desktop: 17, mobile: 16 },
        small:   { desktop: 14, mobile: 14 },
        eyebrow: { desktop: 13, mobile: 12 },
      },
    },
    spacing: {
      steps: {
        xxs: { desktop: 4,   mobile: 4 },
        xs:  { desktop: 8,   mobile: 8 },
        s:   { desktop: 16,  mobile: 12 },
        m:   { desktop: 24,  mobile: 20 },
        l:   { desktop: 40,  mobile: 32 },
        xl:  { desktop: 64,  mobile: 48 },
        xxl: { desktop: 96,  mobile: 64 },
      },
    },
    radius: {
      sm:   { desktop: 8,  mobile: 8 },
      md:   { desktop: 16, mobile: 16 },
      lg:   { desktop: 24, mobile: 24 },
      full: 9999,
    },
    meta: { updated_at: new Date().toISOString() },
  }
}

// ── Parse / validate from jsonb ─────────────────────────────────────

/** Defensive parser — jsonb has no schema enforcement, so anything
 *  could be in the column. Returns `null` if the shape doesn't look
 *  like a spec; callers fall back to `emptyDesignSystemSpec()`.
 *  Handles v1 → v2 migration: the old flat `roles` map (one slot per
 *  role) lifts into `role_shades.{role}.medium`. */
export function parseDesignSystemSpec(raw: unknown): DesignSystemSpec | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.brand_anchors)) return null
  if (typeof r.typography !== 'object' || r.typography === null) return null
  if (typeof r.spacing !== 'object' || r.spacing === null) return null
  if (typeof r.radius !== 'object' || r.radius === null) return null

  // v2 — current shape.
  if (r.schema_version === 2 && typeof r.role_shades === 'object' && r.role_shades !== null) {
    return r as unknown as DesignSystemSpec
  }

  // v1 — migrate. Strip the ACSS shade suffix off any anchor ids
  // that carried it (we used to bake `base-dark` into the id); roll
  // forward to the cleaner `{name-slug}` form. The old flat
  // `roles[role]` value points at one of those anchors — place it
  // in `role_shades[role].medium` since v1 only modeled one slot
  // per role.
  if (r.schema_version === 1 && typeof r.roles === 'object' && r.roles !== null) {
    const oldRoles = r.roles as Record<string, string | null>
    const role_shades: RoleShadeMatrix = ACSS_ROLES.reduce<RoleShadeMatrix>((acc, role) => {
      acc[role] = {}
      return acc
    }, {})
    for (const role of ['primary', 'secondary', 'accent', 'base'] as const) {
      const anchorId = oldRoles[role]
      if (typeof anchorId === 'string' && anchorId) {
        role_shades[role]!.medium = anchorId
      }
    }
    const migrated: DesignSystemSpec = {
      schema_version: 2,
      brand_anchors: r.brand_anchors as BrandAnchor[],
      role_shades,
      typography: r.typography as TypographySpec,
      spacing:    r.spacing    as SpacingSpec,
      radius:     r.radius     as RadiusSpec,
      meta: (r.meta as DesignSystemSpec['meta']) ?? { updated_at: new Date().toISOString() },
    }
    return migrated
  }

  return null
}

// ── Color utilities ─────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0')
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break
      case gn: h = (bn - rn) / d + 2; break
      default: h = (rn - gn) / d + 4
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360 / 360
  const sat = Math.max(0, Math.min(100, s)) / 100
  const lit = Math.max(0, Math.min(100, l)) / 100
  if (sat === 0) {
    const g = Math.round(lit * 255)
    return { r: g, g, b: g }
  }
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat
  const p = 2 * lit - q
  const conv = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    r: Math.round(conv(hue + 1 / 3) * 255),
    g: Math.round(conv(hue) * 255),
    b: Math.round(conv(hue - 1 / 3) * 255),
  }
}

/** Generate a 9-step tonal scale from an anchor hex.
 *  Step 500 = the anchor itself; lighter steps step UP in lightness,
 *  darker steps step DOWN. Uses HSL lightness manipulation with a
 *  perceptual curve (not linear) so steps feel evenly spaced. */
export function generateTonalScale(hex: string): Record<TonalStep, string> {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return TONAL_STEPS.reduce((acc, step) => {
      acc[step] = hex
      return acc
    }, {} as Record<TonalStep, string>)
  }
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b)

  // Target lightness for each step. The brand color sits at 500 and
  // tonal steps walk to white (50) and black (900) via perceptual curve.
  // Numbers chosen so the curve gives clean Material-style stops.
  const lightnessByStep: Record<TonalStep, number> = {
    '50':  96,
    '100': 92,
    '200': 82,
    '300': 70,
    '400': 56,
    '500': rgbToHsl(rgb.r, rgb.g, rgb.b).l, // anchor — preserve native L
    '600': 35,
    '700': 25,
    '800': 16,
    '900': 8,
  }

  // Saturation tapers slightly at the extremes so 50/900 don't feel
  // garish — about 85% sat at the anchor extremes vs 100% at mid.
  const satByStep: Record<TonalStep, number> = {
    '50':  Math.max(s * 0.45, 8),
    '100': Math.max(s * 0.55, 10),
    '200': Math.max(s * 0.70, 12),
    '300': Math.max(s * 0.85, 14),
    '400': s,
    '500': s,
    '600': s,
    '700': Math.max(s * 0.95, 16),
    '800': Math.max(s * 0.85, 14),
    '900': Math.max(s * 0.75, 10),
  }

  const out = {} as Record<TonalStep, string>
  for (const step of TONAL_STEPS) {
    const { r, g, b } = hslToRgb(h, satByStep[step], lightnessByStep[step])
    out[step] = rgbToHex(r, g, b)
  }
  return out
}

export const TONAL_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const
export type TonalStep = typeof TONAL_STEPS[number]

// ── ACSS shade-scale generator ────────────────────────────────────
//
// ACSS Pro's Global Variable Manager uses a fixed lightness target
// per shade. The hue + saturation come from the role's anchor; only
// `l` varies. These targets match exactly what ACSS Pro emits on a
// fresh project (see the GVM JSON sample) so the export round-trips
// cleanly when re-imported.

export const ACSS_SHADE_LIGHTNESS: Record<AcssShadeStep, number> = {
  'ultra-light': 95,
  'light':       85,
  'semi-light':  65,
  'medium':      50,
  'semi-dark':   35,
  'dark':        25,
  'ultra-dark':  10,
}

export interface AcssGeneratedShade {
  /** Hex form of the generated color. Used by the Tokens Studio
   *  export and the workspace preview. */
  hex: string
  /** HSL components — `h` and `s` come from the anchor, `l` from
   *  the fixed table above. Used by the ACSS GVM export which
   *  stores colors as separate H/S/L variables. */
  h: number
  s: number
  l: number
}

/** Generate the 7-step ACSS shade scale from an anchor hex.
 *
 *  Hue + saturation preserved from the anchor at every step. Lightness
 *  walks the fixed ACSS targets EXCEPT at the slot the anchor's actual
 *  lightness classifies into — there we preserve the anchor's exact L
 *  so the picked color appears in the scale at its natural step.
 *
 *  Examples:
 *    • Sky Blue #40AFC9 (L≈52) → classifies as `medium` → medium L=52
 *      (anchor's actual L), others walk standard targets.
 *    • White #FFFFFF (L=100) → classifies as `ultra-light` →
 *      ultra-light L=100, others walk 85/65/50/35/25/10.
 *    • Charcoal #2E2E2E (L=18) → classifies as `dark` → dark L=18,
 *      others walk 95/85/65/50/35/-/10.
 *
 *  This means the anchor is ALWAYS visible somewhere in the generated
 *  scale — important for neutral roles (base / neutral / shade) where
 *  the picked color usually sits at an extreme lightness, not L=50. */
export function generateAcssShades(hex: string): Record<AcssShadeStep, AcssGeneratedShade> {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    const fallback: AcssGeneratedShade = { hex, h: 0, s: 0, l: 50 }
    return ACSS_SHADE_STEPS.reduce((acc, step) => {
      acc[step] = fallback
      return acc
    }, {} as Record<AcssShadeStep, AcssGeneratedShade>)
  }
  const { h, s, l: anchorL } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const anchorShade = classifyShade(hex)
  const out = {} as Record<AcssShadeStep, AcssGeneratedShade>
  for (const step of ACSS_SHADE_STEPS) {
    const l = step === anchorShade ? anchorL : ACSS_SHADE_LIGHTNESS[step]
    const { r, g, b } = hslToRgb(h, s, l)
    out[step] = { hex: rgbToHex(r, g, b), h, s, l }
  }
  return out
}

/** Which shade slot a hex's natural lightness classifies into.
 *  Used by the exporters to know where to place the anchor reference
 *  and by the preview UI to highlight the picked slot. */
export function anchorShadeStep(hex: string): AcssShadeStep {
  return classifyShade(hex)
}

/** Compute the standard ACSS "hover" lightness target — slightly
 *  lighter than the anchor for dark anchors, slightly darker for
 *  light anchors, clamped 5..95. Matches ACSS Pro's default behavior. */
export function computeHoverLightness(anchorL: number): number {
  const target = anchorL < 50 ? anchorL + 15 : anchorL + 18
  return Math.max(5, Math.min(95, target))
}

/** Compute the standard ACSS "comp" (compositional / contrast)
 *  lightness — picks the readable extreme opposite the anchor's
 *  midpoint. Used for text-on-button color etc. */
export function computeCompLightness(anchorL: number): number {
  return anchorL < 50 ? 95 : 10
}

// ── Fluid clamp() generator ─────────────────────────────────────────

const CLAMP_VIEWPORT_MIN = 375   // small phone
const CLAMP_VIEWPORT_MAX = 1440  // desktop reference
const ROOT_FONT_PX = 16          // 1rem = 16px

/** Convert a desktop + mobile px pair to a fluid `clamp()` value.
 *
 *   clamp(min, base + Xvw, max)
 *
 * `vw_coefficient = (desktop - mobile) / (viewportMax - viewportMin) * 100`
 * `base_rem = mobile_rem - (mobile_px * vw_coefficient / 100 / root_px)`
 *
 * When desktop === mobile, returns a static rem value with no clamp. */
export function toClamp(desktopPx: number, mobilePx: number): string {
  if (desktopPx === mobilePx) {
    return (desktopPx / ROOT_FONT_PX).toFixed(3).replace(/\.?0+$/, '') + 'rem'
  }
  const slope = (desktopPx - mobilePx) / (CLAMP_VIEWPORT_MAX - CLAMP_VIEWPORT_MIN)
  const vwCoef = slope * 100
  const minRem = mobilePx / ROOT_FONT_PX
  const maxRem = desktopPx / ROOT_FONT_PX
  const baseRem = minRem - (CLAMP_VIEWPORT_MIN * slope) / ROOT_FONT_PX
  const fmt = (n: number) => n.toFixed(3).replace(/\.?0+$/, '')
  return `clamp(${fmt(minRem)}rem, ${fmt(baseRem)}rem + ${fmt(vwCoef)}vw, ${fmt(maxRem)}rem)`
}

/** Convert a px value to a single rem string. Used by the Tokens Studio
 *  export where Figma variables hold ONE numeric value — no clamp,
 *  no min/max envelope. The CSS export (toClamp above) keeps the
 *  responsive envelope; Figma gets the desktop snapshot. */
export function toRem(px: number): string {
  return (px / ROOT_FONT_PX).toFixed(3).replace(/\.?0+$/, '') + 'rem'
}

// ── Tokens Studio JSON export ───────────────────────────────────────

/** Generate `tokens.figma.json` (Tokens Studio plugin format) from the
 *  spec. Imported into Figma via the Tokens Studio plugin: install →
 *  Tools → "JSON file" → load → press Create variables.
 *
 *  Schema (Tokens Studio): every leaf is `{ $value, $type, $description? }`.
 *  References use `{path.to.token}` syntax — preserved so brand changes
 *  cascade through the variable graph. */
export interface TokensStudioFile {
  global: TokensStudioCollection
  $themes: unknown[]
  $metadata: { tokenSetOrder: string[] }
}

type TokensStudioCollection = Record<string, unknown>

export function toTokensStudioJson(spec: DesignSystemSpec): TokensStudioFile {
  const global: TokensStudioCollection = {}

  // ── Brand anchors (canonical references) ─────────────────────────
  const brand: Record<string, { $value: string; $type: 'color' }> = {}
  for (const a of spec.brand_anchors) {
    brand[a.id] = { $value: a.hex.toUpperCase(), $type: 'color' }
  }
  global.color = { brand }
  const colorBag = global.color as Record<string, unknown>

  // ── ACSS role × shade tokens (color.{role}.{shade}) ─────────────
  //
  // For each role with a `medium` anchor set, auto-fill the full
  // 7-step scale via HSL stepping at fixed lightness targets (the
  // ACSS GVM contract). The `medium` slot references the brand
  // anchor by name so brand updates cascade; the other 6 emit raw
  // hex computed from the anchor.
  //
  // ACSS keys use hyphenated shade names (`ultra-light`, etc.). The
  // Tokens Studio JSON nests them under the role for cleaner Figma
  // variable structure: `color.primary["ultra-light"]`.
  const mediumAnchorByRole: Partial<Record<AcssRole, BrandAnchor>> = {}
  for (const role of ACSS_ROLES) {
    const shadeMap = spec.role_shades[role]
    if (!shadeMap) continue
    const mediumAnchorId = shadeMap.medium
    if (!mediumAnchorId) continue
    const anchor = spec.brand_anchors.find(a => a.id === mediumAnchorId)
    if (!anchor) continue
    mediumAnchorByRole[role] = anchor

    const generated = generateAcssShades(anchor.hex)
    // Where the anchor naturally lives in the scale — that slot
    // references {color.brand.X} so brand updates cascade. Other
    // slots emit computed hex.
    const anchorSlot = anchorShadeStep(anchor.hex)
    const roleColors: Record<string, { $value: string; $type: 'color'; $description?: string }> = {}
    for (const step of ACSS_SHADE_STEPS) {
      // Designer may have explicitly overridden a non-anchor slot
      // with a different brand anchor (rare — UI doesn't expose it
      // yet, but the data model supports it).
      const overrideId = step !== anchorSlot && step !== 'medium' ? shadeMap[step] : undefined
      const override = overrideId ? spec.brand_anchors.find(a => a.id === overrideId) : undefined
      if (step === anchorSlot) {
        roleColors[step] = {
          $value: `{color.brand.${anchor.id}}`,
          $type: 'color',
          $description: step === 'medium' ? `${role} anchor` : `${role} anchor (naturally at ${step})`,
        }
      } else if (override) {
        roleColors[step] = {
          $value: `{color.brand.${override.id}}`,
          $type: 'color',
          $description: `${role} ${step} — designer override`,
        }
      } else {
        roleColors[step] = {
          $value: generated[step].hex.toUpperCase(),
          $type: 'color',
        }
      }
    }
    colorBag[role] = roleColors
  }

  // ── Surface role tokens (theme tokens) ───────────────────────────
  // Aliased to base shade steps when the base role is set. Keys
  // follow common ACSS Pro semantic-surface naming so dev handoff
  // can wire them directly to `--theme-bg-card`, etc. Since we now
  // auto-fill every shade for any role with a medium anchor, just
  // checking the base anchor is enough.
  const baseAnchor = mediumAnchorByRole.base
  if (baseAnchor) {
    const surface: Record<string, { $value: string; $type: 'color' }> = {
      background: { $value: '{color.base.ultra-light}', $type: 'color' },
      foreground: { $value: '{color.base.ultra-dark}',  $type: 'color' },
      card:       { $value: '#FFFFFF',                  $type: 'color' },
      muted:      { $value: '{color.base.light}',       $type: 'color' },
      divider:    { $value: '{color.base.semi-light}',  $type: 'color' },
    }
    colorBag.surface = surface
  }

  // ── Spacing ──────────────────────────────────────────────────────
  // Figma variables hold ONE numeric value, so we emit the desktop
  // snapshot. The responsive envelope lives in the CSS export. If
  // designers want a mobile variant in Figma, Tokens Studio supports
  // multiple token sets — future work to add a `mobile` set alongside
  // `global` and wire them as modes.
  const spacing: Record<string, { $value: string; $type: 'spacing' }> = {}
  for (const [step, vals] of Object.entries(spec.spacing.steps)) {
    spacing[step] = { $value: toRem(vals.desktop), $type: 'spacing' }
  }
  global.spacing = spacing

  // ── Border radius ────────────────────────────────────────────────
  const borderRadius: Record<string, { $value: string; $type: 'borderRadius'; $description?: string }> = {
    sm: {
      $value: toRem(spec.radius.sm.desktop),
      $type: 'borderRadius',
      $description: 'Buttons, inputs, inline interactives',
    },
    md: {
      $value: toRem(spec.radius.md.desktop),
      $type: 'borderRadius',
      $description: 'Cards, content surfaces',
    },
    lg: {
      $value: toRem(spec.radius.lg.desktop),
      $type: 'borderRadius',
      $description: 'Large atmospheric surfaces',
    },
    full: {
      $value: `${spec.radius.full}px`,
      $type: 'borderRadius',
      $description: 'Circular / pill',
    },
  }
  global.borderRadius = borderRadius

  // ── Typography ───────────────────────────────────────────────────
  global.fontFamilies = {
    heading: { $value: spec.typography.font_heading, $type: 'fontFamilies' },
    body:    { $value: spec.typography.font_body,    $type: 'fontFamilies' },
  }

  const fontSizes: Record<string, { $value: string; $type: 'fontSizes' }> = {}
  for (const [role, vals] of Object.entries(spec.typography.sizes)) {
    // Desktop-only for Figma; clamp lives in CSS export.
    fontSizes[role] = { $value: toRem(vals.desktop), $type: 'fontSizes' }
  }
  global.fontSizes = fontSizes

  // Pre-composed text styles (Tokens Studio "typography" composite)
  const typography: Record<string, unknown> = {}
  const composite = (
    family: 'heading' | 'body',
    role: TypographyRole,
    weight: string,
    lineHeight: string,
    letterSpacing: string,
  ) => ({
    $type: 'typography',
    $value: {
      fontFamily:    `{fontFamilies.${family}}`,
      fontWeight:    weight,
      fontSize:      `{fontSizes.${role}}`,
      lineHeight,
      letterSpacing,
    },
  })
  typography.h1      = composite('heading', 'h1',      '700', '1.1',  '-0.02em')
  typography.h2      = composite('heading', 'h2',      '700', '1.15', '-0.015em')
  typography.h3      = composite('heading', 'h3',      '600', '1.2',  '-0.01em')
  typography.h4      = composite('heading', 'h4',      '600', '1.25', '0')
  typography.h5      = composite('heading', 'h5',      '600', '1.3',  '0')
  typography.body    = composite('body',    'body',    '400', '1.6',  '0')
  typography.small   = composite('body',    'small',   '400', '1.5',  '0')
  typography.eyebrow = composite('body',    'eyebrow', '600', '1.4',  '0.08em')
  global.typography = typography

  return {
    global,
    $themes: [],
    $metadata: { tokenSetOrder: ['global'] },
  }
}

/** Map an intake tier value to its ACSS role.
 *
 *  ACSS has three distinct neutral roles, each anchored on a different
 *  lightness range:
 *    • `base`    — the LIGHT neutral (page background, cream/off-white)
 *    • `neutral` — the MID gray family (UI chrome, borders, dividers)
 *    • `shade`   — the DARK neutral (text, shadows, deep dark surfaces)
 *
 *  Intake's `background` tier → base (light), `text` tier → shade
 *  (dark). When a project doesn't capture a separate `neutral` row,
 *  that role stays empty and ACSS falls back to its own defaults. */
export function mapTierToAcssRole(tier: string | null | undefined): AcssRole | null {
  const t = (tier ?? '').toLowerCase().trim()
  if (t === 'primary')    return 'primary'
  if (t === 'secondary')  return 'secondary'
  if (t === 'tertiary')   return 'tertiary'
  if (t === 'accent')     return 'accent'
  if (t === 'background') return 'base'
  if (t === 'text')       return 'shade'
  if (t === 'neutral')    return 'neutral'
  return null
}

/** Classify a hex color into the ACSS shade step closest to its HSL
 *  lightness. Thresholds chosen to spread evenly across 0–100% so the
 *  mid-bucket (`medium`) hits the brand's "main" anchor when L ≈ 50%. */
export function classifyShade(hex: string): AcssShadeStep {
  const rgb = hexToRgb(hex)
  if (!rgb) return 'medium'
  const { l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  if (l >= 90) return 'ultra-light'
  if (l >= 75) return 'light'
  if (l >= 60) return 'semi-light'
  if (l >= 40) return 'medium'
  if (l >= 25) return 'semi-dark'
  if (l >= 10) return 'dark'
  return 'ultra-dark'
}

// ── Auto-populate from intake brand-guide rows ─────────────────────
//
// The intake flow captures structured brand data in three tables keyed
// by `strategy_brand_guides.member` (integer):
//
//   • strategy_brand_colors      — { name, tier, hex, proportion_pct, sort_order }
//   • strategy_brand_typography  — { tier, family_name, web_font_family, font_url,
//                                    free_alt_family, free_alt_font_url, suggested_use, weight }
//   • strategy_brand_guides      — { member, display_name, style_tags, … }
//
// `populateFromBrandGuide` reads those rows and merges them onto a
// design system spec — brand_anchors from colors (dedup'd by hex),
// role mapping by tier, typography heading/body by `suggested_use`
// (most reliable signal: "Headline"/"Heading" → heading; everything
// else → body). The user can then adjust before saving.

export interface BrandColorRow {
  name: string | null
  tier: string | null   // 'primary' | 'secondary' | 'accent' | 'background' | 'text'
  hex: string
  proportion_pct: number | null
  sort_order: number | null
}

export interface BrandTypographyRow {
  tier: string | null
  family_name: string | null
  web_font_family: string | null
  font_url: string | null
  free_alt_family: string | null
  free_alt_font_url: string | null
  suggested_use: string | null  // 'Heading' | 'Headlines' | 'Body' | …
  weight: string | null
  letter_case: string | null
  sort_order: number | null
}

export interface BrandGuidePopulateResult {
  spec: DesignSystemSpec
  /** Human-readable summary of what got picked up — surfaced in the UI
   *  so the strategist knows what to verify vs. what came from intake. */
  summary: string[]
  /** True if at least one anchor or typography family was populated. */
  populated: boolean
}

export function populateFromBrandGuide(
  current: DesignSystemSpec,
  colors: BrandColorRow[],
  typography: BrandTypographyRow[],
): BrandGuidePopulateResult {
  const summary: string[] = []
  let next: DesignSystemSpec = { ...current }

  // ── Colors → brand_anchors + role × shade slots ─────────────────
  //
  // Anchors are pure inputs (slugified name id, hex). Each intake row
  // also tells us where to PLACE that anchor in the role × shade
  // matrix: `mapTierToAcssRole(tier)` → role, `classifyShade(hex)` →
  // shade step. Designer can re-slot freely in the UI.

  if (colors.length > 0) {
    // Dedupe by normalized hex. Keep the first occurrence (intake
    // sort_order represents the brand guide's intended order).
    const sorted = [...colors].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )
    const byHex = new Map<string, BrandColorRow>()
    for (const c of sorted) {
      const norm = normalizeHex(c.hex)
      if (norm && !byHex.has(norm)) byHex.set(norm, { ...c, hex: norm })
    }

    const proportionByHex = new Map<string, number>()
    for (const c of sorted) {
      const norm = normalizeHex(c.hex)
      if (norm) proportionByHex.set(norm, c.proportion_pct ?? 0)
    }

    interface Placed {
      anchor: BrandAnchor
      role: AcssRole | null
      shade: AcssShadeStep
      proportion: number
    }
    const placed: Placed[] = []
    const usedIds = new Set<string>()
    for (const c of byHex.values()) {
      const displayName = c.name?.trim() || titleCase(c.tier ?? 'Color')
      const baseId = slugify(displayName) || `color-${c.hex.slice(1, 4)}`
      let id = baseId
      let i = 2
      while (usedIds.has(id)) id = `${baseId}-${i++}`
      usedIds.add(id)
      placed.push({
        anchor: { id, name: displayName, hex: c.hex.toUpperCase() },
        role:   mapTierToAcssRole(c.tier),
        shade:  classifyShade(c.hex),
        proportion: proportionByHex.get(c.hex.toLowerCase()) ?? 0,
      })
    }
    next.brand_anchors = placed.map(p => p.anchor)
    summary.push(`Colors: ${placed.length} anchor${placed.length === 1 ? '' : 's'} from intake.`)

    // Build the role anchor map. For each role, pick the brand
    // anchor whose shade classifies closest to `medium` (the "main"
    // brand color for that role). Tie-break by `proportion_pct`.
    //
    // Only the `medium` slot is set per role — the rest of the 7-step
    // scale auto-generates from this anchor at preview + export time.
    // Keeps the UI dead simple (one picker per role) without losing
    // any expressive power.
    const matrix: RoleShadeMatrix = ACSS_ROLES.reduce<RoleShadeMatrix>((acc, r) => {
      acc[r] = {}
      return acc
    }, {})
    const mediumIdx = ACSS_SHADE_STEPS.indexOf('medium')
    let rolesFilled = 0
    for (const role of ACSS_ROLES) {
      const candidates = placed.filter(p => p.role === role)
      if (candidates.length === 0) continue
      // Closest to medium L, with proportion_pct as tie-break.
      let best: typeof candidates[number] | null = null
      let bestDistance = Infinity
      let bestProportion = -1
      for (const c of candidates) {
        const distance = Math.abs(ACSS_SHADE_STEPS.indexOf(c.shade) - mediumIdx)
        if (distance < bestDistance || (distance === bestDistance && c.proportion > bestProportion)) {
          best = c
          bestDistance = distance
          bestProportion = c.proportion
        }
      }
      if (best) {
        matrix[role]!.medium = best.anchor.id
        rolesFilled++
      }
    }
    next.role_shades = matrix

    if (rolesFilled > 0) {
      const filledRoles = Array.from(new Set(
        placed.filter(p => p.role).map(p => p.role!)
      ))
      summary.push(`Role anchors set: ${filledRoles.join(', ')}.`)
    }
  } else {
    summary.push('Colors: no rows in strategy_brand_colors.')
  }

  // ── Typography → font_heading / font_body + font resources ─────

  if (typography.length > 0) {
    const sortedType = [...typography].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )

    const isHeadingUse = (r: BrandTypographyRow) =>
      /head|title|display/i.test(`${r.suggested_use ?? ''}`)
    const isBodyUse = (r: BrandTypographyRow) =>
      /body|paragraph|copy|caption|subhead/i.test(`${r.suggested_use ?? ''}`)

    const headingRow = sortedType.find(isHeadingUse)
      ?? sortedType[0]
      ?? null
    const bodyRow =
      sortedType.find(r => r !== headingRow && isBodyUse(r))
      ?? sortedType.find(r => r !== headingRow)
      ?? headingRow
      ?? null

    const resourceFor = (r: BrandTypographyRow | null): FontResource | undefined => {
      if (!r) return undefined
      const out: FontResource = {}
      if (r.family_name) out.family_name = r.family_name
      if (r.web_font_family) out.web_font_family = r.web_font_family
      // Derive a Google Fonts URL if the family looks Google-Fonts-y
      // and no explicit URL was provided. This covers common cases
      // like "Barlow" / "Montserrat" / "Work Sans" without intake
      // having captured the URL.
      out.font_url = r.font_url
        ?? googleFontsUrlFor(r.web_font_family ?? r.family_name ?? '', r.weight ?? undefined)
      if (r.free_alt_family) out.free_alt_family = r.free_alt_family
      const notes: string[] = []
      if (r.weight) notes.push(`weight ${r.weight}`)
      if (r.letter_case) notes.push(`case: ${r.letter_case}`)
      if (notes.length > 0) out.notes = notes.join(' · ')
      return out
    }

    const cssFamilyFor = (r: BrandTypographyRow | null, fallback: string): string => {
      if (!r) return fallback
      const name = r.web_font_family || r.family_name
      if (!name) return fallback
      // Wrap multi-word names in quotes for the CSS font-family.
      const quoted = /\s/.test(name) ? `'${name}'` : name
      // Append a sensible system fallback so the iframe doesn't fall
      // back to Times if the font isn't loaded.
      return `${quoted}, system-ui, sans-serif`
    }

    next.typography = {
      ...next.typography,
      font_heading: cssFamilyFor(headingRow, next.typography.font_heading),
      font_body:    cssFamilyFor(bodyRow,    next.typography.font_body),
      heading_resource: resourceFor(headingRow),
      body_resource:    resourceFor(bodyRow),
    }
    const parts = []
    if (headingRow) parts.push(`heading: ${headingRow.family_name ?? headingRow.web_font_family ?? '(unnamed)'}`)
    if (bodyRow && bodyRow !== headingRow) parts.push(`body: ${bodyRow.family_name ?? bodyRow.web_font_family ?? '(unnamed)'}`)
    if (parts.length > 0) summary.push(`Typography: ${parts.join(', ')}.`)
  } else {
    summary.push('Typography: no rows in strategy_brand_typography.')
  }

  next.meta = { ...next.meta, updated_at: new Date().toISOString() }

  const anyRoleSlot = ACSS_ROLES.some(r =>
    next.role_shades[r] && Object.keys(next.role_shades[r]!).length > 0
  )

  return {
    spec: next,
    summary,
    populated: next.brand_anchors.length > 0 || anyRoleSlot || !!next.typography.heading_resource,
  }
}

function normalizeHex(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim())
  if (!m) return null
  return '#' + m[1].toLowerCase()
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

// ── Figma URL parsing ──────────────────────────────────────────────

/** Extract the file key + node id from a Figma URL. Returns nulls
 *  when the URL is malformed or doesn't carry a node id. Tolerant
 *  of `figma.com/file/...`, `figma.com/design/...`, the `?node-id=`
 *  query param (with or without URL encoding), and the `#node-id=`
 *  hash form. */
export function parseFigmaUrl(url: string): { file_key: string | null; node_id: string | null } {
  if (!url || typeof url !== 'string') return { file_key: null, node_id: null }
  try {
    const u = new URL(url.trim())
    const pathMatch = /\/(?:file|design|proto)\/([A-Za-z0-9]+)/.exec(u.pathname)
    const file_key = pathMatch?.[1] ?? null
    const rawNode = u.searchParams.get('node-id')
      ?? (u.hash ? new URLSearchParams(u.hash.slice(1)).get('node-id') : null)
    let node_id: string | null = null
    if (rawNode) {
      // Figma URLs encode the node id as `1-23`; the plugin API
      // expects `1:23`. Convert both `-` and `%3A` to `:`.
      node_id = decodeURIComponent(rawNode).replace(/-/g, ':')
    }
    return { file_key, node_id }
  } catch {
    return { file_key: null, node_id: null }
  }
}

/** Normalize a `FigmaBinding` by re-parsing the URL into the cached
 *  file_key + node_id fields. Call before persisting. */
export function normalizeFigmaBinding(binding: FigmaBinding | undefined): FigmaBinding | undefined {
  if (!binding) return undefined
  const url = binding.style_guide_url?.trim()
  if (!url) {
    // Allow explicit file_key + node_id input even without a URL.
    if (binding.file_key || binding.style_guide_node_id) return binding
    return undefined
  }
  const parsed = parseFigmaUrl(url)
  return {
    style_guide_url:     url,
    file_key:            parsed.file_key ?? binding.file_key,
    style_guide_node_id: parsed.node_id  ?? binding.style_guide_node_id,
  }
}

// ── ACSS Global Variable Manager export ────────────────────────────
//
// Format reference: a flat key/value object that ACSS Pro's Global
// Variable Manager accepts via "Import" (drag-and-drop JSON).
// Sample inspected:
//   { "primary-medium-h": 213, "primary-medium-s": 30, "primary-medium-l": 50,
//     "color-primary": "#455367", "h1-min": "48", "h1-max": "78", ... }
//
// We emit ONLY the keys derived from the spec — colors, typography,
// spacing, radius. Everything else stays at the ACSS Pro defaults,
// which is what the dev team expects when applying a brand on top of
// a fresh ACSS install.
//
// Values are kept loose (number | string) because ACSS itself mixes
// types (px-suffix strings for some keys, raw numbers for HSL, etc.).

export type AcssGvmFile = Record<string, string | number>

export function toAcssGvmJson(spec: DesignSystemSpec): AcssGvmFile {
  const out: AcssGvmFile = {}

  // ── Colors ───────────────────────────────────────────────────────
  for (const role of ACSS_ROLES) {
    const shadeMap = spec.role_shades[role] ?? {}
    const mediumAnchorId = shadeMap.medium
    if (!mediumAnchorId) continue
    const anchor = spec.brand_anchors.find(a => a.id === mediumAnchorId)
    if (!anchor) continue

    // Source hex for ACSS Pro's "Choose source color" field — used
    // when the user opens the GVM UI to tweak.
    out[`color-${role}`]     = anchor.hex.toUpperCase()
    out[`color-${role}-alt`] = anchor.hex.toUpperCase()

    // The shade scale — HSL components for each fixed-lightness step.
    const shades = generateAcssShades(anchor.hex)
    const anchorL = shades.medium.l
    for (const step of ACSS_SHADE_STEPS) {
      const sh = shades[step]
      out[`${role}-${step}-h`]     = round(sh.h)
      out[`${role}-${step}-s`]     = round(sh.s)
      out[`${role}-${step}-l`]     = round(sh.l)
      out[`${role}-${step}-h-alt`] = round(sh.h)
      out[`${role}-${step}-s-alt`] = round(sh.s)
      out[`${role}-${step}-l-alt`] = round(sh.l)
    }

    // Hover + comp — derived per ACSS Pro's contrast model.
    const hoverL = computeHoverLightness(anchorL)
    out[`${role}-hover-h`]     = round(shades.medium.h)
    out[`${role}-hover-s`]     = round(shades.medium.s)
    out[`${role}-hover-l`]     = round(hoverL)
    out[`${role}-hover-h-alt`] = round(shades.medium.h)
    out[`${role}-hover-s-alt`] = round(shades.medium.s)
    out[`${role}-hover-l-alt`] = round(hoverL)

    const compL = computeCompLightness(anchorL)
    out[`${role}-comp-h`]     = round(shades.medium.h)
    out[`${role}-comp-s`]     = round(shades.medium.s)
    out[`${role}-comp-l`]     = round(compL)
    out[`${role}-comp-h-alt`] = round(shades.medium.h)
    out[`${role}-comp-s-alt`] = round(shades.medium.s)
    out[`${role}-comp-l-alt`] = round(compL)
  }

  // ── Typography ───────────────────────────────────────────────────
  // ACSS stores font-family per H-level + base; sizes as min/max px
  // (mobile / desktop). Line-height and letter-spacing per H-level
  // are left blank by default — only override when the spec has a
  // non-default value.
  out['h1-font-family'] = quoteIfNeeded(spec.typography.font_heading)
  out['h2-font-family'] = quoteIfNeeded(spec.typography.font_heading)
  out['h3-font-family'] = quoteIfNeeded(spec.typography.font_heading)
  out['h4-font-family'] = quoteIfNeeded(spec.typography.font_heading)
  out['h5-font-family'] = quoteIfNeeded(spec.typography.font_heading)
  // ACSS surfaces a single "body font" via the default font-family
  // resolution chain; emit a body-font hint so the GVM UI shows it.
  out['body-font-family'] = quoteIfNeeded(spec.typography.font_body)

  const sizes = spec.typography.sizes
  const fmtSize = (n: number) => String(n)
  if (sizes.h1)      { out['h1-max']    = fmtSize(sizes.h1.desktop);      out['h1-min']    = fmtSize(sizes.h1.mobile) }
  if (sizes.h2)      { out['h2-max']    = fmtSize(sizes.h2.desktop);      out['h2-min']    = fmtSize(sizes.h2.mobile) }
  if (sizes.h3)      { out['h3-max']    = fmtSize(sizes.h3.desktop);      out['h3-min']    = fmtSize(sizes.h3.mobile) }
  if (sizes.h4)      { out['h4-max']    = fmtSize(sizes.h4.desktop);      out['h4-min']    = fmtSize(sizes.h4.mobile) }
  if (sizes.h5)      { out['h5-max']    = fmtSize(sizes.h5.desktop);      out['h5-min']    = fmtSize(sizes.h5.mobile) }
  if (sizes.body)    { out['base-text-desk'] = fmtSize(sizes.body.desktop); out['base-text-mob'] = fmtSize(sizes.body.mobile) }

  // ── Spacing ──────────────────────────────────────────────────────
  // ACSS uses `base-space` (desktop) and `base-space-min` (mobile) as
  // its central spacing anchor — every other ACSS spacing key derives
  // from these via the GVM's scale ratio. Our `m` step is the
  // semantic match (the design-system-builder treatment of `space-m`
  // as the canonical mid-step).
  const mid = spec.spacing.steps.m
  if (mid) {
    out['base-space']     = String(mid.desktop)
    out['base-space-min'] = String(mid.mobile)
  }

  // ── Radius ───────────────────────────────────────────────────────
  // ACSS uses one "base radius" that drives buttons, cards, inputs.
  // Map our `md` (cards / content surfaces) to base-radius and our
  // `sm` (buttons / inputs) to btn-radius.
  out['base-radius'] = `${spec.radius.md.desktop}px`
  out['btn-radius']  = `${spec.radius.sm.desktop}px`
  out['radius']      = `${spec.radius.md.desktop}px`

  return out
}

function round(n: number): number {
  return Math.round(n)
}

function quoteIfNeeded(family: string): string {
  // ACSS stores font-family values without explicit quoting; the
  // sample emits "Unblocker" and "Serotiva" as bare names. Strip our
  // CSS-style fallback chain and emit just the primary family.
  const first = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  return first
}

/** Build a Google Fonts CSS URL guess. Returns undefined if the
 *  family doesn't look like something on Google Fonts. We don't pin
 *  to a specific weight in the URL because intake's `weight` field is
 *  per-family-row, not per-style; the designer typically loads the
 *  full family weight range. */
export function googleFontsUrlFor(family: string, _weight?: string): string | undefined {
  if (!family) return undefined
  const cleaned = family.replace(/[,'"].*$/, '').trim()
  if (!cleaned) return undefined
  // Skip system/generic stacks
  if (/^(inter|system-ui|sans-serif|serif|monospace|cursive|fantasy)$/i.test(cleaned)) {
    return undefined
  }
  const slug = cleaned.replace(/\s+/g, '+')
  return `https://fonts.google.com/specimen/${slug}`
}
