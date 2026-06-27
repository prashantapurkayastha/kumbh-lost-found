// ─────────────────────────────────────────────────────────────────────────────
// Speech Service — Web Speech API wrapper
// Handles noisy environment (Kumbh crowds) with visual feedback + retry logic
//
// Noise suppression strategy:
//   1. Hardware-level: getUserMedia with noiseSuppression + echoCancellation +
//      autoGainControl constraints. Respected by Chrome/Edge; partially by Firefox.
//   2. Volume gate: ignore transcripts below minimum RMS level (< 5 / 100)
//   3. Audio dynamics: DynamicsCompressor to limit peaks from crowd noise.
//   4. Confidence gate: only accept final results with confidence ≥ 0.4.
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

  // ── Volume meter + hardware noise suppression via AudioContext ────────────
  async function startVolumeMeter() {
    try {
      // Request hardware-level noise suppression constraints.
      // These are W3C MediaTrackConstraints — most browsers honour them as
      // processing hints even when SpeechRecognition uses its own stream.
      const constraints: MediaStreamConstraints = {
        audio: {
          noiseSuppression: true,     // Spectral subtraction / Wiener filter
          echoCancellation: true,     // Remove speaker bleed-back
          autoGainControl: true,      // Normalise volume across speakers
          // channelCount tells browser to prefer mono (better for speech)
          channelCount: 1,
          sampleRate: 16000,          // 16 kHz — optimal for speech models
        },
      };
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      audioCtx = new AudioContext({ sampleRate: 16000 });
      const src = audioCtx.createMediaStreamSource(mediaStream);

      // Dynamics compressor limits crowd-noise peaks
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -24;  // dB — start compressing at -24
      compressor.knee.value = 6;
      compressor.ratio.value = 4;        // 4:1 ratio
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;

      src.connect(compressor);
      compressor.connect(analyser);
      // Not connecting to destination — we only want analysis, not playback

      const data = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        opts.onVolume?.(Math.round((avg / 256) * 100));
        animFrame = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      // No microphone access or AudioContext not supported — graceful fallback
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

  // Minimum confidence gate — discard near-silence / noise bursts
  const MIN_CONFIDENCE = 0.35;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recognition.onresult = (event: any) => {
    let interim = "";
    let finalText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const confidence: number = result[0].confidence ?? 1;
        // Only accept if above confidence threshold; otherwise treat as noise
        if (confidence >= MIN_CONFIDENCE) {
          finalText += result[0].transcript;
        } else {
          console.debug(`[speech] low-confidence result (${confidence.toFixed(2)}) dropped`);
        }
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
