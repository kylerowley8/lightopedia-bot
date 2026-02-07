// ============================================
// API Module — Public REST API for Lightopedia
// ============================================

export {
  authenticateApiKey,
  rateLimit,
  validateBody,
  askRequestSchema,
  addRequestId,
  corsMiddleware,
  type AuthenticatedRequest,
  type AskRequest,
} from "./middleware.js";

export {
  handleAskRequest,
  handleHealthCheck,
  type AskResponse,
  type ApiErrorResponse,
  type HealthResponse,
} from "./handler.js";
