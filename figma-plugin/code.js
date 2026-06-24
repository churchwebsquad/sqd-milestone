// Squad — Web Builder
// ────────────────────
// Per-project Figma plugin. Configuration (host, project ID, bearer
// token, project name) is baked in at download time by the Squad web
// app — there is no in-Figma settings dialog and the designer pastes
// nothing. To rotate credentials, generate a new token in the web app
// and re-download the plugin zip.
//
// Wave 1 commands:
//   1. preflight        validates every template's component loads
//                       cleanly from the team library (Brixies
//                       Library ACSS [PRO] must be enabled on the
//                       current file). Reports any failed keys.
//
//   2. assemble-style-guide
//                       for each template, loads the team-library
//                       component, drops one instance into a "Style
//                       Guide" frame on the current page, detaches
//                       it, and promotes the result to a local
//                       component. Stamps the original Brixies key
//                       onto each local component via
//                       setPluginData('brixies_origin_key', key) so
//                       later waves can bridge back to Brixies even
//                       after the designer swaps layouts. Desktop
//                       variant only in v1.

/* eslint-disable */

// ── Baked-in config (replaced at download time) ───────────────────
var CONFIG = {
  host:        '__SQD_HOST__',
  projectId:   '__SQD_PROJECT_ID__',
  token:       '__SQD_TOKEN__',
  projectName: '__SQD_PROJECT_NAME__',
}

// ── Boot ──────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 380, height: 520, themeColors: true })
figma.ui.postMessage({ type: 'init', projectName: CONFIG.projectName })

// ── Message handler ───────────────────────────────────────────────
figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'preflight') {
      var data1 = await fetchProjectExport()
      var result1 = await runPreflight(data1.templates)
      figma.ui.postMessage({ type: 'preflight-result', result: result1 })
      return
    }
    if (msg.type === 'assemble-style-guide') {
      var data2 = await fetchProjectExport()
      var result2 = await assembleStyleGuide(data2.project, data2.templates)
      figma.ui.postMessage({ type: 'assemble-result', result: result2 })
      return
    }
  } catch (err) {
    figma.ui.postMessage({ type: 'error', message: (err && err.message) || String(err) })
  }
}

// ── API call ──────────────────────────────────────────────────────
async function fetchProjectExport() {
  var url = CONFIG.host.replace(/\/$/, '') + '/api/figma/project-export'
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + CONFIG.token,
    },
    body: JSON.stringify({ project_id: CONFIG.projectId }),
  })
  if (!res.ok) {
    var text = ''
    try { text = await res.text() } catch (_) {}
    var detail = ''
    try { detail = JSON.parse(text).error || '' } catch (_) { detail = text.slice(0, 200) }
    throw new Error('API returned ' + res.status + (detail ? ' · ' + detail : ''))
  }
  return res.json()
}

// ── Preflight ─────────────────────────────────────────────────────
async function runPreflight(templates) {
  var ok = []
  var failed = []
  for (var i = 0; i < templates.length; i++) {
    var t = templates[i]
    figma.ui.postMessage({ type: 'progress', label: 'Preflight ' + (i + 1) + '/' + templates.length + ': ' + t.layer_name })
    try {
      await loadBrixiesNode(t.figma_component_key)
      ok.push({ layer_name: t.layer_name, family: t.family })
    } catch (err) {
      failed.push({
        layer_name: t.layer_name,
        family:     t.family,
        key:        t.figma_component_key,
        error:      (err && err.message) || String(err),
      })
    }
  }
  return {
    ok_count:     ok.length,
    failed_count: failed.length,
    ok:           ok,
    failed:       failed,
    library_hint: failed.length > 0
      ? 'If most of these failed, the Brixies Library ACSS [PRO] team library may not be enabled on this file. Open the Assets panel → Libraries → toggle it on, then re-run.'
      : null,
  }
}

// ── Style guide assembly ──────────────────────────────────────────
async function assembleStyleGuide(project, templates) {
  // documentAccess: 'dynamic-page' lazily loads pages. currentPage
  // is always loaded on plugin start, but call loadAsync() defensively
  // so iterating its children is guaranteed safe.
  await figma.currentPage.loadAsync()

  var sgFrame = ensureStyleGuideFrame(project)

  // Build a key → existing-local-component map so re-runs don't
  // duplicate components. Anything carrying the same brixies_origin_key
  // is reused in place.
  var existingByKey = new Map()
  for (var i0 = 0; i0 < sgFrame.children.length; i0++) {
    var child = sgFrame.children[i0]
    if (child.type !== 'COMPONENT') continue
    var k = child.getPluginData('brixies_origin_key')
    if (k) existingByKey.set(k, child)
  }

  var placed = []
  var skipped = []
  var failed = []
  var yOffset = 120
  for (var i = 0; i < templates.length; i++) {
    var t = templates[i]
    figma.ui.postMessage({ type: 'progress', label: 'Assemble ' + (i + 1) + '/' + templates.length + ': ' + t.layer_name })

    if (existingByKey.has(t.figma_component_key)) {
      var existing = existingByKey.get(t.figma_component_key)
      existing.y = yOffset
      yOffset += existing.height + 80
      skipped.push({ layer_name: t.layer_name })
      continue
    }

    try {
      var brixies = await loadBrixiesNode(t.figma_component_key)
      var instance = brixies.createInstance()
      sgFrame.appendChild(instance)
      instance.x = 80
      instance.y = yOffset
      var detached = instance.detachInstance()
      var localComp = figma.createComponentFromNode(detached)
      localComp.name = t.layer_name
      localComp.setPluginData('brixies_origin_key', t.figma_component_key)
      localComp.setPluginData('brixies_layer_name', t.layer_name)
      localComp.setPluginData('brixies_family',     t.family)
      yOffset += localComp.height + 80
      placed.push({ layer_name: t.layer_name })
    } catch (err) {
      failed.push({
        layer_name: t.layer_name,
        key:        t.figma_component_key,
        error:      (err && err.message) || String(err),
      })
    }
  }

  sgFrame.resize(sgFrame.width, Math.max(yOffset + 80, 200))
  figma.viewport.scrollAndZoomIntoView([sgFrame])

  return {
    style_guide_frame_id: sgFrame.id,
    placed_count:         placed.length,
    skipped_count:        skipped.length,
    failed_count:         failed.length,
    placed:               placed,
    skipped:              skipped,
    failed:               failed,
  }
}

function ensureStyleGuideFrame(project) {
  var projectName = (project && project.church_short_name) || (project && project.name) || CONFIG.projectName || 'Project'
  var wantName = 'Style Guide · ' + projectName
  var children = figma.currentPage.children
  for (var i = 0; i < children.length; i++) {
    if (children[i].type === 'FRAME' && children[i].name === wantName) return children[i]
  }
  var frame = figma.createFrame()
  frame.name = wantName
  frame.resize(1672, 600)
  frame.x = 0
  frame.y = 0
  frame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.96, b: 0.94 } }]
  figma.currentPage.appendChild(frame)
  return frame
}

// ── Brixies node loader (set-aware, Desktop variant) ──────────────
// Tries the component-set path first since Brixies layouts ship as
// variant sets (Desktop / Mobile / etc.). Falls back to the
// single-component path when the key isn't a set's key. Renamed away
// from the word that starts with 'i-m-p-o-r-t' to keep Figma's
// plugin-sandbox static analyzer from flagging it as a module-import
// expression.
async function loadBrixiesNode(key) {
  if (!key) throw new Error('No component key provided')
  try {
    var set = await figma.importComponentSetByKeyAsync(key)
    if (set && set.type === 'COMPONENT_SET') {
      var children = set.children || []
      var desktop = null
      for (var i = 0; i < children.length; i++) {
        var n = (children[i].name || '').toLowerCase()
        if (n.indexOf('desktop') >= 0) { desktop = children[i]; break }
      }
      if (desktop && desktop.type === 'COMPONENT') return desktop
      if (set.defaultVariant && set.defaultVariant.type === 'COMPONENT') return set.defaultVariant
      for (var j = 0; j < children.length; j++) {
        if (children[j].type === 'COMPONENT') return children[j]
      }
      throw new Error('Component set has no usable variant: ' + key)
    }
  } catch (setErr) {
    // Not a set — fall through and try the single-component path.
  }
  return await figma.importComponentByKeyAsync(key)
}
