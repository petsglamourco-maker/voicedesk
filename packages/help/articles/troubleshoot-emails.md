---
id: troubleshoot-emails
title: Emails not arriving
page: none
roles: all
keywords: email not arriving, no email, verification email, invitation email, missing email, spam, junk, mailpit, smtp, call summary email, daily brief not received, password reset
suggested: Why didn't I get the verification email? | Why didn't my teammate receive the invitation? | Where do test emails go?
---

## Which emails VoiceDesk sends

VoiceDesk sends emails for sign-up verification, team invitations, call summaries, urgent alerts, low feedback scores, the daily brief, booking confirmations and approved email replies. If one doesn't arrive, work through the checks below.

## Check your spam or junk folder

New senders often land in spam. Search your inbox for "VoiceDesk" and check spam, junk, promotions and other folders. If you find it there, mark it as "not spam" so future emails arrive normally.

## Check the email address

- For invitations, the person must accept with the same email address the invitation was sent to.
- For sign-up, check you typed the address correctly. You may need to sign up again with the right address.

## When VoiceDesk is running on a single computer

While VoiceDesk is still being set up, emails don't go to real inboxes at all. They're caught by a local test mailbox called Mailpit, which the person running VoiceDesk can open at localhost:8025 on that computer. Texts appear there too.

If you're not the person running VoiceDesk, ask them to check Mailpit or to forward you the link.

## For the platform owner - switching on real emails

1. Open **Platform admin → Setup** and look at **Real emails**.
2. If it isn't **Ready**, sign up for an email-sending service (Brevo or Resend have free tiers, or use Gmail with an app password).
3. Put its SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD in `.env`, with an EMAIL_FROM address on a domain you own.
4. Restart VoiceDesk and send yourself a test, for example by inviting a second email address on the Team page.

If emails send but go to spam, set up the sending service's domain checks (usually called SPF and DKIM) for your domain.

## Daily brief or summaries missing

- The daily brief only goes to owners and admins, at 07:30 business time, and only if **Send the daily brief** is on under [Assistant](/t/:tenant/agent). Use **Preview today's brief** to check it.
- Call summary emails go to owners and admins a minute or so after a call ends.

## Customer replies from the Email page

If replies to customers aren't sending, check the mailbox status on [Email](/t/:tenant/email). If it shows **Problem**, click **Test connection**, and update the app password with **Change mailbox settings** if needed.
