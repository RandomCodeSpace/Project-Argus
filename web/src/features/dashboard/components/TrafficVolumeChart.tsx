import { TrendingUp } from 'lucide-react'
import React, { useMemo } from 'react'
import { ChartCard } from '../../../components/common/ChartCard'
import { useArgusQuery } from '../../../hooks/useArgusQuery'
import type { TrafficPoint } from '../../../types'

export const TrafficVolumeChart = React.memo(() => {
    const { data: traffic, isFetching } = useArgusQuery<TrafficPoint[]>({
        queryKey: ['traffic'],
        path: '/api/metrics/traffic',
        liveKey: 'traffic',
    })

    const chartOption = useMemo(() => ({
        tooltip: { trigger: 'axis' },
        grid: { left: 50, right: 20, top: 20, bottom: 30 },
        xAxis: {
            type: 'time',
            axisLabel: {
                formatter: (val: number) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                color: '#909296'
            },
        },
        yAxis: {
            type: 'value',
            name: 'Requests',
            axisLabel: { color: '#909296' },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
        },
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

    return (
        <ChartCard
            title="Traffic Request Volume"
            icon={TrendingUp}
            iconColor="var(--mantine-color-indigo-4)"
            height={260}
            loading={isFetching}
            option={chartOption}
        />
    )
})

TrafficVolumeChart.displayName = 'TrafficVolumeChart'
