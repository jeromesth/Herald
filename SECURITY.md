# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.4.x   | Yes                |
| < 0.4   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in Herald, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email **security@herald-notifications.dev** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You should receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Considerations

Herald is a library that runs in your infrastructure. Keep these points in mind:

- **API Authentication**: Herald does not include authentication. You are responsible for authenticating requests before they reach Herald's API handler. Mount Herald behind your application's auth middleware.
- **Database Security**: Herald stores notification data in your database via adapters. Ensure your database has proper access controls.
- **Email Provider Credentials**: API keys for email providers (Resend, SendGrid, Postmark, SES) should be stored in environment variables, not in source code.
- **Plugin Trust**: Plugins execute in the same process as Herald. Only use plugins you trust, as they have access to the Herald context.

## Past Security Fixes

| Version | Issue | Severity |
|---------|-------|----------|
| 0.4.0   | JSON body size limit added to prevent memory exhaustion | Medium |
| 0.4.0   | Table prefix validation added to prevent SQL injection | High |
| 0.4.0   | Plugin context mutation restricted to safe keys | Medium |
| 0.4.0   | Email provider errors sanitized to prevent info leaks | Low |
