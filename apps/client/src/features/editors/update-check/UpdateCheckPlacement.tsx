import { useUpdateCheckStore } from '../../../common/stores/updateCheckStore';

import UpdateCheckModal from './UpdateCheckModal';

export default function UpdateCheckPlacement() {
  const isOpen = useUpdateCheckStore((state) => state.isOpen);

  if (!isOpen) {
    return null;
  }

  return <UpdateCheckModal />;
}
