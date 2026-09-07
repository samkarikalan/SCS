# LINE Login setup for SCS

The application and Worker integration are included in the repository. Complete these external configuration steps before enabling LINE Login for players.

## 1. Update the database

Run `line-login-account.sql` in the Supabase SQL editor. It adds the LINE identity fields and allows LINE-only accounts to exist without email credentials.

The same script creates `line_login_handoffs`, including the temporary device code used by an installed iPhone PWA, and adds the first-login nickname confirmation field. If LINE Login was configured before build 297, run the complete script again; its statements are safe to repeat.

Then run `subscription-account-identity.sql`. It moves subscription ownership from email to the stable SCS account ID, links existing email plans without losing them, and permits LINE-only trial and purchase records.

## 2. Create the LINE Login channel

In the LINE Developers Console:

1. Create or select the SCS provider.
2. Create a **LINE Login** channel with **Web app** enabled.
3. Set the region to Japan.
4. Add the privacy policy and terms URLs used by SCS.
5. Under **Callback URL**, enter exactly:

   `https://scs-app.karikalan-indo.workers.dev/auth/line/callback`

6. Publish the channel when production testing is complete. A channel in Developing status only permits accounts assigned a channel role.

SCS requests only `openid profile`. Email permission is not required.

## 3. Configure the Cloudflare Worker

Add these Worker secrets/variables:

- `LINE_CHANNEL_ID` — LINE Login channel ID.
- `LINE_CHANNEL_SECRET` — LINE Login channel secret; store as an encrypted secret.
- `LINE_APP_URL` — production app URL, normally `https://scs-app.com/`.
- `LINE_CALLBACK_URL` — the exact callback URL registered above.
- `LINE_STATE_SECRET` — a new long random secret used to protect OAuth state.
- `TOKEN_SECRET` — existing SCS token secret; it must already be a strong random value.

Deploy the updated `worker.js` after saving the variables.

For the iPhone PWA handoff, deploy Worker build 297 together with the updated web files. The PWA displays a temporary activation code and keeps waiting while LINE finishes in the browser. After the player returns to the installed SCS app, the app securely consumes the one-time login result and asks new players to choose their nickname.

## 4. Test

1. Open SCS in a private browser session.
2. Select **Continue with LINE**.
3. Approve the LINE consent screen.
4. Confirm that SCS asks the new player to choose an SCS nickname and creates the account.
5. Log out, repeat LINE Login, and confirm that the same SCS account opens.
6. Test cancellation and desktop QR login.
7. Confirm that a LINE-only player sees the trial, can request Basic or Pro, and can restore the same plan after signing in again.

The Worker keeps the channel secret, authorization code, access token, and ID token server-side. The browser receives only a two-minute signed SCS login ticket in the URL fragment, which is removed immediately after use.
