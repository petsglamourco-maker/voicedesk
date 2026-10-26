"use client";

import { Button, cn } from "@voicedesk/ui";
import { Mic, MicOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";

/**
 * Voice typing (ADR 0027): a microphone button next to text fields. Audio streams from the
 * browser straight to Deepgram with a 30-second token from our API (the API key never
 * reaches the browser). Nothing is stored: the words just go into the field.
 */

const MAX_MS = 60_000;

interface VoiceTypingSettings {
  tenantId: string | null;
  enabled: boolean;
}

const VoiceTypingContext = createContext<VoiceTypingSettings>({ tenantId: null, enabled: false });

/** Set once per business screen (tenant layout): whether this person has the microphone. */
export function VoiceTypingScope(props: {
  tenantId: string;
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <VoiceTypingContext.Provider value={{ tenantId: props.tenantId, enabled: props.enabled }}>
      {props.children}
    </VoiceTypingContext.Provider>
  );
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Puts text at the cursor so React (controlled or not) sees the change. */
export function insertIntoField(el: Field, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const spaced = (before && !/\s$/.test(before) ? " " : "") + text;
  const next = before + spaced + after;
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const caret = before.length + spaced.length;
  el.setSelectionRange?.(caret, caret);
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

const noSubscribe = () => () => {};

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

/** The microphone button for one field. Renders nothing when voice typing is off. */
export function MicButton(props: { target: RefObject<Field | null>; className?: string }) {
  const t = useTranslations("voiceTyping");
  const locale = useLocale();
  const { tenantId, enabled } = useContext(VoiceTypingContext);
  const [listening, setListening] = useState(false);
  // false on the server, the real answer in the browser (no hydration mismatch)
  const canUse = useSyncExternalStore(noSubscribe, supported, () => false);
  const session = useRef<{ stop: () => void } | null>(null);

  useEffect(() => () => session.current?.stop(), []);

  if (!enabled || !tenantId || !canUse) return null;

  async function start() {
    if (!tenantId) return;
    let stream: MediaStream | null = null;
    let socket: WebSocket | null = null;
    let recorder: MediaRecorder | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
        socket.close();
      }
      session.current = null;
      setListening(false);
    };
    session.current = { stop };
    setListening(true);
    try {
      const grant = await api<{ token: string; url: string; protocol: string }>(
        `/api/tenants/${tenantId}/voice-typing/token`,
        { method: "POST", body: JSON.stringify({ language: locale.slice(0, 2) }) },
      );
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      socket = new WebSocket(grant.url, [grant.protocol, grant.token]);
      socket.onopen = () => {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : undefined;
        recorder = new MediaRecorder(stream!, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && socket?.readyState === WebSocket.OPEN) socket.send(e.data);
        };
        recorder.start(250);
        timer = setTimeout(stop, MAX_MS);
      };
      socket.onmessage = (event) => {
        let data: DeepgramResult;
        try {
          data = JSON.parse(String(event.data)) as DeepgramResult;
        } catch {
          return;
        }
        // A pause in speech ends the dictation; the person checks the words, then sends.
        if (data.type === "UtteranceEnd") return stop();
        const text = data.channel?.alternatives?.[0]?.transcript?.trim();
        if (data.is_final && text && props.target.current)
          insertIntoField(props.target.current, text);
      };
      socket.onerror = () => {
        toast.error(t("failed"));
        stop();
      };
      socket.onclose = () => stop();
    } catch (error) {
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      toast.error(blocked ? t("blocked") : error instanceof Error ? error.message : t("failed"));
      stop();
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        shape="pill"
        aria-pressed={listening}
        aria-label={listening ? t("stop") : t("start")}
        title={listening ? t("stop") : t("start")}
        data-testid="mic-button"
        className={cn(
          listening && "bg-primary/15 text-primary shadow-[0_0_18px_0_var(--color-glow)]",
          props.className,
        )}
        onClick={() => (listening ? session.current?.stop() : void start())}
      >
        {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {listening ? t("listening") : ""}
      </span>
    </>
  );
}
