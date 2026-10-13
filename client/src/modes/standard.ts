import { fullVision } from '../chess/attacks';
import type { GameMode } from './types';

export const standardMode: GameMode = {
  id: 'standard',
  name: 'Ajedrez clasico',
  tagline: 'El de toda la vida',
  description:
    'Reglas estandar de ajedrez. Ves todo el tablero y las jugadas se hacen tocando las piezas.',
  emoji: '\u265E',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: () => fullVision(),
};
