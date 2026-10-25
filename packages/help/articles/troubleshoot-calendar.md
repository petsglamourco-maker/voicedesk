---
id: troubleshoot-calendar
title: Calendar connected but bookings not appearing
page: none
roles: owner, admin
keywords: calendar not working, bookings missing, no events, google calendar, outlook, no free times, no availability, slots, gap between appointments, buffer, minimum notice, reconnect, expired
suggested: Why aren't bookings showing in my calendar? | Why does the assistant say no times are free? | Why does my calendar keep disconnecting?
---

## First check - has a calendar been chosen?

Connecting your Google or Microsoft account isn't enough on its own. You also have to choose which calendar bookings go into.

1. Open [Integrations](/t/:tenant/integrations).
2. If the status says **Choose a calendar**, pick one under **Calendar for bookings**.

Until a calendar is chosen, the assistant only uses VoiceDesk's own bookings and nothing is added to your diary.

## Check the right calendar

Many accounts have several calendars. Make sure you chose the one you look at, and that it's switched on (visible) in your calendar app. Bookings appear with the customer's name, phone and booking reference.

## Check the status

- **Problem**: the last attempt to reach your calendar failed. The assistant keeps taking bookings and tries your calendar again. If it stays like this, click **Reconnect**.
- **Needs reconnecting**: access was removed or expired. Click **Reconnect** and sign in again.

## Google calendar keeps disconnecting every week

If your Google connection stops working about seven days after connecting, the Google app VoiceDesk uses is still in Testing mode. Google removes access from Testing apps after 7 days. The platform owner fixes this in Google Cloud Console (console.cloud.google.com): under the OAuth consent screen, click Publish app so it shows "In production". Then reconnect on Integrations.

## The assistant says no times are free

The assistant offers times that are free in your calendar **and** that fit your booking rules. Check:

- **Gap between appointments (minutes)** in the **Booking rules** of your [Business profile](/t/:tenant/profile). A large gap blocks time before and after every event in your calendar, so a busy diary can leave no slots at all. Try 0 or 10 minutes.
- **Minimum notice (hours)**: times sooner than this aren't offered.
- **Opening hours**: times outside them aren't offered.
- The service is marked **Bookable**, with a length in **Minutes**.
- Events in your calendar marked as busy block that time. All-day events can block a whole day.

After changing the profile, click **Approve & publish**, then try a booking in the [Test console](/t/:tenant/console).

## Still not working

Make a test booking in the Test console. If it appears in [Records](/t/:tenant/records) but not in your calendar, disconnect and connect the calendar again, choosing the calendar carefully.
