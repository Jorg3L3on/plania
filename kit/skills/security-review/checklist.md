# Security review: categories

Go through each one against the diff. For each, either a finding, or one line saying the diff does
not touch it.

## 1. Input that reaches somewhere dangerous

Follow every new value that comes from outside (a form, a URL, a header, a file, a webhook, another
service) to where it is used.

- Built into a database query as text, instead of as a parameter.
- Passed to a shell, to `eval`, or into a template that runs code.
- Written into a page without escaping, or as raw HTML.
- Used as a file path, or as part of one (`../`).
- Used as a redirect target.
- Parsed with no limit on size or depth.

## 2. Who is asking, and are they allowed

- Every new route, action and background entry point checks that there is a signed-in person, unless
  it is public on purpose and the ticket says so.
- Every id that comes from the client is checked against its owner. Asking for record 42 must fail
  when 42 belongs to someone else.
- A permission check that runs only in the browser is not a check.
- New admin or internal paths cannot be reached by an ordinary account.

## 3. Secrets

- Keys, tokens, passwords or URLs with credentials in code, tests, fixtures, examples or config that
  gets committed.
- Secrets written to logs, error messages, analytics, or sent to the browser.
- An example env file with a real value in it.

Report the file, the line and the kind. Never the value.

## 4. Personal data

- New fields that identify a person: where they are stored, who can read them, whether they are
  logged.
- Data sent to a third party that was not sent before.
- Something that can be listed or exported by a person who should see only their own.

## 5. Dependencies

- Each package added or upgraded: is it needed, is the version pinned, is it the real package and not
  a look-alike name.
- Install or post-install scripts that run code.
- A lockfile changed with no matching change in the manifest.

## 6. Files and uploads

- Type and size checked on the server, not only in the browser.
- The stored name does not come from the person who uploaded it.
- Uploaded files are not served from a place where they can run.

## 7. Outbound requests

- A URL the server fetches that a person can choose: it can be aimed at internal addresses.
- Certificate checks switched off.
- Responses from other services trusted without checking.

## 8. Sessions, cookies and browser rules

- Cookies that carry a session: `HttpOnly`, `Secure`, `SameSite`.
- Actions that change data and can be triggered from another site.
- Cross-origin rules widened ("allow any origin").
- A token kept where page scripts can read it.

## 9. Randomness and cryptography

- Tokens, codes or links made with a predictable generator.
- Home-made encryption or hashing; passwords hashed with a fast hash.
- Comparing secrets with an ordinary string comparison.

## 10. Data changes

- A migration that drops or rewrites data, with no way back.
- A bulk update or delete whose condition could match everything.

## 11. Configuration

- Debug mode, verbose errors or test routes that would reach production.
- A default that is open and must be closed by hand.

## 12. Limits

- A loop, query, upload or list with no upper bound that a person controls.
- A costly action with no rate limit (sending mail, calling a paid API).
