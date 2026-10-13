export type Annotation =
  | { kind: 'arrow'; from: string; to: string }
  | { kind: 'circle'; square: string };

export function sameAnnotation(a: Annotation, b: Annotation): boolean {
  if (a.kind === 'arrow' && b.kind === 'arrow') return a.from === b.from && a.to === b.to;
  if (a.kind === 'circle' && b.kind === 'circle') return a.square === b.square;
  return false;
}

/** Alterna una anotacion (la quita si ya estaba). */
export function toggleAnnotation(list: Annotation[], next: Annotation): Annotation[] {
  if (list.some((a) => sameAnnotation(a, next))) {
    return list.filter((a) => !sameAnnotation(a, next));
  }
  return [...list, next];
}
