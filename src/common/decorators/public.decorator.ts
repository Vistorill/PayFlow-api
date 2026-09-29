import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Libera a rota do JwtAuthGuard global. Use so em login e register. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
