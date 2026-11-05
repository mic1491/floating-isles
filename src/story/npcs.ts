import raw from '../../data/npcs.json';
import type { StoryLine } from './story';

export interface NpcTalk {
  after: number;
  lines: StoryLine[];
}

export interface NpcDef {
  id: string;
  name: string;
  x: number;
  z: number;
  color: string;
  hair: string;
  talks: NpcTalk[];
}

export const NPCS: readonly NpcDef[] = raw.npcs;

/** What a villager says now: the latest talk whose quest count the player has reached. */
export const pickTalk = (npc: NpcDef, questsDone: number): StoryLine[] => {
  let best = npc.talks[0];
  for (const talk of npc.talks) if (talk.after <= questsDone && talk.after >= best.after) best = talk;
  return best.lines;
};
