import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
import ComingSoonPage from './components/ComingSoonPage'
import ChurchesDashboardPage from './pages/ChurchesDashboardPage'
import ChurchDetailPage from './pages/ChurchDetailPage'
import IntelAuditToolPage from './pages/IntelAuditToolPage'
import LoginPage from './pages/LoginPage'
import SubmitFormPage from './pages/SubmitFormPage'
import TemplateEditorPage from './pages/TemplateEditorPage'
import AccountLogPage from './pages/AccountLogPage'
import DashboardPage from './pages/DashboardPage'
import MyDashboardPage from './pages/MyDashboardPage'
import ClientPortalPage from './pages/ClientPortalPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal/:token" element={<ClientPortalPage />} />

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
