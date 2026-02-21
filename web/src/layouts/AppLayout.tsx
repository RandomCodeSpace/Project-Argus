import { useFilterParamString } from '../hooks/useFilterParams'
import {
    AppShell,
    NavLink,
    Group,
    Title,
    Badge,
    Text,
    Box,
} from '@mantine/core'
import {
    LayoutDashboard,
    Network,
    ScrollText,
    Zap,
    BarChart3,
    Settings,
} from 'lucide-react'

import { Dashboard } from '../features/dashboard/Dashboard'
import { LogExplorer } from '../features/logs/LogExplorer'
import { ServiceMap } from '../features/topology/ServiceMap'
import { SettingsPage } from '../features/settings/Settings'
import { TraceExplorer } from '../features/traces/TraceExplorer'
import { MetricsExplorer } from '../features/metrics/MetricsExplorer'


type PageKey = 'dashboard' | 'map' | 'logs' | 'traces' | 'metrics' | 'settings'

const navItems: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'map', label: 'Service Map', icon: Network },
    { key: 'logs', label: 'Logs', icon: ScrollText },
    { key: 'traces', label: 'Traces', icon: Zap },
    { key: 'metrics', label: 'Metrics', icon: BarChart3 },
    { key: 'settings', label: 'Settings', icon: Settings },
]

export function AppLayout() {
    const [active, setActive] = useFilterParamString('page', 'dashboard') as [PageKey, (v: string) => void]

    const renderPage = () => {
        switch (active) {
            case 'dashboard': return <Dashboard />
            case 'map': return <ServiceMap />
            case 'logs': return <LogExplorer />
            case 'traces': return <TraceExplorer />
            case 'metrics': return <MetricsExplorer />
            case 'settings': return <SettingsPage />
        }
    }

    return (
        <AppShell
            navbar={{ width: 240, breakpoint: 'sm' }}
            padding="md"
            styles={{
                main: { background: 'var(--argus-bg)', minHeight: '100vh' },
                navbar: { background: 'var(--argus-sidebar-bg)', borderRight: 'none' },
            }}
        >
            <AppShell.Navbar p="md">
                {/* Logo */}
                <Group gap="xs" mb="xl" mt="xs">
                    <img src="/argus-logo.svg" alt="Argus Logo" style={{ width: 36, height: 36 }} />
                    <Box>
                        <Title order={4} c="white" style={{ letterSpacing: '0.05em' }}>ARGUS</Title>
                        <Badge size="xs" variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }}>{__APP_VERSION__}</Badge>
                    </Box>
                </Group>

                {/* Navigation */}
                {navItems.map((item) => (
                    <NavLink
                        key={item.key}
                        label={<Text size="sm" c="var(--argus-sidebar-text)">{item.label}</Text>}
                        leftSection={
                            <item.icon
                                size={18}
                                color={active === item.key ? 'var(--argus-sidebar-active)' : 'var(--argus-sidebar-text)'}
                            />
                        }
                        active={active === item.key}
                        onClick={() => setActive(item.key)}
                        variant="subtle"
                        styles={(theme) => ({
                            root: {
                                borderRadius: theme.radius.md,
                                marginBottom: 4,
                            },
                        })}
                    />
                ))}

                {/* Version Info at bottom */}
                <Box mt="auto" pt="md" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <Text size="xs" c="dimmed" ta="center">Production Hardened Edition</Text>
                    <Text size="xs" c="dimmed" ta="center">{__APP_VERSION__ === 'DEV' ? 'DEV MODE' : 'PROD MODE'}</Text>
                </Box>
            </AppShell.Navbar>

            <AppShell.Main style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
                <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {renderPage()}
                </Box>
            </AppShell.Main>
        </AppShell>
    )
}
