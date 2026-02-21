import { Zap } from 'lucide-react'
import React, { useMemo } from 'react'
import { ChartCard } from '../../../components/common/ChartCard'
import { useArgusQuery } from '../../../hooks/useArgusQuery'
import type { LatencyHeatmapPoint } from '../../../types'

export const LatencyScatterChart = React.memo(() => {
    const { data: heatmap, isFetching } = useArgusQuery<LatencyHeatmapPoint[]>({
        queryKey: ['heatmap'],
        path: '/api/metrics/latency_heatmap',
        liveKey: 'heatmap', // Note: context handles this
    })

    const chartOption = useMemo(() => ({
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

    return (
        <ChartCard
            title="Latency Distribution (Scatter)"
            icon={Zap}
            iconColor="var(--mantine-color-yellow-4)"
            height={260}
            loading={isFetching}
            option={chartOption}
        />
    )
})

LatencyScatterChart.displayName = 'LatencyScatterChart'
