import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
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
            <Route path="/" element={<SubmitFormPage />} />
            <Route path="/my-dashboard" element={<MyDashboardPage />} />
            <Route path="/templates" element={<TemplateEditorPage />} />
            <Route path="/account/:memberId" element={<AccountLogPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
