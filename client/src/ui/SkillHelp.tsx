import type { PieceType } from '../var/board';

export interface SkillHelpProps {
  piece: PieceType;
  usesLeft: number;
}

const ABILITY_ICONS: Record<PieceType, string[]> = {
  p: ['/skills/badges/shield.png', '/skills/icons/retreat.png', '/skills/icons/pawn_push.png'],
  n: ['/skills/icons/mount.png', '/skills/badges/rider.png'],
  b: ['/skills/icons/flecha.png', '/skills/icons/mount.png', '/skills/icons/enter_rook.png'],
  r: ['/skills/icons/shelter.png', '/skills/badges/cargo.png'],
  q: ['/skills/icons/convert.png'],
  k: ['/skills/icons/swap.png'],
};

const SKILL_INFO: Record<PieceType, { name: string; skill: string; desc: string }> = {
  p: {
    name: 'Peón',
    skill: 'Armadura',
    desc:
      'Bloquea el primer golpe (el atacante vuelve a su casilla). Además puede retroceder (pierde la armadura), hacer el empujón si hay peones doblados en su columna (avanzan todos matando lo de delante) y montar sobre un caballo.',
  },
  n: {
    name: 'Caballo',
    skill: 'Cabalgadura',
    desc:
      'Puede llevar encima un peón (que pierde la armadura) o recibir un alfil que se convierte en arquero a caballo.',
  },
  b: {
    name: 'Alfil',
    skill: 'Flecha / Fusiones',
    desc:
      'Lanza una flecha: rápida (1 turno, mata la primera de la diagonal), guiada (2 turnos, casilla objetivo) o perforante (3 turnos, arrasa la diagonal). O bien monta en un caballo (arquero) o entra en una torre (convertirse en reina o guarecerse y disparar desde dentro).',
  },
  r: {
    name: 'Torre',
    skill: 'Guarecer',
    desc:
      'Guarece a una pieza aliada adyacente: la torre queda inmóvil y la guarecida ataca desde dentro. Si la rompen, mueren las dos. Un alfil dentro puede seguir disparando flechas.',
  },
  q: {
    name: 'Reina',
    skill: 'Conversión',
    desc:
      'Convierte una pieza enemiga de su línea de acción en una de tu color (no funciona contra otras reinas). Si con ello das jaque, la pieza muere en vez de convertirse.',
  },
  k: {
    name: 'Rey',
    skill: 'Permuta / Grito de guerra',
    desc: 'Permuta con tu propia reina, o da un grito de guerra que renueva el punto de habilidad de las unidades aliadas que tenga a un cuadrado.',
  },
};

export function SkillHelp({ piece, usesLeft }: SkillHelpProps) {
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
      <div className={usesLeft > 0 ? 'skill-uses skill-uses--ok' : 'skill-uses skill-uses--no'}>
        <img
          className="skill-badge"
          src={usesLeft > 0 ? '/skills/badges/skill_ready.png' : '/skills/badges/skill_used.png'}
          alt=""
        />
        {usesLeft > 0 ? `Disponible (${usesLeft} uso${usesLeft > 1 ? 's' : ''})` : 'Sin usos'}
      </div>
    </div>
  );
}
