import { fullVision } from '../chess/attacks';
import type { GameMode } from './types';

/**
 * Modo especial de 4 jugadores. La logica real vive en el motor dedicado
 * (client/src/four) y su pantalla, no en los hooks de visibility de 2 jugadores.
 */
export const fourFFAMode: GameMode = {
  id: 'fourFFA',
  name: 'Ajedrez de 4 · Free-for-all',
  tagline: 'Todos contra todos',
  description:
    'Tablero en cruz para 4 jugadores. Cada uno con su ejercito; el ultimo rey en pie gana. ' +
    'Se necesita 1 anfitrion y 3 jugadores mas.',
  emoji: '\u2694\uFE0F',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: () => fullVision(),
};

export const fourTeamsMode: GameMode = {
  id: 'fourTeams',
  name: 'Ajedrez de 4 · Equipos',
  tagline: '2 contra 2',
  description:
    'Igual que el de 4, pero los asientos opuestos son companeros (Rojo+Amarillo vs Azul+Verde). ' +
    'No puedes capturar a tu companero.',
  emoji: '\u{1F91D}',
  input: 'board',
  showBoard: true,
  lives: Number.POSITIVE_INFINITY,
  penaltyOnIllegal: false,
  penaltyRevealMs: 0,
  computeVisible: () => fullVision(),
};
