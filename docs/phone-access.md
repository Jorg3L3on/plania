# Plania on the phone (2.12)

Plania stays bound to `127.0.0.1:3737` on the Mac. The phone reaches it through Tailscale: `tailscale serve`
terminates HTTPS on the Mac with a real certificate for its tailnet name and forwards to the loopback port.
Nothing listens on the LAN, and only devices signed in to your tailnet can open it.

HTTPS is what the phone needs: the home-screen app, the service worker and push notifications only work
in a secure context, and the session cookie is `Secure`.

## 1. Expose the server on the tailnet (once)

Prerequisites, in the Tailscale admin console (DNS page): MagicDNS on, and HTTPS Certificates enabled.
Tailscale installed and signed in on the Mac and on the phone, with the same account.

On the Mac:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3737
```

`--bg` keeps the serve config after the terminal closes and across reboots. Without it
(`tailscale serve --https=443 http://127.0.0.1:3737`) it serves only while the command runs.

Check it, and read the URL:

```bash
tailscale serve status
```

It prints `https://<mac-name>.<tailnet>.ts.net` → `http://127.0.0.1:3737`. That is Plania's phone URL.
The first request may take a few seconds while Tailscale gets the certificate.

To stop it:

```bash
tailscale serve --https=443 off
```

### Why this works with the session cookie

`tailscale serve` sends `X-Forwarded-Proto: https` (and `X-Forwarded-Host`) to the server. Plania trusts
those headers only because the server is bound to `127.0.0.1`: every request comes from this Mac, either a
local browser or `tailscaled`. Login marks the cookie `Secure` when the request is HTTPS (directly or per
`X-Forwarded-Proto`) or comes to a loopback host (`localhost`, `127.0.0.1`), which browsers treat as secure.
Cookies are per origin, so log in once on the tailnet URL even if you are logged in on `localhost:3737`.

## 2. VAPID keys for push (once)

Push messages are signed with a VAPID key pair that lives in the main checkout's `.env`. Generate one:

```bash
pnpm vapid
```

It prints three lines. Paste them into `/Users/jorgeleon/Developer/Projects/plania/.env`:

```
PLANIA_VAPID_PUBLIC=<the public key it printed>
PLANIA_VAPID_PRIVATE=<the private key it printed>
PLANIA_VAPID_SUBJECT=mailto:<your email>
```

The subject must be a `mailto:` or `https:` URL; Apple's push service refuses the message otherwise.
Keep the private key out of git (`.env` is ignored). Changing the pair later invalidates every
subscription: each device turns the switch off and on again.

Restart the service so it reads the keys (see the deploy steps on PLA-I5). Without the keys the server
runs as before: `GET /api/push/public-key` answers `PUSH_NOT_CONFIGURED` and the switch says so.

## 3. Install the app

### iPhone (iOS 16.4 or later)

1. Open the tailnet URL in **Safari** (push for web apps needs Safari's Add to Home Screen; other iOS
   browsers can install too from iOS 16.4, but Safari is the tested path).
2. Log in.
3. Share button → **Add to Home Screen** → Add.
4. Open Plania **from the home-screen icon**. iOS only offers push to the installed app, never to a tab.

### Android (Chrome)

1. Open the tailnet URL in Chrome and log in.
2. Menu (⋮) → **Install app** (or **Add to Home screen**).
3. Open it from the launcher. On Android, push also works in a normal Chrome tab.

## 4. Turn push on

In the installed app: the **⋯** menu (top right) → **Avisarme cuando me toque**. The phone asks for
permission; allow it. The switch subscribes this device (`POST /api/push/subscribe`); turning it off
unsubscribes it (`DELETE /api/push/subscribe`). Each device has its own switch.

What sends a notification: a question an agent asks, a step that waits on you
(a `human_action` blocker, typed or parsed from a `Jorge:` line) and a release that is ready to ship.
The server looks once a minute and sends one message per device for everything new in that minute, so a
burst is one notification. Tapping it opens the Bandeja on the right tab (Decisiones or Pasos).

A device whose subscription the push service rejects as gone (`404`/`410`) is removed on the next send;
turn the switch on again there. On iPhone, if notifications stop, check Settings → Notifications → Plania.

## Troubleshooting

- The switch is greyed out with "Abre Plania desde el icono": you are in a Safari tab on iPhone; open the
  installed app.
- "Push no está configurado en el servidor": the VAPID keys are missing from `.env`, or the service has not
  restarted since they were added.
- Login loops on the phone: you opened `http://` instead of the `https://…ts.net` URL.
- `tailscale serve status` shows nothing after a reboot: the command ran without `--bg`; run it again with it.
