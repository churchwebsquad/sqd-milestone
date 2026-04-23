/**
 * Pre-processing helpers for images that will be embedded in a PDF via
 * @react-pdf/renderer.
 *
 * Why this exists:
 *   - react-pdf's <Image> component only supports raster formats (JPEG, PNG,
 *     GIF, BMP). SVG logos silently fail to render.
 *   - Remote URLs sometimes hiccup at render time (CORS/content-type), making
 *     images vanish without error. Baking the image into a data URL up front
 *     sidesteps that.
 *   - react-pdf doesn't honor `object-fit: contain`, so callers need the
 *     image's natural dimensions to scale it proportionally without stretch.
 */

/** Pixels on the longest edge when rasterizing. 2400 px gives ~300dpi at an
 *  8-inch-wide A4 logo render — crisp in print. Larger than that balloons
 *  the PDF file size without visible gain. */
const RASTER_LONGEST_PX = 2400

export interface RasterResult {
  /** Data URL, ready to hand to <Image src=… /> in react-pdf. */
  src: string
  /** Natural width after rasterization. Use this to scale proportionally. */
  width: number
  /** Natural height after rasterization. */
  height: number
}

/**
 * Fetch any image URL and return a PNG/raster data URL + its natural
 * dimensions. SVGs get vector-rasterized at RASTER_LONGEST_PX so they stay
 * crisp even when the source viewBox is tiny. Returns null on failure so
 * callers can fall back to the original URL.
 */
export async function rasterizeForPdf(url: string): Promise<RasterResult | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const type = blob.type || inferMimeFromUrl(url)

    if (/svg/i.test(type) || /\.svg(\?|$)/i.test(url)) {
      const svgText = await blob.text()
      return await svgTextToRaster(svgText)
    }

    // Raster sources: decode through Image to get natural dims, re-encode
    // through canvas as PNG (capped at RASTER_LONGEST_PX on the longest edge,
    // never upscaled).
    return await rasterViaCanvas(blob)
  } catch {
    return null
  }
}

function inferMimeFromUrl(url: string): string {
  const m = url.match(/\.(svg|png|jpe?g|webp|gif)(\?|$)/i)
  if (!m) return ''
  const ext = m[1].toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'svg') return 'image/svg+xml'
  return `image/${ext}`
}

/** Paint an SVG string onto a canvas at RASTER_LONGEST_PX on its longest edge
 *  (upscales freely — SVG is vector). Returns the PNG data URL + dims. */
function svgTextToRaster(svg: string): Promise<RasterResult | null> {
  // Pre-parse intrinsic dims from the markup. This is more reliable than
  // relying on the browser's naturalWidth, which returns 0 for SVGs that
  // lack BOTH an explicit width/height AND a viewBox in some browsers.
  const intrinsic = svgIntrinsicDims(svg)

  return new Promise(resolve => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Prefer the markup-parsed intrinsic dims (canonical for SVG).
      // Fall back to naturalWidth/naturalHeight, then a neutral default.
      let nw = intrinsic?.w ?? img.naturalWidth
      let nh = intrinsic?.h ?? img.naturalHeight
      if (!nw || !nh) { nw = 800; nh = 800 }
      const aspect = nw / nh
      const [w, h] = nw >= nh
        ? [RASTER_LONGEST_PX, Math.round(RASTER_LONGEST_PX / aspect)]
        : [Math.round(RASTER_LONGEST_PX * aspect), RASTER_LONGEST_PX]
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, w)
      canvas.height = Math.max(1, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      // Transparent background preserved — logos on dark combinations stay clean.
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        resolve({
          src: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

/** Inspect SVG markup for its intrinsic dimensions, preferring viewBox (which
 *  always reflects the true aspect ratio) over explicit width/height (which
 *  may be in px, %, em, or absent). Returns null if nothing usable is found. */
function svgIntrinsicDims(svg: string): { w: number; h: number } | null {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[\d.\-+]+\s+[\d.\-+]+\s+([\d.]+)\s+([\d.]+)/i)
  if (vb) {
    const w = parseFloat(vb[1]), h = parseFloat(vb[2])
    if (w > 0 && h > 0) return { w, h }
  }
  // Secondary signal: explicit width/height attributes on the root <svg>.
  const root = svg.match(/<svg\b[^>]*>/i)
  if (root) {
    const wAttr = root[0].match(/\swidth\s*=\s*["']?\s*([\d.]+)/i)
    const hAttr = root[0].match(/\sheight\s*=\s*["']?\s*([\d.]+)/i)
    if (wAttr && hAttr) {
      const w = parseFloat(wAttr[1]), h = parseFloat(hAttr[1])
      if (w > 0 && h > 0) return { w, h }
    }
  }
  return null
}

/** Decode a raster blob through an Image element, then re-encode through
 *  canvas as PNG — capped at RASTER_LONGEST_PX on the longest edge. Never
 *  upscales a raster source (would just be fake pixels). */
function rasterViaCanvas(blob: Blob): Promise<RasterResult | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const nw = img.naturalWidth, nh = img.naturalHeight
      if (!nw || !nh) return resolve(null)
      const longest = Math.max(nw, nh)
      const scale = Math.min(1, RASTER_LONGEST_PX / longest)  // never > 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(nw * scale))
      canvas.height = Math.max(1, Math.round(nh * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        // Preserve alpha — PNG for all formats so logos on colored tiles
        // don't get a white rectangle baked into them.
        resolve({
          src: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}
