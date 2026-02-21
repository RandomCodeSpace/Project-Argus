import { BarChart3 } from 'lucide-react'
import React, { useMemo } from 'react'
import { ChartCard } from '../../../components/common/ChartCard'
import { useArgusQuery } from '../../../hooks/useArgusQuery'
import type { DashboardStats } from '../../../types'

export const ThroughputPieChart = React.memo(() => {
    const { data: stats, isFetching } = useArgusQuery<DashboardStats>({
        queryKey: ['dashboardStats'], // Shares key with stats grid for cache efficiency
        path: '/api/metrics/dashboard',
        liveKey: 'dashboardStats',
    })

    const topFailing = stats?.top_failing_services || []

    const chartOption = useMemo(() => ({
        tooltip: { trigger: 'item' },
        legend: { bottom: '5%', left: 'center', textStyle: { color: '#909296' } },
        series: [{
            name: 'Throughput',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: { borderRadius: 10, borderColor: '#ffffffff', borderWidth: 4 },
            label: { show: false, position: 'center' },
            emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' } },
            labelLine: { show: false },
            data: (topFailing || []).map(s => ({ value: s.total_count, name: s.service_name }))
        }]
    }), [topFailing])

    return (
        <ChartCard
            title="Throughput Distribution"
            icon={BarChart3}
            iconColor="var(--mantine-color-cyan-4)"
            height={350}
            loading={isFetching}
            option={chartOption}
        />
    )
})

ThroughputPieChart.displayName = 'ThroughputPieChart'
