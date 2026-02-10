import { useEffect, useState } from 'react';
import { safeGet } from '../services/apiClient';

const defaultStats = [
  { label: 'Total Supply', value: '0', subtext: 'Mint tokens to activate liquidity' },
  { label: 'Active Tokens', value: '0', subtext: 'Awaiting issuance' },
  { label: 'Pending Approvals', value: '0', subtext: 'Real-time Fabric queue' }
];

export default function useDashboardData() {
  const [tokens, setTokens] = useState([]);
  const [mintRequests, setMintRequests] = useState([]);
  const [tokenRequests, setTokenRequests] = useState([]);

  useEffect(() => {
    safeGet('/admin/tokens/all').then(setTokens);
    safeGet('/mint-requests/pending').then(setMintRequests);
    safeGet('/token-requests/pending').then(setTokenRequests);
  }, []);

  const totalSupply = tokens.reduce((acc, token) => acc + (Number(token.total_supply) || 0), 0);
  const stats = [
    { label: 'Total Supply', value: totalSupply.toLocaleString(), subtext: 'Across all tokens' },
    { label: 'Active Tokens', value: tokens.length.toString(), subtext: 'Registered on Fabric' },
    { label: 'Pending Approvals', value: (mintRequests.length + tokenRequests.length).toString(), subtext: 'Mint + token access' }
  ];

  return {
    stats: tokens.length ? stats : defaultStats,
    tokens,
    mintRequests,
    tokenRequests
  };
}

