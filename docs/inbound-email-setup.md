# Forward emails into Contacts (crm@)

Forward a customer email from Gmail to `crm@williamscreekfarms.com`. It shows up in Admin → Contacts as an Email interaction on that person, and you get an ntfy push that opens the contact.

- **Forward:** the original sender becomes the contact. Anything you type above the forwarded message is saved as `Note:`.
- **BCC:** BCC `crm@` on an email you send, and the first recipient who isn't you becomes the contact. It is logged as "Email you sent".
- **Their earlier message:** when a BCC'd reply (or a forward of your own reply) quotes the contact's previous email under "On … wrote:", that message is logged too, at its own date, unless the contact already has it, for example from an earlier forward or the website form. Only the most recent quoted message is checked, and only if the contact wrote it.
- An existing contact is matched by email address. A new sender gets a new contact. A one-word name is saved with `—` as the last name, which you can fix on the contact page.
- The interaction is dated when the original email was sent, not when you forwarded it.
- Forwarding the same message twice logs it once.
- If the forward can't be read, or the only address in it is yours, nothing is saved and you get a "Could not log forwarded email" push.

Only mail from `cchadww@gmail.com` that Cloudflare confirms is DKIM-signed by Gmail is accepted. Everything else is bounced with "Not accepted", and no push is sent. Change who may forward with `INBOUND_EMAIL_ALLOWLIST` (comma-separated).

The handler is `email()` in [src/worker.ts](../src/worker.ts), on the same `wcf` Worker as the site. The logic is in [src/lib/inbound-email.ts](../src/lib/inbound-email.ts).

## One-time setup

The wrangler login on this machine can deploy `wcf` but cannot change DNS or Email Routing, so steps 2 to 5 are in the Cloudflare dashboard.

1. Deploy: `npm run deploy`.
2. Go to **williamscreekfarms.com → Email → Email Routing** and enable it. Accept the MX and SPF records it offers. Resend's SPF record lives on `send.williamscreekfarms.com`, so nothing needs merging, and the `resend._domainkey` record stays as it is.
3. Under **Destination addresses**, add `cchadww@gmail.com`, then click the confirmation link Cloudflare sends to that inbox.
4. Under **Routing rules**, add the custom address `orders@` with the action **Send to an email** and the destination `cchadww@gmail.com`. Replies to order and hunt emails then reach Gmail. They are not logged in Contacts.
5. Add the custom address `crm@` with the action **Send to a Worker** and the Worker `wcf`. Leave catch-all off.
6. Test: in Gmail, forward a customer email to `crm@williamscreekfarms.com`. Within a minute you should get the "Email logged" push, and the person should be in Admin → Contacts.

## If a forward bounces with "Not accepted"

Open **Workers & Pages → wcf → Logs** and look for `[inbound-email] rejected:`. The line includes the reason and the authentication headers Cloudflare saw.

- `envelope sender … is not allowed`: you forwarded from an address that isn't on the allowlist. Add it to `INBOUND_EMAIL_ALLOWLIST`.
- `no Cloudflare DKIM pass for gmail.com`: the check expects an `Authentication-Results` header from `mx.cloudflare.net` showing `dkim=pass header.d=gmail.com`. If the logged headers look different, adjust `cloudflareDkimPassed` to match. As a temporary measure, set the variable `INBOUND_EMAIL_SKIP_DKIM=1` on `wcf`. While it is set, anyone who fakes your From address can add contacts, so remove it once the check is fixed.

## Local testing

`npm run build`, then `npx wrangler dev --var NTFY_DISABLE:1`, then POST a raw `.eml` to the local email trigger:

```bash
curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=cchadww@gmail.com&to=crm@williamscreekfarms.com" --data-binary @forward.eml
```

The file needs `Message-ID`, `Date`, and an `Authentication-Results: mx.cloudflare.net; dkim=pass header.d=gmail.com` header. See the fixtures in [tests/unit/lib/inbound-email.test.ts](../tests/unit/lib/inbound-email.test.ts).
