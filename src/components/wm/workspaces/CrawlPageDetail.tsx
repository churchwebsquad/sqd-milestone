/**
 * Rich preview of a single crawled page.
 *
 * Used by:
 *   · Crawl tab — Test scrape (single URL, no DB write)
 *   · Crawl tab — Inspecting a persisted crawl job's pages
 *
 * Tab layout:
 *   Markdown · Signals · Links · Images · Raw HTML · JSON
 *
 * "Signals" mirrors the regex extractor in fire-crawl-trigger so the
 * strategist can see exactly what auto-snippeted off this page —
 * phone, email, address, service times, social URLs, action URLs,
 * pastor name. Helps tune the extractor when something gets missed.
 */
import { useMemo, useState } from 'react'
import {
  FileText, Sparkles, Link as LinkIcon, Image as ImageIcon,
  Code, Braces, ExternalLink,
} from 'lucide-react'

export interface CrawlPagePayload {
  url:        string
  title?:     string
  markdown?:  string
  html?:      string
  content?:   string         // legacy field (some callers use `content` instead of `markdown`)
  metadata?:  Record<string, unknown>
  links?:     Array<string | { href: string; text?: string }>
  navigation?: Array<{ text: string; url: string }>
  images?:    Array<{ src: string; alt?: string } | string>
}

type TabKey = 'markdown' | 'signals' | 'links' | 'images' | 'html' | 'json'

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'markdown', label: 'Markdown', icon: <FileText size={11} /> },
  { key: 'signals',  label: 'Signals',  icon: <Sparkles size={11} /> },
  { key: 'links',    label: 'Links',    icon: <LinkIcon size={11} /> },
  { key: 'images',   label: 'Images',   icon: <ImageIcon size={11} /> },
  { key: 'html',     label: 'HTML',     icon: <Code     size={11} /> },
  { key: 'json',     label: 'JSON',     icon: <Braces   size={11} /> },
]

export function CrawlPageDetail({ page }: { page: CrawlPagePayload }) {
  const [tab, setTab] = useState<TabKey>('markdown')

  const markdown = page.markdown ?? page.content ?? ''
  const html     = page.html ?? ''
  const stats    = useMemo(() => computeStats(markdown), [markdown])
  const links    = useMemo(() => extractLinks(page), [page])
  const images   = useMemo(() => extractImages(page, markdown, html), [page, markdown, html])
  const signals  = useMemo(() => extractSignals(markdown, html), [markdown, html])

  return (
    <div className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden">
      {/* Header */}
      <header className="px-4 py-3 border-b border-wm-border space-y-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="text-[15px] font-bold text-wm-text">
            {page.title || '(no title)'}
          </h3>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-wm-accent hover:underline inline-flex items-center gap-1 font-mono break-all"
          >
            {page.url}
            <ExternalLink size={10} />
          </a>
        </div>
        {typeof page.metadata?.description === 'string' && (
          <p className="text-[12px] text-wm-text-muted leading-snug">
            {page.metadata.description as string}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-wm-text-subtle pt-1">
          <span>{stats.words.toLocaleString()} words</span>
          <span>·</span>
          <span>{stats.chars.toLocaleString()} chars</span>
          <span>·</span>
          <span>{stats.headings} headings</span>
          <span>·</span>
          <span>{links.length} links</span>
          <span>·</span>
          <span>{images.length} images</span>
          {signals.length > 0 && (
            <>
              <span>·</span>
              <span className="font-semibold text-wm-accent">{signals.length} signals</span>
            </>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex flex-wrap items-center gap-0.5 px-2 pt-2 bg-wm-bg-hover/30 border-b border-wm-border">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-t-md text-[11px] font-semibold transition-colors ${
              tab === t.key
                ? 'bg-wm-bg-elevated text-wm-text border-b-2 border-wm-accent -mb-px'
                : 'text-wm-text-muted hover:bg-wm-bg-hover'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {/* Panel */}
      <div className="p-4">
        {tab === 'markdown' && <MarkdownPanel markdown={markdown} />}
        {tab === 'signals'  && <SignalsPanel signals={signals} />}
        {tab === 'links'    && <LinksPanel links={links} pageUrl={page.url} />}
        {tab === 'images'   && <ImagesPanel images={images} />}
        {tab === 'html'     && <HtmlPanel html={html} />}
        {tab === 'json'     && <JsonPanel payload={page} />}
      </div>
    </div>
  )
}

// ── Panels ────────────────────────────────────────────────────────────

function MarkdownPanel({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return <Empty label="No markdown extracted." />
  return (
    <article
      className="prose prose-sm max-w-none text-wm-text leading-relaxed
                 [&_h1]:text-[18px] [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-wm-text
                 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-wm-text
                 [&_h3]:text-[14px] [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-wm-text
                 [&_h4]:text-[13px] [&_h4]:font-bold [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-wm-text-muted
                 [&_p]:text-[13px] [&_p]:my-2 [&_p]:text-wm-text
                 [&_strong]:text-wm-text [&_strong]:font-bold
                 [&_a]:text-wm-accent [&_a]:underline
                 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
                 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5
                 [&_li]:text-[13px] [&_li]:my-0.5
                 [&_code]:text-[11px] [&_code]:bg-wm-bg-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                 [&_blockquote]:border-l-2 [&_blockquote]:border-wm-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-wm-text-muted
                 [&_img]:rounded [&_img]:my-2 [&_img]:max-w-full
                 [&_hr]:my-3 [&_hr]:border-wm-border"
      // Light markdown-to-HTML rendering — enough for visualization. Heavy
      // parsing isn't required since the strategist isn't editing here.
      dangerouslySetInnerHTML={{ __html: renderMarkdownLite(markdown) }}
    />
  )
}

function SignalsPanel({ signals }: { signals: ExtractedSignal[] }) {
  if (signals.length === 0) {
    return <Empty label="No signals matched on this page. The extractor would not auto-snippet anything from here." />
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-wm-text-muted">
        These match the regex patterns in <code className="font-mono text-[10px] bg-wm-bg-hover px-1 py-0.5 rounded">fire-crawl-trigger</code> —
        the same ones that auto-create snippets on a real crawl.
      </p>
      <ul className="divide-y divide-wm-border rounded-md border border-wm-border">
        {signals.map((s, i) => (
          <li key={i} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="text-[12px] font-semibold text-wm-text">{s.label}</span>
              <span className="text-[9px] uppercase tracking-widest font-bold text-wm-accent">
                {s.token}
              </span>
            </div>
            <p className="text-[12px] text-wm-text-muted font-mono break-all">{s.value}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LinksPanel({ links, pageUrl }: { links: string[]; pageUrl: string }) {
  if (links.length === 0) return <Empty label="No links extracted." />
  const origin = (() => { try { return new URL(pageUrl).origin } catch { return '' } })()
  const grouped = useMemo(() => {
    const internal: string[] = []
    const external: string[] = []
    for (const l of links) {
      if (origin && l.startsWith(origin)) internal.push(l)
      else if (l.startsWith('/')) internal.push(l)
      else external.push(l)
    }
    return { internal, external }
  }, [links, origin])
  return (
    <div className="space-y-3">
      <LinkGroup title="Internal" links={grouped.internal} />
      <LinkGroup title="External" links={grouped.external} />
    </div>
  )
}

function LinkGroup({ title, links }: { title: string; links: string[] }) {
  if (links.length === 0) return null
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
        {title} ({links.length})
      </p>
      <ul className="space-y-0.5 max-h-72 overflow-y-auto rounded-md border border-wm-border bg-wm-bg/30 p-2">
        {links.map((l, i) => (
          <li key={i}>
            <a
              href={l}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-wm-accent hover:underline break-all inline-flex items-center gap-1"
            >
              {l}
              <ExternalLink size={9} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImagesPanel({ images }: { images: string[] }) {
  if (images.length === 0) return <Empty label="No images extracted." />
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {images.map((src, i) => (
        <a
          key={i}
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md border border-wm-border overflow-hidden bg-wm-bg/30 hover:border-wm-accent transition-colors"
        >
          <div className="aspect-video bg-wm-bg-hover/40 flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
          <p className="text-[9px] font-mono text-wm-text-subtle px-2 py-1 truncate">{src}</p>
        </a>
      ))}
    </div>
  )
}

function HtmlPanel({ html }: { html: string }) {
  if (!html.trim()) return <Empty label="No HTML captured." />
  return (
    <pre className="text-[10px] font-mono text-wm-text bg-wm-bg-hover/40 p-3 rounded-md overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre-wrap break-words">
      {html}
    </pre>
  )
}

function JsonPanel({ payload }: { payload: unknown }) {
  return (
    <pre className="text-[10px] font-mono text-wm-text bg-wm-bg-hover/40 p-3 rounded-md overflow-x-auto max-h-[600px] overflow-y-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  )
}

function Empty({ label }: { label: string }) {
  return <p className="text-[12px] text-wm-text-muted italic py-3">{label}</p>
}

// ── Stats + extractors ───────────────────────────────────────────────

interface PageStats { words: number; chars: number; headings: number }

function computeStats(markdown: string): PageStats {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]+\)/g, '')
  const words = (text.match(/\b[\w'-]+\b/g) ?? []).length
  const chars = markdown.length
  const headings = (markdown.match(/^#{1,6}\s/gm) ?? []).length
  return { words, chars, headings }
}

function extractLinks(page: CrawlPagePayload): string[] {
  const out = new Set<string>()
  if (Array.isArray(page.links)) {
    for (const l of page.links) {
      if (typeof l === 'string') out.add(l)
      else if (l && typeof l === 'object' && typeof l.href === 'string') out.add(l.href)
    }
  }
  if (Array.isArray(page.navigation)) {
    for (const n of page.navigation) {
      if (n.url) out.add(n.url)
    }
  }
  // Markdown link extraction as fallback.
  const md = page.markdown ?? page.content ?? ''
  const re = /\[(?:[^\]]+)\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(md)) !== null) out.add(m[1])
  return Array.from(out)
}

function extractImages(page: CrawlPagePayload, markdown: string, html: string): string[] {
  const out = new Set<string>()
  if (Array.isArray(page.images)) {
    for (const im of page.images) {
      if (typeof im === 'string') out.add(im)
      else if (im && typeof im === 'object' && typeof im.src === 'string') out.add(im.src)
    }
  }
  const md = markdown
  const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g
  let m
  while ((m = mdRe.exec(md)) !== null) out.add(m[1])
  const htmlRe = /<img[^>]+src=["']([^"']+)["']/gi
  while ((m = htmlRe.exec(html)) !== null) out.add(m[1])
  return Array.from(out)
}

interface ExtractedSignal { token: string; label: string; value: string }

function extractSignals(markdown: string, html: string): ExtractedSignal[] {
  const text = `${markdown}\n${html}`
  const out: ExtractedSignal[] = []
  const seen = new Set<string>()
  const add = (token: string, label: string, value: string | null | undefined) => {
    if (!value || seen.has(token)) return
    seen.add(token)
    out.push({ token, label, value: value.trim() })
  }
  const first = (patterns: RegExp[]): string | null => {
    for (const re of patterns) {
      const m = text.match(re)
      if (m) return m[1] ?? m[0]
    }
    return null
  }
  const firstUrl = (re: RegExp): string | null => {
    const m = text.match(re)
    return m ? m[0].replace(/[).,;]+$/, '') : null
  }

  add('church_phone', 'Church phone', first([
    /tel:([+\-0-9() ]{7,})/i,
    /(\(\d{3}\)\s*\d{3}[-\s.]?\d{4})/,
    /(\+?1?[-\s.]?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4})/,
  ]))
  add('church_email', 'Church email', first([
    /mailto:([\w.+-]+@[\w-]+\.[\w.-]+)/i,
    /\b((?:info|hello|contact|admin|office|connect)@[\w-]+\.[\w.-]+)\b/i,
    /\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/i,
  ]))
  add('church_address', 'Church address', first([
    /(\d{1,5}\s+[\w.\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Place|Pl)\.?,\s+[\w\s.]+,\s+[A-Z]{2,}\s+\d{5})/i,
  ]))

  const allTimes = Array.from(new Set(text.match(/Sunday[s]?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi) ?? []))
  if (allTimes.length > 0) {
    add('primary_service_time', 'Primary service time', allTimes[0])
    if (allTimes.length > 1) add('all_service_times', 'All service times', allTimes.join(', '))
  }

  add('facebook_url',  'Facebook URL',   firstUrl(/https?:\/\/(?:www\.)?facebook\.com\/[\w\-./]+/i))
  add('instagram_url', 'Instagram URL',  firstUrl(/https?:\/\/(?:www\.)?instagram\.com\/[\w\-./]+/i))
  add('youtube_url',   'YouTube URL',    firstUrl(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w\-.]+|channel\/[\w\-]+|c\/[\w\-]+)/i))
  add('tiktok_url',    'TikTok URL',     firstUrl(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i))
  add('give_url',      'Giving URL',     firstUrl(/https?:\/\/[\w\-./]*(?:give|giving|donate)[\w\-./?=&%#]*/i))
  add('directions_url', 'Directions URL', firstUrl(/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)\/[\w\-./?=&%#@,+]+/i))
  add('livestream_url', 'Livestream URL', firstUrl(/https?:\/\/[\w\-./]*(?:livestream|watch\-live|live\-stream|\/live\b)[\w\-./?=&%#]*/i))
  add('pastor_name', 'Pastor name', first([
    /(?:Lead|Senior)\s+Pastor[:\s\-]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/,
    /Pastor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/,
  ]))

  return out
}

// ── Lightweight markdown renderer ────────────────────────────────────
// We intentionally don't pull a full markdown library in — this view
// is for previewing extraction quality, not authoring. Handles
// headings, paragraphs, bold/italic, links, lists, images, hr, code.

function renderMarkdownLite(md: string): string {
  let s = escapeHtml(md)
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
  s = s.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
  s = s.replace(/^#####\s+(.*)$/gm,  '<h5>$1</h5>')
  s = s.replace(/^####\s+(.*)$/gm,   '<h4>$1</h4>')
  s = s.replace(/^###\s+(.*)$/gm,    '<h3>$1</h3>')
  s = s.replace(/^##\s+(.*)$/gm,     '<h2>$1</h2>')
  s = s.replace(/^#\s+(.*)$/gm,      '<h1>$1</h1>')
  s = s.replace(/^---+$/gm,          '<hr>')
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+)\*/g,     '<em>$1</em>')
  s = s.replace(/`([^`\n]+)`/g,       '<code>$1</code>')
  // Crude list grouping — wrap consecutive `- ` or `1. ` lines.
  s = s.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (_, block) =>
    '\n<ul>' + block.split('\n').filter(Boolean).map((l: string) => `<li>${l.replace(/^- /, '')}</li>`).join('') + '</ul>')
  s = s.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_, block) =>
    '\n<ol>' + block.split('\n').filter(Boolean).map((l: string) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('') + '</ol>')
  // Paragraph wrapping for orphan lines.
  s = s.split(/\n{2,}/).map(chunk => {
    if (/^\s*<(h[1-6]|ul|ol|pre|hr|img|blockquote)/i.test(chunk.trim())) return chunk
    if (!chunk.trim()) return ''
    return `<p>${chunk.replace(/\n/g, '<br>')}</p>`
  }).join('\n')
  return s
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}
