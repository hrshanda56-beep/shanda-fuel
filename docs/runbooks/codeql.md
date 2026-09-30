# CodeQL disposition

## Repository-side state

The repository contains a pinned CodeQL action, a pinned configuration file, and
permissions for `security-events: write`. The workflow is ready to run the
JavaScript/TypeScript and GitHub Actions analyses when `vars.CODEQL_ENABLED` is
`true`.

The workflow intentionally keeps CodeQL separate from the already active
dependency audit, Gitleaks secret scan, and Semgrep CE SAST jobs. Those checks
remain the repository's current evidence and must not be treated as CodeQL
results.

## Provider-blocked state

When `vars.CODEQL_ENABLED` is not `true`, the CodeQL job is skipped. Enabling
the repository variable and accepting `security-events: write` requires GitHub
repository/code-scanning availability for this private repository. That
permission/product state cannot be created by a source change and is not
claimed here.

## Evidence required to close the provider gate

An operator should record the repository setting, the successful CI run, both
matrix analyses, uploaded findings, and the GitHub code-scanning status. Until
that exists, report CodeQL as **prepared but provider-blocked**, while retaining
the passed dependency, secret, and Semgrep evidence.
