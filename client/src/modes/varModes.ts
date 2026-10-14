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
    'Ajedrez normal 2 jugadores con habilidades. El peon activa un escudo (queda fijo e ' +
    'imbatible) o retrocede o empuja peones doblados. El alfil carga un longshot de 2 turnos. ' +
    'La torre guarece una pieza aliada (el alfil dispara gratis dentro). Una reina guarecida ' +
    'fabrica piezas de un peon adyacente tardando turnos. El rey permuta con la reina.',
  emoji: '\u2728',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: () => fullVision(),
};

/** Modificadores combinables de la familia de variantes 8x8 (2 jugadores). */
export interface VarMods {
  skills: boolean;
  shrink: boolean;
  fog: boolean;
}

/** Configuracion del motor segun el modo de variante. */
export function varConfigOf(modeId: 'royale' | 'skills'): VarConfig {
  if (modeId === 'royale') {
    return { modeId, shrinkEvery: 10, skills: false, fog: false, shieldPawns: false };
  }
  return { modeId, shrinkEvery: 0, skills: true, fog: false, shieldPawns: false };
}

/** Construye la config combinando modificadores sobre una base. */
export function varConfigFrom(base: 'royale' | 'skills', mods: VarMods): VarConfig {
  return {
    modeId: base,
    shrinkEvery: mods.shrink ? 10 : 0,
    skills: mods.skills,
    fog: mods.fog,
    shieldPawns: false,
  };
}
