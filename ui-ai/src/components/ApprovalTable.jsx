import { useState, useEffect } from 'react';
import client, { safeGet } from '../services/apiClient';
import { io } from 'socket.io-client';

const getStoredRegistrationSnapshot = () => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem('latestRegistrationCredentials');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const ApprovalTable = ({ title, subtitle, fetchUrl, approveUrl, rejectUrl, columns, helper, mapRowToRequest, mapRequestToFields }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState(null);
    const [processingId, setProcessingId] = useState(null);
    const [latestRegistration, setLatestRegistration] = useState(() => getStoredRegistrationSnapshot());

    const fetchData = async () => {
        if (!latestRegistration?.network_address) return;
        setLoading(true);
        try {
            const params = {
                ownerNetworkAddress: latestRegistration.network_address,
            };
            const response = await safeGet(fetchUrl, { params });
            setData(Array.isArray(response) ? response : []);
        } catch (err) {
            console.error("Fetch error", err);
        } finally {
            setLoading(false);
        }
    };

    // Do not auto-fetch; wait for manual Refresh or socket events that intentionally trigger it.
    useEffect(() => {
        setData([]);
    }, [latestRegistration, fetchUrl]);

    // Socket Setup
    useEffect(() => {
        // Connect to the backend socket
        // Ideally this URL comes from an env var like import.meta.env.VITE_API_URL
        // For now, we assume standard localhost:8080 or relative if proxied
        const socketUrl = 'http://localhost:8080';
        console.log('Connecting to Socket.io at', socketUrl);

        const newSocket = io(socketUrl, {
            transports: ['websocket', 'polling']
        });
        setSocket(newSocket);

        newSocket.on('connect', () => {
            console.log('Connected to real-time events');
        });

        newSocket.on('connect_error', (err) => {
            console.error('Socket connection error:', err);
        });

        // Event Listeners
        // No automatic fetches from events; user triggers Refresh manually.
        newSocket.on('CustomerKYCUpdated', (payload) => {
            console.log('Event: CustomerKYCUpdated (manual refresh required)', payload);
        });

        newSocket.on('TokenMinted', () => console.log('Event: TokenMinted (manual refresh required)'));
        newSocket.on('CustomerRegistered', () => console.log('Event: CustomerRegistered (manual refresh required)'));
        newSocket.on('refresh', () => console.log('Event: refresh (manual refresh required)'));

        return () => newSocket.disconnect();
    }, [fetchUrl]);

    const handleAction = async (item, decision) => {
        setProcessingId(item.key || item.msg_id || item.MsgID || item.request_id || item.RequestID);
        try {
            const url = decision === 'approved' ? approveUrl : rejectUrl;
            const finalUrl = url.replace(':requestId', item.msg_id || item.MsgID || item.request_id || item.RequestID || item.request_id);

            const payload = mapRequestToFields ? mapRequestToFields(item, decision, latestRegistration) : {};

            await client.post(finalUrl, payload);
            // We still await fetchData here for immediate feedback, 
            // though the socket event should technically handle it too.
            await fetchData();
        } catch (err) {
            alert("Action failed: " + (err.response?.data?.detail || err.message));
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <div className="glass-panel p-6 border border-white/5 space-y-4">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-xl font-semibold text-white">{title}</h3>
                    <p className="text-sm text-white/50">{subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    {socket && (
                        <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                            <span className={`w-1.5 h-1.5 rounded-full ${socket.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-white/50">
                                {socket.connected ? 'Live' : 'Offline'}
                            </span>
                        </div>
                    )}
                    <button onClick={fetchData} className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1 rounded transition">
                        Refresh
                    </button>
                </div>
            </div>

            {loading && data.length === 0 ? (
                <div className="text-center py-8 text-white/40 animate-pulse">Loading pending requests...</div>
            ) : data.length === 0 ? (
                <div className="text-center py-8 bg-white/5 rounded-xl border border-dashed border-white/10">
                    <p className="text-white/60">No pending requests found</p>
                    <p className="text-xs text-white/40 mt-1">Click Refresh to load or update requests</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/10 text-xs uppercase text-white/40">
                                {columns.map((col, i) => <th key={i} className="pb-3 pl-2 font-medium">{col.header}</th>)}
                                <th className="pb-3 text-right pr-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm text-gray-300">
                            {data.map((item, idx) => (
                                <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition group">
                                    {columns.map((col, cIdx) => (
                                        <td key={cIdx} className="py-3 pl-2">
                                            {col.render ? col.render(item) : item[col.field]}
                                        </td>
                                    ))}
                                    <td className="py-3 text-right pr-2">
                                        <div className="flex justify-end gap-2 opacity-80 group-hover:opacity-100 transition">
                                            <button
                                                onClick={() => handleAction(item, 'rejected')}
                                                disabled={!!processingId}
                                                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-medium disabled:opacity-50"
                                            >
                                                Reject
                                            </button>
                                            <button
                                                onClick={() => handleAction(item, 'approved')}
                                                disabled={!!processingId}
                                                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 text-xs font-medium disabled:opacity-50"
                                            >
                                                {processingId === (item.msg_id || item.MsgID || item.request_id || item.RequestID) ? '...' : 'Approve'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ApprovalTable;
