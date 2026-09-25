export const PLAYER_MINIMIZE_DISTANCE = 88;
export const PLAYER_MINIMIZE_VELOCITY = 450;

export function shouldMinimizePlayer(offsetY: number, velocityY: number) {
  return offsetY > PLAYER_MINIMIZE_DISTANCE || velocityY > PLAYER_MINIMIZE_VELOCITY;
}

export function shouldExpandMiniPlayer(offsetY: number, velocityY: number) {
  return offsetY < -PLAYER_MINIMIZE_DISTANCE || velocityY < -PLAYER_MINIMIZE_VELOCITY;
}

export function shouldDismissMiniPlayer(offsetY: number, velocityY: number) {
  return offsetY > PLAYER_MINIMIZE_DISTANCE + 24 || velocityY > PLAYER_MINIMIZE_VELOCITY + 100;
}
