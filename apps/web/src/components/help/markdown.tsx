import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for Help answers: paragraphs, headings, lists, rules,
 * **bold**, `code` and links. It builds React elements only (no HTML injection), and only
 * in-app links (starting with "/") are clickable; anything else shows as plain text.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1] !== undefined) {
      out.push(<strong key={key}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {m[2]}
        </code>,
      );
    } else if (m[4]!.startsWith("/") && !m[4]!.startsWith("//") && !m[4]!.includes(":tenant")) {
      out.push(
        <Link
          key={key}
          href={m[4]!}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {m[3]}
        </Link>,
      );
    } else {
      out.push(m[3]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HelpMarkdown(props: { text: string }) {
  const lines = props.text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k} dir="auto">
          {inline(para.join(" "), k)}
        </p>,
      );
    }
    para = [];
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((item, i) => (
        <li key={`${k}-${i}`} dir="auto">
          {inline(item, `${k}-${i}`)}
        </li>
      ));
      blocks.push(
        list.ordered ? (
          <ol key={k} className="list-decimal space-y-1 ps-5">
            {items}
          </ol>
        ) : (
          <ul key={k} className="list-disc space-y-1 ps-5">
            {items}
          </ul>
        ),
      );
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (/^-{3,}$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push(<hr key={`h${blocks.length}`} className="border-border" />);
    } else if (heading) {
      flushPara();
      flushList();
      const k = `t${blocks.length}`;
      blocks.push(
        <p key={k} className="font-display font-semibold" dir="auto">
          {inline(heading[1]!, k)}
        </p>,
      );
    } else if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2.5 text-sm leading-relaxed">{blocks}</div>;
}
