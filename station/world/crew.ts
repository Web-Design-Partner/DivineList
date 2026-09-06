export type Role =
  | 'captain'
  | 'scout'
  | 'mapper'
  | 'analyst'
  | 'reviewer'
  | 'scribe';

export const crew: {
  id: Role;
  name: string;
  task: string;
  color: string;
  number: string;
}[] = [
  {
    id: 'captain',
    name: 'Kaptenen',
    task: 'Du bestämmer kursen',
    color: '#e9b76a',
    number: '00',
  },
  {
    id: 'scout',
    name: 'Spanaren',
    task: 'Hittar företagskandidater',
    color: '#7dcfb5',
    number: '01',
  },
  {
    id: 'mapper',
    name: 'Kartografen',
    task: 'Ordnar källor och domäner',
    color: '#6ab4d1',
    number: '02',
  },
  {
    id: 'analyst',
    name: 'Analytikern',
    task: 'Undersöker webbplatser',
    color: '#ac9bd7',
    number: '03',
  },
  {
    id: 'reviewer',
    name: 'Granskaren',
    task: 'Synliggör osäkerheter',
    color: '#e3947e',
    number: '04',
  },
  {
    id: 'scribe',
    name: 'Skrivaren',
    task: 'Sammanställer underlag',
    color: '#b3c97c',
    number: '05',
  },
];

export type Direction = 'south' | 'north' | 'east' | 'west';
export type Point = { x: number; y: number };
export const WORLD_WIDTH = 720;
export const WORLD_HEIGHT = 430;

// Feet anchors; every route remains on the open floor inside its own room.
export const stations: Record<Role, { home: Point; work: Point }> = {
  captain: { home: { x: 579, y: 281 }, work: { x: 617, y: 245 } },
  scout: { home: { x: 202, y: 192 }, work: { x: 156, y: 180 } },
  mapper: { home: { x: 340, y: 192 }, work: { x: 291, y: 180 } },
  analyst: { home: { x: 493, y: 192 }, work: { x: 430, y: 180 } },
  reviewer: { home: { x: 233, y: 322 }, work: { x: 162, y: 310 } },
  scribe: { home: { x: 389, y: 322 }, work: { x: 327, y: 310 } },
};
