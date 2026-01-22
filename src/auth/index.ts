// ============================================
// Auth Module Exports
// ============================================

export { handleLogin, handleCallback, handleLogout } from "./oauth.js";
export { requireAuth, attachSession, type AuthenticatedDashboardRequest } from "./middleware.js";
export {
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  type SessionPayload,
} from "./session.js";
