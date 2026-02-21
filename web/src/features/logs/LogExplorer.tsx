import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
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
    Pagination,
    Table as MantineTable,
} from '@mantine/core'
import { useElementSize, useDebouncedValue } from '@mantine/hooks'
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    createColumnHelper,
} from '@tanstack/react-table'
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

const columnHelper = createColumnHelper<LogEntry>()

const safeJsonParse = (json: string | null | undefined) => {
    if (!json) return {}
    try {
        return JSON.parse(json)
    } catch (e) {
        return { error: 'Invalid JSON data', raw: json }
    }
}

export function LogExplorer() {
    // 1. Viewport & Sizing (Stabilized)
    const { ref: containerRef, height: containerHeight } = useElementSize()
    const [pageSize, setPageSize] = useState(25)
    // Debounce resize updates to 1000ms to prevent jitter and excessive re-fetching
    const [debouncedPageSize] = useDebouncedValue(pageSize, 1000)
    const lastHeightRef = useRef(0)

    const [page, setPage] = useState(1)
    const [selectedService, setSelectedService] = useFilterParam('service', null)
    const [selectedSeverity, setSelectedSeverity] = useFilterParam('severity', null)
    const [searchText, setSearchText] = useFilterParamString('log_q', '')
    const { isLive: liveMode } = useLiveMode()

    // 2. WebSocket Throttling (Optimized)
    const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])
    const liveLogBuffer = useRef<LogEntry[]>([])
    const wsRef = useRef<WebSocket | null>(null)

    // Expanded state
    const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set())
    const [contextMap, setContextMap] = useState<Map<number, LogEntry[]>>(new Map())
    const [loadingContext, setLoadingContext] = useState<Set<number>>(new Set())

    const tr = useTimeRange('5m')

    // Reset page when switching modes
    useEffect(() => {
        setPage(1)
    }, [liveMode])

    // Stabilized dynamic page size calculation
    useEffect(() => {
        if (containerHeight > 0) {
            // Only recalculate if height changed significantly (> 20px)
            if (Math.abs(containerHeight - lastHeightRef.current) > 20) {
                const headerHeight = 40
                const rowHeight = 42
                // Use Math.max/min to keep paging within sane bounds
                const calculatedSize = Math.max(10, Math.floor((containerHeight - headerHeight) / rowHeight))
                if (calculatedSize !== pageSize) {
                    setPageSize(calculatedSize)
                    lastHeightRef.current = containerHeight
                }
            }
        }
    }, [containerHeight, pageSize])

    const { data: services } = useQuery<string[]>({
        queryKey: ['services'],
        queryFn: () => fetch('/api/metadata/services').then(r => r.json()),
        staleTime: 60000, // Services list doesn't change often
        refetchOnWindowFocus: false,
    })

    // 3. Historical Data Fetching (Optimized)
    const { data: historicalData, isFetching: isFetchingLogs } = useQuery<LogResponse>({
        // Include debouncedPageSize in key to prevent intermediate renders during resize
        queryKey: ['logs', selectedService, selectedSeverity, searchText, tr.start, tr.end, page, debouncedPageSize],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (selectedService) params.append('service_name', selectedService)
            if (selectedSeverity) params.append('severity', selectedSeverity)
            if (searchText) params.append('search', searchText)
            params.append('limit', String(debouncedPageSize))
            params.append('offset', String((page - 1) * debouncedPageSize))
            params.append('start', tr.start)
            params.append('end', tr.end)
            const res = await fetch(`/api/logs?${params}`)
            return res.json()
        },
        enabled: !liveMode,
        staleTime: 30000,
        refetchOnWindowFocus: false,
    })

    // 4. WebSocket Manager (Throttled Updates)
    useEffect(() => {
        if (!liveMode) {
            if (wsRef.current) {
                wsRef.current.close()
                wsRef.current = null
            }
            setLiveLogs([])
            liveLogBuffer.current = []
            return
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
        wsRef.current = ws

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                // DEFENSIVE: Batch logs into buffer instead of immediate state update
                if (Array.isArray(data)) {
                    liveLogBuffer.current = [...data, ...liveLogBuffer.current].slice(0, 50)
                }
            } catch (err) {
                console.warn('WS Refreshing: Non-iterable data or heartbeat received')
            }
        }

        // Flush buffer to UI every 500ms to keep it smooth under high load
        const flushInterval = setInterval(() => {
            if (liveLogBuffer.current.length > 0) {
                setLiveLogs([...liveLogBuffer.current])
            }
        }, 500)

        ws.onerror = () => ws.close()
        ws.onclose = () => { wsRef.current = null }

        return () => {
            clearInterval(flushInterval)
            ws.close()
            wsRef.current = null
        }
    }, [liveMode])

    // 5. Intelligent Filtering Logic (Optimized)
    // Only filter on client side for LIVE logs. Historical logs are already server-side filtered.
    const displayLogs = useMemo(() => {
        const rawLogs = liveMode ? liveLogs : (historicalData?.logs || historicalData?.data || [])

        // If not in live mode, trust the server's filtering
        if (!liveMode) return rawLogs

        // If in live mode, filter the live buffer on client side
        if (!searchText && !selectedService && !selectedSeverity) return rawLogs

        const searchLower = searchText.toLowerCase()
        return rawLogs.filter((log: LogEntry) => {
            if (selectedService && log.service_name !== selectedService) return false
            if (selectedSeverity && log.severity !== selectedSeverity) return false
            if (searchText) {
                return log.body.toLowerCase().includes(searchLower) || (log.trace_id && log.trace_id.toLowerCase().includes(searchLower))
            }
            return true
        })
    }, [liveMode, liveLogs, historicalData, selectedService, selectedSeverity, searchText])

    const totalCount = liveMode ? displayLogs.length : (historicalData?.total || 0)
    const totalPages = Math.ceil(totalCount / Math.max(1, debouncedPageSize))

    const toggleExpand = useCallback((id: number) => {
        setExpandedLogs(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

    // 6. Memoized Column Definitions (Static)
    const columns = useMemo(() => [
        columnHelper.display({
            id: 'expander',
            header: () => null,
            cell: ({ row }) => (
                <Box style={{ width: 30, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {expandedLogs.has(row.original.id) ? (
                        <ChevronDown size={14} color="var(--mantine-color-dimmed)" />
                    ) : (
                        <ChevronRight size={14} color="var(--mantine-color-dimmed)" />
                    )}
                </Box>
            ),
            size: 40,
        }),
        columnHelper.accessor('severity', {
            header: 'Severity',
            cell: (info) => (
                <Box style={{ width: 80 }}>
                    <Badge size="xs" variant="light" color={SEVERITY_COLORS[info.getValue()] || 'gray'}>{info.getValue()}</Badge>
                </Box>
            ),
            size: 80,
        }),
        columnHelper.accessor('timestamp', {
            header: 'Timestamp',
            cell: (info) => (
                <Text size="xs" c="dimmed" style={{ width: 170, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {new Date(info.getValue()).toLocaleString()}
                </Text>
            ),
            size: 170,
        }),
        columnHelper.accessor('service_name', {
            header: 'Service',
            cell: (info) => <Text size="xs" fw={500} style={{ width: 140 }} truncate>{info.getValue()}</Text>,
            size: 140,
        }),
        columnHelper.accessor('body', {
            header: 'Message',
            id: 'body',
            cell: (info) => (
                <Text size="xs" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {info.row.original.ai_insight && (
                        <Tooltip label="AI Insight Available">
                            <Sparkles size={12} color="var(--mantine-color-yellow-6)" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        </Tooltip>
                    )}
                    {info.getValue()}
                </Text>
            ),
            size: 400,
        }),
    ], [expandedLogs])

    // 6. Logic for Live Mode (Full Scroll, No Pagination)
    const paginatedLogs = useMemo(() => {
        if (!liveMode) {
            const start = (page - 1) * debouncedPageSize
            return displayLogs.slice(start, start + debouncedPageSize)
        }
        // In Live Mode, show full buffer (max 50) for "full scroll" feel
        return displayLogs
    }, [liveMode, displayLogs, page, debouncedPageSize])

    const table = useReactTable({
        data: paginatedLogs,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    const rows = table.getRowModel().rows

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => 42,
        overscan: 15, // Increased overscan for smoother high-speed scrolling
    })

    const loadContext = async (log: LogEntry) => {
        if (contextMap.has(log.id)) return
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
        <Stack gap="md" style={{ height: '100%', overflow: 'hidden' }}>
            {/* Page Header */}
            <Group justify="space-between" px="xs">
                <Group gap="sm">
                    <Title order={3}>Logs</Title>
                    {!liveMode && (
                        <Badge variant="light" color="indigo" size="lg">
                            {TIME_RANGES.find(r => r.value === tr.timeRange)?.label || tr.timeRange} • {totalCount} total
                        </Badge>
                    )}
                </Group>
                <GlobalControls />
            </Group>

            {/* Persistence Layer / Filters */}
            <Paper shadow="xs" p="sm" radius="md" withBorder mx="xs">
                <Group gap="sm">
                    <TextInput
                        placeholder="Search logs..."
                        leftSection={<Search size={14} />}
                        value={searchText}
                        onChange={(e) => { setSearchText(e.currentTarget.value); setPage(1) }}
                        style={{ flex: 1 }}
                        size="xs"
                    />
                    <Select
                        size="xs"
                        placeholder="Service"
                        data={[{ value: '', label: 'All Services' }, ...(services || []).map(s => ({ value: s, label: s }))]}
                        value={selectedService || ''}
                        onChange={(v) => { setSelectedService(v || null); setPage(1) }}
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
                        onChange={(v) => { setSelectedSeverity(v || null); setPage(1) }}
                        clearable
                        styles={{ input: { width: 120 } }}
                    />
                </Group>
            </Paper>

            {/* Data Layer / Log Table */}
            <Paper shadow="xs" radius="md" withBorder mx="xs" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                <LoadingOverlay visible={isFetchingLogs && !liveMode} zIndex={100} overlayProps={{ radius: 'sm', blur: 1 }} />

                {/* Fixed Header */}
                <Box bg="var(--mantine-color-gray-0)" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
                    <MantineTable striped highlightOnHover withTableBorder={false}>
                        <MantineTable.Thead>
                            {table.getHeaderGroups().map(headerGroup => (
                                <MantineTable.Tr key={headerGroup.id} style={{ display: 'flex' }}>
                                    {headerGroup.headers.map(header => {
                                        const isBody = header.column.id === 'body'
                                        return (
                                            <MantineTable.Th
                                                key={header.id}
                                                style={{
                                                    width: isBody ? undefined : header.getSize(),
                                                    flex: isBody ? 1 : undefined,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    border: 'none',
                                                    paddingTop: 8,
                                                    paddingBottom: 8,
                                                }}
                                            >
                                                <Text fw={700} size="xs" c="dimmed">
                                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                                </Text>
                                            </MantineTable.Th>
                                        )
                                    })}
                                </MantineTable.Tr>
                            ))}
                        </MantineTable.Thead>
                    </MantineTable>
                </Box>

                {/* Virtualized Scroll Area */}
                <div
                    ref={containerRef}
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        position: 'relative',
                        minHeight: 0
                    }}
                >
                    <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const row = rows[virtualRow.index]
                            if (!row) return null
                            const log = row.original
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
                                        borderBottom: '1px solid var(--mantine-color-gray-2)',
                                        background: isExpanded ? 'var(--mantine-color-blue-0)' : 'transparent',
                                    }}
                                >
                                    <Group
                                        gap={0}
                                        px="sm"
                                        py={8}
                                        style={{ cursor: 'pointer', flexWrap: 'nowrap' }}
                                        onClick={() => toggleExpand(log.id)}
                                    >
                                        {row.getVisibleCells().map(cell => {
                                            const isBody = cell.column.id === 'body'
                                            return (
                                                <Box key={cell.id} style={{
                                                    width: isBody ? undefined : cell.column.getSize(),
                                                    flex: isBody ? 1 : undefined,
                                                    overflow: 'hidden'
                                                }}>
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </Box>
                                            )
                                        })}
                                    </Group>

                                    {/* Expansion Section */}
                                    <Collapse in={isExpanded}>
                                        <Box p="md" bg="var(--mantine-color-gray-0)" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
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
                                                            <Sparkles size={14} color="var(--mantine-color-yellow-6)" />
                                                            <Text size="xs" fw={700} c="orange.8">AI Insight</Text>
                                                        </Group>
                                                        <Text size="sm">{log.ai_insight}</Text>
                                                    </Paper>
                                                )}

                                                {log.attributes_json && (
                                                    <Box>
                                                        <Text size="xs" fw={700} mb={4} c="dimmed">ATTRIBUTES</Text>
                                                        <Code block>{JSON.stringify(safeJsonParse(log.attributes_json), null, 2)}</Code>
                                                    </Box>
                                                )}

                                                <Group>
                                                    <Button
                                                        size="xs"
                                                        variant="light"
                                                        leftSection={<List size={14} />}
                                                        onClick={(e) => { e.stopPropagation(); loadContext(log) }}
                                                        loading={isLoadingCtx}
                                                        disabled={!!context}
                                                    >
                                                        {context ? 'Context Loaded' : 'Show Context (±1 min)'}
                                                    </Button>
                                                </Group>

                                                {context && (
                                                    <Box>
                                                        <Text size="xs" fw={700} mb="xs" c="dimmed">CONTEXT LOGS ({context.length})</Text>
                                                        {context.length === 0 ? (
                                                            <Text size="xs" c="dimmed">No context logs found within ±1 minute.</Text>
                                                        ) : (
                                                            <Paper p="xs" radius="sm" bg="gray.9" withBorder style={{ maxHeight: 400, overflow: 'auto' }}>
                                                                <Stack gap={2} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                                                                    {context.map((l) => (
                                                                        <Box
                                                                            key={l.id}
                                                                            style={{
                                                                                color: l.id === log.id ? 'var(--mantine-color-yellow-4)' : 'var(--mantine-color-gray-3)',
                                                                                backgroundColor: l.id === log.id ? 'rgba(255, 255, 0, 0.1)' : 'transparent',
                                                                                padding: '2px 4px',
                                                                                borderRadius: '2px'
                                                                            }}
                                                                        >
                                                                            <span style={{ color: SEVERITY_COLORS[l.severity] ? `var(--mantine-color-${SEVERITY_COLORS[l.severity]}-5)` : 'inherit', fontWeight: 700 }}>
                                                                                [{l.severity.padEnd(5)}]
                                                                            </span>{' '}
                                                                            <span style={{ color: 'var(--mantine-color-dimmed)' }}>
                                                                                {new Date(l.timestamp).toLocaleTimeString()}
                                                                            </span>{' '}
                                                                            {l.body}
                                                                        </Box>
                                                                    ))}
                                                                </Stack>
                                                            </Paper>
                                                        )}
                                                    </Box>
                                                )}
                                            </Stack>
                                        </Box>
                                    </Collapse>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Unified Footer - Locked height for stability */}
                <Box p="xs" bg="var(--mantine-color-gray-0)" style={{ borderTop: '1px solid var(--mantine-color-gray-2)', height: 48, display: 'flex', alignItems: 'center' }}>
                    <Group justify="space-between" px="md" style={{ flex: 1 }}>
                        <Box style={{ flex: 1 }}>
                            {liveMode && (
                                <Group gap="xs">
                                    <Text size="xs" fw={500} c="dimmed">Live Buffer: {liveLogs.length}/50 logs</Text>
                                    <Badge variant="dot" color="green" size="sm">RECEIVING DATA</Badge>
                                </Group>
                            )}
                        </Box>

                        {!liveMode && totalPages > 1 && (
                            <Group justify="center" style={{ flex: 2 }}>
                                <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
                            </Group>
                        )}

                        <Box style={{ flex: 1 }} />
                    </Group>
                </Box>
            </Paper>
        </Stack>
    )
}
