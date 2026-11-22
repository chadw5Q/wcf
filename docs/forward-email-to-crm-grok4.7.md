# Forward emails into Contacts

Forward a customer email to `crm@williamscreekfarms.com` and it becomes an Email interaction in Contacts. Mail sent to `orders@williamscreekfarms.com` is delivered to `cchadww@gmail.com` and is not logged automatically.

Forwarding is the right fit. You already get mail in Gmail (`cchadww@gmail.com`). That inbox is not an address on this domain, so it stays as it is.

`@williamscreekfarms.com` does not receive mail. Checked on Nov 21, 2026: the domain is on Cloudflare and has no MX records, so mail sent to any address there has nowhere to go. Resend can still send from `orders@williamscreekfarms.com` (the Resend DKIM record is present). That From address is outbound only. Nobody has been reading replies to it.

Because nothing is receiving, both addresses can live on the main domain. Turning on Cloudflare Email Routing will add the domain's first MX records. It does not take over Gmail, and it does not stop Resend from sending.

Two different routes:

- `orders@williamscreekfarms.com` forwards to `cchadww@gmail.com`. Replies to order and hunt mail show up in Gmail. They are not added to Contacts.
- `crm@williamscreekfarms.com` goes to the worker and becomes a contact. Only messages forwarded from your own mailbox are saved, so a stranger who finds `crm@` cannot create contacts.

When a customer replies to an order email, read it in Gmail. Forward that message to `crm@` only when you want it in the CRM.

```mermaid
flowchart LR
  reply[Reply to orders@]
  gmail[cchadww@gmail.com]
  crmAddr["crm@williamscreekfarms.com"]
  worker[Worker email handler]
  contact[Contact plus Email interaction]
  reply --> gmail
  gmail -->|"forward when you want it saved"| crmAddr --> worker --> contact
```

## What a forward becomes

The handler reads the forwarded block (Gmail, Apple Mail, and Outlook) and takes the original sender, not you.

- Match an existing contact by that email. Same rules as today: do not overwrite a name, phone, or email already saved.
- If they are new, split the display name into first and last. A single name (just "Jeff") is stored as the first name, with last name `—`, so you can fix it on the contact page.
- Log one interaction, channel `email`, with `at` set to the original message date. Summary is `Subject: …`, then `Note: …` when you typed something above the forward line, then the body. Drop quoted older replies (`On … wrote:`). Cap at 4,000 characters.
- If there is no forwarded block, such as a BCC to `crm@` on a reply, use the first To address that is not on the allowlist.
- Store the message id in `ORDERS_KV` under `inbound_email_${messageId}` with a 30-day TTL after the contact save. If the handler is retried and the key exists, stop. Do not throw after a successful save, and do not let an ntfy failure throw. Cloudflare retries a thrown email handler.
- On success, ntfy on the existing `hedge-order` topic reads "Email logged: Jeff Smith — Subject" and its click URL is `/admin/contacts/<id>`. On a parse failure, ntfy "Couldn't read forwarded email: <subject>" and do not log. Do not send an email reply. A reply to `crm@` can loop.

The allowlist checks the SMTP envelope sender (`message.from`), which is the mailbox that forwarded, not the customer. It defaults to `cchadww@gmail.com`, overridable with `INBOUND_EMAIL_ALLOWLIST` (comma-separated). `gmail.com` DMARC is `p=none`, so a forged From is not rejected upstream. Also require Cloudflare's `Authentication-Results` header to show `dkim=pass` for that sender's domain (`header.d=gmail.com` for the default). If either check fails, call `message.setReject("Not accepted")`, store nothing, and send no ntfy. One exception: DKIM passed for a `gmail.com` or `fiveq.com` address that is not on the list. Send one ntfy naming that address so a forward from the wrong personal mailbox is visible. Never create or match a contact for an allowlisted address. Walk-in orders, the contact form, and the manual Email radio stay as they are.

## Code

- New parser and ingest in `src/lib/inbound-email.ts`, calling existing `logInteraction` in `src/lib/contacts.ts`.
- The installed adapter (`@astrojs/cloudflare` 12.6.13) supports `workerEntryPoint`. Set `adapter: cloudflare({ workerEntryPoint: { path: 'src/worker.ts' } })` in `astro.config.mjs`. `src/worker.ts` keeps the site `fetch` handler and adds `email(message, env, ctx)`, writing to `env.ORDERS_KV`. No public endpoint and no shared secret. One `npm run deploy` ships both. If that entrypoint breaks the build, fall back to a small `workers/crm-email-worker` on the same KV namespace that imports the same parser. The workers already in `workers/` stay as they are. After the entrypoint change, build and load the homepage to confirm the site still serves.
- Parse the raw message with `postal-mime` (read `message.raw` once). Prefer the text part. If the message is HTML only, strip tags. If the forward is a `message/rfc822` attachment, parse that attachment. Then read the Gmail, Apple Mail, or Outlook forwarded block.
- If the original sender has no display name, use the part before `@` as the first name and `—` as the last name.
- Add `INBOUND_EMAIL_ALLOWLIST` to `src/env.d.ts` and `.env.example`.
- Unit tests in `tests/unit/lib/inbound-email.test.ts`: Gmail with a name, Gmail with a bare address, a note above the forward line, HTML-only, a one-word name, one Apple Mail fixture, one Outlook fixture, the BCC fallback, and a forward whose only address is yours (nothing logged, failure push). Also reject a sender not on the allowlist, reject an allowlisted From without DKIM pass, create a contact, match an existing contact by email, and skip a duplicate Message-ID. Email Routing cannot be exercised on localhost, so these tests are the check.

## Cloudflare setup

The wrangler login on this machine (`webmaster@fiveq.com`) can deploy the `wcf` worker. Its token can read the zone and cannot edit DNS or Email Routing, so the routes below cannot be created from here.

You do these once in the Cloudflare dashboard, after the worker is deployed:

1. Turn on Email Routing for `williamscreekfarms.com`. This adds the first MX records. There is no existing inbox on this domain to interrupt.
2. Verify `cchadww@gmail.com` as a destination. Cloudflare sends a confirmation link to that Gmail. That click has to be you.
3. Route `orders@williamscreekfarms.com` to that Gmail destination. Leave the catch-all off. Leave every other address, except `crm@`, unrouted.
4. Route `crm@williamscreekfarms.com` to the `wcf` worker.
5. Let Email Routing add its own root SPF record. Do not merge Resend into it. Resend's SPF (`v=spf1 include:amazonses.com ~all`) and its MX already live on `send.williamscreekfarms.com`. Leave the `resend._domainkey` DKIM record alone. The domain has no DMARC record. Leave that alone.
6. Forward Jeff's message to `crm@` from Gmail. He should show up under Admin → Contacts with an Email interaction, and the ntfy push should open that contact. A message addressed to `orders@` should arrive in Gmail and should not create a contact.

A Gmail filter that auto-forwards certain senders to `crm@` can wait. It is not part of this work.

Replies do not all arrive at `orders@`. The hedge thank-you and receipt already set Reply-To to `ORDER_NOTIFICATION_EMAIL` or `cchadww@gmail.com`, so a reply to those goes straight to Gmail. Hunt mail to hunters is From `orders@` with no Reply-To, so those replies, and any mail typed to `orders@`, are what the new route delivers. This work does not change those Reply-To headers.

A Cloudflare API token with DNS edit and Email Routing edit would let the routes be created from here. The Gmail confirmation click would still be yours.

No new database. Contacts stay in `ORDERS_KV`.
