import { useEffect, useMemo } from 'react'
import {
    Paper,
    Group,
    Title,
    Stack,
    SimpleGrid,
    Text,
    Badge,
    ThemeIcon,
    Box,
    LoadingOverlay,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, HeatmapChart, ScatterChart, PieChart } from 'echarts/charts'
import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Activity, AlertTriangle, Clock, Layers, Zap, BarChart3, TrendingUp } from 'lucide-react'
import type { TrafficPoint, DashboardStats, LatencyHeatmapPoint } from '../../types'
import { useFilterParam } from '../../hooks/useFilterParams'
import { useLiveMode } from '../../contexts/LiveModeContext'
import { GlobalControls } from '../../components/GlobalControls'
import { useTimeRange } from '../../components/TimeRangeSelector'

echarts.use([
    LineChart, BarChart, HeatmapChart, ScatterChart, PieChart,
    GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, TitleComponent,
    CanvasRenderer,
])

export function Dashboard() {
    const tr = useTimeRange('15m')
    const [selectedService] = useFilterParam('service', null)
    const { isLive, isConnected, setServiceFilter } = useLiveMode()

    // Sync local filter param to global live mode filter
    useEffect(() => {
        if (isLive) {
            setServiceFilter(selectedService || '')
        }
    }, [isLive, selectedService, setServiceFilter])

    const serviceParams = selectedService ? `&service_name=${encodeURIComponent(selectedService)}` : ''

    // Traffic data
    const trafficQueryKey = ['traffic', tr.start, tr.end, selectedService, isLive]
    const { data: traffic, isFetching: isFetchingTraffic } = useQuery<TrafficPoint[]>({
        queryKey: trafficQueryKey,
        queryFn: () => fetch(`/api/metrics/traffic?start=${tr.start}&end=${tr.end}${serviceParams}`).then(r => r.json()),
        refetchInterval: isLive ? 10000 : false,
        staleTime: 30000,
        refetchOnWindowFocus: false,
    })

    // Dashboard Stats
    const statsQueryKey = ['dashboardStats', tr.start, tr.end, selectedService, isLive]
    const { data: stats, isFetching: isFetchingStats } = useQuery<DashboardStats>({
        queryKey: statsQueryKey,
        queryFn: () => fetch(`/api/metrics/dashboard?start=${tr.start}&end=${tr.end}${serviceParams}`).then(r => r.json()),
        refetchInterval: isLive ? 10000 : false,
        staleTime: 30000,
        refetchOnWindowFocus: false,
    })

    // Heatmap data
    const heatmapQueryKey = ['heatmap', tr.start, tr.end, selectedService, isLive]
    const { data: heatmap, isFetching: isFetchingHeatmap } = useQuery<LatencyHeatmapPoint[]>({
        queryKey: heatmapQueryKey,
        queryFn: () => fetch(`/api/metrics/latency_heatmap?start=${tr.start}&end=${tr.end}${serviceParams}`).then(r => r.json()),
        refetchInterval: isLive ? 10000 : false,
    })

    const topFailing = stats?.top_failing_services || []

    const trafficChartOption = useMemo(() => ({
        tooltip: { trigger: 'axis' },
        grid: { left: 50, right: 20, top: 20, bottom: 30 },
        xAxis: {
            type: 'time',
            axisLabel: { formatter: (val: number) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
        },
        yAxis: { type: 'value', name: 'Requests' },
        series: [
            {
                name: 'Total',
                type: 'line',
                smooth: true,
                data: (traffic || []).map((p: TrafficPoint) => [new Date(p.timestamp).getTime(), p.count]),
                areaStyle: { opacity: 0.1, color: '#4c6ef5' },
                lineStyle: { color: '#4c6ef5', width: 2 },
                itemStyle: { color: '#4c6ef5' },
            },
            {
                name: 'Errors',
                type: 'line',
                smooth: true,
                data: (traffic || []).map((p: TrafficPoint) => [new Date(p.timestamp).getTime(), p.error_count]),
                areaStyle: { opacity: 0.1, color: '#fa5252' },
                lineStyle: { color: '#fa5252', width: 2 },
                itemStyle: { color: '#fa5252' },
            },
        ],
    }), [traffic])

    const heatmapChartOption = useMemo(() => ({
        tooltip: {
            trigger: 'item',
            formatter: (p: any) => {
                const durMs = p.value[1] / 1000;
                return `Time: ${new Date(p.value[0]).toLocaleTimeString()}<br/>Latency: <b>${durMs.toFixed(2)}ms</b>`;
            }
        },
        grid: { left: 60, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'time', axisLabel: { color: '#909296' } },
        yAxis: {
            type: 'value',
            name: 'µs',
            axisLabel: { color: '#909296' },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
        },
        series: [{
            type: 'scatter',
            symbolSize: 8,
            data: (heatmap || []).map(p => [new Date(p.timestamp).getTime(), p.duration]),
            itemStyle: { color: 'rgba(76, 110, 245, 0.6)' },
            large: true,
            largeThreshold: 500
        }]
    }), [heatmap])

    const throughputPieOption = useMemo(() => ({
        tooltip: { trigger: 'item' },
        legend: { bottom: '5%', left: 'center', textStyle: { color: '#909296' } },
        series: [{
            name: 'Throughput',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: { borderRadius: 10, borderColor: '#1A1B1E', borderWidth: 2 },
            label: { show: false, position: 'center' },
            emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' } },
            labelLine: { show: false },
            data: (topFailing || []).map(s => ({ value: s.total_count, name: s.service_name }))
        }]
    }), [topFailing])

    const statCards = [
        { label: 'Total Traces', value: stats?.total_traces ?? 0, icon: Layers, color: 'indigo' },
        { label: 'Total Logs', value: stats?.total_logs ?? 0, icon: Activity, color: 'cyan' },
        { label: 'Total Errors', value: stats?.total_errors ?? 0, icon: AlertTriangle, color: 'red' },
        { label: 'Avg Latency', value: `${(stats?.avg_latency_ms ?? 0).toFixed(1)}ms`, icon: Clock, color: 'orange' },
    ]

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Group gap="sm">
                    <Title order={3}>Dashboard</Title>
                    {isLive && (
                        <Badge variant="dot" color={isConnected ? 'green' : 'red'} size="lg">
                            {isConnected ? 'LIVE' : 'Reconnecting...'}
                        </Badge>
                    )}
                </Group>
                <Group gap="md">
                    <GlobalControls />
                </Group>
            </Group>

            <Box style={{ position: 'relative' }}>
                <LoadingOverlay visible={(isFetchingTraffic || isFetchingStats || isFetchingHeatmap) && !isLive} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />

                <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
                    {statCards.map((s) => (
                        <Paper key={s.label} shadow="xs" p="md" radius="md" withBorder>
                            <Group justify="space-between" align="flex-start">
                                <Box>
                                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{s.label}</Text>
                                    <Title order={3} mt={4}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</Title>
                                </Box>
                                <ThemeIcon variant="light" color={s.color} size="lg" radius="md">
                                    <s.icon size={18} />
                                </ThemeIcon>
                            </Group>
                        </Paper>
                    ))}
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="md">
                    <Paper shadow="xs" p="md" radius="md" withBorder>
                        <Group gap="xs" mb="sm">
                            <BarChart3 size={16} color="var(--mantine-color-cyan-4)" />
                            <Text fw={600}>Throughput Distribution</Text>
                        </Group>
                        <Box style={{ height: 350 }}>
                            <ReactEChartsCore echarts={echarts} option={throughputPieOption} style={{ height: '100%' }} />
                        </Box>
                    </Paper>

                    <Paper shadow="xs" p="md" radius="md" withBorder>
                        <Group gap="xs" mb="sm">
                            <Zap size={16} color="var(--mantine-color-yellow-4)" />
                            <Text fw={600}>Latency Distribution (Scatter)</Text>
                        </Group>
                        <Box style={{ height: 260 }}>
                            <ReactEChartsCore echarts={echarts} option={heatmapChartOption} style={{ height: '100%' }} />
                        </Box>
                    </Paper>
                </SimpleGrid>

                <Paper shadow="xs" p="md" radius="md" withBorder>
                    <Group gap="xs" mb="sm">
                        <TrendingUp size={16} color="var(--mantine-color-indigo-4)" />
                        <Text fw={600}>Traffic Request Volume</Text>
                    </Group>
                    <Box style={{ height: 260 }}>
                        <ReactEChartsCore echarts={echarts} option={trafficChartOption} style={{ height: '100%' }} />
                    </Box>




                </Paper>
            </Box>
        </Stack>
    )
}
