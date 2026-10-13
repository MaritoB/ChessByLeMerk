import { formatClock } from '../game/clock';

export interface ClockBarProps {
  white: number;
  black: number;
  active: 'w' | 'b';
  whiteLabel?: string;
  blackLabel?: string;
}

export function ClockBar({ white, black, active, whiteLabel = 'Blancas', blackLabel = 'Negras' }: ClockBarProps) {
  return (
    <div className="clocks">
      <div className={`clock ${active === 'w' ? 'clock--active' : ''} ${white <= 20_000 ? 'clock--low' : ''}`}>
        <span className="clock__side">{whiteLabel}</span>
        <span className="clock__time">{formatClock(white)}</span>
      </div>
      <div className={`clock ${active === 'b' ? 'clock--active' : ''} ${black <= 20_000 ? 'clock--low' : ''}`}>
        <span className="clock__side">{blackLabel}</span>
        <span className="clock__time">{formatClock(black)}</span>
      </div>
    </div>
  );
}
