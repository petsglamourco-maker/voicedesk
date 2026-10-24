---
id: forms
title: Forms - capture enquiries from your website forms
page: /t/:tenant/forms
roles: owner, admin
keywords: forms, contact form, enquiry form, webhook, typeform, jotform, webflow, tally, wordpress, hosted form, form capture
suggested: How do I use the hosted enquiry form? | Can I connect my existing contact form? | Why weren't replies emailed to form senders?
---

## What Forms does

[Forms](/t/:tenant/forms) brings enquiries from website forms into the [Inbox](/t/:tenant/inbox). The assistant reads each one, creates the right record (booking request, message or ticket) and drafts a reply for you to approve.

Only owners and admins can change these settings.

## Turning it on

Under **Form capture**, click **Turn on**. While it's off, the hosted form and the webhook don't accept submissions.

## Option 1 - the hosted enquiry form

A ready-made contact form you can link to from your website, social profiles or emails.

1. Set the **Form heading** and an optional **Introduction**.
2. Click **Save**.
3. The form's link is shown on the page. Click it to check the form, then share that address.

Customers enter their name, email or phone, and their message. They tick a box agreeing that you may contact them about the enquiry, and can optionally agree to news and offers. The form tells them it's read by an AI assistant and the team.

When VoiceDesk's bot check is switched on, the hosted form quietly checks that the visitor is a person before sending. Most people never see it.

## Option 2 - connect a form you already have

If you use Typeform, Jotform, Webflow, Tally, WordPress or similar, point its webhook at the address shown under **Connect a form you already have**. JSON and normal form posts both work.

Click **Show secret** to see the webhook secret. Keep it private: anyone with it can send enquiries.

If your form tool can add headers, use the safer set-up shown under the address: post to the address without `?secret=` and send the secret in an **X-VoiceDesk-Secret** header, so it never appears in logs. Add an **Idempotency-Key** header (any unique id per submission) and a retried submission won't create a duplicate enquiry.

## Field names

Under **Field names**, leave each box on **Detect automatically** to pick up fields called name, email, phone, message and so on. If your form uses different names, enter them for the **Name field**, **Email field**, **Phone field** and **Message field**.

If your form has a consent box, enter its **Consent field** name. Without the tick, no reply is emailed to that person.

## Renewing the address

Click **New address and secret** if your form link or secret has leaked. The old link and webhook stop working straight away, so update your website and form tool.

## Before VoiceDesk is hosted

While VoiceDesk runs on a single computer, customers can't open the hosted form, and form tools need the public address that your VoiceDesk administrator sets up with a tunnel.
