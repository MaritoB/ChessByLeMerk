import type { PieceType } from '../var/board';

export interface SkillHelpProps {
  piece: PieceType;
  shieldActive?: boolean;
}

const ABILITY_ICONS: Record<PieceType, string[]> = {
  p: ['/skills/badges/shield.png', '/skills/icons/retreat.png', '/skills/icons/pawn_push.png'],
  n: ['/skills/icons/mount.png', '/skills/badges/rider.png'],
  b: ['/skills/icons/flecha.png'],
  r: ['/skills/icons/shelter.png', '/skills/badges/cargo.png'],
  q: ['/skills/icons/enter_rook.png'],
  k: ['/skills/icons/convert.png'],
};

const SKILL_INFO: Record<PieceType, { name: string; skill: string; desc: string }> = {
  p: {
    name: 'Peón',
    skill: 'Escudo',
    desc:
      'Escudo (sin límite): queda fijo en su casilla y si una pieza lo ataca, el escudo se rompe y esa ' +
      'pieza muere (el peón queda). Puede bajarlo cuando quiera. También puede retroceder una casilla o dar ' +
      'el ariete (empujón de peones doblados). No puede activar el escudo mientras el rey lo transforma.',
  },
  n: {
    name: 'Caballo',
    skill: 'Montura / Rebote',
    desc:
      'Puede llevar una sola pieza encima (jinete) y moverse con los movimientos del jinete; la pieza ' +
      'montada desmonta a una casilla libre adyacente (un peón que desmonta en la última fila promociona; ' +
      'montado nunca promueve). Rebote: salta por encima de un caballo aliado y sigue hasta más allá.',
  },
  b: {
    name: 'Alfil',
    skill: 'Longshot',
    desc:
      'Carga 1 turno y dispara a una sola casilla de su diagonal (pasa por encima); si se mueve antes de ' +
      'disparar, se cancela. Guarecido en una torre, el longshot es instantáneo.',
  },
  r: {
    name: 'Torre',
    skill: 'Guarecer',
    desc:
      'Guarece una única pieza aliada (a la que pueda llegar moviéndose). La torre se mueve llevándola, pero ' +
      'la guarecida no ataca. Puede desguarecerla a una casilla adyacente. Si capturan la torre, mueren las ' +
      'dos. Un alfil dentro dispara longshot instantáneo.',
  },
  q: {
    name: 'Reina',
    skill: 'Fábrica',
    desc:
      'Guarecida dentro de una torre: crea un peón nuevo por turno en una casilla adyacente, o transforma ' +
      'un peón adyacente en caballo/alfil/torre (tarda turnos; una pieza de cada tipo por bando). Fabricar ' +
      'obliga a la torre a quedarse quieta.',
  },
  k: {
    name: 'Rey',
    skill: 'Coronar',
    desc:
      'Transforma un peón adyacente en reina tras 4 turnos (sin límite). Se cancela si el peón deja de ' +
      'estar al lado del rey. El peón no puede usar el escudo mientras se transforma.',
  },
};

export function SkillHelp({ piece, shieldActive }: SkillHelpProps) {
  const info = SKILL_INFO[piece];
  return (
    <div className="skill-help">
      <div className="skill-help__head">
        <strong>{info.name}</strong>
        <span className="skill-help__skill">{info.skill}</span>
      </div>
      <div className="skill-icons">
        {ABILITY_ICONS[piece].map((src, i) => (
          <img key={i} className="skill-icon" src={src} alt="" draggable={false} />
        ))}
      </div>
      <div className="muted small">{info.desc}</div>
      <div className="skill-uses skill-uses--ok">
        <img className="skill-badge" src="/skills/badges/skill_ready.png" alt="" />
        {piece === 'p' && shieldActive ? 'Escudo activo' : 'Sin límite (carga por turnos)'}
      </div>
    </div>
  );
}
