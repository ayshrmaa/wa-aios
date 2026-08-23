"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import type { RetellWebClient } from "retell-client-js-sdk";

type CallState = "idle" | "connecting" | "live" | "ended" | "error";

type WebCallContextValue = {
  enableAudio: () => Promise<void>;
  errorMessage: string | null;
  needsAudioTap: boolean;
  startCall: () => Promise<void>;
  state: CallState;
  stopCall: () => void;
};

type WebCallApiResponse = {
  accessToken?: unknown;
  callId?: unknown;
  error?: unknown;
};

const WebCallContext = createContext<WebCallContextValue | null>(null);

const stateLabels: Record<Exclude<CallState, "idle" | "error">, string> = {
  connecting: "Verbindung wird hergestellt …",
  live: "Live - Sie sprechen jetzt mit der KI-Rezeptionistin.",
  ended: "Anruf beendet. Sie können jederzeit erneut anrufen."
};

function microphoneErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Der Mikrofonzugriff wurde blockiert. Erlauben Sie dieser Seite den Mikrofonzugriff in Ihren Browser-Einstellungen und versuchen Sie es erneut.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Es wurde kein Mikrofon gefunden. Verbinden oder aktivieren Sie ein Mikrofon und versuchen Sie es erneut.";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Das Mikrofon wird gerade von einer anderen App verwendet. Schliessen Sie die andere App und versuchen Sie es erneut.";
  }

  return "Das Mikrofon konnte nicht gestartet werden. Prüfen Sie die Browser-Berechtigung und versuchen Sie es erneut.";
}

export function WebCallProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<CallState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const stateRef = useRef<CallState>("idle");
  const clientRef = useRef<RetellWebClient | null>(null);

  const updateState = useCallback((nextState: CallState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const getClient = useCallback(async () => {
    if (clientRef.current) {
      return clientRef.current;
    }

    const { RetellWebClient } = await import("retell-client-js-sdk");
    const client = new RetellWebClient();

    client.on("call_started", () => {
      setErrorMessage(null);
      updateState("live");
    });
    client.on("call_ended", () => {
      if (stateRef.current !== "error") {
        updateState("ended");
      }
    });
    client.on("error", () => {
      setErrorMessage("Der Anruf ist fehlgeschlagen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.");
      updateState("error");
    });

    clientRef.current = client;
    return client;
  }, [updateState]);

  const startCall = useCallback(async () => {
    if (stateRef.current === "connecting" || stateRef.current === "live") {
      return;
    }

    setErrorMessage(null);
    setNeedsAudioTap(false);
    updateState("connecting");

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("Mikrofonanrufe benötigen HTTPS oder localhost und einen Browser mit Mikrofon-Unterstützung.");
      updateState("error");
      return;
    }

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      permissionStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      setErrorMessage(microphoneErrorMessage(error));
      updateState("error");
      return;
    }

    try {
      const response = await fetch("/api/web-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const payload = await response.json() as WebCallApiResponse;

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "The web call could not be started."
        );
      }

      if (typeof payload.accessToken !== "string" || typeof payload.callId !== "string") {
        throw new Error("The web-call service returned an invalid response.");
      }

      const client = await getClient();
      await client.startCall({ accessToken: payload.accessToken });

      try {
        await client.startAudioPlayback();
      } catch {
        setNeedsAudioTap(true);
      }
    } catch (error) {
      if (stateRef.current !== "error") {
        setErrorMessage(
          error instanceof Error && error.message
            ? error.message
            : "Der Anruf konnte nicht gestartet werden. Bitte versuchen Sie es erneut."
        );
        updateState("error");
      }
    }
  }, [getClient, updateState]);

  const enableAudio = useCallback(async () => {
    try {
      await clientRef.current?.startAudioPlayback();
      setNeedsAudioTap(false);
    } catch {
      setNeedsAudioTap(true);
    }
  }, []);

  const stopCall = useCallback(() => {
    setNeedsAudioTap(false);
    clientRef.current?.stopCall();
  }, []);

  useEffect(() => {
    return () => {
      const client = clientRef.current;
      client?.removeAllListeners();
      client?.stopCall();
      clientRef.current = null;
    };
  }, []);

  return (
    <WebCallContext.Provider value={{ enableAudio, errorMessage, needsAudioTap, startCall, state, stopCall }}>
      {children}
    </WebCallContext.Provider>
  );
}

export function WebCallControl({ buttonClassName }: Readonly<{ buttonClassName: string }>) {
  const context = useContext(WebCallContext);

  if (!context) {
    throw new Error("WebCallControl must be rendered inside WebCallProvider.");
  }

  const { enableAudio, errorMessage, needsAudioTap, startCall, state, stopCall } = context;
  const isConnecting = state === "connecting";
  const isLive = state === "live";

  return (
    <div className="call-demo">
      <p className="call-disclosure">
        <strong>Hinweis vor dem Anruf:</strong>{" "}
        Sie sprechen mit einer KI-Assistentin. Das Gespräch wird aufgezeichnet.
      </p>
      <button
        className={`button ${isLive ? "button-hangup" : buttonClassName}`}
        type="button"
        onClick={isLive ? stopCall : startCall}
        disabled={isConnecting}
      >
        {isLive
          ? "Anruf beenden"
          : isConnecting
            ? "Verbindung wird hergestellt …"
            : "Talk to our receptionist"}
      </button>
      {isLive && needsAudioTap ? (
        <button className="call-audio-button" type="button" onClick={enableAudio}>
          Ton aktivieren
        </button>
      ) : null}
      <div className="call-feedback" aria-live="polite" aria-atomic="true">
        {state !== "idle" && state !== "error" ? (
          <p className={`call-status call-status-${state}`}>
            <span aria-hidden="true" />
            {stateLabels[state]}
          </p>
        ) : null}
        {state === "error" && errorMessage ? (
          <p className="call-error" role="alert">{errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
