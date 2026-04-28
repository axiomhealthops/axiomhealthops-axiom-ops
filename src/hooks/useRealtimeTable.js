


Google Chrome

// useRealtimeTable.js
//
// Subscribes to Supabase Realtime Postgres Changes for one or more tables.
// When any INSERT, UPDATE, or DELETE fires on those tables, the provided
// onDataChange callback is invoked (typically the page's load/refresh fn).
//
// IMPORTANT — input-safe refresh:
// If the user is actively typing (any input/textarea/select/[contenteditable]
// is focused), the reload is DEFERRED until they click away (blur). This
// prevents mid-typing data loss that Mary, Carla, and others reported.
// A small "New data available" toast appears so they know fresh data is
// waiting — it auto-applies on blur.
//
// Usage:
//   useRealtimeTable('auth_tracker', load);          // single table
//   useRealtimeTable(['census_data','auth_tracker'], load);  // multi-table
 
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
 
const DEBOUNCE_MS = 800; // Wait 800ms of silence before triggering reload
 
// Lightweight check: is the user mid-edit in any form field?
function isUserEditing() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // Also check if a modal / dialog is open (common pattern in this codebase:
  // fixed-position overlays with z-index >= 1000)
  const modal = document.querySelector('[style*="position: fixed"][style*="z-index"]');
  if (modal && modal.contains(el)) return true;
  return false;
}
 
// Tiny non-intrusive toast — tells the user data is queued, disappears on reload
let toastEl = null;
function showPendingToast() {
  if (toastEl) return; // already showing
  toastEl = document.createElement('div');
  toastEl.textContent = '↻ New data available — will refresh when you finish editing';
  Object.assign(toastEl.style, {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: '9999',
    background: '#1E40AF', color: '#fff', padding: '8px 16px',
    borderRadius: '8px', fontSize: '12px', fontWeight: '600',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)', opacity: '0',
    transition: 'opacity 0.3s', pointerEvents: 'none',
  });
  document.body.appendChild(toastEl);
  requestAnimationFrame(() => { toastEl.style.opacity = '1'; });
}
function hidePendingToast() {
  if (!toastEl) return;
  toastEl.style.opacity = '0';
  setTimeout(() => { toastEl?.remove(); toastEl = null; }, 300);
}
 
export function useRealtimeTable(tables, onDataChange) {
  const cbRef = useRef(onDataChange);
  cbRef.current = onDataChange; // always reference latest callback
 
  useEffect(() => {
    if (!tables || !onDataChange) return;
 
    const tableList = Array.isArray(tables) ? tables : [tables];
    if (tableList.length === 0) return;
 
    let debounceTimer = null;
    let pendingReload = false;      // true = a reload is waiting for blur
    let blurListener = null;
 
    function executeReload() {
      pendingReload = false;
      hidePendingToast();
      cbRef.current?.();
    }
 
    function scheduleReload() {
      // If user is actively editing, defer until they leave the field
      if (isUserEditing()) {
        if (!pendingReload) {
          pendingReload = true;
          showPendingToast();
          // Listen for the user to finish editing (blur on any form element)
          blurListener = () => {
            // Small delay so the blur event settles (e.g. clicking from one
            // input to another shouldn't trigger a reload in between)
            setTimeout(() => {
              if (pendingReload && !isUserEditing()) {
                document.removeEventListener('focusout', blurListener);
                blurListener = null;
                executeReload();
              }
            }, 300);
          };
          document.addEventListener('focusout', blurListener);
        }
        return; // Don't reload now
      }
 
      // Not editing — reload immediately
      executeReload();
    }
 
    const debouncedReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scheduleReload, DEBOUNCE_MS);
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
      if (blurListener) document.removeEventListener('focusout', blurListener);
      pendingReload = false;
      hidePendingToast();
      supabase.removeChannel(channel);
    };
  }, [
    // Re-subscribe when the table list identity changes
    Array.isArray(tables) ? tables.join(',') : tables,
  ]);
}
 
