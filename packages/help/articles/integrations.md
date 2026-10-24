---
id: integrations
title: Connect your calendar (Google or Outlook)
page: /t/:tenant/integrations
roles: owner, admin
keywords: calendar, google, outlook, microsoft, microsoft 365, booking, availability, free busy, diary, integrations, connect, reconnect, disconnect
suggested: How do I connect Google Calendar? | Why aren't bookings appearing in my calendar? | Can I choose which calendar to use?
---

## What connecting a calendar does

On [Integrations](/t/:tenant/integrations) you connect the calendar your business already uses. Once it's connected:

- the assistant only offers times that are free in that calendar;
- every booking it makes goes straight into it, with the customer's name, phone and booking reference.

Your customers aren't sent calendar invitations; VoiceDesk sends its own confirmations. Only owners and admins can connect a calendar.

## Connecting Google Calendar or Outlook

1. Under **Calendar**, click **Connect Google Calendar** or **Connect Outlook / Microsoft 365**.
2. Sign in to your Google or Microsoft account and allow access.
3. You're brought back to VoiceDesk with "Calendar connected. Now choose which calendar bookings go into."
4. Under **Calendar for bookings**, pick the calendar from **Choose a calendar…** (your main calendar is marked "main").

Step 4 is essential. Until you choose a calendar, the status shows **Choose a calendar** and the assistant only uses VoiceDesk's own bookings.

A business connects one calendar at a time.

## Statuses

- **Connected**: everything is working.
- **Problem**: the last attempt to reach your calendar failed. The assistant still takes bookings and uses your calendar again when it responds.
- **Needs reconnecting**: access was removed or has expired. Click **Reconnect**. Until then the assistant only uses VoiceDesk's own bookings.

## Disconnecting

Click **Disconnect** to stop the assistant checking your calendar and adding bookings to it. Existing events stay in your calendar.

## If the buttons aren't there

If you see "No calendar service is set up on this VoiceDesk server yet", your VoiceDesk administrator needs to add Google or Microsoft app credentials first. If you see "An owner or admin can connect a calendar.", ask an owner or admin.

## If you see an error after signing in

- "Connection cancelled": you cancelled at Google or Microsoft. Nothing was changed; try again.
- "The calendar service didn't grant ongoing access": remove VoiceDesk from your account's connected apps, then connect again.

For bookings not showing up, see the Help article on calendar troubleshooting.
