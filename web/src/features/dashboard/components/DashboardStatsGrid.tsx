import { SimpleGrid } from '@mantine/core'
import { Activity, AlertTriangle, Clock, Layers } from 'lucide-react'
import React from 'react'
import { StatsCard } from '../../../components/common/StatsCard'
import { useArgusQuery } from '../../../hooks/useArgusQuery'
import type { DashboardStats } from '../../../types'

export const DashboardStatsGrid = React.memo(() => {
    const { data: stats } = useArgusQuery<DashboardStats>({
        queryKey: ['dashboardStats'],
        path: '/api/metrics/dashboard',
        liveKey: 'dashboardStats',
    })

    const statCards = [
        { label: 'Total Traces', value: stats?.total_traces ?? 0, icon: Layers, color: 'indigo' },
        { label: 'Total Logs', value: stats?.total_logs ?? 0, icon: Activity, color: 'cyan' },
        { label: 'Total Errors', value: stats?.total_errors ?? 0, icon: AlertTriangle, color: 'red' },
        { label: 'Avg Latency', value: `${(stats?.avg_latency_ms ?? 0).toFixed(1)}ms`, icon: Clock, color: 'orange' },
    ]

    return (
        <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
            {statCards.map((s) => (
                <StatsCard
                    key={s.label}
                    label={s.label}
                    value={s.value}
                    icon={s.icon}
                    color={s.color}
                />
            ))}
        </SimpleGrid>
    )
})

DashboardStatsGrid.displayName = 'DashboardStatsGrid'
