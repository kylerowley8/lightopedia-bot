// ============================================
// Indexer Config Tests — Help-Articles Only
// ============================================

import { describe, it, expect } from "vitest";
import {
  ALLOWED_REPOS,
  isAllowedRepo,
  shouldIndexPath,
  isDocFile,
  validateIndexRequest,
} from "../src/indexer/config.js";

// ============================================
// ALLOWED_REPOS
// ============================================

describe("ALLOWED_REPOS", () => {
  it("contains only 'light-space/help-articles'", () => {
    expect(ALLOWED_REPOS).toHaveLength(1);
    expect(ALLOWED_REPOS).toContain("light-space/help-articles");
  });
});

// ============================================
// isAllowedRepo()
// ============================================

describe("isAllowedRepo", () => {
  it("returns true for 'light-space/help-articles'", () => {
    expect(isAllowedRepo("light-space/help-articles")).toBe(true);
  });

  it("returns false for 'light-space/other-repo'", () => {
    expect(isAllowedRepo("light-space/other-repo")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAllowedRepo("")).toBe(false);
  });

  it("returns false for a completely unrelated repo", () => {
    expect(isAllowedRepo("other-org/some-repo")).toBe(false);
  });
});

// ============================================
// shouldIndexPath()
// ============================================

describe("shouldIndexPath", () => {
  describe("allowed paths", () => {
    it("returns true for 'README.md'", () => {
      expect(shouldIndexPath("README.md")).toBe(true);
    });

    it("returns true for 'docs/guide.md'", () => {
      expect(shouldIndexPath("docs/guide.md")).toBe(true);
    });

    it("returns true for 'docs/nested/file.mdx'", () => {
      expect(shouldIndexPath("docs/nested/file.mdx")).toBe(true);
    });

    it("returns true for 'some/path.md'", () => {
      expect(shouldIndexPath("some/path.md")).toBe(true);
    });
  });

  describe("excluded paths", () => {
    it("returns false for 'dist/bundle.js'", () => {
      expect(shouldIndexPath("dist/bundle.js")).toBe(false);
    });

    it("returns false for 'node_modules/pkg/index.js'", () => {
      expect(shouldIndexPath("node_modules/pkg/index.js")).toBe(false);
    });

    it("returns false for '.git/config'", () => {
      expect(shouldIndexPath(".git/config")).toBe(false);
    });

    it("returns false for 'CHANGELOG.md'", () => {
      expect(shouldIndexPath("CHANGELOG.md")).toBe(false);
    });

    it("returns false for 'src/index.ts' (not markdown)", () => {
      expect(shouldIndexPath("src/index.ts")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for an empty string", () => {
      expect(shouldIndexPath("")).toBe(false);
    });

    it("returns false for markdown inside node_modules", () => {
      expect(shouldIndexPath("node_modules/pkg/README.md")).toBe(false);
    });

    it("returns false for markdown inside dist", () => {
      expect(shouldIndexPath("dist/docs/guide.md")).toBe(false);
    });

    it("returns true for deeply nested markdown", () => {
      expect(shouldIndexPath("docs/a/b/c/d/guide.md")).toBe(true);
    });
  });
});

// ============================================
// isDocFile()
// ============================================

describe("isDocFile", () => {
  it("returns true for a .md file", () => {
    expect(isDocFile("guide.md")).toBe(true);
  });

  it("returns true for a .mdx file", () => {
    expect(isDocFile("component.mdx")).toBe(true);
  });

  it("returns true for .MD (case insensitive)", () => {
    expect(isDocFile("README.MD")).toBe(true);
  });

  it("returns true for .MDX (case insensitive)", () => {
    expect(isDocFile("page.MDX")).toBe(true);
  });

  it("returns false for a .ts file", () => {
    expect(isDocFile("index.ts")).toBe(false);
  });

  it("returns false for a .js file", () => {
    expect(isDocFile("bundle.js")).toBe(false);
  });

  it("returns false for a .json file", () => {
    expect(isDocFile("package.json")).toBe(false);
  });
});

// ============================================
// validateIndexRequest()
// ============================================

describe("validateIndexRequest", () => {
  it("returns allowed for a valid repo and valid path", () => {
    const result = validateIndexRequest(
      "light-space/help-articles",
      "docs/billing.md"
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("returns not allowed for wrong repo", () => {
    const result = validateIndexRequest(
      "light-space/other-repo",
      "docs/billing.md"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Repo not in allowlist");
  });

  it("returns not allowed for excluded path", () => {
    const result = validateIndexRequest(
      "light-space/help-articles",
      "CHANGELOG.md"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Path not allowed");
  });

  it("checks repo before path (repo rejection takes priority)", () => {
    const result = validateIndexRequest(
      "light-space/other-repo",
      "CHANGELOG.md"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Repo not in allowlist");
  });

  it("returns not allowed for a non-markdown path in valid repo", () => {
    const result = validateIndexRequest(
      "light-space/help-articles",
      "src/index.ts"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Path not allowed");
  });
});
