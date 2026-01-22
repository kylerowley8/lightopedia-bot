// ============================================
// Auth Module Exports
// ============================================

export { handleLogin, handleCallback, handleLogout, handleSignup, handleSignin } from "./oauth.js";
export { requireAuth, type AuthenticatedDashboardRequest } from "./middleware.js";
export {
  getSessionFromRequest,
  setSessionCookies,
  clearSessionCookies,
  createServerSupabase,
  type SessionUser,
} from "./session.js";
