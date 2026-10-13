import { noVision } from '../chess/attacks';
import type { GameMode } from './types';

/**
 * Ajedrez ciego: no hay tablero visible. Las jugadas se anuncian por voz
 * (o escribiendo la casilla). Cada fallo cuesta una vida y revela el tablero
 * unos segundos para volver a "ver" la posicion.
 */
export const blindVoiceMode: GameMode = {
  id: 'blindVoice',
  name: 'Ajedrez ciego por voz',
  tagline: 'Di tus jugadas de memoria',
  description:
    'Tablero oculto. Dicta la jugada ("caballo f3") o escribela. Tienes 3 vidas: ' +
    'cada intento ilegal te cuesta una y te muestra una captura del tablero unos segundos.',
  emoji: '\u{1F648}',
  input: 'voice',
  showBoard: false,
  lives: 3,
  penaltyOnIllegal: true,
  penaltyRevealMs: 6000,
  computeVisible: () => noVision(),
};
