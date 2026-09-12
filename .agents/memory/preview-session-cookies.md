---
name: Preview session cookies
description: Replit Preview session behavior across local HTTP and proxied HTTPS transports.
---

Session cookies must support both local HTTP Preview and Replit's proxied HTTPS Preview. Use the request's resolved transport when choosing development cookie flags, while always requiring secure cookies in production. After login, verify the browser retained the httpOnly cookie with a protected current-user request before showing authenticated screens.

**Why:** Replit Preview can expose the same development app through different transports, and the edge proxy may rewrite cookie attributes for HTTPS. Environment-mode-only cookie flags allowed the UI to appear logged in even when the browser omitted the session cookie on later writes.

**How to apply:** When changing login, logout, proxy, workflow, or cookie behavior, test unauthenticated protection plus login, current-user restoration, and an authenticated write through both local HTTP and proxied HTTPS paths. Never log cookie values.