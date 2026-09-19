# Security Policy

## Authentication boundary

Codex Client Provider does not read or copy Codex credential files. It launches
the locally installed `codex app-server` process and relies on that process to
use the account session managed by the Codex client.

Applications using this package should not pass access tokens through prompts,
logs, tool arguments, or environment variables intended for this provider.
`CODEX_CLIENT_BIN` should point only to a trusted Codex executable.

The model turn uses the App Server's read-only sandbox. Host applications remain
responsible for validating and authorizing any LangChain tool calls before they
execute them.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not
include credentials, session files, access tokens, or other secrets in a report.
Include the package version, operating system, Python version, Codex CLI version,
and a minimal reproduction when possible.

