import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
import ComingSoonPage from './components/ComingSoonPage'
import ChurchesDashboardPage from './pages/ChurchesDashboardPage'
import ChurchDetailPage from './pages/ChurchDetailPage'
import CopyReviewAdminPage from './pages/CopyReviewAdminPage'
import BrandGuideEditorPage from './pages/BrandGuideEditorPage'
import IntelAuditToolPage from './pages/IntelAuditToolPage'
import LoginPage from './pages/LoginPage'
import SubmitFormPage from './pages/SubmitFormPage'
import TemplateEditorPage from './pages/TemplateEditorPage'
import AccountLogPage from './pages/AccountLogPage'
import DashboardPage from './pages/DashboardPage'
import MyDashboardPage from './pages/MyDashboardPage'
import ClientPortalPage from './pages/ClientPortalPage'
import CopyReviewPortalPage from './pages/CopyReviewPortalPage'
import BrandGuidePortalPage from './pages/BrandGuidePortalPage'
import BrandingIndexPage from './pages/BrandingIndexPage'
import BrandHandoffPage from './pages/BrandHandoffPage'
import { BRAND_PORTAL_HOST } from './lib/portalUrl'

// `brand.thesqd.com` is a dedicated subdomain for partner-facing brand
// guides. Same Vercel project, same bundle, but a different route tree:
// the portal lives at the root (`/{church}`, `/{church}/{ministry}`)
// instead of under `/brand/`, so the public URL reads cleanly. The
// staff-only areas (editor, dashboards, auth) are NOT mounted on this
// host — an accidental `brand.thesqd.com/churches/123` redirects to the
// main app.
const isBrandPortalHost =
  typeof window !== 'undefined' && window.location.hostname === BRAND_PORTAL_HOST

export default function App() {
  if (isBrandPortalHost) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/:churchSlug" element={<BrandGuidePortalPage />} />
          <Route path="/:churchSlug/:ministrySlug" element={<BrandGuidePortalPage />} />
          {/* Anything else — the bare root, typos, /login probes — renders
               a plain info page. Never redirects to the staff app. */}
          <Route path="*" element={<BrandPortalLanding />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal/:token" element={<ClientPortalPage />} />
          <Route path="/portal/:token/copy-review" element={<CopyReviewPortalPage />} />
          {/* Legacy brand-guide URLs — kept live so old links don't rot. New
              links go through buildPortalUrl() which emits brand.thesqd.com. */}
          <Route path="/brand/:churchSlug" element={<BrandGuidePortalPage />} />
          <Route path="/brand/:churchSlug/:ministrySlug" element={<BrandGuidePortalPage />} />

          {/* Protected routes — staff only, wrapped in AppLayout */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<MyDashboardPage />} />
            <Route path="/churches" element={<ChurchesDashboardPage />} />
            <Route path="/churches/:memberId" element={<ChurchDetailPage />} />
            <Route path="/churches/:memberId/copy-review/:reviewId" element={<CopyReviewAdminPage />} />
            <Route path="/churches/:memberId/brand" element={<BrandGuideEditorPage />} />
            <Route path="/churches/:memberId/brand/:subSlug" element={<BrandGuideEditorPage />} />

            {/* Internal brand handoff — staff-only search + per-church doc */}
            <Route path="/branding" element={<BrandingIndexPage />} />
            <Route path="/branding/:token" element={<BrandHandoffPage />} />

            {/* All In Journey Milestones */}
            <Route path="/pathway" element={<ComingSoonPage title="Pathway Viewer" />} />
            <Route path="/submit" element={<SubmitFormPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/templates" element={<TemplateEditorPage />} />

            {/* Social Media */}
            <Route path="/social/srp" element={<ComingSoonPage title="SRP Generator" />} />
            <Route path="/social/intel" element={<IntelAuditToolPage />} />
            <Route path="/social/prompts" element={<ComingSoonPage title="Prompt Settings" />} />
            <Route path="/social/planner" element={<ComingSoonPage title="Planning Calendar" />} />

            {/* Detail pages */}
            <Route path="/account/:memberId" element={<AccountLogPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

/** Partner-facing landing shown for any path on brand.thesqd.com that
 *  isn't a live guide slug — the bare root, typos, probes for /login, etc.
 *  Deliberately plain + branded: no links into the staff app, no
 *  suggestion that there's anything else to discover here. */
function BrandPortalLanding() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{
        background: 'linear-gradient(135deg, #341756 0%, #513DE5 100%)',
        color: '#F9F5F1',
        fontFamily: '"Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div className="max-w-lg text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] mb-3 opacity-70">
          Brand Guide Portal
        </p>
        <h1 className="text-3xl md:text-4xl font-semibold mb-4 leading-tight">
          This page needs a direct link.
        </h1>
        <p className="text-sm md:text-base leading-relaxed opacity-85">
          Brand guides on this site are accessed via a link your team shared with you.
          Please check the email or message that was sent, or reach out to your Church Media Squad account manager.
        </p>
        <a
          href="https://churchmediasquad.com"
          className="inline-block mt-8 rounded-full border border-white/30 px-5 py-2 text-sm font-semibold hover:bg-white/10 transition-colors"
        >
          Visit Church Media Squad
        </a>
      </div>
    </div>
  )
}
