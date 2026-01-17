// ============================================
// Indexer Config Tests — V1 Scope Enforcement
// ============================================

import { describe, it, expect } from "vitest";
import {
  isAllowedRepo,
  isAllowedSlackChannel,
  shouldIndexPath,
  validateIndexRequest,
  ALLOWED_REPOS,
  ALLOWED_SLACK_CHANNELS,
} from "../src/indexer/config.js";

describe("Allowed Repos", () => {
  it("should allow light-space/light", () => {
    expect(isAllowedRepo("light-space/light")).toBe(true);
  });

  it("should allow light-space/axolotl", () => {
    expect(isAllowedRepo("light-space/axolotl")).toBe(true);
  });

  it("should allow light-space/mobile-app", () => {
    expect(isAllowedRepo("light-space/mobile-app")).toBe(true);
  });

  it("should reject unknown repos", () => {
    expect(isAllowedRepo("light-space/other")).toBe(false);
    expect(isAllowedRepo("other-org/light")).toBe(false);
    expect(isAllowedRepo("random/repo")).toBe(false);
  });

  it("should have exactly 3 allowed repos", () => {
    expect(ALLOWED_REPOS).toHaveLength(3);
  });
});

describe("Allowed Slack Channels", () => {
  it("should allow #lightopedia channel", () => {
    expect(isAllowedSlackChannel("C08SDBFS7BL")).toBe(true);
  });

  it("should reject other channels", () => {
    expect(isAllowedSlackChannel("C12345678")).toBe(false);
    expect(isAllowedSlackChannel("CXXXXXXXX")).toBe(false);
    expect(isAllowedSlackChannel("")).toBe(false);
  });

  it("should have exactly 1 allowed channel", () => {
    expect(Object.keys(ALLOWED_SLACK_CHANNELS)).toHaveLength(1);
  });
});

describe("File Path Indexing — Allowed Paths", () => {
  describe("README files", () => {
    it("should allow root README.md", () => {
      expect(shouldIndexPath("README.md")).toBe(true);
    });

    it("should allow nested README.md", () => {
      expect(shouldIndexPath("docs/README.md")).toBe(true);
      expect(shouldIndexPath("src/README.md")).toBe(true);
    });
  });

  describe("docs directory", () => {
    it("should allow docs/*.md", () => {
      expect(shouldIndexPath("docs/billing.md")).toBe(true);
      expect(shouldIndexPath("docs/api.md")).toBe(true);
    });

    it("should allow docs/**/*.md", () => {
      expect(shouldIndexPath("docs/guides/getting-started.md")).toBe(true);
      expect(shouldIndexPath("docs/api/endpoints/invoices.md")).toBe(true);
    });

    it("should allow docs/**/*.mdx", () => {
      expect(shouldIndexPath("docs/components/Button.mdx")).toBe(true);
    });
  });

  describe("Markdown files anywhere", () => {
    it("should allow .md files matching patterns", () => {
      // **/*.md matches any .md file
      expect(shouldIndexPath("CONTRIBUTING.md")).toBe(true);
      expect(shouldIndexPath("guides/setup.md")).toBe(true);
      expect(shouldIndexPath("api/overview.md")).toBe(true);
    });

    it("should allow .mdx files", () => {
      expect(shouldIndexPath("pages/index.mdx")).toBe(true);
    });
  });
});

describe("File Path Indexing — Excluded Paths", () => {
  describe("Executable code", () => {
    it("should reject Kotlin files", () => {
      expect(shouldIndexPath("src/Invoice.kt")).toBe(false);
      expect(shouldIndexPath("billing/Payment.kts")).toBe(false);
    });

    it("should reject Java files", () => {
      expect(shouldIndexPath("src/Main.java")).toBe(false);
    });

    it("should reject TypeScript files", () => {
      expect(shouldIndexPath("src/server.ts")).toBe(false);
      expect(shouldIndexPath("components/Button.tsx")).toBe(false);
    });

    it("should reject JavaScript files", () => {
      expect(shouldIndexPath("index.js")).toBe(false);
      expect(shouldIndexPath("App.jsx")).toBe(false);
    });

    it("should reject other languages", () => {
      expect(shouldIndexPath("main.py")).toBe(false);
      expect(shouldIndexPath("main.go")).toBe(false);
      expect(shouldIndexPath("main.rs")).toBe(false);
      expect(shouldIndexPath("main.swift")).toBe(false);
      expect(shouldIndexPath("main.scala")).toBe(false);
    });
  });

  describe("Config files", () => {
    it("should reject JSON", () => {
      expect(shouldIndexPath("package.json")).toBe(false);
      expect(shouldIndexPath("tsconfig.json")).toBe(false);
    });

    it("should reject YAML", () => {
      expect(shouldIndexPath("config.yaml")).toBe(false);
      expect(shouldIndexPath("config.yml")).toBe(false);
    });

    it("should reject other config", () => {
      expect(shouldIndexPath("config.toml")).toBe(false);
      expect(shouldIndexPath("pom.xml")).toBe(false);
      expect(shouldIndexPath("build.gradle")).toBe(false);
    });
  });

  describe("Build artifacts", () => {
    it("should reject dist/", () => {
      expect(shouldIndexPath("dist/index.js")).toBe(false);
      expect(shouldIndexPath("dist/README.md")).toBe(false);
    });

    it("should reject build/", () => {
      expect(shouldIndexPath("build/output.js")).toBe(false);
    });

    it("should reject node_modules/", () => {
      expect(shouldIndexPath("node_modules/lodash/README.md")).toBe(false);
    });

    it("should reject target/", () => {
      expect(shouldIndexPath("target/classes/Main.class")).toBe(false);
    });
  });

  describe("Generated files", () => {
    it("should reject minified files", () => {
      expect(shouldIndexPath("bundle.min.js")).toBe(false);
      expect(shouldIndexPath("styles.min.css")).toBe(false);
    });

    it("should reject lock files", () => {
      expect(shouldIndexPath("package-lock.json")).toBe(false);
      expect(shouldIndexPath("yarn.lock")).toBe(false);
      expect(shouldIndexPath("pnpm-lock.yaml")).toBe(false);
    });

    it("should reject source maps", () => {
      expect(shouldIndexPath("bundle.js.map")).toBe(false);
    });
  });

  describe("Test files", () => {
    it("should reject *.test.* files", () => {
      expect(shouldIndexPath("Invoice.test.ts")).toBe(false);
      expect(shouldIndexPath("Invoice.test.kt")).toBe(false);
    });

    it("should reject *.spec.* files", () => {
      expect(shouldIndexPath("Invoice.spec.ts")).toBe(false);
    });

    it("should reject __tests__/", () => {
      expect(shouldIndexPath("__tests__/Invoice.ts")).toBe(false);
    });

    it("should reject tests/", () => {
      expect(shouldIndexPath("tests/unit/Invoice.ts")).toBe(false);
    });
  });

  describe("IDE/config directories", () => {
    it("should reject .git/", () => {
      expect(shouldIndexPath(".git/config")).toBe(false);
    });

    it("should reject .github/", () => {
      expect(shouldIndexPath(".github/workflows/ci.yml")).toBe(false);
    });

    it("should reject .vscode/", () => {
      expect(shouldIndexPath(".vscode/settings.json")).toBe(false);
    });
  });

  describe("Changelogs", () => {
    it("should reject CHANGELOG.md", () => {
      expect(shouldIndexPath("CHANGELOG.md")).toBe(false);
    });
  });
});

describe("Full Validation", () => {
  it("should allow valid repo + path", () => {
    const result = validateIndexRequest("light-space/light", "docs/billing.md");
    expect(result.allowed).toBe(true);
  });

  it("should reject invalid repo", () => {
    const result = validateIndexRequest("other/repo", "docs/billing.md");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Repo not in allowlist");
  });

  it("should reject invalid path", () => {
    const result = validateIndexRequest("light-space/light", "src/Invoice.kt");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Path not allowed");
  });

  it("should reject both invalid", () => {
    const result = validateIndexRequest("other/repo", "src/Invoice.kt");
    expect(result.allowed).toBe(false);
    // Repo check comes first
    expect(result.reason).toContain("Repo not in allowlist");
  });
});

describe("Edge Cases", () => {
  it("should handle empty path", () => {
    expect(shouldIndexPath("")).toBe(false);
  });

  it("should be case-sensitive for extensions", () => {
    // .MD should still match (glob is case-insensitive for this)
    // Actually our implementation is case-sensitive, so .MD won't match
    expect(shouldIndexPath("README.MD")).toBe(false);
  });

  it("should handle deeply nested docs", () => {
    expect(shouldIndexPath("docs/a/b/c/d/e/f/guide.md")).toBe(true);
  });

  it("should reject docs inside excluded directories", () => {
    // Even if it's .md, if it's in node_modules, reject
    expect(shouldIndexPath("node_modules/pkg/README.md")).toBe(false);
    expect(shouldIndexPath("dist/docs/guide.md")).toBe(false);
  });
});
