import { Group, Title, Stack, Badge, Box } from '@mantine/core'
import { useLiveMode } from '../../contexts/LiveModeContext'
import { GlobalControls } from '../../components/GlobalControls'
import { DashboardStatsGrid } from './components/DashboardStatsGrid'
import { TrafficVolumeChart } from './components/TrafficVolumeChart'
import { LatencyScatterChart } from './components/LatencyScatterChart'
import { ThroughputPieChart } from './components/ThroughputPieChart'
import { SimpleGrid } from '@mantine/core'

export function Dashboard() {
    const { isLive, isConnected } = useLiveMode()

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
                <DashboardStatsGrid />

                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="md">
                    <ThroughputPieChart />
                    <LatencyScatterChart />
                </SimpleGrid>

                <TrafficVolumeChart />
            </Box>
        </Stack>
    )
}
