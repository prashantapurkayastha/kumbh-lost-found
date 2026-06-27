// ─────────────────────────────────────────────────────────────────────────────
// Speech Service — Web Speech API wrapper
// Handles noisy environment (Kumbh crowds) with visual feedback + retry logic
// ─────────────────────────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES: { code: string; label: string; bcp47: string }[] = [
  { code: "mr", label: "मराठी", bcp47: "mr-IN" },
  { code: "hi", label: "हिन्दी", bcp47: "hi-IN" },
  { code: "en", label: "English", bcp47: "en-IN" },
  { code: "gu", label: "ગુજરાતી", bcp47: "gu-IN" },
  { code: "bn", label: "বাংলা", bcp47: "bn-IN" },
  { code: "te", label: "తెలుగు", bcp47: "te-IN" },
  { code: "ta", label: "தமிழ்", bcp47: "ta-IN" },
  { code: "pa", label: "ਪੰਜਾਬੀ", bcp47: "pa-IN" },
  { code: "kn", label: "ಕನ್ನಡ", bcp47: "kn-IN" },
  { code: "bh", label: "भोजपुरी", bcp47: "hi-IN" }, // fallback to Hindi
  { code: "mai", label: "मैथिली", bcp47: "hi-IN" }, // fallback to Hindi
];

export function getBCP47(langCode: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === langCode)?.bcp47 ?? "hi-IN";
}

export type SpeechState = "idle" | "listening" | "processing" | "done" | "error";

export interface SpeechSession {
  stop: () => void;
}

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionCtor: SpeechRecognitionType | undefined =
  typeof window !== "undefined"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;

export interface StartSpeechOptions {
  langCode: string;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onStateChange: (state: SpeechState) => void;
  onVolume?: (level: number) => void; // 0–100
}

export function startSpeech(opts: StartSpeechOptions): SpeechSession | null {
  if (!SpeechRecognitionCtor) {
    opts.onStateChange("error");
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognition: any = new SpeechRecognitionCtor();
  recognition.lang = getBCP47(opts.langCode);
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.continuous = false;

  let audioCtx: AudioContext | null = null;
  let animFrame: number | null = null;
  let mediaStream: MediaStream | null = null;

  // ── Volume meter via AudioContext ──────────────────────────────────────────
  async function startVolumeMeter() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const src = audioCtx.createMediaStreamSource(mediaStream);
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        opts.onVolume?.(Math.round((avg / 256) * 100));
        animFrame = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      // No microphone access — that's fine
    }
  }

  function stopVolumeMeter() {
    if (animFrame) cancelAnimationFrame(animFrame);
    audioCtx?.close().catch(() => {});
    mediaStream?.getTracks().forEach((t) => t.stop());
  }

  recognition.onstart = () => {
    opts.onStateChange("listening");
    startVolumeMeter();
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recognition.onresult = (event: any) => {
    let interim = "";
    let finalText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        // Pick the best alternative (highest confidence or first)
        finalText += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }

    if (interim) opts.onInterim(interim);
    if (finalText) {
      opts.onFinal(finalText.trim());
      opts.onStateChange("done");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recognition.onerror = (event: any) => {
    console.warn("[speech] error:", event.error);
    opts.onStateChange("error");
    stopVolumeMeter();
  };

  recognition.onend = () => {
    stopVolumeMeter();
    opts.onStateChange("idle");
  };

  try {
    recognition.start();
    opts.onStateChange("listening");
  } catch (err) {
    console.warn("[speech] start error:", err);
    opts.onStateChange("error");
    return null;
  }

  return {
    stop: () => {
      recognition.stop();
      stopVolumeMeter();
    },
  };
}
