import { useCallback, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = typeof window !== 'undefined' && Boolean(getCtor());

export function useSpeechRecognition(lang = 'es-ES') {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const resultRef = useRef<(text: string) => void>(() => {});

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(
    (onResult: (text: string) => void) => {
      const Ctor = getCtor();
      if (!Ctor) return;
      resultRef.current = onResult;
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setListening(true);
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      recognition.onresult = (event: any) => {
        let finalText = '';
        let partial = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalText += result[0].transcript;
          else partial += result[0].transcript;
        }
        setInterim(partial);
        if (finalText.trim()) {
          setInterim('');
          resultRef.current(finalText.trim());
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    },
    [lang],
  );

  return { supported: speechSupported, listening, interim, start, stop };
}

/** Locucion (text-to-speech) en el idioma indicado. */
export function speak(text: string, lang = 'es-ES'): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* noop */
  }
}
