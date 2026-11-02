export type EnemyState = 'patrol' | 'chase' | 'attack' | 'return';

export interface EnemySenses {
  distanceToPlayer: number;
  distanceFromHome: number;
  aggroRange: number;
  attackRange: number;
  leashRange: number;
  playerAlive: boolean;
}

export const nextEnemyState = (state: EnemyState, s: EnemySenses): EnemyState => {
  if (!s.playerAlive || s.distanceFromHome > s.leashRange) {
    return s.distanceFromHome > 1 ? 'return' : 'patrol';
  }
  switch (state) {
    case 'patrol':
      return s.distanceToPlayer <= s.aggroRange ? 'chase' : 'patrol';
    case 'chase':
      if (s.distanceToPlayer <= s.attackRange) return 'attack';
      return s.distanceToPlayer > s.aggroRange * 1.4 ? 'return' : 'chase';
    case 'attack':
      return s.distanceToPlayer > s.attackRange * 1.25 ? 'chase' : 'attack';
    case 'return':
      if (s.distanceToPlayer <= s.aggroRange) return 'chase';
      return s.distanceFromHome <= 1 ? 'patrol' : 'return';
  }
};
