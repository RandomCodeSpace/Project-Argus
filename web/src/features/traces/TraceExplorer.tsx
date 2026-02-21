import React, { useState, useEffect, useMemo, useRef } from 'react'
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
} from '@mantine/core'
import { useElementSize, useDebouncedValue } from '@mantine/hooks'
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    createColumnHelper,
} from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Search, Clock, ChevronRight, ChevronDown } from 'lucide-react'
import type { TraceResponse, Trace, Span } from '../../types'
import { useTimeRange } from '../../components/TimeRangeSelector'
import { useFilterParam, useFilterParamString } from '../../hooks/useFilterParams'
import { GlobalControls } from '../../components/GlobalControls'

const STATUS_COLORS: Record<string, string> = {
    OK: 'green',
    ERROR: 'red',
    UNSET: 'gray',
}

const columnHelper = createColumnHelper<Trace>()

export function TraceExplorer() {
    const { ref: containerRef, height: containerHeight } = useElementSize()
    const [pageSize, setPageSize] = useState(25)
    const [debouncedPageSize] = useDebouncedValue(pageSize, 1000)
    const lastHeightRef = useRef(0)

    const [page, setPage] = useState(1)
    const [search, setSearch] = useFilterParamString('trace_q', '')
    const [selectedService] = useFilterParam('service', null)
    const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set())

    const tr = useTimeRange('5m')

    // Reset pagination when filter changes
    useEffect(() => {
        setPage(1)
    }, [selectedService])

    // Calculate dynamic page size based on available height (Stabilized)
    useEffect(() => {
        if (containerHeight > 0) {
            // Only recalculate if height changed significantly (> 20px)
            // This prevents sub-pixel jitter or LoadingOverlay shifts from triggering a loop
            if (Math.abs(containerHeight - lastHeightRef.current) > 20) {
                const headerHeight = 40
                const rowHeight = 40
                const calculatedSize = Math.max(10, Math.floor((containerHeight - headerHeight) / rowHeight))
                if (calculatedSize !== pageSize) {
                    setPageSize(calculatedSize)
                    lastHeightRef.current = containerHeight
                }
            }
        }
    }, [containerHeight, pageSize])



    const tracesQueryKey = ['traces', page, search, selectedService, tr.start, tr.end, debouncedPageSize]

    // Traces data
    const { data, isLoading, isFetching } = useQuery<TraceResponse>({
        queryKey: tracesQueryKey,
        queryFn: () => {
            const params = new URLSearchParams()
            params.append('limit', String(debouncedPageSize))
            params.append('offset', String((page - 1) * debouncedPageSize))
            if (search) params.append('search', search)
            if (selectedService) params.append('service_name', selectedService)
            params.append('start', tr.start)
            params.append('end', tr.end)
            return fetch(`/api/traces?${params}`).then(r => r.json())
        },
        staleTime: 30000, // Keep data fresh for 30s
        refetchOnWindowFocus: false, // Core requirement: No background noise
    })

    const traces = data?.traces || []
    const totalPages = Math.ceil((data?.total || 0) / debouncedPageSize)

    const toggleTrace = (id: number) => {
        const next = new Set(expandedTraces)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setExpandedTraces(next)
    }

    const navigateToLogs = (traceId: string, timestamp: string) => {
        const date = new Date(timestamp)
        const start = new Date(date.getTime() - 60 * 60 * 1000).toISOString()
        const end = new Date(date.getTime() + 60 * 60 * 1000).toISOString()

        const params = new URLSearchParams(window.location.search)
        params.set('log_q', traceId)
        params.set('page', 'logs')
        params.delete('range')
        params.set('from', start)
        params.set('to', end)

        const url = `${window.location.pathname}?${params.toString()}`
        window.history.replaceState(null, '', url)
        window.dispatchEvent(new Event('argus:urlchange'))
    }

    const columns = useMemo(() => [
        columnHelper.display({
            id: 'expander',
            header: () => null,
            cell: ({ row }) => (
                <Box
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                        e.stopPropagation()
                        toggleTrace(row.original.id)
                    }}
                >
                    {expandedTraces.has(row.original.id) ? (
                        <ChevronDown size={14} color="var(--mantine-color-dimmed)" />
                    ) : (
                        <ChevronRight size={14} color="var(--mantine-color-dimmed)" />
                    )}
                </Box>
            ),
            size: 40,
        }),
        columnHelper.accessor('trace_id', {
            header: 'Trace ID',
            cell: (info) => (
                <Tooltip label="Click to view logs for this trace">
                    <Text
                        size="xs"
                        ff="var(--font-mono)"
                        style={{ fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                        component="span"
                        c="blue"
                        onClick={() => navigateToLogs(info.getValue(), info.row.original.timestamp)}
                    >
                        {info.getValue()?.substring(0, 16)}...
                    </Text>
                </Tooltip>
            ),
        }),
        columnHelper.accessor('service_name', {
            header: 'Service',
            cell: (info) => <Text size="sm" fw={500}>{info.getValue()}</Text>,
        }),
        columnHelper.accessor('operation', {
            header: 'Operation',
            cell: (info) => <Text size="sm">{info.getValue() || '—'}</Text>,
        }),
        columnHelper.accessor('duration_ms', {
            header: 'Duration',
            cell: (info) => (
                <Group gap={4}>
                    <Clock size={12} color="#868e96" />
                    <Text size="sm">{info.getValue() !== undefined ? info.getValue().toFixed(1) : '0.0'}ms</Text>
                </Group>
            ),
        }),
        columnHelper.accessor('status', {
            header: 'Status',
            cell: (info) => (
                <Badge size="xs" color={STATUS_COLORS[info.getValue()] || 'gray'}>
                    {info.getValue() || 'UNSET'}
                </Badge>
            ),
        }),
        columnHelper.accessor('span_count', {
            header: 'Spans',
            cell: (info) => <Badge size="xs" variant="light">{info.getValue() ?? 0}</Badge>,
        }),
        columnHelper.accessor('timestamp', {
            header: 'Timestamp',
            cell: (info) => <Text size="xs" c="dimmed">{new Date(info.getValue()).toLocaleString()}</Text>,
        }),
    ], [expandedTraces])

    const table = useReactTable({
        data: traces,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    return (
        <Stack gap="md" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between">
                <Group gap="sm">
                    <Title order={3}>Traces</Title>
                    <Badge variant="light" color="indigo">{data?.total ?? 0} total</Badge>
                </Group>
                <GlobalControls />
            </Group>

            <Paper shadow="xs" p="sm" radius="md" withBorder>
                <Group gap="sm">
                    <TextInput
                        placeholder="Search traces..."
                        size="xs"
                        leftSection={<Search size={14} />}
                        value={search}
                        onChange={(e) => { setSearch(e.currentTarget.value); setPage(1) }}
                        styles={{ input: { width: 200 } }}
                    />
                </Group>
            </Paper>

            <Paper shadow="xs" radius="md" withBorder style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                <LoadingOverlay visible={isFetching} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />

                <Box ref={containerRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            {table.getHeaderGroups().map(headerGroup => (
                                <Table.Tr key={headerGroup.id}>
                                    {headerGroup.headers.map(header => (
                                        <Table.Th key={header.id} style={{ width: header.getSize() }}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </Table.Th>
                                    ))}
                                </Table.Tr>
                            ))}
                        </Table.Thead>
                        <Table.Tbody>
                            {isLoading ? (
                                <Table.Tr>
                                    <Table.Td colSpan={columns.length}>
                                        <Text c="dimmed" ta="center" py="md">Loading traces...</Text>
                                    </Table.Td>
                                </Table.Tr>
                            ) : traces.length === 0 ? (
                                <Table.Tr>
                                    <Table.Td colSpan={columns.length}>
                                        <Text c="dimmed" ta="center" py="md">No traces found</Text>
                                    </Table.Td>
                                </Table.Tr>
                            ) : table.getRowModel().rows.map(row => (
                                <React.Fragment key={row.id}>
                                    <Table.Tr>
                                        {row.getVisibleCells().map(cell => (
                                            <Table.Td key={cell.id}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </Table.Td>
                                        ))}
                                    </Table.Tr>
                                    {expandedTraces.has(row.original.id) && (
                                        <Table.Tr>
                                            <Table.Td colSpan={columns.length} p={0}>
                                                <Box p="md" bg="var(--mantine-color-gray-0)" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
                                                    <Group justify="space-between" mb="xs">
                                                        <Title order={6}>Spans ({row.original.spans?.length || 0})</Title>
                                                        <Badge variant="outline" size="xs">{row.original.trace_id}</Badge>
                                                    </Group>
                                                    <Table striped highlightOnHover withTableBorder>
                                                        <Table.Thead>
                                                            <Table.Tr>
                                                                <Table.Th>Span ID</Table.Th>
                                                                <Table.Th>Operation</Table.Th>
                                                                <Table.Th>Duration</Table.Th>
                                                                <Table.Th>Status</Table.Th>
                                                                <Table.Th>Start Time</Table.Th>
                                                            </Table.Tr>
                                                        </Table.Thead>
                                                        <Table.Tbody>
                                                            {(row.original.spans || []).map((span: Span) => (
                                                                <Table.Tr key={span.id}>
                                                                    <Table.Td><Text size="xs" ff="monospace">{span.span_id.substring(0, 8)}</Text></Table.Td>
                                                                    <Table.Td>{span.operation_name}</Table.Td>
                                                                    <Table.Td>{(span.duration / 1000).toFixed(2)}ms</Table.Td>
                                                                    <Table.Td>
                                                                        <Badge size="xs" color={STATUS_COLORS[span.status] || 'gray'}>
                                                                            {span.status}
                                                                        </Badge>
                                                                    </Table.Td>
                                                                    <Table.Td>{new Date(span.start_time).toLocaleTimeString()}</Table.Td>
                                                                </Table.Tr>
                                                            ))}
                                                        </Table.Tbody>
                                                    </Table>
                                                </Box>
                                            </Table.Td>
                                        </Table.Tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Box>

                {/* Footer - Fixed height to keep layout stable */}
                <Box p="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-2)', height: 48, display: 'flex', alignItems: 'center' }}>
                    {totalPages > 1 && (
                        <Group justify="center" style={{ flex: 1 }}>
                            <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
                        </Group>
                    )}
                </Box>
            </Paper>
        </Stack>
    )
}
