import { Group, Switch, Text, Badge } from '@mantine/core'
import { Play, Pause } from 'lucide-react'
import { useLiveMode } from '../contexts/LiveModeContext'
import { TimeRangeSelector, useTimeRange } from './TimeRangeSelector'

export function GlobalControls() {
    const { isLive, isConnected, setIsLive } = useLiveMode()
    const tr = useTimeRange('5m')

    return (
        <Group gap="md">
            <Switch
                label={
                    <Group gap={6}>
                        <Text size="sm" fw={500}>Live Mode</Text>
                        {isLive && (
                            <Badge
                                variant="dot"
                                color={isConnected ? 'green' : 'red'}
                                size="xs"
                            >
                                {isConnected ? 'ON' : '...'}
                            </Badge>
                        )}
                    </Group>
                }
                checked={isLive}
                onChange={(e) => setIsLive(e.currentTarget.checked)}
                onLabel={<Play size={12} />}
                offLabel={<Pause size={12} />}
                size="md"
            />
            {!isLive && (
                <TimeRangeSelector
                    value={tr.timeRange}
                    onChange={tr.setTimeRange}
                />
            )}
        </Group>
    )
}
