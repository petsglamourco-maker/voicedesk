---
id: troubleshoot-website-chat
title: Website chat isn't showing on my website
page: none
roles: owner, admin
keywords: chat not showing, widget missing, chat button not appearing, website chat not working, snippet, embed, allowed websites, public address
suggested: Why isn't the chat button on my website? | Where exactly do I paste the snippet? | Does the chat work while VoiceDesk runs on my computer?
---

## Is VoiceDesk on a public address yet?

This is the most common reason. While VoiceDesk is running on a single computer, a real website on the internet can't reach it, so the chat button won't appear for visitors. It will work once VoiceDesk is hosted on a server with its own web address. You can still try the chat with **Preview** on [Website chat](/t/:tenant/website-chat).

The platform owner can check this under **Platform admin → Setup** (**Public web address**).

## Is the chat turned on?

On [Website chat](/t/:tenant/website-chat), **Chat on your website** must show **On**. While it's off, the chat button doesn't appear even if the snippet is on your site. Click **Turn on** if needed.

## Is your website on the allowed list?

Under **Where it can appear**, **Your websites** must include the exact website the chat is on, one per line. Check:

- both versions if your site works with and without "www" (for example https://www.example.co.uk and https://example.co.uk);
- any test or staging address you're using.

Click **Save** after changing the list.

## Is the snippet in the right place?

1. On Website chat, click **Copy** under **Add it to your website**.
2. Paste it just before the closing body tag on every page, or into your website builder's "custom code" or "footer code" setting so it appears on all pages.
3. Publish the website (many builders need a separate Publish step).
4. Reload the page, and clear your browser cache or try a private window.

Some website builders only run custom code on paid plans or on the live site, not in their editor preview.

## Did someone create a new key?

If someone clicked **New key**, the old snippet stopped working. Copy the current snippet and replace it on your website.

## Still not showing

- Try another browser, and switch off ad blockers for your site.
- Check the button position (**Bottom right** or **Bottom left**) isn't hidden behind another chat or cookie banner.
- Ask your web designer to check the snippet is on the published page.
