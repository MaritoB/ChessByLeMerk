import { useState } from 'react';
import { buildRoomLink, copyText } from '../net/share';
import { Icon } from './Icon';

export function RoomLink({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const link = buildRoomLink(roomId);

  return (
    <div className="room-link">
      <div className="room-link__code">
        Codigo: <strong>{roomId.toUpperCase()}</strong>
      </div>
      <input
        className="input input--small"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className="btn btn--outline btn--small"
        onClick={async () => {
          if (await copyText(link)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        <Icon name="share" size={16} /> {copied ? 'Copiado!' : 'Copiar enlace'}
      </button>
    </div>
  );
}
