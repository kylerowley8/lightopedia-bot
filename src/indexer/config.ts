// Repo content policy: which files to index
export const ALLOW_PATHS = [
  // Documentation
  "**/*.md",
  // Source code
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  // Config files
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
];

// File types to exclude even if path matches
export const EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/CHANGELOG.md",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/fixtures/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/*.map",
];

// Chunk settings
export const CHUNK_SIZE = 500; // target chars per chunk
export const CHUNK_OVERLAP = 50; // overlap between chunks

export function shouldIndexPath(path: string): boolean {
  // Check exclusions first
  for (const pattern of EXCLUDE_PATTERNS) {
    if (matchGlob(pattern, path)) return false;
  }

  // Check allowlist
  for (const pattern of ALLOW_PATHS) {
    if (matchGlob(pattern, path)) return true;
  }

  return false;
}

function matchGlob(pattern: string, path: string): boolean {
  // Simple glob matching
  const regex = pattern
    .replace(/\*\*/g, "{{DOUBLE}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{DOUBLE}}/g, ".*")
    .replace(/\//g, "\\/");
  return new RegExp(`^${regex}$`).test(path);
}
