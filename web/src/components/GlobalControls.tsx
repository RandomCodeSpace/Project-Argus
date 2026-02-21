import { Group, Switch, Text, Badge, ActionIcon, Tooltip } from '@mantine/core'
import { Play, Pause, RefreshCw } from 'lucide-react'
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
                <Group gap="xs">
                    <TimeRangeSelector
                        value={tr.timeRange}
                        onChange={tr.setTimeRange}
                    />
                    <Tooltip label="Refresh data">
                        <ActionIcon
                            variant="light"
                            size="md"
                            onClick={tr.refresh}
                            aria-label="Refresh"
                        >
                            <RefreshCw size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            )}
        </Group>
    )
}
