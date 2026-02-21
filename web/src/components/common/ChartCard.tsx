import { Paper, Group, Text, Box, LoadingOverlay } from '@mantine/core'
import type { LucideIcon } from 'lucide-react'
import React, { type ReactNode } from 'react'
import ReactEChartsCore, { echarts } from '../../lib/echarts'

interface ChartCardProps {
    title: string
    icon: LucideIcon
    iconColor: string
    height?: number | string
    loading?: boolean
    option: any
    children?: ReactNode
}

export const ChartCard = React.memo(({
    title,
    icon: Icon,
    iconColor,
    height = 300,
    loading = false,
    option,
    children
}: ChartCardProps) => {
    return (
        <Paper shadow="xs" p="md" radius="md" withBorder style={{ position: 'relative', height: '100%' }}>
            <LoadingOverlay visible={loading} zIndex={100} overlayProps={{ radius: 'sm', blur: 2 }} />

            <Group gap="xs" mb="sm">
                <Icon size={16} color={iconColor} />
                <Text fw={600}>{title}</Text>
            </Group>

            <Box style={{ height }}>
                <ReactEChartsCore
                    echarts={echarts}
                    option={option}
                    style={{ height: '100%', width: '100%' }}
                    notMerge={true}
                    lazyUpdate={true}
                />
            </Box>

            {children}
        </Paper>
    )
})

ChartCard.displayName = 'ChartCard'
