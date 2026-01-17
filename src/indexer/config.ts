// ============================================
// Indexing Config — V1 Scope Enforcement
// See INDEXING_SCOPE.md for full contract
// ============================================

// ============================================
// Allowed Repos (V1)
// ============================================

export const ALLOWED_REPOS = [
  "light-space/light",
  "light-space/axolotl",
  "light-space/mobile-app",
] as const;

export type AllowedRepo = (typeof ALLOWED_REPOS)[number];

// ============================================
// Allowed Slack Channels (V1)
// ============================================

export const ALLOWED_SLACK_CHANNELS = {
  lightopedia: "C08SDBFS7BL",
} as const;

// ============================================
// File Patterns — DOCS ONLY (V1)
// No executable code.
// ============================================

export const ALLOW_PATHS = [
  // Root-level docs
  "README.md",
  "*.md",
  "*.mdx",
  // docs directory
  "docs/**",
  "docs/**/*.md",
  "docs/**/*.mdx",
  // Nested markdown anywhere
  "**/*.md",
  "**/*.mdx",
];

// Explicit exclusions
export const EXCLUDE_PATTERNS = [
  // Executable code
  "**/*.kt",
  "**/*.kts",
  "**/*.java",
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.py",
  "**/*.go",
  "**/*.rs",
  "**/*.swift",
  "**/*.scala",

  // Config (executable)
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
  "**/*.toml",
  "**/*.xml",
  "**/*.gradle",
  "**/*.properties",

  // Build artifacts (multiple patterns for better matching)
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
  "target/**",
  "**/target/**",
  "out/**",
  "**/out/**",

  // Generated
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",

  // Tests
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",

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
 * Check if a Slack channel is allowed for indexing.
 */
export function isAllowedSlackChannel(channelId: string): boolean {
  return Object.values(ALLOWED_SLACK_CHANNELS).includes(channelId as any);
}

/**
 * Check if a file path should be indexed.
 * Enforces V1 scope: docs only, no executable code.
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
