import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useLiveMode } from '../contexts/LiveModeContext'
import { useTimeRange } from '../components/TimeRangeSelector'

interface ArgusQueryOptions {
    queryKey: any[]
    path: string
    params?: Record<string, string | number | boolean | null | undefined>
    liveKey?: string // Key in the React Query cache mapped by LiveModeContext
    enabled?: boolean
    refetchInterval?: number | false
}

/**
 * useArgusQuery abstracts the complexity of switching between
 * Historical (API) and Live (WebSocket Cache) data.
 * 
 * It automatically injects time range params for historical queries
 * and switches to the live cache when Live Mode is active.
 */
export function useArgusQuery<T>({
    queryKey,
    path,
    params = {},
    liveKey,
    enabled = true,
    refetchInterval = 30000,
}: ArgusQueryOptions): UseQueryResult<T, Error> {
    const { isLive, serviceFilter } = useLiveMode()
    const tr = useTimeRange('15m')

    // 1. Construct Final Query Key
    const finalQueryKey = isLive && liveKey
        ? ['live', liveKey] // Live mode uses standardized cache keys
        : [...queryKey, tr.start, tr.end, serviceFilter]

    // 2. Fetcher Function (only used for historical data)
    const fetcher = async () => {
        const urlParams = new URLSearchParams()

        // Add time range
        urlParams.append('start', tr.start)
        urlParams.append('end', tr.end)

        // Add service filter
        if (serviceFilter) {
            urlParams.append('service_name', serviceFilter)
        }

        // Add additional params
        Object.entries(params).forEach(([key, val]) => {
            if (val !== undefined && val !== null) {
                urlParams.append(key, String(val))
            }
        })

        const response = await fetch(`${path}?${urlParams.toString()}`)
        if (!response.ok) {
            throw new Error(`Argus API Error: ${response.statusText}`)
        }
        return response.json()
    }

    // 3. The React Query execution
    return useQuery<T, Error>({
        queryKey: finalQueryKey,
        queryFn: fetcher,
        // In Live Mode, we don't refetch from API; we wait for cache updates from WS.
        // UNLESS there is no liveKey, in which case we fall back to polling.
        enabled: enabled && (isLive ? !liveKey : true),
        refetchInterval: isLive ? (liveKey ? false : 10000) : refetchInterval,
        staleTime: isLive ? Infinity : 30000,
        refetchOnWindowFocus: false,
    })
}
