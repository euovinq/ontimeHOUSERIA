import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Box, Flex, HStack, Spinner, Switch, Text, VStack } from '@chakra-ui/react';

import { fetchPowerPointGroups, PowerPointGroup, setPowerPointGroupCloud } from '../../../common/api/powerpoint';

const POLL_MS = 2500;

function InstanceRow({ instance }: { instance: PowerPointGroup['instances'][number] }) {
  const active = instance.isActive;
  return (
    <HStack
      justify='space-between'
      px={3}
      py={2}
      borderRadius='6px'
      bg={active ? 'green.900' : 'transparent'}
      spacing={3}
    >
      <HStack spacing={2} minW={0}>
        <Box w='8px' h='8px' borderRadius='50%' bg={active ? 'green.400' : 'gray.500'} flex='none' />
        <Text fontSize='sm' color={active ? 'green.200' : 'gray.300'} noOfLines={1}>
          {instance.machineName}
        </Text>
      </HStack>
      <HStack spacing={2} flex='none'>
        <Badge colorScheme={active ? 'green' : 'gray'} fontSize='0.65rem'>
          P{instance.priority}
        </Badge>
        <Text fontSize='xs' color={active ? 'green.300' : 'gray.500'}>
          {active ? 'AO VIVO' : instance.priority === 1 ? 'principal' : 'backup'}
        </Text>
      </HStack>
    </HStack>
  );
}

function GroupCard({ group, onToggleCloud }: { group: PowerPointGroup; onToggleCloud: (g: PowerPointGroup, v: boolean) => void }) {
  return (
    <Box borderRadius='10px' border='1px solid' borderColor='gray.600' bg='gray.800' p={3}>
      <Flex justify='space-between' align='center' mb={1}>
        <HStack spacing={2} minW={0}>
          <Box w='9px' h='9px' borderRadius='50%' bg='purple.400' flex='none' />
          <Text fontWeight='bold' color='white' noOfLines={1}>
            {group.groupName}
          </Text>
          {group.slideCount != null && group.currentSlide != null && (
            <Text fontSize='xs' color='gray.400' flex='none'>
              slide {group.currentSlide} / {group.slideCount}
            </Text>
          )}
        </HStack>
        <HStack spacing={2} flex='none'>
          <Text fontSize='xs' color={group.cloud ? 'blue.300' : 'gray.500'}>
            nuvem
          </Text>
          <Switch
            size='sm'
            isChecked={group.cloud}
            onChange={(e) => onToggleCloud(group, e.target.checked)}
            colorScheme='blue'
          />
        </HStack>
      </Flex>
      <VStack align='stretch' spacing={1} mt={2}>
        {group.instances.map((inst) => (
          <InstanceRow key={inst.instanceId} instance={inst} />
        ))}
      </VStack>
      {!group.connected && (
        <Text fontSize='xs' color='orange.300' mt={2}>
          aguardando conexão da máquina ativa…
        </Text>
      )}
    </Box>
  );
}

export default function PowerPointGroupsPanel() {
  const [groups, setGroups] = useState<PowerPointGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchPowerPointGroups();
      if (mounted.current) {
        setGroups(data);
        setLoading(false);
      }
    } catch {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const timer = setInterval(load, POLL_MS);

    // real-time via socket (quando disponível)
    const onGroups = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && Array.isArray(detail.groups)) {
        setGroups(detail.groups);
        setLoading(false);
      }
    };
    window.addEventListener('powerpoint-groups', onGroups as EventListener);

    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('powerpoint-groups', onGroups as EventListener);
    };
  }, [load]);

  const handleToggleCloud = useCallback(async (group: PowerPointGroup, value: boolean) => {
    // otimista
    setGroups((prev) => prev.map((g) => (g.groupId === group.groupId ? { ...g, cloud: value } : g)));
    try {
      const updated = await setPowerPointGroupCloud(group.groupId, value);
      if (updated.length) setGroups(updated);
    } catch {
      // reverte em caso de erro
      setGroups((prev) => prev.map((g) => (g.groupId === group.groupId ? { ...g, cloud: !value } : g)));
    }
  }, []);

  if (loading) {
    return (
      <HStack justify='center' py={6}>
        <Spinner size='sm' color='gray.400' />
        <Text fontSize='sm' color='gray.400'>
          Procurando fontes PowerPoint…
        </Text>
      </HStack>
    );
  }

  if (groups.length === 0) {
    return (
      <Box py={6} textAlign='center'>
        <Text fontSize='sm' color='gray.400'>
          Nenhuma fonte PowerPoint na rede.
        </Text>
        <Text fontSize='xs' color='gray.500' mt={1}>
          Abra o houseriaPPT em uma máquina e defina o grupo.
        </Text>
      </Box>
    );
  }

  return (
    <VStack align='stretch' spacing={3}>
      {groups.map((group) => (
        <GroupCard key={group.groupId} group={group} onToggleCloud={handleToggleCloud} />
      ))}
      <Text fontSize='xs' color='gray.500' textAlign='center'>
        A máquina de menor prioridade viva fica no ar; se cair, o backup assume automaticamente.
      </Text>
    </VStack>
  );
}
