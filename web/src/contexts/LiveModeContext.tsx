import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFilterParamString } from '../hooks/useFilterParams'
import type { DashboardStats, TrafficPoint, TraceResponse, ServiceMapMetrics } from '../types'

interface LiveSnapshot {
    type: 'live_snapshot'
    dashboard: DashboardStats | null
    traffic: TrafficPoint[] | null
    traces: TraceResponse | null
    service_map: ServiceMapMetrics | null
}

interface LiveModeContextValue {
    isLive: boolean
    isConnected: boolean
    setIsLive: (live: boolean) => void
    serviceFilter: string
    setServiceFilter: (service: string) => void
    refreshTrigger: number
    refresh: () => void
}

const LiveModeContext = createContext<LiveModeContextValue>({
    isLive: true,
    isConnected: false,
    setIsLive: () => { },
    serviceFilter: '',
    setServiceFilter: () => { },
    refreshTrigger: 0,
    refresh: () => { },
})

/**
 * Global live mode provider. Manages a single `/ws/events` WebSocket connection.
 * The backend pushes LiveSnapshot payloads (last 15 min, filtered by selected service)
 * and this provider writes the data directly into the React Query cache.
 *
 * Clients can change the service filter dynamically by sending {"service":"xxx"} over WS.
 */
export function LiveModeProvider({ children }: { children: ReactNode }) {
    const [liveParam, setLiveParam] = useFilterParamString('live', 'true')
    const isLive = liveParam !== 'false'

    const [isConnected, setIsConnected] = useState(false)
    const [serviceFilter, setServiceFilterState] = useState('')
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    const wsRef = useRef<WebSocket | null>(null)
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isLiveRef = useRef(isLive)
    const mountedRef = useRef(true)
    const queryClient = useQueryClient()

    useEffect(() => {
        isLiveRef.current = isLive
    }, [isLive])

    const setIsLive = useCallback((live: boolean) => {
        setLiveParam(live ? 'true' : 'false')
    }, [setLiveParam])

    // Send service filter update over existing WS connection
    const setServiceFilter = useCallback((service: string) => {
        setServiceFilterState(service)
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ service }))
        }
    }, [])

    const handleSnapshot = useCallback((snapshot: LiveSnapshot) => {
        // Write data directly into React Query cache using the "live" query keys.
        // Components use these same keys when isLive is true.

        if (snapshot.dashboard) {
            queryClient.setQueryData(['live', 'dashboardStats'], snapshot.dashboard)
        }

        if (snapshot.traffic) {
            queryClient.setQueryData(['live', 'traffic'], snapshot.traffic)
        }

        if (snapshot.traces) {
            const limitedTraces = {
                ...snapshot.traces,
                traces: snapshot.traces.traces.slice(0, 50),
                total: Math.min(snapshot.traces.total, 50)
            }
            queryClient.setQueryData(['live', 'traces'], limitedTraces)
        }

        if (snapshot.service_map) {
            queryClient.setQueryData(['live', 'serviceMapMetrics'], snapshot.service_map)
        }
    }, [queryClient])

    const cleanup = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current)
            reconnectTimerRef.current = null
        }
        if (wsRef.current) {
            wsRef.current.onclose = null
            wsRef.current.close()
            wsRef.current = null
        }
        setIsConnected(false)
    }, [])

    const connect = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
            return
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`)

        ws.onopen = () => {
            setIsConnected(true)
            // Send current service filter on connect
            setServiceFilterState(prev => {
                if (prev) {
                    ws.send(JSON.stringify({ service: prev }))
                }
                return prev
            })
        }

        ws.onmessage = (event) => {
            try {
                const snapshot: LiveSnapshot = JSON.parse(event.data)
                if (snapshot.type === 'live_snapshot') {
                    handleSnapshot(snapshot)
                }
            } catch {
                // Ignore malformed messages
            }
        }

        ws.onclose = () => {
            setIsConnected(false)
            wsRef.current = null
            if (isLiveRef.current && mountedRef.current) {
                reconnectTimerRef.current = setTimeout(connect, 3000)
            }
        }

        ws.onerror = () => {
            ws.close()
        }

        wsRef.current = ws
    }, [handleSnapshot])

    useEffect(() => {
        mountedRef.current = true

        if (isLive) {
            connect()
        } else {
            cleanup()
        }

        return () => {
            mountedRef.current = false
            cleanup()
        }
    }, [isLive, connect, cleanup])

    return (
        <LiveModeContext.Provider value={{
            isLive,
            isConnected,
            setIsLive,
            serviceFilter,
            setServiceFilter,
            refreshTrigger,
            refresh: () => setRefreshTrigger(prev => prev + 1)
        }}>
            {children}
        </LiveModeContext.Provider>
    )
}

export function useLiveMode() {
    return useContext(LiveModeContext)
}
