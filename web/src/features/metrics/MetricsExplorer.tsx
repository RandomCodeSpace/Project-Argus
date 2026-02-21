import { useState, useMemo } from 'react'
import {
    Stack,
    Group,
    Title,
    Paper,
    Select,
    Box,
    Text,
    Badge,
    LoadingOverlay,
} from '@mantine/core'
import ReactECharts from 'echarts-for-react'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { useLiveMode } from '../../contexts/LiveModeContext'
import { GlobalControls } from '../../components/GlobalControls'
import { useFilterParam } from '../../hooks/useFilterParams'
import { useTimeRange } from '../../components/TimeRangeSelector'
import type { MetricBucket, MetricEntry } from '../../types'

export function MetricsExplorer() {
    const { isLive } = useLiveMode()
    const tr = useTimeRange('5m')
    const [selectedMetric, setSelectedMetric] = useState<string | null>('orders_processed_total')
    const [selectedService] = useFilterParam('service', null)

    // --- 1. Historical Data (TSDB Buckets) ---
    const { data: historicalBuckets, isFetching: isFetchingHistorical } = useQuery<MetricBucket[]>({
        queryKey: ['metrics', 'historical', selectedService, selectedMetric, tr.start, tr.end],
        queryFn: async () => {
            if (!selectedMetric) return []
            const params = new URLSearchParams({
                start: tr.start,
                end: tr.end,
                name: selectedMetric
            })
            if (selectedService) params.append('service_name', selectedService)

            const res = await fetch(`/api/metrics?${params.toString()}`)
            if (!res.ok) throw new Error('Failed to fetch metrics')
            return res.json()
        },
        enabled: !isLive && !!selectedMetric,
    })

    // --- 2. Live Data (Raw OTLP Stream from WebSocket Bypass) ---
    const realtimeMetrics = useQuery<MetricEntry[]>({
        queryKey: ['live', 'realtime_metrics'],
        enabled: isLive,
    }).data || []

    const filteredLiveMetrics = useMemo(() => {
        return realtimeMetrics
            .filter(m => (!selectedMetric || m.name === selectedMetric) && (!selectedService || m.service_name === selectedService))
            .slice(-100) // Only show last 100 points for performance
    }, [realtimeMetrics, selectedMetric, selectedService])

    // --- 3. ECharts Configuration ---
    const chartOptions = useMemo(() => {
        if (isLive) {
            const data = filteredLiveMetrics.map(m => [new Date(m.timestamp).getTime(), m.value])
            return {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    formatter: (params: any) => {
                        const [p] = params;
                        return `${new Date(p.value[0]).toLocaleTimeString()}<br/><b>${p.value[1].toFixed(2)}</b>`;
                    }
                },
                grid: { top: 40, bottom: 40, left: 60, right: 20 },
                xAxis: {
                    type: 'time',
                    splitLine: { show: false },
                    axisLabel: { color: '#909296' }
                },
                yAxis: {
                    type: 'value',
                    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
                    axisLabel: { color: '#909296' }
                },
                series: [{
                    name: selectedMetric || 'Value',
                    type: 'line',
                    showSymbol: false,
                    data: data,
                    lineStyle: { width: 3, color: '#228be6' },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(34, 139, 230, 0.4)' },
                                { offset: 1, color: 'rgba(34, 139, 230, 0)' }
                            ]
                        }
                    }
                }],
                animation: false,
            }
        }

        // Historical Mode (Buckets)
        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['Average Value', 'Value Variance (Min-Max)'],
                textStyle: { color: '#909296' },
                top: 0
            },
            grid: { top: 60, bottom: 40, left: 60, right: 20 },
            xAxis: {
                type: 'time',
                splitLine: { show: false },
                axisLabel: { color: '#909296' }
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
                axisLabel: { color: '#909296' }
            },
            series: [
                {
                    name: 'Average Value',
                    type: 'line',
                    data: historicalBuckets?.map(b => [new Date(b.time_bucket).getTime(), b.count > 0 ? b.sum / b.count : 0]) || [],
                    lineStyle: { width: 3, color: '#fab005' },
                    itemStyle: { color: '#fab005' },
                    zIndex: 10
                },
                {
                    name: 'Value Variance (Min-Max)',
                    type: 'line',
                    data: historicalBuckets?.map(b => [new Date(b.time_bucket).getTime(), b.max]) || [],
                    lineStyle: { opacity: 0 },
                    stack: 'range',
                    symbol: 'none'
                },
                {
                    name: 'Value Variance (Min-Max)',
                    type: 'line',
                    data: historicalBuckets?.map(b => [new Date(b.time_bucket).getTime(), b.min - b.max]) || [], // Relative for area
                    lineStyle: { opacity: 0 },
                    stack: 'range',
                    symbol: 'none',
                    areaStyle: { color: 'rgba(250, 176, 5, 0.15)' }
                }
            ],
            dataZoom: [
                { type: 'inside', start: 0, end: 100 },
                { type: 'slider', bottom: 0, textStyle: { color: '#909296' } }
            ]
        }
    }, [isLive, filteredLiveMetrics, historicalBuckets, selectedMetric])

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
                        placeholder="Select metric..."
                        size="xs"
                        data={[
                            { value: 'orders_processed_total', label: 'orders_processed_total' },
                            { value: 'active_payments', label: 'active_payments' },
                            { value: 'inventory_queries_total', label: 'inventory_queries_total' },
                        ]}
                        value={selectedMetric}
                        onChange={setSelectedMetric}
                        style={{ width: 250 }}
                    />
                </Group>
            </Paper>

            <Paper shadow="xs" radius="md" withBorder mx="xs" style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: 20 }}>
                <LoadingOverlay visible={!isLive && isFetchingHistorical} zIndex={10} overlayProps={{ blur: 1 }} />

                <Box style={{ height: '100%', width: '100%' }}>
                    <ReactECharts
                        option={chartOptions}
                        style={{ height: '100%', width: '100%' }}
                        theme="dark"
                        notMerge={true}
                    />
                </Box>

                {isLive && filteredLiveMetrics.length === 0 && (
                    <Box style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                        <Activity size={48} color="var(--mantine-color-gray-4)" style={{ marginBottom: 10 }} />
                        <Text c="dimmed">Waiting for live metric stream...</Text>
                        <Text size="xs" c="dimmed">Ensure chaos services are running and emitting OTLP data.</Text>
                    </Box>
                )}
            </Paper>
        </Stack>
    )
}
