/**
 * A que portal pertenece cada rol.
 *
 * Vive fuera de `auth.actions.ts` porque aquel archivo lleva `'use server'` y un
 * modulo de Server Actions solo puede exportar funciones asincronas: exportar
 * este ayudante desde alli rompe la compilacion, y no de forma evidente.
 */
export function portalPath(portal: string): string {
  switch (portal) {
    case 'academy':
      return '/academy';
    case 'teacher':
      return '/docentes';
    case 'institution':
    case 'admin':
      return '/admin';
    default:
      return '/discover';
  }
}
