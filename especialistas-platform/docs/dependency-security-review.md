# ConnectPro - Dependency security review

## Review baseline

- Date: 2026-11-18
- Branch: main
- Commit: 24b7cb2
- Prisma: 7.10.1
- Validated regression: 63 of 63 files.

## Audit results

Full npm audit:

- Critical: 0.
- High: 0.
- Moderate: 3.
- Low: 0.

Production dependency audit:

- Command: npm audit --omit=dev
- Result: found 0 vulnerabilities.

## Affected dependency chain

- @nestjs/cli: 11.0.24
- glob: 13.0.6
- minimatch: 10.2.6

NestJS CLI is declared as a development dependency.

The NestJS runtime packages are at version 12.4.0.

## Security advisories

- GHSA-3g3m-2fjr-6pw4:
  glob cancellation bypass.
- GHSA-g3hv-75wg-m249:
  minimatch denial of service.

Both advisories were reported as moderate.

## Proposed remediation

npm recommends a forced update to:

@nestjs/cli@12.0.13

npm identifies this as a breaking change.

## Technical decision

Defer the NestJS CLI major-version upgrade.

Reasons:

- No known vulnerabilities reported by the
  production dependency audit.
- Affected dependency chain is development-related.
- Current API and web compilations passed.
- All 63 planned regression files passed.
- Avoid unnecessary breaking changes.

Do not execute npm audit fix --force automatically.

## Risk mitigation

- Keep development access restricted.
- Avoid processing untrusted filesystem patterns.
- Use trusted build environments and inputs.
- Exclude development dependencies from the
  production runtime where appropriate.
- Keep dependency versions and lockfile controlled.

The production audit does not establish that every
deployment artifact is free of security risks.

Development and build environments remain relevant
to the overall security of the application.

## Follow-up requirements

Repeat dependency security review:

- Before pilot operation.
- Before production deployment.
- Following dependency changes.
- When relevant new advisories become available.

Evaluate a compatible NestJS CLI upgrade separately.

Any major upgrade requires compilation and regression
validation before integration.

## Current status

Production dependency audit: passed.

Three moderate development-related vulnerabilities
remain open and documented.

This review is not production deployment approval.

No dependencies were modified during this review.
