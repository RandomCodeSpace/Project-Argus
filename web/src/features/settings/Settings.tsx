import React from 'react';
import { Card, Typography, Divider, List, Tag, Button, Space, Descriptions } from 'antd';
import { Database, Server, ShieldCheck, RefreshCw } from 'lucide-react';

const { Title, Text } = Typography;

const Settings: React.FC = () => {
    // Mock Data (In real implementation, fetch from API)
    const systemInfo = {
        version: "2.0.0 (Enterprise)",
        environment: "Production", // Should match .env
        uptime: "99.99%",
        database: "MySQL 8.0",
        ingestionStatus: "Active"
    };

    const configSettings = [
        { label: "HTTP Port", value: "8080" },
        { label: "gRPC Port", value: "4317" },
        { label: "Log Retention", value: "30 Days" },
        { label: "Trace Retention", value: "7 Days" },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <ShieldCheck size={32} color="#52c41a" />
                        <div>
                            <Title level={4} style={{ margin: 0 }}>System Status</Title>
                            <Text type="secondary">All systems operational</Text>
                        </div>
                    </div>
                    <Button icon={<RefreshCw size={16} />}>Refresh Status</Button>
                </div>

                <Descriptions bordered column={{ xxl: 4, xl: 3, lg: 3, md: 3, sm: 2, xs: 1 }}>
                    <Descriptions.Item label="Version">{systemInfo.version}</Descriptions.Item>
                    <Descriptions.Item label="Environment">
                        <Tag color="blue">{systemInfo.environment}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Database">
                        <Space>
                            <Database size={14} />
                            {systemInfo.database}
                        </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Ingestion">
                        <Tag color="success">{systemInfo.ingestionStatus}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Uptime">{systemInfo.uptime}</Descriptions.Item>
                </Descriptions>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <Card title={<Space><Server size={18} /> Configuration</Space>}>
                    <List
                        itemLayout="horizontal"
                        dataSource={configSettings}
                        renderItem={item => (
                            <List.Item>
                                <List.Item.Meta
                                    title={item.label}
                                />
                                <Text code>{item.value}</Text>
                            </List.Item>
                        )}
                    />
                </Card>

                <Card title="Data Management">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <Text strong>Purge Old Logs</Text>
                                <br />
                                <Text type="secondary" style={{ fontSize: 12 }}>Deletes logs older than retention period</Text>
                            </div>
                            <Button danger>Purge Now</Button>
                        </div>
                        <Divider style={{ margin: '12px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <Text strong>Reset Analytics</Text>
                                <br />
                                <Text type="secondary" style={{ fontSize: 12 }}>Clear cached dashboard metrics</Text>
                            </div>
                            <Button>Reset</Button>
                        </div>
                    </Space>
                </Card>
            </div>
        </Space>
    );
};

export default Settings;
