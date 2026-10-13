import type { GameModeId } from '@shared/protocol';
import type { GameMode } from './types';
import { standardMode } from './standard';
import { fogOfWarMode } from './fogOfWar';
import { blindVoiceMode } from './blindVoice';
import { fourFFAMode, fourTeamsMode } from './four';
import { royaleMode, skillsMode, varConfigOf } from './varModes';

export const GAME_MODES: Record<GameModeId, GameMode> = {
  standard: standardMode,
  fogOfWar: fogOfWarMode,
  blindVoice: blindVoiceMode,
  royale: royaleMode,
  skills: skillsMode,
  fourFFA: fourFFAMode,
  fourTeams: fourTeamsMode,
};

export const MODE_LIST: GameMode[] = [
  standardMode,
  fogOfWarMode,
  blindVoiceMode,
  royaleMode,
  skillsMode,
  fourFFAMode,
  fourTeamsMode,
];

export function getMode(id: GameModeId): GameMode {
  return GAME_MODES[id] ?? standardMode;
}

export function isFourMode(id: GameModeId): boolean {
  return id === 'fourFFA' || id === 'fourTeams';
}

export function fourFormatOf(id: GameModeId): 'ffa' | 'teams' {
  return id === 'fourTeams' ? 'teams' : 'ffa';
}

export function isVarMode(id: GameModeId): boolean {
  return id === 'royale' || id === 'skills';
}

export function varModeIdOf(id: GameModeId): 'royale' | 'skills' {
  return id === 'skills' ? 'skills' : 'royale';
}

export { varConfigOf } from './varModes';

export type { GameMode } from './types';
