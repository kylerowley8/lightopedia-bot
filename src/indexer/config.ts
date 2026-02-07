// ============================================
// Indexing Config — Help Articles Only
// Single source of truth: light-space/help-articles
// ============================================

// ============================================
// Allowed Repos
// ============================================

export const ALLOWED_REPOS = [
  "light-space/help-articles",
] as const;

export type AllowedRepo = (typeof ALLOWED_REPOS)[number];

// ============================================
// File Patterns — Docs Only
// ============================================

export const DOC_PATTERNS = [
  "README.md",
  "*.md",
  "*.mdx",
  "docs/**",
  "docs/**/*.md",
  "docs/**/*.mdx",
  "**/*.md",
  "**/*.mdx",
];

// Only doc patterns allowed
export const ALLOW_PATHS = [...DOC_PATTERNS];

// Explicit exclusions
export const EXCLUDE_PATTERNS = [
  // Build artifacts
  "dist/**",
  "**/dist/**",
  "build/**",
  "**/build/**",
  ".next/**",
  "**/.next/**",
  "coverage/**",
  "**/coverage/**",
  "node_modules/**",
  "**/node_modules/**",

  // Generated
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",

  // IDE/config
  "**/.git/**",
  "**/.github/**",
  "**/.vscode/**",
  "**/.idea/**",

  // Changelogs (noisy)
  "CHANGELOG.md",
  "**/CHANGELOG.md",
  "**/CHANGELOG/**",
];

// ============================================
// Chunk Settings
// ============================================

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 50;

// ============================================
// Validation Functions
// ============================================

/**
 * Check if a repo is in the allowed list.
 */
export function isAllowedRepo(repoSlug: string): boolean {
  return ALLOWED_REPOS.includes(repoSlug as AllowedRepo);
}

/**
 * Check if a file path should be indexed.
 */
export function shouldIndexPath(path: string): boolean {
  // Check exclusions first (deny takes priority)
  for (const pattern of EXCLUDE_PATTERNS) {
    if (matchGlob(pattern, path)) {
      return false;
    }
  }

  // Check allowlist
  for (const pattern of ALLOW_PATHS) {
    if (matchGlob(pattern, path)) {
      return true;
    }
  }

  // Default deny
  return false;
}

/**
 * Check if a path is a doc file (Markdown).
 */
export function isDocFile(path: string): boolean {
  return /\.(md|mdx)$/i.test(path);
}

/**
 * Validate full indexing request.
 */
export function validateIndexRequest(
  repoSlug: string,
  path: string
): { allowed: boolean; reason?: string } {
  if (!isAllowedRepo(repoSlug)) {
    return { allowed: false, reason: `Repo not in allowlist: ${repoSlug}` };
  }

  if (!shouldIndexPath(path)) {
    return { allowed: false, reason: `Path not allowed: ${path}` };
  }

  return { allowed: true };
}

/**
 * Simple glob matching.
 */
function matchGlob(pattern: string, path: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, "{{DOUBLE}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{DOUBLE}}/g, ".*")
    .replace(/\//g, "\\/");
  return new RegExp(`^${regex}$`).test(path);
}
