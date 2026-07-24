import axios from 'axios';

import { apiEntryUrl } from './constants';

const powerpointPath = `${apiEntryUrl}/powerpoint`;

export interface PowerPointGroupInstance {
  instanceId: string;
  machineName: string;
  priority: number;
  isActive: boolean;
}

export interface PowerPointGroup {
  groupId: string;
  groupName: string;
  consumed: boolean;
  cloud: boolean;
  connected: boolean;
  currentSlide: number | null;
  slideCount: number | null;
  activeInstanceId: string | null;
  instances: PowerPointGroupInstance[];
}

/** Lista os grupos multi-instância descobertos. */
export async function fetchPowerPointGroups(): Promise<PowerPointGroup[]> {
  const res = await axios.get(`${powerpointPath}/groups`);
  return res.data?.groups ?? [];
}

/** Liga/desliga o consumo de um grupo pelo Ontime. */
export async function setPowerPointGroupConsume(groupId: string, consume: boolean): Promise<PowerPointGroup[]> {
  const res = await axios.post(`${powerpointPath}/groups/consume`, { groupId, consume });
  return res.data?.groups ?? [];
}

/** Liga/desliga a publicação de um grupo na nuvem (Supabase). */
export async function setPowerPointGroupCloud(groupId: string, cloud: boolean): Promise<PowerPointGroup[]> {
  const res = await axios.post(`${powerpointPath}/groups/cloud`, { groupId, cloud });
  return res.data?.groups ?? [];
}
