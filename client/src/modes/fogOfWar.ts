import type { Color } from 'chess.js';
import { computeVision } from '../chess/attacks';
import type { GameMode } from './types';

/**
 * Fog of War: solo ves tus piezas y las casillas que tus piezas atacan.
 * Las piezas enemigas que no esten "a tiro" permanecen ocultas.
 */
export const fogOfWarMode: GameMode = {
  id: 'fogOfWar',
  name: 'Fog of War',
  tagline: 'Solo ves lo que tus piezas vigilan',
  description:
    'Cada jugador ve unicamente sus piezas y las casillas que estas atacan. ' +
    'El rival aparece cuando entra en tu campo de vision.',
  emoji: '\u{1F32B}\uFE0F',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: (chess, viewer: Color) => computeVision(chess, viewer),
};
