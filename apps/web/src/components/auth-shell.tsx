import { Card, CardDescription, CardTitle } from "@voicedesk/ui";
import type { ReactNode } from "react";

/** Centered card layout for sign-in, sign-up and other standalone pages. */
export function AuthShell(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-xl font-semibold tracking-tight">VoiceDesk</p>
        <Card>
          <CardTitle>{props.title}</CardTitle>
          {props.description ? <CardDescription>{props.description}</CardDescription> : null}
          <div className="mt-6">{props.children}</div>
        </Card>
      </div>
    </main>
  );
}
