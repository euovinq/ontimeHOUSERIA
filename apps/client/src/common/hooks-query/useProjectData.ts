import { useMutation, useQuery } from '@tanstack/react-query';

import { queryRefetchIntervalSlow } from '../../ontimeConfig';
import { PROJECT_DATA } from '../api/constants';
import { getProjectData, postProjectData } from '../api/project';
import { logAxiosError } from '../api/utils';
import { projectDataPlaceholder } from '../models/ProjectData';
import { ontimeQueryClient } from '../queryClient';

export default function useProjectData() {
  const { data, status, isFetching, isError, refetch } = useQuery({
    queryKey: PROJECT_DATA,
    queryFn: getProjectData,
    placeholderData: (previousData, _previousQuery) => previousData,
    retry: 5,
    retryDelay: (attempt) => attempt * 2500,
    refetchInterval: queryRefetchIntervalSlow,
    networkMode: 'always',
  });

  return { data: data ?? projectDataPlaceholder, status, isFetching, isError, refetch };
}

export function useProjectDataMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: postProjectData,
    onError: (error) => logAxiosError('Error saving project data', error),
    onSuccess: (data) => {
      // O servidor devolve o projeto já atualizado; gravar no cache evita um
      // GET completo extra a cada save (o invalidate anterior forçava refetch).
      ontimeQueryClient.setQueryData(PROJECT_DATA, data.data);
    },
  });
  return { isPending, mutateAsync };
}
