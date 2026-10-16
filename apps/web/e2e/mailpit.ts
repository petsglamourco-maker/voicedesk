// Reads emails captured by the local Mailpit SMTP server (http://localhost:8025).
const MAILPIT = "http://localhost:8025/api/v1";

interface MessageSummary {
  ID: string;
  Subject: string;
}

/** Waits for the newest email to `to` whose subject matches, and returns its first link. */
export async function waitForEmailLink(
  to: string,
  subject: RegExp,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: MessageSummary[] };
    const match = messages.find((m) => subject.test(m.Subject));
    if (match) {
      const message = (await (await fetch(`${MAILPIT}/message/${match.ID}`)).json()) as {
        Text: string;
      };
      const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
      if (!link) throw new Error(`no link in email "${match.Subject}"`);
      return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for email to ${to} matching ${String(subject)}`);
}
