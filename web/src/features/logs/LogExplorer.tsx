import { useState, useEffect, useRef } from 'react'
import {
    Paper,
    Group,
    Title,
    Select,
    Stack,
    TextInput,
    Badge,
    Text,
    Box,
    Code,
    Tooltip,
    Button,
    Collapse,
    LoadingOverlay,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, Sparkles, ChevronRight, ChevronDown, List } from 'lucide-react'
import type { LogEntry, LogResponse } from '../../types'
import { useTimeRange, TIME_RANGES } from '../../components/TimeRangeSelector'
import { useFilterParam, useFilterParamString } from '../../hooks/useFilterParams'
import { useLiveMode } from '../../contexts/LiveModeContext'
import { GlobalControls } from '../../components/GlobalControls'

const SEVERITY_COLORS: Record<string, string> = {
    ERROR: 'red',
    WARN: 'orange',
    INFO: 'blue',
    DEBUG: 'gray',
    TRACE: 'grape',
    FATAL: 'red',
}

export function LogExplorer() {
    const [selectedService, setSelectedService] = useFilterParam('service', null)
    const [selectedSeverity, setSelectedSeverity] = useFilterParam('severity', null)
    const [searchText, setSearchText] = useFilterParamString('log_q', '')
    const { isLive: liveMode } = useLiveMode()
    const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])

    // Expanded state
    const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set())
    const [contextMap, setContextMap] = useState<Map<number, LogEntry[]>>(new Map())
    const [loadingContext, setLoadingContext] = useState<Set<number>>(new Set())

    const parentRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const liveModeRef = useRef(liveMode)
    const tr = useTimeRange('5m')

    useEffect(() => {
        liveModeRef.current = liveMode
    }, [liveMode])

    const { data: services } = useQuery<string[]>({
        queryKey: ['services'],
        queryFn: () => fetch('/api/metadata/services').then(r => r.json()),
    })

    // Fetch historical logs using selected time range
    const { data: historicalData, isFetching: isFetchingLogs } = useQuery<LogResponse>({
        queryKey: ['logs', selectedService, selectedSeverity, searchText, tr.start, tr.end],
        queryFn: () => {
            const params = new URLSearchParams()
            if (selectedService) params.append('service_name', selectedService)
            if (selectedSeverity) params.append('severity', selectedSeverity)
            if (searchText) params.append('search', searchText)
            params.append('page', '1')
            params.append('page_size', '200')
            params.append('start', tr.start)
            params.append('end', tr.end)
            return fetch(`/api/logs?${params}`).then(r => r.json())
        },
        enabled: !liveMode,
        refetchInterval: 10000,
    })

    // WebSocket live stream
    useEffect(() => {
        if (!liveMode) {
            if (wsRef.current) {
                wsRef.current.close()
                wsRef.current = null
            }
            return
        }

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            return
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
        wsRef.current = ws

        ws.onmessage = (event) => {
            try {
                const batch: LogEntry[] = JSON.parse(event.data)
                setLiveLogs(prev => [...batch, ...prev].slice(0, 2000))
            } catch { }
        }

        ws.onerror = () => { ws.close() }

        ws.onclose = () => {
            wsRef.current = null
            // We do NOT attempt to self-heal liveMode here because it's globally managed now.
            // Reconnection logic is handled centrally in LiveModeContext.
        }

        return () => {
            ws.close()
            wsRef.current = null
        }
    }, [liveMode])

    const displayLogs = liveMode ? liveLogs : (historicalData?.logs || historicalData?.data || [])

    const filteredLogs = displayLogs.filter((log: LogEntry) => {
        if (selectedService && log.service_name !== selectedService) return false
        if (selectedSeverity && log.severity !== selectedSeverity) return false
        if (searchText) {
            const searchLower = searchText.toLowerCase()
            return log.body.toLowerCase().includes(searchLower) || (log.trace_id && log.trace_id.toLowerCase().includes(searchLower))
        }
        return true
    })

    const virtualizer = useVirtualizer({
        count: filteredLogs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 42,
        overscan: 10,
    })

    const toggleExpand = (id: number) => {
        const next = new Set(expandedLogs)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setExpandedLogs(next)
    }

    const loadContext = async (log: LogEntry) => {
        if (contextMap.has(log.id)) return // Already loaded

        setLoadingContext(prev => new Set(prev).add(log.id))
        try {
            const res = await fetch(`/api/logs/context?trace_id=${log.trace_id}&timestamp=${log.timestamp}`)
            const data = await res.json()
            setContextMap(prev => new Map(prev).set(log.id, data))
        } catch (err) {
            console.error(err)
        } finally {
            setLoadingContext(prev => {
                const next = new Set(prev)
                next.delete(log.id)
                return next
            })
        }
    }

    return (
        <Stack gap="md">
            {/* Header */}
            <Group justify="space-between">
                <Group gap="sm">
                    <Title order={3}>Logs</Title>
                    {liveMode ? (
                        <Badge variant="dot" color="green" size="lg">
                            LIVE • {liveLogs.length} logs
                        </Badge>
                    ) : (
                        <Badge variant="light" color="indigo" size="lg">
                            {TIME_RANGES.find(r => r.value === tr.timeRange)?.label || tr.timeRange} • {filteredLogs.length} logs
                        </Badge>
                    )}
                </Group>
                <GlobalControls />
            </Group>

            {/* Filters */}
            <Paper shadow="xs" p="sm" radius="md" withBorder>
                <Group gap="sm">
                    <TextInput
                        placeholder="Search logs..."
                        leftSection={<Search size={14} />}
                        value={searchText}
                        onChange={(e) => setSearchText(e.currentTarget.value)}
                        style={{ flex: 1 }}
                        size="xs"
                    />
                    <Select
                        size="xs"
                        placeholder="Service"
                        data={[{ value: '', label: 'All Services' }, ...(services || []).map(s => ({ value: s, label: s }))]}
                        value={selectedService || ''}
                        onChange={(v) => setSelectedService(v || null)}
                        clearable
                        styles={{ input: { width: 160 } }}
                    />
                    <Select
                        size="xs"
                        placeholder="Severity"
                        data={[
                            { value: '', label: 'All' },
                            { value: 'ERROR', label: 'ERROR' },
                            { value: 'WARN', label: 'WARN' },
                            { value: 'INFO', label: 'INFO' },
                            { value: 'DEBUG', label: 'DEBUG' },
                        ]}
                        value={selectedSeverity || ''}
                        onChange={(v) => setSelectedSeverity(v || null)}
                        clearable
                        styles={{ input: { width: 120 } }}
                    />
                </Group>
            </Paper>

            {/* Log Table */}
            <Paper shadow="xs" radius="md" withBorder style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                <LoadingOverlay visible={isFetchingLogs && !liveMode} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />

                {/* List Header */}                  <Group
                    gap={0}
                    px="sm"
                    py={6}
                    style={{ borderBottom: '1px solid var(--argus-border)', background: '#f8f9fa' }}
                >
                    <Box style={{ width: 30 }} />
                    <Text fw={600} size="xs" c="dimmed" style={{ width: 80 }}>Severity</Text>
                    <Text fw={600} size="xs" c="dimmed" style={{ width: 170 }}>Timestamp</Text>
                    <Text fw={600} size="xs" c="dimmed" style={{ width: 140 }}>Service</Text>
                    <Text fw={600} size="xs" c="dimmed" style={{ flex: 1 }}>Message</Text>
                </Group>

                <div ref={parentRef} style={{ height: 'calc(100vh - 280px)', overflow: 'auto' }}>
                    <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const log = filteredLogs[virtualRow.index]
                            const sevColor = SEVERITY_COLORS[log.severity] || 'gray'
                            const isExpanded = expandedLogs.has(log.id)
                            const context = contextMap.get(log.id)
                            const isLoadingCtx = loadingContext.has(log.id)

                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                        borderBottom: '1px solid #f1f3f5',
                                        background: isExpanded ? '#f8f9fa' : 'transparent',
                                    }}
                                >
                                    <Group
                                        gap={0}
                                        px="sm"
                                        py={6}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => toggleExpand(log.id)}
                                    >
                                        <Box style={{ width: 30 }}>
                                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </Box>
                                        <Box style={{ width: 80 }}>
                                            <Badge size="xs" variant="light" color={sevColor}>{log.severity}</Badge>
                                        </Box>
                                        <Text size="xs" c="dimmed" style={{ width: 170, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                            {new Date(log.timestamp).toLocaleString()}
                                        </Text>
                                        <Text size="xs" fw={500} style={{ width: 140 }} truncate>{log.service_name}</Text>
                                        <Text size="xs" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {log.ai_insight && (
                                                <Tooltip label="AI Insight Available">
                                                    <Sparkles size={12} color="#f59f00" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                                </Tooltip>
                                            )}
                                            {log.body}
                                        </Text>
                                    </Group>

                                    {/* Expanded Details */}
                                    <Collapse in={isExpanded}>
                                        <Box p="md" bg="var(--mantine-color-gray-0)" style={{ borderTop: '1px solid #e9ecef' }}>
                                            <Stack gap="sm">
                                                <Group gap="xs">
                                                    <Text size="sm" fw={600}>Trace ID:</Text>
                                                    <Text size="sm" style={{ flex: 1, fontFamily: 'monospace' }} c="blue">{log.trace_id || 'N/A'}</Text>
                                                </Group>

                                                <Group gap="xs">
                                                    <Text size="sm" fw={600}>Message:</Text>
                                                    <Text size="sm" style={{ flex: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{log.body}</Text>
                                                </Group>

                                                {log.ai_insight && (
                                                    <Paper p="sm" radius="md" bg="yellow.0" withBorder>
                                                        <Group gap="xs" mb={4}>
                                                            <Sparkles size={14} color="#f59f00" />
                                                            <Text size="xs" fw={600} c="orange">AI Insight</Text>
                                                        </Group>
                                                        <Text size="sm">{log.ai_insight}</Text>
                                                    </Paper>
                                                )}

                                                {log.attributes_json && (
                                                    <Box>
                                                        <Text size="xs" fw={600} mb={4}>Attributes</Text>
                                                        <Code block>{JSON.stringify(JSON.parse(log.attributes_json || '{}'), null, 2)}</Code>
                                                    </Box>
                                                )}

                                                <Group>
                                                    <Button
                                                        size="xs"
                                                        variant="light"
                                                        leftSection={<List size={14} />}
                                                        onClick={() => loadContext(log)}
                                                        loading={isLoadingCtx}
                                                        disabled={!!context}
                                                    >
                                                        {context ? 'Context Loaded' : 'Show Context (±1 min)'}
                                                    </Button>
                                                </Group>

                                                {context && (
                                                    <Paper p="sm" radius="md" withBorder bg="white">
                                                        <Text size="xs" fw={600} mb="xs">Context Logs ({context.length})</Text>
                                                        {context.length === 0 ? (
                                                            <Text size="xs" c="dimmed">No context logs found within ±1 minute.</Text>
                                                        ) : (
                                                            <Stack gap={4}>
                                                                {context.map((l) => (
                                                                    <Group key={l.id} gap="xs" py={2} style={{
                                                                        borderBottom: '1px solid #f1f3f5',
                                                                        backgroundColor: l.id === log.id ? '#fff3bf' : 'transparent'
                                                                    }}>
                                                                        <Badge size="xs" color={SEVERITY_COLORS[l.severity] || 'gray'}>{l.severity}</Badge>
                                                                        <Text size="xs" c="dimmed" ff="monospace">{new Date(l.timestamp).toLocaleTimeString()}</Text>
                                                                        <Text size="xs" truncate style={{ flex: 1 }}>{l.body}</Text>
                                                                    </Group>
                                                                ))}
                                                            </Stack>
                                                        )}
                                                    </Paper>
                                                )}
                                            </Stack>
                                        </Box>
                                    </Collapse>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </Paper>
        </Stack>
    )
}
