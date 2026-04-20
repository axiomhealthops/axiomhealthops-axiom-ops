// useRealtimeTable.js
//
// Subscribes to Supabase Realtime Postgres Changes for one or more tables.
// When any INSERT, UPDATE, or DELETE fires on those tables, the provided
// onDataChange callback is invoked (typically the page's load/refresh fn).
//
// Usage:
//   useRealtimeTable('auth_tracker', load);          // single table
//   useRealtimeTable(['census_data','auth_tracker'], load);  // multi-table
//
// The hook manages the subscription lifecycle — subscribes on mount,
// removes the channel on unmount.  It also debounces rapid-fire events
// (e.g. a bulk Pariox upload writing 200 rows) so the reload fn only
// fires once per burst instead of 200 times.

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const DEBOUNCE_MS = 800; // Wait 800ms of silence before triggering reload

export function useRealtimeTable(tables, onDataChange) {
  const cbRef = useRef(onDataChange);
  cbRef.current = onDataChange; // always reference latest callback

  useEffect(() => {
    if (!tables || !onDataChange) return;

    const tableList = Array.isArray(tables) ? tables : [tables];
    if (tableList.length === 0) return;

    let debounceTimer = null;
    const debouncedReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        cbRef.current?.();
      }, DEBOUNCE_MS);
    };

    // Build a single channel that listens to all requested tables
    const channelName = `realtime-${tableList.join('-')}-${Date.now()}`;
    let channel = supabase.channel(channelName);

    tableList.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (_payload) => {
          debouncedReload();
        }
      );
    });

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn(`[useRealtimeTable] channel error for ${tableList.join(', ')}`);
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [
    // Re-subscribe when the table list identity changes
    Array.isArray(tables) ? tables.join(',') : tables,
  ]);
}
