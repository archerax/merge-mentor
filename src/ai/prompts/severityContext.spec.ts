import { describe, expect, it } from "vitest";
import {
  buildSeverityContextSection,
  type CodeContext,
  inferCodeContext,
} from "./severityContext.js";

describe("severityContext", () => {
  describe("inferCodeContext", () => {
    describe("security-critical context", () => {
      it.each([
        ["src/auth/validateToken.ts", "security-critical"],
        ["src/authentication/login.ts", "security-critical"],
        ["src/authorization/checkRole.ts", "security-critical"],
        ["src/security/sanitize.ts", "security-critical"],
        ["src/login/handler.ts", "security-critical"],
        ["src/logout/session.ts", "security-critical"],
        ["src/password/reset.ts", "security-critical"],
        ["src/session/manager.ts", "security-critical"],
        ["src/token/jwt.ts", "security-critical"],
        ["src/oauth/callback.ts", "security-critical"],
        ["src/saml/provider.ts", "security-critical"],
        ["src/sso/redirect.ts", "security-critical"],
        ["src/credential/store.ts", "security-critical"],
        ["src/secret/manager.ts", "security-critical"],
        ["src/encrypt/data.ts", "security-critical"],
        ["src/decrypt/payload.ts", "security-critical"],
        ["src/hash/password.ts", "security-critical"],
        ["src/jwt/verify.ts", "security-critical"],
        ["src/2fa/setup.ts", "security-critical"],
        ["src/mfa/validate.ts", "security-critical"],
        ["src/otp/generate.ts", "security-critical"],
        // File-level patterns (not in subdirectory)
        ["src/auth.ts", "security-critical"],
        ["lib/security.ts", "security-critical"],
        ["app/login.controller.ts", "security-critical"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("financial context", () => {
      it.each([
        ["src/payment/process.ts", "financial"],
        ["src/billing/invoice.ts", "financial"],
        ["src/checkout/cart.ts", "financial"],
        ["src/transaction/log.ts", "financial"],
        ["src/invoice/generate.ts", "financial"],
        ["src/subscription/renew.ts", "financial"],
        ["src/pricing/calculate.ts", "financial"],
        ["src/stripe/webhook.ts", "financial"],
        ["src/paypal/callback.ts", "financial"],
        ["src/wallet/balance.ts", "financial"],
        ["src/refund/process.ts", "financial"],
        ["src/charge/create.ts", "financial"],
        ["src/credit/apply.ts", "financial"],
        ["src/debit/process.ts", "financial"],
        // File-level patterns
        ["src/payment.ts", "financial"],
        ["lib/billing.service.ts", "financial"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("test context", () => {
      it.each([
        ["src/test/helpers.ts", "test"],
        ["src/tests/unit/service.ts", "test"],
        ["src/spec/auth.spec.ts", "test"],
        ["src/specs/payment.ts", "test"],
        ["src/__tests__/utils.ts", "test"],
        ["src/__mocks__/api.ts", "test"],
        ["src/__fixtures__/data.ts", "test"],
        ["e2e/login.ts", "test"],
        ["integration-tests/api.ts", "test"],
        ["src/fixtures/sample.ts", "test"],
        ["src/mocks/database.ts", "test"],
        ["src/stubs/external.ts", "test"],
        ["src/fakes/provider.ts", "test"],
        ["src/testutils/helpers.ts", "test"],
        ["src/test-utils/setup.ts", "test"],
        ["src/test-helpers/factory.ts", "test"],
        // Extension patterns
        ["src/auth.test.ts", "test"],
        ["src/utils.spec.ts", "test"],
        ["src/payment.e2e.ts", "test"],
        ["components/Button.test.tsx", "test"],
        ["lib/api.spec.js", "test"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("data-critical context", () => {
      it.each([
        ["src/database/connection.ts", "data-critical"],
        ["src/db/pool.ts", "data-critical"],
        ["src/migration/20230101.ts", "data-critical"],
        ["src/migrations/create-users.ts", "data-critical"],
        ["src/schema/user.ts", "data-critical"],
        ["src/storage/s3.ts", "data-critical"],
        ["src/persistence/cache.ts", "data-critical"],
        ["src/repository/user.ts", "data-critical"],
        ["src/repositories/order.ts", "data-critical"],
        ["src/data-access/query.ts", "data-critical"],
        ["src/dao/product.ts", "data-critical"],
        ["src/orm/config.ts", "data-critical"],
        ["src/entity/user.ts", "data-critical"],
        ["src/entities/order.ts", "data-critical"],
        ["src/model/product.ts", "data-critical"],
        ["src/models/customer.ts", "data-critical"],
        // File-level patterns
        ["src/database.ts", "data-critical"],
        ["lib/storage.service.ts", "data-critical"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("api context", () => {
      it.each([
        ["src/routes/users.ts", "api"],
        ["src/router/index.ts", "api"],
        ["src/routers/api.ts", "api"],
        ["src/endpoints/health.ts", "api"],
        ["src/endpoint/status.ts", "api"],
        ["src/handlers/user.ts", "api"],
        ["src/handler/request.ts", "api"],
        ["src/controllers/product.ts", "api"],
        ["src/controller/order.ts", "api"],
        ["src/api/v1/users.ts", "api"],
        ["src/rest/resources.ts", "api"],
        ["src/graphql/resolvers.ts", "api"],
        ["src/rpc/methods.ts", "api"],
        // File-level patterns
        ["src/routes.ts", "api"],
        ["app/controller.ts", "api"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });

      it("identifies route with auth as security-critical (auth takes precedence)", () => {
        // Auth-related routes should be treated as security-critical
        expect(inferCodeContext("src/route/auth.ts")).toBe("security-critical");
      });
    });

    describe("background context", () => {
      it.each([
        ["src/jobs/email.ts", "background"],
        ["src/job/cleanup.ts", "background"],
        ["src/workers/processor.ts", "background"],
        ["src/worker/task.ts", "background"],
        ["src/queues/notifications.ts", "background"],
        ["src/scheduler/cron.ts", "background"],
        ["src/schedulers/reports.ts", "background"],
        ["src/cron/nightly.ts", "background"],
        ["src/background/sync.ts", "background"],
        ["src/async-tasks/import.ts", "background"],
        ["src/tasks/export.ts", "background"],
        ["src/consumers/events.ts", "background"],
        ["src/consumer/messages.ts", "background"],
        // File-level patterns
        ["src/jobs.ts", "background"],
        ["lib/worker.service.ts", "background"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });

      it("identifies queue handler as api (handler takes precedence in pattern)", () => {
        // API handler patterns are checked before background patterns
        expect(inferCodeContext("src/queue/handler.ts")).toBe("api");
      });
    });

    describe("admin context", () => {
      it.each([
        ["src/admin/users.ts", "admin"],
        ["src/administration/settings.ts", "admin"],
        ["src/internal/tools.ts", "admin"],
        ["src/backoffice/reports.ts", "admin"],
        ["src/back-office/dashboard.ts", "admin"],
        ["src/dashboard/metrics.ts", "admin"],
        ["src/management/config.ts", "admin"],
        ["src/ops/deploy.ts", "admin"],
        // File-level patterns
        ["src/admin.ts", "admin"],
        ["app/dashboard.controller.ts", "admin"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("logging context", () => {
      it.each([
        ["src/logging/config.ts", "logging"],
        ["src/logger/factory.ts", "logging"],
        ["src/loggers/custom.ts", "logging"],
        ["src/debug/panel.ts", "logging"],
        ["src/telemetry/collector.ts", "logging"],
        ["src/metrics/prometheus.ts", "logging"],
        ["src/tracing/opentelemetry.ts", "logging"],
        ["src/observability/setup.ts", "logging"],
        ["src/monitoring/alerts.ts", "logging"],
        ["src/analytics/tracker.ts", "logging"],
        // File-level patterns
        ["src/logging.ts", "logging"],
        ["lib/logger.service.ts", "logging"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("utility context", () => {
      it.each([
        ["src/utils/format.ts", "utility"],
        ["src/util/helper.ts", "utility"],
        ["src/utilities/string.ts", "utility"],
        ["src/helpers/date.ts", "utility"],
        ["src/helper/array.ts", "utility"],
        ["src/lib/crypto.ts", "utility"],
        ["src/libs/validation.ts", "utility"],
        ["src/common/types.ts", "utility"],
        ["src/shared/constants.ts", "utility"],
        ["src/core/base.ts", "utility"],
        ["src/base/component.ts", "utility"],
        ["src/support/functions.ts", "utility"],
        // File-level patterns
        ["src/utils.ts", "utility"],
        ["lib/helpers.ts", "utility"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });
    });

    describe("standard context (default)", () => {
      it.each([
        ["src/components/Button.tsx", "standard"],
        ["src/pages/Home.tsx", "standard"],
        ["src/services/UserService.ts", "standard"],
        ["src/hooks/useAuth.ts", "standard"],
        ["src/features/cart/slice.ts", "standard"],
        ["src/modules/notifications.ts", "standard"],
        ["src/views/Settings.vue", "standard"],
        ["src/stores/cart.ts", "standard"],
        ["index.ts", "standard"],
        ["main.ts", "standard"],
        ["App.tsx", "standard"],
      ] as const)('identifies "%s" as %s', (filepath: string, expected: CodeContext) => {
        expect(inferCodeContext(filepath)).toBe(expected);
      });

      it("identifies Dashboard as admin context due to filename pattern", () => {
        // Files named Dashboard are typically admin dashboards
        expect(inferCodeContext("src/views/Dashboard.vue")).toBe("admin");
      });
    });

    describe("edge cases", () => {
      it("handles Windows-style backslash paths", () => {
        expect(inferCodeContext("src\\auth\\login.ts")).toBe("security-critical");
        expect(inferCodeContext("src\\test\\helpers.ts")).toBe("test");
      });

      it("handles paths without leading slash", () => {
        expect(inferCodeContext("auth/login.ts")).toBe("security-critical");
        expect(inferCodeContext("test/unit/service.ts")).toBe("test");
      });

      it("handles paths with leading slash", () => {
        expect(inferCodeContext("/src/auth/login.ts")).toBe("security-critical");
        expect(inferCodeContext("/src/test/helpers.ts")).toBe("test");
      });

      it("handles empty string", () => {
        expect(inferCodeContext("")).toBe("standard");
      });

      it("handles deeply nested paths", () => {
        expect(inferCodeContext("src/modules/user/features/auth/validation/token.ts")).toBe(
          "security-critical"
        );
      });

      it("handles case insensitivity", () => {
        expect(inferCodeContext("src/AUTH/Login.ts")).toBe("security-critical");
        expect(inferCodeContext("src/Payment/Process.ts")).toBe("financial");
        expect(inferCodeContext("src/TEST/helpers.ts")).toBe("test");
      });

      it("prioritizes test patterns over other patterns", () => {
        // Test in auth directory should be test context
        expect(inferCodeContext("src/auth/login.test.ts")).toBe("test");
        expect(inferCodeContext("src/payment/__tests__/process.ts")).toBe("test");
      });

      it("handles mixed patterns with security taking priority", () => {
        // Security patterns should be checked before utility
        expect(inferCodeContext("src/utils/auth/helper.ts")).toBe("security-critical");
      });
    });
  });

  describe("buildSeverityContextSection", () => {
    const section = buildSeverityContextSection();

    it("includes the section header", () => {
      expect(section).toContain("# CONTEXT-AWARE SEVERITY SCORING");
    });

    it("includes severity rules for each code location", () => {
      expect(section).toContain("### Authentication/Authorization Code");
      expect(section).toContain("### Payment/Financial Code");
      expect(section).toContain("### Data Processing/Storage Code");
      expect(section).toContain("### API Endpoints");
      expect(section).toContain("### Background Jobs/Workers");
      expect(section).toContain("### Error Handling Code");
      expect(section).toContain("### Test Code");
      expect(section).toContain("### Logging/Debug Code");
      expect(section).toContain("### Admin/Internal Tools");
      expect(section).toContain("### Utility/Helper Code");
    });

    it("includes detection heuristics table", () => {
      expect(section).toContain("## Detection Heuristics");
      expect(section).toContain("| Path Pattern | Context | Severity Adjustment |");
    });

    it("includes path patterns for each context", () => {
      expect(section).toContain("`/auth/`");
      expect(section).toContain("`/payment/`");
      expect(section).toContain("`/database/`");
      expect(section).toContain("`/routes/`");
      expect(section).toContain("`/jobs/`");
      expect(section).toContain("`/test/`");
      expect(section).toContain("`/logging/`");
      expect(section).toContain("`/utils/`");
      expect(section).toContain("`/admin/`");
    });

    it("includes compact examples showing same bug in different contexts", () => {
      // 6 compact examples replacing the old verbose 20+
      expect(section).toContain("Missing Input Validation");
      expect(section).toContain("Hardcoded Secret");
      expect(section).toContain("Missing Error Handling");
      expect(section).toContain("SQL Injection");
    });

    it("includes examples for security-critical context", () => {
      expect(section).toContain("src/auth/");
      expect(section).toContain("CRITICAL");
    });

    it("includes examples for financial context", () => {
      expect(section).toContain("src/payment/");
    });

    it("includes examples for test context", () => {
      expect(section).toContain("no production impact");
    });

    it("includes severity level keywords", () => {
      expect(section).toContain("CRITICAL");
      expect(section).toContain("HIGH");
      expect(section).toContain("MEDIUM");
      expect(section).toContain("LOW");
    });

    it("includes severity adjustment indicators", () => {
      expect(section).toContain("⬆️ Strict scoring");
      expect(section).toContain("⬇️ Lenient scoring");
      expect(section).toContain("➡️");
    });

    it("includes auth-specific severity rules", () => {
      expect(section).toContain("Input validation bug");
      expect(section).toContain("security bypass");
      expect(section).toContain("auth bypass");
    });

    it("includes financial-specific severity rules", () => {
      expect(section).toContain("Calculation error");
      expect(section).toContain("double-charge");
      expect(section).toContain("money loss");
    });

    it("includes data-critical severity rules", () => {
      expect(section).toContain("Data loss bug");
      expect(section).toContain("Transaction integrity");
      expect(section).toContain("data corruption");
    });

    it("includes API severity rules", () => {
      expect(section).toContain("rate limiting");
      expect(section).toContain("injection risk");
      expect(section).toContain("info disclosure");
    });

    it("includes background job severity rules", () => {
      expect(section).toContain("Infinite loop");
      expect(section).toContain("resource exhaustion");
      expect(section).toContain("retry logic");
    });

    it("includes test code severity rules", () => {
      expect(section).toContain("doesn't affect production");
      expect(section).toContain("coverage gap");
    });

    it("includes logging severity rules", () => {
      expect(section).toContain("Sensitive data logged");
      expect(section).toContain("PII in logs");
      expect(section).toContain("compliance violation");
    });

    it("includes admin severity rules", () => {
      expect(section).toContain("high privilege");
      expect(section).toContain("admin");
    });

    it("includes utility severity rules", () => {
      expect(section).toContain("depends on usage context");
      expect(section).toContain("Context-dependent");
    });
  });
});
