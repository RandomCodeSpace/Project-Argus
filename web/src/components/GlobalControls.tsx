import { Group, Switch, Text, Badge, ActionIcon, Tooltip, Select } from '@mantine/core'
import { Play, Pause, RefreshCw } from 'lucide-react'
import { useLiveMode } from '../contexts/LiveModeContext'
import { TimeRangeSelector, useTimeRange } from './TimeRangeSelector'
import { useFilterParamString, useFilterParam } from '../hooks/useFilterParams'
import { useQuery } from '@tanstack/react-query'

export function GlobalControls() {
    const { isLive, setIsLive } = useLiveMode()
    const tr = useTimeRange('5m')
    const [page] = useFilterParamString('page', 'dashboard')
    const [selectedService, setSelectedService] = useFilterParam('service', null)

    const isLiveSupported = page === 'dashboard' || page === 'map'
    const isServiceFilterSupported = page === 'dashboard' || page === 'logs' || page === 'traces'
    const showHistoricalControls = !isLive || !isLiveSupported

    const { data: services } = useQuery<string[]>({
        queryKey: ['services'],
        queryFn: () => fetch('/api/metadata/services').then(r => r.json()),
        staleTime: 60000,
        refetchOnWindowFocus: false,
    })

    const formatDateTime = (startIso: string, endIso: string) => {
        const s = new Date(startIso)
        const e = new Date(endIso)

        const formatDate = (d: Date) => {
            const day = d.getDate().toString().padStart(2, '0')
            const month = d.toLocaleString('en-US', { month: 'short' })
            const year = d.getFullYear()
            return `${day}-${month}-${year}`
        }

        const formatTime = (d: Date) => {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        }

        const sDate = formatDate(s)
        const eDate = formatDate(e)

        if (sDate === eDate) {
            return `${sDate} ${formatTime(s)} - ${formatTime(e)}`
        }
        return `${sDate} ${formatTime(s)} - ${eDate} ${formatTime(e)}`
    }

    return (
        <Group gap="md">

            {isServiceFilterSupported && (
                <Select
                    size="xs"
                    placeholder="All Services"
                    data={[{ value: '', label: 'All Services' }, ...(services || []).map(s => ({ value: s, label: s }))]}
                    value={selectedService || ''}
                    onChange={(v) => setSelectedService(v || null)}
                    clearable
                    styles={{ input: { width: 160 } }}
                />
            )}
            {showHistoricalControls && (
                <Group gap="xs">
                    <Badge variant="light" color="gray" size="sm" style={{ fontFamily: 'var(--font-mono)', textTransform: 'none' }}>
                        {formatDateTime(tr.start, tr.end)}
                    </Badge>
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
            {isLiveSupported && (
                <Switch
                    label={
                        <Group gap={6}>
                            <Text size="sm" fw={500}>Live Mode</Text>
                        </Group>
                    }
                    checked={isLive}
                    onChange={(e) => setIsLive(e.currentTarget.checked)}
                    onLabel={<Play size={12} />}
                    offLabel={<Pause size={12} />}
                    size="md"
                />
            )}
        </Group>
    )
}
