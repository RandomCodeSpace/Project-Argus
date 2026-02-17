import React, { useState } from 'react';
import { Layout, Menu, theme } from 'antd';
import { LayoutDashboard, ScrollText, Activity, Settings as SettingsIcon } from 'lucide-react';
import Dashboard from '../features/dashboard/Dashboard';
import LogExplorer from '../features/logs/LogExplorer';
import Traces from '../features/traces/Traces';
import Settings from '../features/settings/Settings';
import Header from './Header';
import dayjs from 'dayjs';

const { Sider, Content } = Layout;

const AppLayout: React.FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const [selectedKey, setSelectedKey] = useState('dashboard');
    const [pageParams, setPageParams] = useState<any>({});

    // Global Time State (Default: Last 5 Minutes)
    const [timeRange, setTimeRange] = useState<[string, string] | null>([
        dayjs().subtract(5, 'minute').toISOString(),
        dayjs().toISOString()
    ]);

    const {
        token: { colorBgContainer },
    } = theme.useToken();

    const handleNavigate = (key: string, params?: any) => {
        setPageParams(params || {});
        setSelectedKey(key);
    };

    const renderContent = () => {
        switch (selectedKey) {
            case 'dashboard': return <Dashboard timeRange={timeRange} />;
            case 'logs': return <LogExplorer initialParams={pageParams} timeRange={timeRange} />;
            case 'traces': return <Traces onNavigate={handleNavigate} timeRange={timeRange} />;
            case 'settings': return <Settings />;
            default: return <Dashboard timeRange={timeRange} />;
        }
    };

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider trigger={null} collapsible collapsed={collapsed} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
                <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}>
                    {/* Logo Area */}
                    <Activity size={24} color="#1677ff" />
                    {!collapsed && <span style={{ marginLeft: 8, fontWeight: 'bold', fontSize: 16 }}>Project Argus</span>}
                </div>
                <Menu
                    theme="light"
                    mode="inline"
                    defaultSelectedKeys={['dashboard']}
                    selectedKeys={[selectedKey]}
                    onClick={(e) => setSelectedKey(e.key)}
                    items={[
                        {
                            key: 'dashboard',
                            icon: <LayoutDashboard size={18} />,
                            label: 'Dashboard',
                        },
                        {
                            key: 'logs',
                            icon: <ScrollText size={18} />,
                            label: 'Logs',
                        },
                        {
                            key: 'traces',
                            icon: <Activity size={18} />,
                            label: 'Traces',
                        },
                        {
                            key: 'settings',
                            icon: <SettingsIcon size={18} />,
                            label: 'Settings',
                        },
                    ]}
                />
            </Sider>
            <Layout>
                <Header
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    timeRange={timeRange}
                    setTimeRange={setTimeRange}
                />
                <Content
                    style={{
                        margin: '24px 16px',
                        padding: 24,
                        minHeight: 280,
                        background: colorBgContainer,
                        overflow: 'initial' // Allow scroll
                    }}
                >
                    {renderContent()}
                </Content>
            </Layout>
        </Layout>
    );
};

export default AppLayout;
