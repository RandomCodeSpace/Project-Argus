import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
    Paper,
    Group,
    Title,
    Stack,
    Text,
    Badge,
    TextInput,
    Table,
    Pagination,
    Box,
    Tooltip,
    LoadingOverlay,
    Collapse,
    Button,
    Code,
    Select,
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
    const { ref: containerRef, height: containerHeight } = useElementSize()
    const [pageSize, setPageSize] = useState(25)
    const [debouncedPageSize] = useDebouncedValue(pageSize, 1000)
    const lastHeightRef = useRef(0)

    const [page, setPage] = useState(1)
    const [selectedService] = useFilterParam('service', null)
    const [selectedSeverity, setSelectedSeverity] = useFilterParam('severity', null)
    const [searchText, setSearchText] = useFilterParamString('log_q', '')
    const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set())
    const [contextMap, setContextMap] = useState<Map<number, LogEntry[]>>(new Map())
    const [loadingContext, setLoadingContext] = useState<Set<number>>(new Set())

    const tr = useTimeRange('5m')

    // Reset pagination when service filter changes
    useEffect(() => {
        setPage(1)
    }, [selectedService])

    // Stabilized dynamic page size calculation
    useEffect(() => {
        if (containerHeight > 0) {
            if (Math.abs(containerHeight - lastHeightRef.current) > 20) {
                const headerHeight = 40
                const rowHeight = 42
                const calculatedSize = Math.max(10, Math.floor((containerHeight - headerHeight) / rowHeight))
                if (calculatedSize !== pageSize) {
                    setPageSize(calculatedSize)
                    lastHeightRef.current = containerHeight
                }
            }
        }
    }, [containerHeight, pageSize])

    // Historical Data Fetching
    const { data: historicalData, isFetching: isFetchingLogs } = useQuery<LogResponse>({
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
            const res = await fetch(`/api/logs?${params.toString()}`)
            return res.json()
        },
        staleTime: 30000,
        refetchOnWindowFocus: false,
    })

    const displayLogs = useMemo(() => {
        return (historicalData?.logs || historicalData?.data || [])
    }, [historicalData])

    const totalCount = (historicalData?.total || 0)
    const totalPages = Math.ceil(totalCount / Math.max(1, debouncedPageSize))

    const toggleExpand = useCallback((id: number) => {
        setExpandedLogs(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

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

    const table = useReactTable({
        data: displayLogs,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    const rows = table.getRowModel().rows

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => 42,
        overscan: 10,
    })

    return (
        <Stack gap="md" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between" px="xs">
                <Group gap="sm">
                    <Title order={3}>Logs</Title>
                    <Badge variant="light" color="indigo" size="lg">
                        {TIME_RANGES.find(r => r.value === tr.timeRange)?.label || tr.timeRange} • {totalCount} total
                    </Badge>
                </Group>
                <GlobalControls />
            </Group>

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

            <Paper shadow="xs" radius="md" withBorder mx="xs" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                <LoadingOverlay visible={isFetchingLogs} zIndex={100} overlayProps={{ radius: 'sm', blur: 1 }} />

                <Box bg="var(--mantine-color-gray-0)" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            {table.getHeaderGroups().map(headerGroup => (
                                <Table.Tr key={headerGroup.id} style={{ display: 'flex' }}>
                                    {headerGroup.headers.map(header => {
                                        const isBody = header.column.id === 'body'
                                        return (
                                            <Table.Th
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
                                            </Table.Th>
                                        )
                                    })}
                                </Table.Tr>
                            ))}
                        </Table.Thead>
                    </Table>
                </Box>

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

                <Box p="xs" bg="var(--mantine-color-gray-0)" style={{ borderTop: '1px solid var(--mantine-color-gray-2)', height: 48, display: 'flex', alignItems: 'center' }}>
                    <Group justify="center" px="md" style={{ flex: 1 }}>
                        {totalPages > 1 && (
                            <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
                        )}
                    </Group>
                </Box>
            </Paper>
        </Stack>
    )
}
