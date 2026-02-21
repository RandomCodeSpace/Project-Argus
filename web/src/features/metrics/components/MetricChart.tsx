import { Activity } from 'lucide-react'
import React, { useMemo } from 'react'
import { Box, Text } from '@mantine/core'
import { ChartCard } from '../../../components/common/ChartCard'
import { useArgusQuery } from '../../../hooks/useArgusQuery'
import { useLiveMode } from '../../../contexts/LiveModeContext'
import type { MetricBucket, MetricEntry } from '../../../types'

interface MetricChartProps {
    selectedMetric: string | null
}

export const MetricChart = React.memo(({ selectedMetric }: MetricChartProps) => {
    const { isLive, serviceFilter } = useLiveMode()

    // 1. Historical Data (TSDB Buckets)
    const { data: historicalBuckets, isFetching: isFetchingHistorical } = useArgusQuery<MetricBucket[]>({
        queryKey: ['metrics', 'historical', selectedMetric],
        path: '/api/metrics',
        params: { name: selectedMetric },
        enabled: !isLive && !!selectedMetric,
    })

    // 2. Live Data (Raw OTLP Stream from WebSocket Bypass)
    const { data: realtimeMetrics = [] } = useArgusQuery<MetricEntry[]>({
        queryKey: ['live', 'realtime_metrics'],
        path: '', // Not used for liveKey
        liveKey: 'realtime_metrics',
        enabled: isLive,
    })

    const filteredLiveMetrics = useMemo(() => {
        return realtimeMetrics
            .filter(m => (!selectedMetric || m.name === selectedMetric) && (!serviceFilter || m.service_name === serviceFilter))
            .slice(-100)
    }, [realtimeMetrics, selectedMetric, serviceFilter])

    const chartOption = useMemo(() => {
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
                xAxis: { type: 'time', axisLabel: { color: '#909296' } },
                yAxis: { type: 'value', axisLabel: { color: '#909296' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
                series: [{
                    name: selectedMetric || 'Value',
                    type: 'line',
                    showSymbol: false,
                    data: data,
                    lineStyle: { width: 3, color: '#228be6' },
                    areaStyle: {
                        color: {
                            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [{ offset: 0, color: 'rgba(34, 139, 230, 0.4)' }, { offset: 1, color: 'rgba(34, 139, 230, 0)' }]
                        }
                    }
                }],
                animation: false,
            }
        }

        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
            legend: { data: ['Average Value', 'Value Variance (Min-Max)'], textStyle: { color: '#909296' }, top: 0 },
            grid: { top: 60, bottom: 40, left: 60, right: 20 },
            xAxis: { type: 'time', axisLabel: { color: '#909296' } },
            yAxis: { type: 'value', axisLabel: { color: '#909296' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
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
                    lineStyle: { opacity: 0 }, stack: 'range', symbol: 'none'
                },
                {
                    name: 'Value Variance (Min-Max)',
                    type: 'line',
                    data: historicalBuckets?.map(b => [new Date(b.time_bucket).getTime(), b.min - b.max]) || [],
                    lineStyle: { opacity: 0 }, stack: 'range', symbol: 'none',
                    areaStyle: { color: 'rgba(250, 176, 5, 0.15)' }
                }
            ],
            dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 0, textStyle: { color: '#909296' } }]
        }
    }, [isLive, filteredLiveMetrics, historicalBuckets, selectedMetric])

    return (
        <ChartCard
            title={selectedMetric || 'Select a metric...'}
            icon={Activity}
            iconColor="var(--mantine-color-cyan-4)"
            height="100%"
            loading={!isLive && isFetchingHistorical}
            option={chartOption}
        >
            {isLive && filteredLiveMetrics.length === 0 && (
                <Box style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                    <Activity size={48} color="var(--mantine-color-gray-4)" style={{ marginBottom: 10 }} />
                    <Text c="dimmed">Waiting for live metric stream...</Text>
                </Box>
            )}
        </ChartCard>
    )
})

MetricChart.displayName = 'MetricChart'
