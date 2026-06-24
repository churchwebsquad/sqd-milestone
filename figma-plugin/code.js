// Squad — Web Builder
// ────────────────────
// Main-thread Figma plugin code. Talks to the UI panel (ui.html)
// over postMessage. Wave 1 ships two commands:
//
//   1. preflight        — validates the project's templates are
//                         importable from the team library (Brixies
//                         Library ACSS [PRO] must be enabled on the
//                         file). Reports any keys that fail.
//
//   2. assemble-style-guide
//                       — for each template the project uses, imports
//                         the team-library component, drops one
//                         instance in a "Style Guide" frame, detaches
//                         it, and promotes the resulting frame to a
//                         local component. Stamps the original
//                         Brixies key onto the local component via
//                         setPluginData('brixies_origin_key', key) so
//                         later waves can read the bridge back to
//                         Brixies even after the designer swaps
//                         layouts. Desktop variant only in v1.
//
// Project data flow: UI panel asks the user for project ID + share
// token (saved in figma.clientStorage), then POSTs to
//   https://<host>/api/figma/project-export
// with Authorization: Bearer <token>. The host is configurable in
// the UI panel so local-dev installs can hit localhost.

/* eslint-disable */
'use strict'

// ── Storage keys ──────────────────────────────────────────────────
const STORAGE_KEY_HOST     = 'squad_api_host'
const STORAGE_KEY_PROJECT  = 'squad_project_id'
const STORAGE_KEY_TOKEN    = 'squad_share_token'

const DEFAULT_HOST = 'https://sqd-milestone.vercel.app'

// ── Boot ──────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 380, height: 560, themeColors: true })

;(async () => {
  // Restore saved credentials on launch so the UI can pre-populate.
  const host       = (await figma.clientStorage.getAsync(STORAGE_KEY_HOST))    || DEFAULT_HOST
  const projectId  = (await figma.clientStorage.getAsync(STORAGE_KEY_PROJECT)) || ''
  const token      = (await figma.clientStorage.getAsync(STORAGE_KEY_TOKEN))   || ''
  figma.ui.postMessage({ type: 'init', host: host, projectId: projectId, token: token })
})()

// ── Message handler ───────────────────────────────────────────────
figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'save-settings') {
      await figma.clientStorage.setAsync(STORAGE_KEY_HOST,    msg.host    || DEFAULT_HOST)
      await figma.clientStorage.setAsync(STORAGE_KEY_PROJECT, msg.projectId || '')
      await figma.clientStorage.setAsync(STORAGE_KEY_TOKEN,   msg.token   || '')
      figma.ui.postMessage({ type: 'settings-saved' })
      return
    }
    if (msg.type === 'preflight') {
      const data = await fetchProjectExport(msg.host, msg.projectId, msg.token)
      const result = await runPreflight(data.templates)
      figma.ui.postMessage({ type: 'preflight-result', result: result })
      return
    }
    if (msg.type === 'assemble-style-guide') {
      const data = await fetchProjectExport(msg.host, msg.projectId, msg.token)
      const result = await assembleStyleGuide(data.project, data.templates)
      figma.ui.postMessage({ type: 'assemble-result', result: result })
      return
    }
  } catch (err) {
    figma.ui.postMessage({ type: 'error', message: (err && err.message) || String(err) })
  }
}

// ── API call ──────────────────────────────────────────────────────
async function fetchProjectExport(host, projectId, token) {
  if (!host || !projectId || !token) {
    throw new Error('Host, project ID, and token are all required. Open Settings.')
  }
  const url = (host || DEFAULT_HOST).replace(/\/$/, '') + '/api/figma/project-export'
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify({ project_id: projectId }),
  })
  if (!res.ok) {
    const text = await res.text().catch(function () { return '' })
    let detail = ''
    try { detail = JSON.parse(text).error || '' } catch (_) { detail = text.slice(0, 200) }
    throw new Error('API returned ' + res.status + (detail ? ' · ' + detail : ''))
  }
  return res.json()
}

// ── Preflight ─────────────────────────────────────────────────────
// Walks each template's figma_component_key and tries to import it.
// Reports which keys imported cleanly vs. failed. The most common
// failure mode is "Brixies Library ACSS [PRO]" not enabled on the
// current file — we surface that with a hint.
async function runPreflight(templates) {
  const ok = []
  const failed = []
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    figma.ui.postMessage({ type: 'progress', label: 'Preflight ' + (i + 1) + '/' + templates.length + ': ' + t.layer_name })
    try {
      await importBrixiesComponent(t.figma_component_key)
      ok.push({ layer_name: t.layer_name, family: t.family })
    } catch (err) {
      failed.push({ layer_name: t.layer_name, family: t.family, key: t.figma_component_key, error: (err && err.message) || String(err) })
    }
  }
  return {
    ok_count: ok.length,
    failed_count: failed.length,
    ok: ok,
    failed: failed,
    library_hint: failed.length > 0
      ? 'If many imports failed, the Brixies Library ACSS [PRO] team library may not be enabled on this file. Open the Assets panel → Libraries → toggle it on, then re-run.'
      : null,
  }
}

// ── Style guide assembly ──────────────────────────────────────────
async function assembleStyleGuide(project, templates) {
  // 1. Find or create the Style Guide frame on the current page.
  const sgFrame = ensureStyleGuideFrame(project)

  // 2. Build a name → existing local component map so re-runs don't
  //    duplicate local components. If a local component already
  //    carries the same brixies_origin_key, we leave it alone.
  const existingByKey = new Map()
  for (const child of sgFrame.children) {
    if (child.type !== 'COMPONENT') continue
    const k = child.getPluginData('brixies_origin_key')
    if (k) existingByKey.set(k, child)
  }

  // 3. Iterate templates; for each one, instantiate + detach +
  //    componentize unless we already have it.
  const placed = []
  const skipped = []
  const failed = []
  let yOffset = paddingHeader(sgFrame)
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    figma.ui.postMessage({ type: 'progress', label: 'Assemble ' + (i + 1) + '/' + templates.length + ': ' + t.layer_name })

    if (existingByKey.has(t.figma_component_key)) {
      const existing = existingByKey.get(t.figma_component_key)
      // Keep the existing component but reflow into the current y
      // position for layout consistency.
      existing.y = yOffset
      yOffset += existing.height + 80
      skipped.push({ layer_name: t.layer_name })
      continue
    }

    try {
      const brixies = await importBrixiesComponent(t.figma_component_key)
      const instance = brixies.createInstance()
      sgFrame.appendChild(instance)
      instance.x = 80
      instance.y = yOffset
      // Detach the instance — returns a FRAME with the same content
      // but no library link.
      const detached = instance.detachInstance()
      // Promote to a local component. createComponentFromNode wraps
      // the node so its position + size + content all stick.
      const localComp = figma.createComponentFromNode(detached)
      localComp.name = t.layer_name
      // Stamp the original team-library key so later passes can
      // bridge back to Brixies even if the designer swaps layouts.
      localComp.setPluginData('brixies_origin_key', t.figma_component_key)
      localComp.setPluginData('brixies_layer_name', t.layer_name)
      localComp.setPluginData('brixies_family',     t.family)
      yOffset += localComp.height + 80
      placed.push({ layer_name: t.layer_name })
    } catch (err) {
      failed.push({ layer_name: t.layer_name, key: t.figma_component_key, error: (err && err.message) || String(err) })
    }
  }

  // Resize the SG frame around the children.
  sgFrame.resize(sgFrame.width, Math.max(yOffset + 80, 200))

  // Scroll to the result.
  figma.viewport.scrollAndZoomIntoView([sgFrame])

  return {
    style_guide_frame_id: sgFrame.id,
    placed_count: placed.length,
    skipped_count: skipped.length,
    failed_count: failed.length,
    placed: placed,
    skipped: skipped,
    failed: failed,
  }
}

// Find an existing "Style Guide" frame on the current page, or
// create a new one. Idempotent on re-run.
function ensureStyleGuideFrame(project) {
  const projectName = (project && project.church_short_name) || (project && project.name) || 'Project'
  const wantName = 'Style Guide · ' + projectName
  for (const child of figma.currentPage.children) {
    if (child.type === 'FRAME' && child.name === wantName) return child
  }
  const frame = figma.createFrame()
  frame.name = wantName
  frame.resize(1672, 600)
  frame.x = 0
  frame.y = 0
  frame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.96, b: 0.94 } }]
  figma.currentPage.appendChild(frame)
  return frame
}

function paddingHeader(/* frame */) {
  // Top-padding before the first component lands. Leave room for an
  // eventual project title / brand swatches at the top of the SG.
  return 120
}

// ── Brixies component import (set-aware, Desktop variant) ─────────
// importComponentByKeyAsync throws if the key belongs to a
// COMPONENT_SET (variant container). importComponentSetByKeyAsync
// returns the set; we walk children for a Desktop variant.
async function importBrixiesComponent(key) {
  if (!key) throw new Error('No component key provided')
  // Try the set path first — variant sets are the common shape in
  // Brixies (Desktop / Mobile / etc.).
  try {
    const set = await figma.importComponentSetByKeyAsync(key)
    if (set && set.type === 'COMPONENT_SET') {
      // Prefer a Desktop variant by name; fall back to defaultVariant;
      // fall back to first child.
      const children = set.children || []
      const desktop = children.find(function (c) {
        const n = (c.name || '').toLowerCase()
        return n.includes('desktop') || n.includes('breakpoint=desktop') || n.includes('property 1=desktop')
      })
      if (desktop && desktop.type === 'COMPONENT') return desktop
      if (set.defaultVariant && set.defaultVariant.type === 'COMPONENT') return set.defaultVariant
      const fallback = children.find(function (c) { return c.type === 'COMPONENT' })
      if (fallback) return fallback
      throw new Error('Component set has no usable variant: ' + key)
    }
  } catch (setErr) {
    // Not a set — fall through and try the single-component path.
    // We swallow this error because the next try gives a clearer one.
  }
  // Single-component path.
  return await figma.importComponentByKeyAsync(key)
}
