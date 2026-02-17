import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Row, Col, Card, Statistic, theme, Select, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import "highcharts/modules/heatmap";

// Ensure Highcharts is available globally for the heatmap module if needed
if (typeof window !== 'undefined') {
    (window as any).Highcharts = Highcharts;
}



// --- API Types ---
interface DashboardStats {
    total_traces: number;
    error_rate: number;
    active_services: number;
    p99_latency: number;
}

interface TrafficPoint {
    timestamp: string;
    count: number;
}

interface LatencyPoint {
    timestamp: string;
    duration: number;
}

// --- Fetch Functions ---
const fetchDashboardStats = async (start?: string, end?: string, services?: string[]) => {
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    services?.forEach(s => params.append('service_name', s));
    const res = await fetch(`/api/metrics/dashboard?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json() as Promise<DashboardStats>;
};

const fetchTraffic = async (start?: string, end?: string, services?: string[]) => {
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    services?.forEach(s => params.append('service_name', s));
    const res = await fetch(`/api/metrics/traffic?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch traffic');
    return res.json() as Promise<TrafficPoint[]>;
};

const fetchHeatmap = async (start?: string, end?: string, services?: string[]) => {
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    services?.forEach(s => params.append('service_name', s));
    const res = await fetch(`/api/metrics/latency_heatmap?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch heatmap');
    return res.json() as Promise<LatencyPoint[]>;
};

interface DashboardProps {
    timeRange: [string, string] | null;
}

const Dashboard: React.FC<DashboardProps> = ({ timeRange }) => {
    const { token } = theme.useToken();
    // const [timeRange, setTimeRange] = useState<[string, string] | null>(null); // Removed local state
    const [selectedServices, setSelectedServices] = useState<string[]>(['order-service', 'payment-service']);

    // Queries
    const { data: stats, refetch: refetchStats } = useQuery({
        queryKey: ['dashboardStats', timeRange, selectedServices],
        queryFn: () => fetchDashboardStats(timeRange?.[0], timeRange?.[1], selectedServices),
        refetchInterval: 10000
    });

    const { data: traffic, refetch: refetchTraffic } = useQuery({
        queryKey: ['traffic', timeRange, selectedServices],
        queryFn: () => fetchTraffic(timeRange?.[0], timeRange?.[1], selectedServices),
        refetchInterval: 10000
    });

    const { data: heatmapData, refetch: refetchHeatmap } = useQuery({
        queryKey: ['heatmap', timeRange, selectedServices],
        queryFn: () => fetchHeatmap(timeRange?.[0], timeRange?.[1], selectedServices),
        refetchInterval: 10000
    });

    const handleRefresh = () => {
        refetchStats();
        refetchTraffic();
        refetchHeatmap();
    };

    // Chart Options
    const trafficOptions: Highcharts.Options = {
        chart: { type: 'areaspline', height: 300, backgroundColor: 'transparent' },
        title: { text: undefined },
        xAxis: {
            type: 'datetime',
            title: { text: null }
        },
        yAxis: { title: { text: 'Req/Sec' }, gridLineDashStyle: 'Dash' },
        plotOptions: {
            areaspline: {
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [
                        [0, token.colorPrimary],
                        [1, 'rgba(255,255,255,0)']
                    ]
                },
                marker: { enabled: false },
                lineWidth: 2,
                color: token.colorPrimary
            }
        },
        series: [{
            type: 'areaspline',
            name: 'Traffic',
            data: traffic?.map(p => [new Date(p.timestamp).getTime(), p.count]) || []
        }],
        credits: { enabled: false }
    };

    // Heatmap Options (Simplified Scatter for now as Heatmap module requires specific data structure)
    // Actually, let's use a Scatter chart with color mapped to Y (Latency) to emulate a heatmap feel or just basic scatter
    const heatmapOptions: Highcharts.Options = {
        chart: { type: 'scatter', height: 300, backgroundColor: 'transparent' },
        title: { text: undefined },
        xAxis: { type: 'datetime' },
        yAxis: { title: { text: 'Duration (µs)' }, min: 0 },
        plotOptions: {
            scatter: {
                marker: {
                    radius: 2,
                    states: { hover: { enabled: true, lineColor: 'rgb(100,100,100)' } }
                },
                tooltip: {
                    headerFormat: '<b>{series.name}</b><br>',
                    pointFormat: '{point.x:%H:%M:%S}, {point.y} µs'
                }
            }
        },
        series: [{
            type: 'scatter',
            name: 'Trace Latency',
            color: 'rgba(223, 83, 83, .5)',
            data: heatmapData?.map(p => [new Date(p.timestamp).getTime(), p.duration]) || []
        }],
        credits: { enabled: false }
    };

    return (
        <div>
            {/* Global Filter Bar */}
            <Card style={{ marginBottom: 24 }} bodyStyle={{ padding: '16px 24px' }}>
                <Row justify="space-between" align="middle">
                    <Col>
                        <Space size="large">
                            <span style={{ fontWeight: 500, color: token.colorTextSecondary }}>FILTERS:</span>
                            <Select
                                mode="multiple"
                                style={{ width: 300 }}
                                placeholder="Filter by Service"
                                defaultValue={['order-service', 'payment-service']}
                                onChange={setSelectedServices}
                                options={[
                                    { value: 'order-service', label: 'Order Service' },
                                    { value: 'payment-service', label: 'Payment Service' },
                                ]}
                            />
                            {/* RangePicker moved to Global Header */}
                            {/* RangePicker moved to Global Header */}
                        </Space>
                    </Col>
                    <Col>
                        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
                            Refresh
                        </Button>
                    </Col>
                </Row>
            </Card>

            {/* Metrics Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={6}>
                    <Card bordered={false}>
                        <Statistic
                            title="Total Traces"
                            value={stats?.total_traces || 0}
                            valueStyle={{ color: token.colorPrimary }}
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={6}>
                    <Card bordered={false}>
                        <Statistic
                            title="Error Rate"
                            value={stats?.error_rate || 0}
                            precision={2}
                            suffix="%"
                            valueStyle={{ color: (stats?.error_rate || 0) > 1 ? token.colorError : token.colorSuccess }}
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={6}>
                    <Card bordered={false}>
                        <Statistic
                            title="P99 Latency"
                            value={(stats?.p99_latency || 0) / 1000}
                            precision={2}
                            suffix="ms"
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={6}>
                    <Card bordered={false}>
                        <Statistic
                            title="Active Services"
                            value={stats?.active_services || 0}
                        />
                    </Card>
                </Col>
            </Row>

            {/* Charts Row 1 */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} lg={16}>
                    <Card title="Traffic Volume (Req/Sec)" bordered={false}>
                        <HighchartsReact highcharts={Highcharts} options={trafficOptions} />
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card title="Service Health" bordered={false} style={{ height: '100%' }}>
                        {/* Placeholder for Top Failing Services or Health Status */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: token.colorTextTertiary }}>
                            Service Health Visualization
                            <br />(Coming Soon)
                        </div>
                    </Card>
                </Col>
            </Row>

            {/* Charts Row 2 */}
            <Row gutter={[16, 16]}>
                <Col span={24}>
                    <Card title="Latency Distribution (Heatmap)" bordered={false}>
                        <HighchartsReact highcharts={Highcharts} options={heatmapOptions} />
                    </Card>
                </Col>
            </Row>
        </div >
    );
};

export default Dashboard;
