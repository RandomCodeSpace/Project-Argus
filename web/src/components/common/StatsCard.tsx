import { Paper, Group, Text, Title, ThemeIcon, Box } from '@mantine/core'
import type { LucideIcon } from 'lucide-react'
import React from 'react'

interface StatsCardProps {
    label: string
    value: string | number
    icon: LucideIcon
    color: string
}

export const StatsCard = React.memo(({ label, value, icon: Icon, color }: StatsCardProps) => {
    return (
        <Paper shadow="xs" p="md" radius="md" withBorder>
            <Group justify="space-between" align="flex-start">
                <Box>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
                    <Title order={3} mt={4}>
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </Title>
                </Box>
                <ThemeIcon variant="light" color={color} size="lg" radius="md">
                    <Icon size={18} />
                </ThemeIcon>
            </Group>
        </Paper>
    )
})

StatsCard.displayName = 'StatsCard'
