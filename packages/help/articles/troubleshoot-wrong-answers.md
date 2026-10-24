---
id: troubleshoot-wrong-answers
title: The assistant gives wrong or "I don't know" answers
page: none
roles: owner, admin, staff
keywords: wrong answer, incorrect, doesn't know, unknown, made up, wrong price, wrong hours, outdated, mistake, assistant wrong, hallucination, not answering
suggested: Why did the assistant give the wrong opening hours? | Why does the assistant say it doesn't know? | How do I correct what the assistant says?
---

## Where the assistant's facts come from

The assistant only states business facts from two places:

1. your **approved** [Business profile](/t/:tenant/profile), which it checks first;
2. your [Knowledge](/t/:tenant/knowledge) (website, documents, FAQs), which it searches when the answer isn't in the profile.

It's told never to make facts up. If it can't find something in either place, it says it doesn't have that detail and notes the question for you.

## Check the profile is approved

Open [Business profile](/t/:tenant/profile).

- If it says "Not approved yet — the assistant has no business facts", click **Approve & publish** after checking the draft.
- If you edited the profile but only clicked **Save draft**, the assistant still uses the old live version. Click **Approve & publish**.
- Sections marked **Differs from live** have unpublished changes.

## Wrong prices, hours or details

Correct them in the profile and approve it again. Check **Notes (bank holidays, seasonal hours…)** too: old notes can contradict the hours. Then check your knowledge for out-of-date documents or pages. **Delete** old sources, or **Refresh** a website after you've updated it.

## "I don't know" answers

1. Open [Records](/t/:tenant/records) and look at **Questions the assistant couldn't answer**.
2. Click **Add the answer** and add it to the profile, ideally as an FAQ. Approve it.
3. Click **Mark done**.

You can also use **Test what the assistant finds** on [Knowledge](/t/:tenant/knowledge) to see whether a question finds a useful passage. If it finds "Nothing relevant found.", add the information as a **Text / FAQ** source or to the profile.

## Test the fix

Open the [Test console](/t/:tenant/console), click **Start new conversation**, and ask the same question. Look at **Tool calls** to see whether it searched your knowledge.

## Other things to check

- **Language**: if the customer used a language that isn't ticked under **Languages** on [Assistant](/t/:tenant/agent), the assistant replies in another one.
- **Offers**: expired offers under **Current offers** should be removed or given a **Valid until** date.
- **AI provider**: if every answer is strange or generic, the assistant may be running without an AI provider. Ask your VoiceDesk administrator to check **AI providers**.

Only owners and admins can change the profile and knowledge. Staff can tell them what needs fixing.
