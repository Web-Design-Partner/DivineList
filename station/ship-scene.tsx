// A live canvas is the actual image; an img element cannot render these animation frames.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import React, { useEffect, useRef, useState } from 'react';
import { crew, WORLD_HEIGHT, WORLD_WIDTH, type Role } from './world/crew';
import {
  createEnvironment,
  drawAmbient,
  drawBeltMotion,
} from './world/environment';
import { createActors, updateActors } from './world/motion';
import { sprite } from './world/sprites';
import './world/world.css';

export { crew, type Role } from './world/crew';

export function PixelPerson({
  role,
  big = false,
}: {
  role: Role;
  big?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 24, 36);
    c.imageSmoothingEnabled = false;
    c.drawImage(sprite(role), 0, 0);
  }, [role]);
  return (
    <canvas
      ref={canvas}
      width={24}
      height={36}
      className={big ? 'pixel-person big' : 'pixel-person'}
      aria-hidden="true"
    />
  );
}

export function ShipScene({
  selected,
  onSelect,
  workingRoles,
  queued,
  active,
}: {
  selected: Role;
  onSelect: (role: Role) => void;
  workingRoles: string[];
  queued: number;
  active: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const buttons = useRef<Partial<Record<Role, HTMLButtonElement | null>>>({});
  const state = useRef({ selected, workingRoles, active });
  const paintOnce = useRef<(() => void) | null>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    state.current = { selected, workingRoles, active };
  }, [selected, workingRoles, active]);

  useEffect(() => {
    const c = canvas.current?.getContext('2d', { alpha: false });
    if (!c) return;
    c.imageSmoothingEnabled = false;
    const background = createEnvironment();
    const actors = createActors();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = media.matches;
    let frame = 0;
    let previous = 0;
    let logicalTime = 0;
    let disposed = false;
    const draw = (now: number) => {
      if (disposed) return;
      reduced = media.matches;
      if (canvas.current)
        canvas.current.dataset.motionPolicy = reduced ? 'reduced' : 'animated';
      const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      if (!reduced) logicalTime += dt * 1000;
      const current = state.current;
      updateActors(actors, current.workingRoles, current.active, dt, reduced);
      c.drawImage(background, 0, 0);
      drawAmbient(c, logicalTime, !reduced);
      if (current.active)
        for (const role of current.workingRoles)
          drawBeltMotion(c, reduced ? 0 : logicalTime, role);
      for (const actor of [...actors].sort((a, b) => a.y - b.y)) {
        const x = Math.round(actor.x);
        const y = Math.round(actor.y);
        c.fillStyle = '#252f326b';
        c.fillRect(x - 8, y - 2, 16, 4);
        c.fillRect(x - 5, y + 2, 10, 1);
        if (actor.role === current.selected) {
          c.fillStyle = '#e4c995';
          c.fillRect(x - 11, y, 5, 1);
          c.fillRect(x + 7, y, 5, 1);
          c.fillRect(x - 12, y - 2, 1, 3);
          c.fillRect(x + 11, y - 2, 1, 3);
          const bob = reduced ? 0 : Math.floor(logicalTime / 450) % 2;
          c.fillRect(x - 3, y - 42 - bob, 7, 1);
          c.fillRect(x - 2, y - 41 - bob, 5, 1);
          c.fillRect(x - 1, y - 40 - bob, 3, 1);
          c.fillRect(x, y - 39 - bob, 1, 1);
        }
        const action = actor.moving ? 'walk' : actor.working ? 'work' : 'idle';
        const pose = reduced
          ? 0
          : action === 'walk'
            ? Math.floor(actor.gait / 4) % 4
            : action === 'work'
              ? Math.floor(logicalTime / 260) % 4
              : Math.floor(logicalTime / 850) % 8 === 7
                ? 3
                : 0;
        c.drawImage(
          sprite(actor.role, actor.direction, pose, action),
          x - 12,
          y - 34,
        );
        if (actor.working && !actor.moving) {
          c.fillStyle = '#365752';
          c.fillRect(x + 10, y - 31, 5, 5);
          c.fillStyle = '#b6d1a3';
          c.fillRect(x + 12, y - 30, 1, 3);
          c.fillRect(x + 11, y - 29, 3, 1);
        }
        const button = buttons.current[actor.role];
        if (button) {
          button.style.left = `${(actor.x / WORLD_WIDTH) * 100}%`;
          button.style.top = `${((actor.y - 17) / WORLD_HEIGHT) * 100}%`;
          button.dataset.motion = actor.moving
            ? 'walking'
            : actor.working
              ? 'working'
              : 'idle';
        }
      }
    };
    const tick = (now: number) => {
      if (disposed || document.hidden || reduced) {
        frame = 0;
        return;
      }
      if (now - previous >= 1000 / 30) draw(now);
      frame = window.requestAnimationFrame(tick);
    };
    const restart = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (!document.hidden) {
        draw(performance.now());
        if (!reduced) frame = window.requestAnimationFrame(tick);
      }
    };
    const preference = () => {
      reduced = media.matches;
      restart();
    };
    paintOnce.current = () => {
      if (reduced && !document.hidden) draw(performance.now());
    };
    document.addEventListener('visibilitychange', restart);
    media.addEventListener('change', preference);
    restart();
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', restart);
      media.removeEventListener('change', preference);
      paintOnce.current = null;
    };
  }, []);

  useEffect(() => {
    paintOnce.current?.();
  }, [selected, workingRoles, active]);

  return (
    <div className={`ship-world pixel-world ${active ? 'is-active' : ''}`}>
      <div className="pixel-world-header">
        <span>
          <i /> DIVINE / FORSKNINGSSKEPPET
        </span>
        <button
          type="button"
          onClick={() => setZoom(!zoom)}
          aria-pressed={zoom}
          aria-label={zoom ? 'Visa hela skeppet' : 'Förstora skeppet'}
        >
          {zoom ? '− Hela skeppet' : '+ Förstora'}
        </button>
      </div>
      <div
        className={`pixel-viewport ${zoom ? 'pixel-zoom' : ''}`}
        role="region"
        aria-label={
          zoom ? 'Förstorat skepp. Rulla för att se hela däcket.' : undefined
        }
      >
        <div className="pixel-stage">
          <canvas
            ref={canvas}
            width={WORLD_WIDTH}
            height={WORLD_HEIGHT}
            className="pixel-scene-canvas"
            role="img"
            aria-label="Original pixelvärld: ett forskningsskepp med observatorium, kartrum, laboratorium, granskning, arkiv och kommandobrygga. Använd besättningens knappar för att ge order."
          />
          <div className="pixel-crew-overlay">
            {crew.map((person) => {
              const working = active && workingRoles.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  ref={(element) => {
                    buttons.current[person.id] = element;
                  }}
                  className={`pixel-crew-target ${selected === person.id ? 'is-selected' : ''}`}
                  onClick={() => onSelect(person.id)}
                  aria-pressed={selected === person.id}
                  aria-label={`${person.name} — ${working ? 'arbetar' : person.task}`}
                >
                  <span className="pixel-crew-caption">
                    {person.name}
                    {working && <i />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="pixel-world-footer">
        <span>Klicka på besättningen för att ge order.</span>
        <span className="pixel-queue-readout">
          <i className={active && workingRoles.length ? 'on' : ''} />
          {active && workingRoles.length
            ? 'Arbete pågår'
            : 'Besättningen väntar'}{' '}
          <b>·</b> {queued} i kö
        </span>
      </div>
    </div>
  );
}
