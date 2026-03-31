import React, { useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS, METRICS } from '../../lib/constants';

const COORDINATOR_REGIONS = {
  'Gypsy Renos': ['A'],
  'Mary Imperio': ['B', 'C', 'G'],
  'Audrey Sarmiento': ['H', 'J', 'M', 'N'],
  'April Manalo': ['T', 'V'],
};

export default function RegionsPage() {
  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);
  const census = useMemo(() => {
