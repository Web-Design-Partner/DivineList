import { crew, stations, type Direction, type Point, type Role } from './crew';

export type Actor = {
  role: Role;
  x: number;
  y: number;
  direction: Direction;
  path: Point[];
  working: boolean;
  moving: boolean;
  gait: number;
};
export const createActors = (): Actor[] =>
  crew.map(({ id }) => ({
    role: id,
    ...stations[id].home,
    direction: 'south',
    path: [],
    working: false,
    moving: false,
    gait: 0,
  }));

/** Visual movement is derived from job state; it never starts or completes a job. */
export function updateActors(
  actors: Actor[],
  workingRoles: string[],
  active: boolean,
  seconds: number,
  reducedMotion: boolean,
) {
  for (const actor of actors) {
    const working = active && workingRoles.includes(actor.role);
    const station = stations[actor.role];
    if (working !== actor.working) {
      actor.working = working;
      const target = working ? station.work : station.home;
      // Approach above the room's conveyor, then turn toward the desk.
      // Return horizontally before moving down; feet never cross a belt.
      actor.path = working
        ? [{ x: actor.x, y: station.work.y }, target]
        : [{ x: station.home.x, y: actor.y }, target];
    }
    if (reducedMotion) {
      const target = working ? station.work : station.home;
      actor.x = target.x;
      actor.y = target.y;
      actor.path = [];
    }
    const target = actor.path[0];
    actor.moving = Boolean(target);
    if (target) {
      const dx = target.x - actor.x;
      const dy = target.y - actor.y;
      const distance = Math.hypot(dx, dy);
      const step = 25 * Math.min(seconds, 0.1);
      if (distance <= step) {
        actor.x = target.x;
        actor.y = target.y;
        actor.path.shift();
      } else {
        actor.x += (dx / distance) * step;
        actor.y += (dy / distance) * step;
        actor.direction =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? 'east'
              : 'west'
            : dy > 0
              ? 'south'
              : 'north';
        actor.gait += step;
      }
    } else actor.direction = working ? 'north' : 'south';
  }
}
