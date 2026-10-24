---
id: email-inbox
title: Connect your support mailbox (Email)
page: /t/:tenant/email
roles: owner, admin
keywords: email, mailbox, gmail, imap, smtp, app password, support email, drafts, auto send, zoho, icloud, yahoo, outlook email
suggested: How do I connect my Gmail? | What is an app password? | Can simple emails be answered automatically?
---

## What the Email page does

On [Email](/t/:tenant/email) you connect the mailbox your customers write to, such as hello@example.com. The assistant reads new emails, drafts a reply in your business's voice and puts it in the [Inbox](/t/:tenant/inbox). You approve it, or let simple answers go out on their own.

Only owners and admins can connect or change the mailbox.

## Before you start - get an app password

Use an app password, not your normal password. In Gmail:

1. Turn on 2-Step Verification in your Google Account.
2. Go to Google Account, then Security, then App passwords, and create one.
3. Copy the password it shows.

Zoho, iCloud and Yahoo work the same way. Microsoft 365 mailboxes aren't supported yet.

## Connecting the mailbox

1. Click **Connect a mailbox**.
2. Choose your **Email provider**: **Gmail / Google Workspace**, **Zoho Mail (EU)**, **iCloud Mail**, **Yahoo Mail**, or **Other (enter server details)**.
3. Enter the **Email address customers write to**, the **Login username** (usually the email address) and the **App password**.
4. For **Other**, also fill in the **Incoming (IMAP) server**, **Outgoing (SMTP) server**, **Port** and **Security**.
5. Check the **Folder to watch** (usually the inbox).
6. Under **Replies**, choose **I approve every reply (recommended to start)** or **Send simple answers automatically; I approve the rest**.
7. Click **Save and connect**. VoiceDesk logs in first to check the details.

## What gets answered

- Only emails that arrive after you connect are answered; older mail is left alone.
- Newsletters and automatic emails are ignored.
- New mail is checked every minute. The page shows when it was last checked.
- With automatic sending on, complaints, cancellations and anything the assistant isn't sure about still wait for you in the Inbox.
- Automatic replies only go to senders your email provider has verified (DMARC or DKIM). Emails that could be forged wait for you as drafts, so the assistant never replies to someone pretending to be another person.

## Approving drafts

In the [Inbox](/t/:tenant/inbox), open the email conversation, read the draft, click **Edit** if needed, then **Approve and send**. Replies thread normally in the customer's email app.

## Testing and changing the connection

- **Test connection** checks VoiceDesk can still log in.
- **Change mailbox settings** lets you update the details. Leave the password empty to keep the saved one.
- **Disconnect** deletes the stored password and stops answering new emails.

If the status shows **Problem**, the password may have been changed or revoked. Create a new app password and update it.
