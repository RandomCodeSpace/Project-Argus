import {
    Paper,
    Group,
    Title,
    Stack,
    Text,
    Badge,
    SimpleGrid,
    ThemeIcon,
    Button,
    Divider,
    NumberInput,
    Box,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { Activity, Database, HardDrive, Users, Trash2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { HealthStats } from '../../types'

export function SettingsPage() {
    const [purgeDays, setPurgeDays] = useState<number>(7)
    const [purging, setPurging] = useState(false)
    const [vacuuming, setVacuuming] = useState(false)

    const { data: health } = useQuery<HealthStats>({
        queryKey: ['health'],
        queryFn: () => fetch('/api/health').then(r => r.json()),
        refetchInterval: 5000,
    })

    const handlePurge = async () => {
        setPurging(true)
        try {
            const res = await fetch(`/api/admin/purge?days=${purgeDays}`, { method: 'DELETE' })
            const data = await res.json()
            notifications.show({
                title: 'Purge Complete',
                message: `Deleted ${data.logs_purged} logs and ${data.traces_purged} traces`,
                color: 'green',
            })
        } catch (err) {
            notifications.show({ title: 'Purge Failed', message: String(err), color: 'red' })
        } finally {
            setPurging(false)
        }
    }

    const handleVacuum = async () => {
        setVacuuming(true)
        try {
            await fetch('/api/admin/vacuum', { method: 'POST' })
            notifications.show({
                title: 'Vacuum Complete',
                message: 'Database has been vacuumed successfully',
                color: 'green',
            })
        } catch (err) {
            notifications.show({ title: 'Vacuum Failed', message: String(err), color: 'red' })
        } finally {
            setVacuuming(false)
        }
    }

    const healthCards = [
        {
            label: 'Ingestion Rate',
            value: health?.ingestion_rate?.toLocaleString() ?? '0',
            icon: Activity,
            color: 'indigo',
            desc: 'Total spans/logs ingested',
        },
        {
            label: 'Active Connections',
            value: health?.active_connections?.toString() ?? '0',
            icon: Users,
            color: 'cyan',
            desc: 'WebSocket clients',
        },
        {
            label: 'DB Latency P99',
            value: `${health?.db_latency_p99_ms?.toFixed(1) ?? '0'}ms`,
            icon: Database,
            color: 'orange',
            desc: 'Database operation latency',
        },
        {
            label: 'DLQ Size',
            value: health?.dlq_size?.toString() ?? '0',
            icon: HardDrive,
            color: health?.dlq_size && health.dlq_size > 0 ? 'red' : 'green',
            desc: 'Files in Dead Letter Queue',
        },
    ]

    return (
        <Stack gap="md">
            <Title order={3}>Settings</Title>

            {/* Argus Health */}
            <Paper shadow="xs" p="lg" radius="md" withBorder>
                <Group gap="xs" mb="md">
                    <Sparkles size={20} color="#4c6ef5" />
                    <Title order={5}>Argus Health</Title>
                    <Badge variant="dot" color="green" size="sm">Live</Badge>
                </Group>

                <SimpleGrid cols={{ base: 2, md: 4 }}>
                    {healthCards.map((card) => (
                        <Paper key={card.label} p="md" radius="md" withBorder>
                            <Group justify="space-between" mb="xs">
                                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{card.label}</Text>
                                <ThemeIcon variant="light" color={card.color} size="sm" radius="xl">
                                    <card.icon size={12} />
                                </ThemeIcon>
                            </Group>
                            <Title order={3}>{card.value}</Title>
                            <Text size="xs" c="dimmed" mt={2}>{card.desc}</Text>
                        </Paper>
                    ))}
                </SimpleGrid>
            </Paper>

            {/* System Information */}
            <Paper shadow="xs" p="lg" radius="md" withBorder>
                <Title order={5} mb="md">System Information</Title>
                <SimpleGrid cols={2}>
                    <Box>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Version</Text>
                        <Text size="sm">ARGUS {__APP_VERSION__} ({__APP_VERSION__ === 'DEV' ? 'DEV MODE' : 'PROD release'})</Text>
                    </Box>
                    <Box>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Edition</Text>
                        <Text size="sm">Production Hardened Edition</Text>
                    </Box>
                    <Box>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Architecture</Text>
                        <Text size="sm">Single Binary → gRPC + HTTP</Text>
                    </Box>
                    <Box>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>WebSocket Hub</Text>
                        <Text size="sm">Buffered (100 items / 500ms flush)</Text>
                    </Box>
                </SimpleGrid>
            </Paper>

            {/* Danger Zone */}
            <Paper shadow="xs" p="lg" radius="md" withBorder style={{ borderColor: '#fa5252' }}>
                <Group gap="xs" mb="md">
                    <Trash2 size={20} color="#fa5252" />
                    <Title order={5} c="red">Danger Zone</Title>
                </Group>
                <Divider mb="md" />

                <Group justify="space-between" align="flex-end">
                    <Box>
                        <Text size="sm" fw={500}>Purge Old Data</Text>
                        <Text size="xs" c="dimmed">Delete logs and traces older than specified days</Text>
                        <NumberInput
                            mt="xs"
                            size="xs"
                            value={purgeDays}
                            onChange={(v) => setPurgeDays(typeof v === 'number' ? v : 7)}
                            min={1}
                            max={365}
                            suffix=" days"
                            styles={{ input: { width: 120 } }}
                        />
                    </Box>
                    <Button
                        color="red"
                        variant="outline"
                        size="xs"
                        loading={purging}
                        onClick={handlePurge}
                        leftSection={<Trash2 size={14} />}
                    >
                        Purge Now
                    </Button>
                </Group>

                <Divider my="md" />

                <Group justify="space-between" align="center">
                    <Box>
                        <Text size="sm" fw={500}>Vacuum Database</Text>
                        <Text size="xs" c="dimmed">Reclaim disk space after purging (SQLite only)</Text>
                    </Box>
                    <Button
                        color="red"
                        variant="outline"
                        size="xs"
                        loading={vacuuming}
                        onClick={handleVacuum}
                        leftSection={<Database size={14} />}
                    >
                        Vacuum
                    </Button>
                </Group>
            </Paper>
        </Stack>
    )
}
