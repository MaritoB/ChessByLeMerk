import { useState } from 'react';
import { useSpeechRecognition } from './useSpeech';

export interface VoiceInputProps {
  disabled?: boolean;
  feedback?: { text: string; kind: 'info' | 'error' | 'ok' };
  announce: boolean;
  onToggleAnnounce: () => void;
  onSubmit: (text: string) => void;
}

export function VoiceInput({
  disabled,
  feedback,
  announce,
  onToggleAnnounce,
  onSubmit,
}: VoiceInputProps) {
  const [text, setText] = useState('');
  const { supported, listening, interim, start, stop } = useSpeechRecognition('es-ES');

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onSubmit(value);
    setText('');
  };

  const handleMic = () => {
    if (listening) {
      stop();
      return;
    }
    start((recognized) => onSubmit(recognized));
  };

  return (
    <div className="voice">
      <div className="voice__row">
        <button
          type="button"
          className={`mic ${listening ? 'mic--on' : ''}`}
          onClick={handleMic}
          disabled={disabled || !supported}
          title={supported ? 'Hablar jugada' : 'Reconocimiento de voz no disponible en este navegador'}
        >
          {listening ? '\u23F9 Detener' : '\u{1F3A4} Hablar'}
        </button>
        <input
          className="voice__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="o escribe la jugada: caballo f3, e2 e4, enroque corto..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          disabled={disabled}
        />
        <button type="button" className="btn btn--ghost" onClick={submit} disabled={disabled}>
          Enviar
        </button>
      </div>
      {interim && <div className="voice__interim">...{interim}</div>}
      {!supported && (
        <div className="voice__hint">
          Tu navegador no soporta dictado por voz. Escribe la jugada (p. ej. "peon e4").
        </div>
      )}
      <label className="voice__announce">
        <input type="checkbox" checked={announce} onChange={onToggleAnnounce} />
        Locucion de jugadas (lee en voz alta)
      </label>
      {feedback && <div className={`feedback feedback--${feedback.kind}`}>{feedback.text}</div>}
    </div>
  );
}
