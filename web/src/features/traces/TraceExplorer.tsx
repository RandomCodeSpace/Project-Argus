import React, { useState, useEffect } from 'react'
import {
    Paper,
    Group,
    Title,
    Stack,
    Text,
    Badge,
    TextInput,
    Select,
    Table,
    Pagination,
    Box,
    Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Search, Clock } from 'lucide-react'
import type { TraceResponse } from '../../types'
import { TimeRangeSelector, useTimeRange } from '../../components/TimeRangeSelector'
import { useFilterParam, useFilterParamString } from '../../hooks/useFilterParams'
import { useLiveMode } from '../../contexts/LiveModeContext'

const STATUS_COLORS: Record<string, string> = {
    OK: 'green',
    ERROR: 'red',
    UNSET: 'gray',
}

export function TraceExplorer() {
    const [page, setPage] = useState(1)
    const [search, setSearch] = useFilterParamString('trace_q', '')
    const [selectedService, setSelectedService] = useFilterParam('service', null)
    const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set())

    const pageSize = 25
    const tr = useTimeRange('5m')
    const { isLive, isConnected, setServiceFilter } = useLiveMode()

    // Sync local filter param to global live mode filter
    useEffect(() => {
        if (isLive) {
            setServiceFilter(selectedService || '')
        }
    }, [isLive, selectedService, setServiceFilter])

    const { data: services } = useQuery<string[]>({
        queryKey: ['services'],
        queryFn: () => fetch('/api/metadata/services').then(r => r.json()),
    })

    const tracesQueryKey = isLive ? ['live', 'traces'] : ['traces', page, search, selectedService, tr.start, tr.end]

    // Traces data
    const { data, isLoading } = useQuery<TraceResponse>({
        queryKey: tracesQueryKey,
        queryFn: () => {
            const params = new URLSearchParams()
            params.append('limit', String(pageSize))
            params.append('offset', String((page - 1) * pageSize))
            if (search) params.append('search', search)
            if (selectedService) params.append('service_name', selectedService)
            params.append('start', tr.start)
            params.append('end', tr.end)
            return fetch(`/api/traces?${params}`).then(r => r.json())
        },
        refetchInterval: isLive ? false : 15000,
        enabled: !isLive || !!(isLive && tracesQueryKey[0] === 'live'),
    })

    const traces = data?.traces || []
    const totalPages = Math.ceil((data?.total || 0) / pageSize)

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

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Group gap="sm">
                    <Title order={3}>Traces</Title>
                    {isLive ? (
                        <Badge variant="dot" color={isConnected ? 'green' : 'red'} size="lg">
                            {isConnected ? 'LIVE' : 'Reconnecting...'} • {data?.total ?? 0} total
                        </Badge>
                    ) : (
                        <Badge variant="light" color="indigo">{data?.total ?? 0} total</Badge>
                    )}
                </Group>
                {!isLive && (
                    <TimeRangeSelector value={tr.timeRange} onChange={tr.setTimeRange} />
                )}
            </Group>

            <Paper shadow="xs" p="sm" radius="md" withBorder>
                <Group gap="sm">
                    <TextInput
                        placeholder="Search traces..."
                        leftSection={<Search size={14} />}
                        value={search}
                        onChange={(e) => { setSearch(e.currentTarget.value); setPage(1) }}
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
                </Group>
            </Paper>

            <Paper shadow="xs" radius="md" withBorder>
                <Table striped highlightOnHover>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th style={{ width: 40 }}></Table.Th>
                            <Table.Th>Trace ID</Table.Th>
                            <Table.Th>Service</Table.Th>
                            <Table.Th>Operation</Table.Th>
                            <Table.Th>Duration</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Spans</Table.Th>
                            <Table.Th>Timestamp</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {isLoading && !isLive ? (
                            <Table.Tr>
                                <Table.Td colSpan={8}>
                                    <Text c="dimmed" ta="center" py="md">Loading traces...</Text>
                                </Table.Td>
                            </Table.Tr>
                        ) : traces.length === 0 ? (
                            <Table.Tr>
                                <Table.Td colSpan={8}>
                                    <Text c="dimmed" ta="center" py="md">{isLive ? 'Waiting for live data...' : 'No traces found'}</Text>
                                </Table.Td>
                            </Table.Tr>
                        ) : traces.map((trace) => {
                            const isExpanded = expandedTraces.has(trace.id)
                            return (
                                <React.Fragment key={trace.id}>
                                    <Table.Tr>
                                        <Table.Td style={{ cursor: 'pointer' }} onClick={() => toggleTrace(trace.id)}>
                                            <Text size="xs" c="dimmed">{isExpanded ? '▼' : '▶'}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label="Click to view logs for this trace">
                                                <Text
                                                    size="xs"
                                                    ff="var(--font-mono)"
                                                    style={{ fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                                                    component="span"
                                                    c="blue"
                                                    onClick={() => navigateToLogs(trace.trace_id, trace.timestamp)}
                                                >
                                                    {trace.trace_id?.substring(0, 16)}...
                                                </Text>
                                            </Tooltip>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm" fw={500}>{trace.service_name}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm">{trace.operation || '—'}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
                                                <Clock size={12} color="#868e96" />
                                                <Text size="sm">{trace.duration_ms !== undefined ? trace.duration_ms.toFixed(1) : '0.0'}ms</Text>
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge size="xs" color={STATUS_COLORS[trace.status] || 'gray'}>
                                                {trace.status || 'UNSET'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge size="xs" variant="light">{trace.span_count ?? 0}</Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="xs" c="dimmed">{new Date(trace.timestamp).toLocaleString()}</Text>
                                        </Table.Td>
                                    </Table.Tr>
                                    {isExpanded && (
                                        <Table.Tr>
                                            <Table.Td colSpan={8} p={0}>
                                                <Box p="md" bg="var(--mantine-color-gray-0)">
                                                    <Title order={6} mb="xs">Spans ({trace.spans?.length || 0})</Title>
                                                    <Table withTableBorder>
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
                                                            {(trace.spans || []).map(span => (
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
                            )
                        })}
                    </Table.Tbody>
                </Table>

                {totalPages > 1 && (
                    <Box p="md" style={{ borderTop: '1px solid var(--argus-border)' }}>
                        <Group justify="center">
                            <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
                        </Group>
                    </Box>
                )}
            </Paper>
        </Stack>
    )
}
