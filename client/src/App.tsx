import { Navigate, Route, Routes } from 'react-router-dom'
import AuthProvider from './auth/AuthProvider.tsx'
import RequireAuth from './auth/RequireAuth.tsx'
import SignInPage from './auth/SignInPage.tsx'
import SignUpPage from './auth/SignUpPage.tsx'
import Layout from './components/Layout.tsx'
import WakeBanner from './components/WakeBanner.tsx'
import RecordingsPage from './recordings/RecordingsPage.tsx'

/** The app's routes. The router comes from main.tsx (or the test harness). */
export default function App() {
  return (
    // Nothing talks to the API until the server is awake.
    <WakeBanner>
      <AuthProvider>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<RecordingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </WakeBanner>
  )
}
