import { useState, useMemo } from 'react'
import {
    Stack,
    Group,
    Title,
    Paper,
    Select,
    Box,
    Badge,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useLiveMode } from '../../contexts/LiveModeContext'
import { GlobalControls } from '../../components/GlobalControls'
import { MetricChart } from './components/MetricChart'

export function MetricsExplorer() {
    const { isLive, serviceFilter } = useLiveMode()
    const [selectedMetric, setSelectedMetric] = useState<string | null>(null)

    // --- Metric Discovery (Available Names) ---
    const { data: availableMetrics = [] } = useQuery<string[]>({
        queryKey: ['metadata', 'metrics', serviceFilter],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (serviceFilter) params.append('service_name', serviceFilter)
            const res = await fetch(`/api/metadata/metrics?${params.toString()}`)
            if (!res.ok) throw new Error('Failed to discover metrics')
            return res.json()
        },
    })

    // Auto-select first metric if none selected or current is invalid
    useMemo(() => {
        if (availableMetrics.length > 0) {
            if (!selectedMetric || !availableMetrics.includes(selectedMetric)) {
                setSelectedMetric(availableMetrics[0])
            }
        }
    }, [availableMetrics, selectedMetric])

    return (
        <Stack gap="md" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between" px="xs">
                <Group gap="sm">
                    <Title order={3}>Metrics Explorer</Title>
                    <Badge variant="light" color="cyan" size="lg">
                        {isLive ? 'Real-time Stream' : 'TSDB Aggregate'}
                    </Badge>
                </Group>
                <GlobalControls />
            </Group>

            <Paper shadow="xs" p="sm" radius="md" withBorder mx="xs">
                <Group gap="lg">
                    <Select
                        label="Metric Name"
                        placeholder={availableMetrics.length > 0 ? "Select metric..." : "No metrics found"}
                        size="xs"
                        data={availableMetrics.map(m => ({ value: m, label: m }))}
                        value={selectedMetric}
                        onChange={setSelectedMetric}
                        disabled={availableMetrics.length === 0}
                        style={{ width: 250 }}
                    />
                </Group>
            </Paper>

            <Box mx="xs" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <MetricChart selectedMetric={selectedMetric} />
            </Box>
        </Stack>
    )
}
