// Orquestrador multi-instância: agrupa instâncias houseriaPPT por group_id,
// escolhe a ativa por prioridade (menor = principal), faz failover, avisa a
// instância ativa que está no ar (capture_state) e publica por grupo no Supabase.
//
// Modelo: UMA conexão ("pipe") por grupo, reapontada no failover. As máquinas
// de backup inferem "STANDBY" localmente (via peer_registry), então o Ontime não
// precisa manter conexões ociosas com elas.
import { getDiscoveryService, DiscoveredServer } from './powerpoint-discovery.service.js';
import { PowerPointWebSocketService } from './powerpoint-websocket.service.js';
import { PowerPointSupabaseService } from './powerpoint-supabase.service.js';
import { supabaseAdapter } from '../../adapters/SupabaseAdapter.js';
import { getDataProvider } from '../../classes/data-provider/DataProvider.js';
import { socket } from '../../adapters/WebsocketAdapter.js';
import { logger } from '../../classes/Logger.js';
import { LogOrigin } from 'houseriaapp-types';

const STALE_MS = 12000; // instância some se não anuncia há esse tempo
const TICK_MS = 3000; // reconciliação + push de estado

interface Instance {
  instanceId: string;
  machineName: string;
  groupId: string;
  groupName: string;
  priority: number;
  ip: string;
  port: number;
  url: string;
  lastSeen: number;
}

interface Group {
  groupId: string;
  groupName: string;
  pipe: PowerPointWebSocketService; // conexão de dados (reaponta no failover)
  supabase: PowerPointSupabaseService | null;
  activeInstanceId: string | null;
}

export interface GroupSnapshot {
  groupId: string;
  groupName: string;
  consumed: boolean;
  cloud: boolean;
  connected: boolean;
  currentSlide: number | null;
  slideCount: number | null;
  activeInstanceId: string | null;
  instances: Array<{
    instanceId: string;
    machineName: string;
    priority: number;
    isActive: boolean;
  }>;
}

export class PowerPointMultiSourceService {
  private instances = new Map<string, Instance>();
  private groups = new Map<string, Group>();
  private consumedGroups = new Set<string>(); // grupos que o operador escolheu consumir
  private consumeAll = true; // enquanto o operador não escolher, consome todos
  private cloudGroups = new Set<string>(); // grupos publicados na nuvem
  // Instâncias cuja conexão caiu agora (failover imediato, sem esperar o timeout
  // de 12s). Limpo assim que a máquina volta a anunciar via discovery.
  private unhealthy = new Set<string>();
  private tickTimer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    const discovery = getDiscoveryService();
    discovery.startListening(); // broadcast: instantâneo onde funciona (Windows)
    discovery.startScanning(); // scan unicast: única via no macOS (broadcast é barrado lá)
    discovery.on('serverFound', (s: DiscoveredServer) => this.onServerFound(s));

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    logger.info(LogOrigin.Server, '🎛️  PowerPoint MultiSource - iniciado (multi-instância por grupo)');
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const g of this.groups.values()) this.teardownGroup(g);
    this.groups.clear();
    this.instances.clear();
    this.started = false;
  }

  // --- descoberta ---
  private onServerFound(s: DiscoveredServer): void {
    try {
      this.handleServerFound(s);
    } catch (error) {
      logger.error(
        LogOrigin.Server,
        `PowerPoint MultiSource - erro em onServerFound: ${error instanceof Error ? error.message : 'desconhecido'}`,
      );
    }
  }

  private handleServerFound(s: DiscoveredServer): void {
    if (!s.ip || !s.port) return;
    const instanceId = s.instance_id || `${s.ip}:${s.port}`;
    // Sem group_id (app antigo ou sem grupo definido): vira um feed avulso próprio.
    // A chave do grupo (e, portanto, da linha na nuvem `projectCode:groupId`) tem
    // que ser ESTÁVEL entre reaberturas do PPT. O `instance_id` muda a cada vez
    // que a máquina do PowerPoint reabre, o que criava uma linha órfã por
    // reconexão (o espectador via o slide velho congelado embaixo do novo).
    // Usa o nome da máquina (estável) e cai pra ip:port se não vier nome.
    const soloKey = s.machine_name || s.device_name || `${s.ip}:${s.port}`;
    const groupId = s.group_id || `solo:${soloKey}`;
    const groupName = s.group_name || s.machine_name || s.device_name || 'PowerPoint';
    let priority = Number(s.priority);
    if (!Number.isFinite(priority) || priority < 1) priority = 1;

    // Anunciou de novo → está viva: sai da lista de "caiu" (permite reassumir)
    this.unhealthy.delete(instanceId);

    this.instances.set(instanceId, {
      instanceId,
      machineName: s.machine_name || s.device_name || instanceId,
      groupId,
      groupName,
      priority,
      ip: s.ip,
      port: s.port,
      url: `http://${s.ip}:${s.port}`,
      lastSeen: Date.now(),
    });
    this.reconcile();
  }

  private aliveInstances(): Instance[] {
    const now = Date.now();
    return [...this.instances.values()].filter((i) => now - i.lastSeen <= STALE_MS);
  }

  private groupMembers(instances: Instance[]): Map<string, Instance[]> {
    const map = new Map<string, Instance[]>();
    for (const i of instances) {
      const arr = map.get(i.groupId);
      if (arr) arr.push(i);
      else map.set(i.groupId, [i]);
    }
    return map;
  }

  private isConsumed(groupId: string): boolean {
    return this.consumeAll || this.consumedGroups.has(groupId);
  }

  private pickActive(members: Instance[]): Instance | null {
    if (members.length === 0) return null;
    // menor prioridade vence; desempata determinístico por instanceId
    const byPriority = (a: Instance, b: Instance) =>
      a.priority - b.priority || a.instanceId.localeCompare(b.instanceId);
    // Prefere quem NÃO caiu; se todas caíram (ex: máquina única), mantém o alvo
    // pra a pipe seguir tentando reconectar quando ela voltar.
    const healthy = members.filter((m) => !this.unhealthy.has(m.instanceId));
    const pool = healthy.length > 0 ? healthy : members;
    return [...pool].sort(byPriority)[0];
  }

  // --- reconciliação ---
  private tick(): void {
    try {
      const now = Date.now();
      for (const [id, i] of this.instances) {
        if (now - i.lastSeen > STALE_MS) {
          this.instances.delete(id);
          this.unhealthy.delete(id);
        }
      }
      this.reconcile();
      this.pushSnapshot();
    } catch (error) {
      // Nunca deixa o loop de reconciliação derrubar o servidor
      logger.error(
        LogOrigin.Server,
        `PowerPoint MultiSource - erro no tick: ${error instanceof Error ? error.message : 'desconhecido'}`,
      );
    }
  }

  private reconcile(): void {
    const byGroup = this.groupMembers(this.aliveInstances());

    // cria/atualiza grupos consumidos
    for (const [groupId, members] of byGroup) {
      if (!this.isConsumed(groupId)) {
        const existing = this.groups.get(groupId);
        if (existing) {
          this.teardownGroup(existing);
          this.groups.delete(groupId);
        }
        continue;
      }

      const groupName = members.find((m) => m.groupName)?.groupName || groupId;
      let group = this.groups.get(groupId);
      if (!group) {
        const pipe = new PowerPointWebSocketService();
        group = { groupId, groupName, pipe, supabase: null, activeInstanceId: null };
        this.groups.set(groupId, group);
        pipe.on('connected', () => this.onPipeConnected(group as Group));
        pipe.on('disconnected', () => this.onPipeDisconnected(group as Group));
      } else {
        group.groupName = groupName;
      }

      const active = this.pickActive(members);
      if (active) {
        if (group.activeInstanceId !== active.instanceId) {
          group.activeInstanceId = active.instanceId;
          group.pipe.setUrl(active.url);
          logger.info(
            LogOrigin.Server,
            `🎛️  PowerPoint MultiSource - grupo "${group.groupName}" ativo → ${active.machineName} (P${active.priority})`,
          );
        } else if (!group.pipe.isServiceConnected() && group.pipe.getUrl() !== active.url) {
          group.pipe.setUrl(active.url);
        }
      }

      this.syncCloud(group);
    }

    // derruba grupos que sumiram
    for (const [groupId, group] of this.groups) {
      if (!byGroup.has(groupId)) {
        this.teardownGroup(group);
        this.groups.delete(groupId);
      }
    }
  }

  private onPipeConnected(group: Group): void {
    // avisa a instância ativa que ELA está no ar (acende o badge AO VIVO no PPT)
    group.pipe.send({
      type: 'capture_state',
      active: true,
      consumers: 1,
      group_name: group.groupName,
    });
  }

  private onPipeDisconnected(group: Group): void {
    try {
      // A máquina ativa caiu: marca como fora e failover IMEDIATO pra próxima
      // prioridade, sem esperar o timeout de discovery (~12s). Se ela voltar a
      // anunciar, sai de "unhealthy" e reassume no próximo reconcile.
      const fallen = group.activeInstanceId;
      if (!fallen) return;
      this.unhealthy.add(fallen);
      logger.info(
        LogOrigin.Server,
        `🎛️  PowerPoint MultiSource - conexão caiu no grupo "${group.groupName}" → failover imediato`,
      );
      this.reconcile();
      this.pushSnapshot();
    } catch (error) {
      logger.error(
        LogOrigin.Server,
        `PowerPoint MultiSource - erro no failover: ${error instanceof Error ? error.message : 'desconhecido'}`,
      );
    }
  }

  private syncCloud(group: Group): void {
    const wantCloud = this.cloudGroups.has(group.groupId);
    if (wantCloud && !group.supabase) {
      try {
        const supa = new PowerPointSupabaseService(null, group.pipe, supabaseAdapter || null);
        const base = getDataProvider().getProjectData()?.projectCode || null;
        supa.setProjectCode(base ? `${base}:${group.groupId}` : group.groupId);
        supa.start();
        // start desabilitado por padrão; liga o envio
        Promise.resolve(supa.toggleEnabled()).catch(() => undefined);
        group.supabase = supa;
        logger.info(LogOrigin.Server, `☁️  PowerPoint MultiSource - nuvem LIGADA p/ grupo "${group.groupName}"`);
      } catch (e) {
        logger.error(
          LogOrigin.Server,
          `PowerPoint MultiSource - erro ao ligar nuvem: ${e instanceof Error ? e.message : 'desconhecido'}`,
        );
      }
    } else if (!wantCloud && group.supabase) {
      // Desligar a nuvem tem que APAGAR a linha do banco, não só parar de
      // enviar — senão o espectador fica preso no último slide. `stopAndClear`
      // apaga pela chave composta (projectCode:groupId) e depois para.
      const supa = group.supabase;
      group.supabase = null;
      Promise.resolve(supa.stopAndClear()).catch(() => undefined);
      logger.info(LogOrigin.Server, `☁️  PowerPoint MultiSource - nuvem DESLIGADA p/ grupo "${group.groupName}" (linha removida)`);
    }
  }

  private teardownGroup(group: Group): void {
    try {
      // Grupo saindo de vez (shutdown, não-consumido, ou sumiu da rede) →
      // apaga a linha da nuvem, não só para. Failover NÃO passa por aqui
      // (reconcile mantém o grupo e troca a instância), então isto não pisca
      // o slide numa troca de máquina — só some quando o grupo realmente vai.
      const supa = group.supabase;
      if (supa) Promise.resolve(supa.stopAndClear()).catch(() => undefined);
    } catch {
      // ignora
    }
    try {
      group.pipe.stop();
    } catch {
      // ignora
    }
  }

  // --- estado p/ frontend ---
  private pushSnapshot(): void {
    const snapshot = this.getSnapshot();
    try {
      socket.sendAsJson({ type: 'powerpoint-groups', payload: snapshot });
      // compat com a UI atual: espelha o primeiro grupo no push legado
      const first = snapshot[0];
      if (first) {
        socket.sendAsJson({
          type: 'powerpoint-status',
          payload: {
            enabled: true,
            currentSlide: first.currentSlide ?? 0,
            slideCount: first.slideCount ?? 0,
          },
        });
      }
    } catch {
      // ignora falhas de socket
    }
  }

  getSnapshot(): GroupSnapshot[] {
    const byGroup = this.groupMembers(this.aliveInstances());
    const result: GroupSnapshot[] = [];
    for (const [groupId, members] of byGroup) {
      const group = this.groups.get(groupId);
      const sorted = [...members].sort(
        (a, b) => a.priority - b.priority || a.instanceId.localeCompare(b.instanceId),
      );
      const activeId = group?.activeInstanceId ?? sorted[0]?.instanceId ?? null;
      const status = group?.pipe.getStatus() ?? null;
      result.push({
        groupId,
        groupName: group?.groupName || sorted[0]?.groupName || groupId,
        consumed: this.isConsumed(groupId),
        cloud: this.cloudGroups.has(groupId),
        connected: group?.pipe.isServiceConnected() ?? false,
        // currentSlide vem 0-based do serviço; exibe 1-based (igual ao mockup)
        currentSlide: status && status.slideCount > 0 ? status.currentSlide + 1 : null,
        slideCount: status ? status.slideCount : null,
        activeInstanceId: activeId,
        instances: sorted.map((m) => ({
          instanceId: m.instanceId,
          machineName: m.machineName,
          priority: m.priority,
          isActive: m.instanceId === activeId,
        })),
      });
    }
    return result.sort((a, b) => a.groupName.localeCompare(b.groupName));
  }

  // --- controles (rotas) ---
  setConsumed(groupId: string, consumed: boolean): void {
    // primeira escolha manual desliga o "consome todos"
    if (this.consumeAll) {
      this.consumeAll = false;
      for (const g of this.groupMembers(this.aliveInstances()).keys()) {
        this.consumedGroups.add(g);
      }
    }
    if (consumed) this.consumedGroups.add(groupId);
    else this.consumedGroups.delete(groupId);
    this.reconcile();
  }

  setCloud(groupId: string, cloud: boolean): void {
    if (cloud) this.cloudGroups.add(groupId);
    else this.cloudGroups.delete(groupId);
    const group = this.groups.get(groupId);
    if (group) this.syncCloud(group);
  }
}

let instance: PowerPointMultiSourceService | null = null;

export function getMultiSourceService(): PowerPointMultiSourceService {
  if (!instance) instance = new PowerPointMultiSourceService();
  return instance;
}
