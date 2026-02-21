import { useMemo } from 'react'
import { Group, Select } from '@mantine/core'
import { useFilterParam } from '../hooks/useFilterParams'
import { useLiveMode } from '../contexts/LiveModeContext'

export const TIME_RANGES = [
    { value: '5m', label: 'Last 5 min' },
    { value: '15m', label: 'Last 15 min' },
    { value: '1h', label: 'Last 1 hour' },
    { value: '6h', label: 'Last 6 hours' },
    { value: '24h', label: 'Last 24 hours' },
]

const RANGE_MINUTES: Record<string, number> = {
    '5m': 5,
    '15m': 15,
    '1h': 60,
    '6h': 360,
    '24h': 1440,
}

// Helper to calculate start/end ISO strings from a range
export function getRangeTimes(range: string) {
    const mins = RANGE_MINUTES[range] || 5
    const now = new Date()
    const start = new Date(now.getTime() - mins * 60 * 1000)
    return { start: start.toISOString(), end: now.toISOString() }
}

interface TimeRangeSelectorProps {
    value: string | null
    onChange: (value: string) => void
}

export function TimeRangeSelector({
    value,
    onChange,
}: TimeRangeSelectorProps) {
    // If value is not a known preset, default to 5m for display or handle gracefully
    const selectedValue = (value && RANGE_MINUTES[value]) ? value : '5m'

    return (
        <Group gap="xs">
            <Select
                size="xs"
                data={TIME_RANGES}
                value={selectedValue}
                onChange={(v) => v && onChange(v)}
                styles={{ input: { width: 140 } }}
                allowDeselect={false}
            />
        </Group>
    )
}

/** Hook for time range state — persisted to URL search params */
export function useTimeRange(defaultRange = '5m') {
    const [rangeParam, setRangeParam] = useFilterParam('range', null)
    const [fromParam, setFromParam] = useFilterParam('from', null)
    const [toParam, setToParam] = useFilterParam('to', null)
    const { refreshTrigger, refresh } = useLiveMode()

    // Helper to clear discrete params when setting a range
    const setTimeRange = (val: string) => {
        setRangeParam(val)
        // Clear from/to to keep URL clean as requested
        setFromParam(null)
        setToParam(null)
    }

    // Determine effective range and start/end times
    const { timeRange, start, end } = useMemo(() => {
        // 1. If we have a valid range param, use it (Dynamic Mode)
        if (rangeParam && RANGE_MINUTES[rangeParam]) {
            const times = getRangeTimes(rangeParam)
            return { timeRange: rangeParam, start: times.start, end: times.end }
        }

        // 2. If we have explicit from/to params (Static Mode / Drilldown)
        if (fromParam && toParam) {
            return { timeRange: 'custom', start: fromParam, end: toParam }
        }

        // 3. Fallback to default
        const times = getRangeTimes(defaultRange)
        return { timeRange: defaultRange, start: times.start, end: times.end }

    }, [rangeParam, fromParam, toParam, defaultRange, refreshTrigger])

    return {
        timeRange,
        setTimeRange,
        start,
        end,
        refresh,
        setCustomRange: (s: string, e: string) => {
            setRangeParam(null)
            setFromParam(s)
            setToParam(e)
        }
    }
}
