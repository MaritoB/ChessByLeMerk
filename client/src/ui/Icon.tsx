export interface IconProps {
  name: string;
  size?: number;
}

/** Icono de la hoja de sprites (`/icons/<name>.png`). */
export function Icon({ name, size = 18 }: IconProps) {
  return (
    <img
      className="ui-icon"
      src={`/icons/${name}.png`}
      alt=""
      draggable={false}
      style={{ width: size, height: size }}
    />
  );
}
