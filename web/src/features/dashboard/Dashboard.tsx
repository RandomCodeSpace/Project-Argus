import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Row, Col, Card, Statistic, theme, Select, Button, Space, Skeleton, Empty } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import "highcharts/modules/heatmap";

// Ensure Highcharts is available globally for the heatmap module if needed
if (typeof window !== 'undefined') {
    (window as any).Highcharts = Highcharts;
    // Set Highcharts to use local timezone (offset in minutes from UTC)
    const timezoneOffset = new Date().getTimezoneOffset();
    Highcharts.setOptions({
        time: {
            timezoneOffset: timezoneOffset
        }
    });
}

// --- API Types ---
interface DashboardStats {
    total_traces: number;
    error_rate: number;
    active_services: number;
    p99_latency: number;
    top_failing_services: { service_name: string; error_count: number }[];
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

interface MetricCardProps {
    title: string;
    value?: number | string;
    precision?: number;
    suffix?: string;
    color?: string;
    loading: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, precision, suffix, color, loading }) => (
    <Card bordered={false}>
        <Skeleton loading={loading} active paragraph={{ rows: 1 }}>
            <Statistic
                title={title}
                value={value}
                precision={precision}
                suffix={suffix}
                valueStyle={{ color }}
            />
        </Skeleton>
    </Card>
);


interface DashboardProps {
    timeRange: [string, string] | null;
}

const Dashboard: React.FC<DashboardProps> = ({ timeRange }) => {
    const { token } = theme.useToken();
    const [selectedServices, setSelectedServices] = useState<string[]>(['order-service', 'payment-service']);

    // Queries
    const { data: stats, refetch: refetchStats, isLoading: isLoadingStats } = useQuery({
        queryKey: ['dashboardStats', timeRange, selectedServices],
        queryFn: () => fetchDashboardStats(timeRange?.[0], timeRange?.[1], selectedServices),
        refetchInterval: 10000
    });

    const { data: traffic, refetch: refetchTraffic, isLoading: isLoadingTraffic } = useQuery({
        queryKey: ['traffic', timeRange, selectedServices],
        queryFn: () => fetchTraffic(timeRange?.[0], timeRange?.[1], selectedServices),
        refetchInterval: 10000
    });

    const { data: heatmapData, refetch: refetchHeatmap, isLoading: isLoadingHeatmap } = useQuery({
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
    const trafficOptions: Highcharts.Options = useMemo(() => ({
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
                marker: { enabled: true, radius: 3 },
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
    }), [traffic, token.colorPrimary]);

    const heatmapOptions: Highcharts.Options = useMemo(() => ({
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
    }), [heatmapData]);

    const serviceHealthOptions: Highcharts.Options = useMemo(() => ({
        chart: { type: 'bar', height: 300, backgroundColor: 'transparent' },
        title: { text: undefined },
        xAxis: {
            categories: stats?.top_failing_services?.map(s => s.service_name) || [],
            title: { text: null }
        },
        yAxis: { min: 0, title: { text: 'Error Count', align: 'high' } },
        plotOptions: {
            bar: {
                dataLabels: { enabled: true },
                color: token.colorError
            }
        },
        legend: { enabled: false },
        series: [{
            type: 'bar',
            name: 'Errors',
            data: stats?.top_failing_services?.map(s => s.error_count) || []
        }],
        credits: { enabled: false }
    }), [stats?.top_failing_services, token.colorError]);

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
                    <MetricCard
                        title="Total Traces"
                        value={stats?.total_traces}
                        color={token.colorPrimary}
                        loading={isLoadingStats}
                    />
                </Col>
                <Col xs={24} sm={6}>
                    <MetricCard
                        title="Error Rate"
                        value={stats?.error_rate}
                        precision={2}
                        suffix="%"
                        color={(stats?.error_rate || 0) > 1 ? token.colorError : token.colorSuccess}
                        loading={isLoadingStats}
                    />
                </Col>
                <Col xs={24} sm={6}>
                    <MetricCard
                        title="P99 Latency"
                        value={(stats?.p99_latency || 0) / 1000}
                        precision={2}
                        suffix="ms"
                        loading={isLoadingStats}
                    />
                </Col>
                <Col xs={24} sm={6}>
                    <MetricCard
                        title="Active Services"
                        value={stats?.active_services}
                        loading={isLoadingStats}
                    />
                </Col>
            </Row>

            {/* Charts Row 1 */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} lg={16}>
                    <Card title="Traffic Volume (Req/Sec)" bordered={false} bodyStyle={{ minHeight: 350 }}>
                        {isLoadingTraffic ? (
                            <Skeleton active paragraph={{ rows: 6 }} />
                        ) : (traffic?.length || 0) > 0 ? (
                            <HighchartsReact highcharts={Highcharts} options={trafficOptions} />
                        ) : (
                            <Empty description="No Traffic Data" />
                        )}
                    </Card>
                </Col>
                <Col xs={24} lg={8}>
                    <Card title="Top Failing Services" bordered={false} bodyStyle={{ minHeight: 350 }}>
                        {isLoadingStats ? (
                            <Skeleton active paragraph={{ rows: 6 }} />
                        ) : (stats?.top_failing_services?.length || 0) > 0 ? (
                            <HighchartsReact highcharts={Highcharts} options={serviceHealthOptions} />
                        ) : (
                            <Empty description="No Errors Found" />
                        )}
                    </Card>
                </Col>
            </Row>

            {/* Charts Row 2 */}
            <Row gutter={[16, 16]}>
                <Col span={24}>
                    <Card title="Latency Distribution (Heatmap)" bordered={false} bodyStyle={{ minHeight: 350 }}>
                        {isLoadingHeatmap ? (
                            <Skeleton active paragraph={{ rows: 6 }} />
                        ) : (heatmapData?.length || 0) > 0 ? (
                            <HighchartsReact highcharts={Highcharts} options={heatmapOptions} />
                        ) : (
                            <Empty description="No Latency Data" />
                        )}
                    </Card>
                </Col>
            </Row>
        </div >
    );
};

export default Dashboard;
