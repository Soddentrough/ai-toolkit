'use client';

import { useRef, useState } from 'react';
import { Queue } from '@prisma/client';
import { apiClient } from '@/utils/api';
import usePollLoop from '@/hooks/usePollLoop';

type UseQueueListProps = {
  reloadInterval?: number | null;
};

export default function useQueueList({ reloadInterval = 15000 }: UseQueueListProps = {}) {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const isFetchingRef = useRef(false);

  const refreshQueues = () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setStatus('loading');
    return apiClient
      .get('/api/queue')
      .then(res => res.data)
      .then(data => {
        console.log('Queues:', data);
        if (data.error) {
          console.log('Error fetching queues:', data.error);
          setStatus('error');
        } else {
          setQueues(data.queues);
          setStatus('success');
        }
      })
      .catch(error => {
        console.error('Error fetching queues:', error);
        setStatus('error');
      })
      .finally(() => {
        isFetchingRef.current = false;
      });
  };
  usePollLoop(refreshQueues, reloadInterval);

  return { queues, setQueues, status, refreshQueues };
}
