import { useState, useMemo, useCallback } from 'react'
import {
    Paper,
    Group,
    Title,
    Stack,
    Badge,
    TextInput,
    Pagination,
    Box,
    LoadingOverlay,
    Collapse,
    Select,
    Text,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { LogResponse } from '../../types'
import { useTimeRange, TIME_RANGES } from '../../components/TimeRangeSelector'
import { useFilterParam, useFilterParamString } from '../../hooks/useFilterParams'
import { GlobalControls } from '../../components/GlobalControls'
import { LogRow } from './components/LogRow'
import { LogDetails } from './components/LogDetails'

export function LogExplorer() {
    const [page, setPage] = useState(1)
    const [pageSize] = useState(25)
    const [debouncedPageSize] = useDebouncedValue(pageSize, 500)

    const [selectedService] = useFilterParam('service', null)
    const [selectedSeverity, setSelectedSeverity] = useFilterParam('severity', null)
    const [searchText, setSearchText] = useFilterParamString('log_q', '')
    const [expandedLogId, setExpandedLogId] = useState<number | null>(null)

    const tr = useTimeRange('5m')

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

    const handleToggleExpand = useCallback((id: number) => {
        setExpandedLogId(prev => (prev === id ? null : id))
    }, [])

    return (
        <Stack gap="md" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between" px="xs">
                <Group gap="sm">
                    <Title order={3}>Logs Explorer</Title>
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
                    <Group gap={0} px="sm" py={8}>
                        <Box style={{ width: 40 }}><Text fw={700} size="xs" c="dimmed"></Text></Box>
                        <Box style={{ width: 80 }}><Text fw={700} size="xs" c="dimmed">SEVERITY</Text></Box>
                        <Box style={{ width: 170 }}><Text fw={700} size="xs" c="dimmed">TIMESTAMP</Text></Box>
                        <Box style={{ width: 140 }}><Text fw={700} size="xs" c="dimmed">SERVICE</Text></Box>
                        <Box style={{ flex: 1 }}><Text fw={700} size="xs" c="dimmed">MESSAGE</Text></Box>
                    </Group>
                </Box>

                <Box style={{ flex: 1, overflowY: 'auto' }}>
                    {displayLogs.map(log => (
                        <Box key={log.id}>
                            <LogRow
                                log={log}
                                isExpanded={expandedLogId === log.id}
                                onToggle={handleToggleExpand}
                            />
                            <Collapse in={expandedLogId === log.id}>
                                <LogDetails log={log} />
                            </Collapse>
                        </Box>
                    ))}
                    {displayLogs.length === 0 && !isFetchingLogs && (
                        <Box p="xl" style={{ textAlign: 'center' }}>
                            <Text c="dimmed">No logs found matching your criteria</Text>
                        </Box>
                    )}
                </Box>

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
