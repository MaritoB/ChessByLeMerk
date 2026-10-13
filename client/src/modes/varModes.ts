import { fullVision } from '../chess/attacks';
import type { VarConfig } from '../var/session';
import type { GameMode } from './types';

export const royaleMode: GameMode = {
  id: 'royale',
  name: 'Royale (tablero que encoge)',
  tagline: 'El tablero se hace pequeno',
  description:
    'Ajedrez normal 2 jugadores, pero cada N jugadas desaparece el anillo exterior. ' +
    'La primera vez se borran las filas y columnas a, h, 1 y 8. Las piezas que queden ahi se pierden ' +
    '(si desaparece un rey, ese jugador pierde).',
  emoji: '\u{1F300}',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: () => fullVision(),
};

export const skillsMode: GameMode = {
  id: 'skills',
  name: 'Ajedrez con Skills',
  tagline: 'Cada pieza con una habilidad',
  description:
    'Ajedrez normal 2 jugadores. Cada pieza tiene una habilidad, una vez por pieza: el alfil ' +
    'lanza una flecha, el peon lleva armadura y puede retroceder, la torre guarece aliados, ' +
    'el rey permuta con la reina y la reina convierte piezas enemigas.',
  emoji: '\u2728',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: () => fullVision(),
};

/** Configuracion del motor segun el modo de variante. */
export function varConfigOf(modeId: 'royale' | 'skills'): VarConfig {
  if (modeId === 'royale') {
    return { modeId, shrinkEvery: 10, skills: false, shieldPawns: false };
  }
  return { modeId, shrinkEvery: 0, skills: true, shieldPawns: true };
}
