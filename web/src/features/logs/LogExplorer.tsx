import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Input, Select, Button, Space, Typography, Tooltip, Modal, Alert, Spin } from 'antd';
import { SearchOutlined, ReloadOutlined, EyeOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import { BrainCircuit } from 'lucide-react';
import { format } from 'date-fns';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import {
    useReactTable,
    getCoreRowModel,
    getExpandedRowModel,
    type ColumnDef,
    flexRender,
    type PaginationState,
} from '@tanstack/react-table';

const { Text } = Typography;

// --- Types ---
interface LogEntry {
    ID: number;
    TraceID: string;
    Severity: string;
    Body: string;
    ServiceName: string;
    Timestamp: string;
    AIInsight?: string;
    AttributesJSON?: string;
}

interface LogResponse {
    data: LogEntry[];
    total: number;
}

// --- Fetcher ---
const fetchLogs = async (params: any) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value) searchParams.append(key, value as string);
    });
    const res = await fetch(`/api/logs?${searchParams.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch logs');
    return res.json() as Promise<LogResponse>;
};

const fetchContextLogs = async (timestamp: string) => {
    const res = await fetch(`/api/logs/context?timestamp=${encodeURIComponent(timestamp)}`);
    if (!res.ok) throw new Error('Failed to fetch context');
    return res.json() as Promise<LogEntry[]>;
};

// --- Context Modal Component ---
const ContextModal: React.FC<{ isOpen: boolean; onClose: () => void; targetLog: LogEntry | null }> = ({ isOpen, onClose, targetLog }) => {
    const { data: contextLogs, isLoading } = useQuery({
        queryKey: ['logContext', targetLog?.ID],
        queryFn: () => fetchContextLogs(targetLog?.Timestamp || ''),
        enabled: !!targetLog && isOpen
    });

    return (
        <Modal
            title="Log Context Analysis (+/- 1 Minute)"
            open={isOpen}
            onCancel={onClose}
            width={1000}
            footer={null}
        >
            {isLoading ? <Spin style={{ display: 'block', margin: '20px auto' }} /> : (
                <Table
                    dataSource={contextLogs || []}
                    rowKey="ID"
                    size="small"
                    pagination={false}
                    scroll={{ y: 400 }}
                    rowClassName={(record) => record.ID === targetLog?.ID ? 'ant-table-row-selected' : ''}
                    columns={[
                        { title: 'Time', dataIndex: 'Timestamp', width: 140, render: (t: string) => <Text type="secondary" style={{ fontSize: 11 }}>{format(new Date(t), 'HH:mm:ss.SSS')}</Text> },
                        { title: 'Svc', dataIndex: 'ServiceName', width: 120, render: (s: string) => <Text strong style={{ fontSize: 11 }}>{s}</Text> },
                        { title: 'Sev', dataIndex: 'Severity', width: 80, render: (s: string) => <Tag color={s === 'ERROR' ? 'red' : s === 'WARN' ? 'gold' : 'cyan'}>{s}</Tag> },
                        { title: 'Message', dataIndex: 'Body', render: (t: string) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{t}</Text> }
                    ]}
                />
            )}
        </Modal>
    );
};


interface LogExplorerProps {
    initialParams?: {
        search?: string;
        service?: string;
        severity?: string;
    };
    timeRange: [string, string] | null;
}

const LogExplorer: React.FC<LogExplorerProps> = ({ initialParams, timeRange }) => {
    // Filters
    const [service, setService] = useState<string | undefined>(initialParams?.service);
    const [severity, setSeverity] = useState<string | undefined>(initialParams?.severity);

    // Search State: distinct input vs active query
    const [tempSearch, setTempSearch] = useState<string>(initialParams?.search || '');
    const [search, setSearch] = useState<string>(initialParams?.search || '');

    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 50,
    });
    const [expanded, setExpanded] = useState({});

    // Sync with initialParams if they change
    useEffect(() => {
        if (initialParams) {
            if (initialParams.service !== undefined) setService(initialParams.service);
            if (initialParams.severity !== undefined) setSeverity(initialParams.severity);
            if (initialParams.search !== undefined) {
                setTempSearch(initialParams.search);
                setSearch(initialParams.search);
            }
        }
    }, [initialParams]);

    // Context State
    const [contextLog, setContextLog] = useState<LogEntry | null>(null);

    // Query
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['logs', service, severity, search, pagination.pageIndex, pagination.pageSize, timeRange],
        queryFn: () => fetchLogs({
            service_name: service,
            severity,
            search,
            limit: pagination.pageSize,
            offset: pagination.pageIndex * pagination.pageSize,
            start: timeRange?.[0],
            end: timeRange?.[1]
        }),
        refetchInterval: 5000
    });

    // Helper: Severity Color
    const getSeverityColor = (sev: string) => {
        const s = sev.toUpperCase();
        if (s.includes('ERROR') || s.includes('FATAL')) return 'red';
        if (s.includes('WARN')) return 'gold';
        if (s === 'INFO') return 'cyan';
        return 'default';
    };

    // Columns
    const columns = React.useMemo<ColumnDef<LogEntry>[]>(() => [
        {
            id: 'expander',
            header: () => null,
            cell: ({ row }) => (
                row.getCanExpand() ? (
                    <Button
                        type="text"
                        size="small"
                        icon={row.getIsExpanded() ? <DownOutlined /> : <RightOutlined />}
                        onClick={row.getToggleExpandedHandler()}
                        style={{ cursor: 'pointer' }}
                    />
                ) : null
            ),
            size: 40,
        },
        {
            accessorKey: 'Timestamp',
            header: 'Timestamp',
            cell: info => <Text type="secondary" style={{ fontFamily: 'monospace' }}>{format(new Date(info.getValue() as string), 'HH:mm:ss.SSS')}</Text>,
            size: 150,
        },
        {
            accessorKey: 'Severity',
            header: 'Severity',
            cell: info => <Tag color={getSeverityColor(info.getValue() as string)}>{info.getValue() as string}</Tag>,
            size: 90,
        },
        {
            accessorKey: 'ServiceName',
            header: 'Service',
            size: 140,
        },
        {
            accessorKey: 'Body',
            header: 'Message',
            cell: info => (
                <Space>
                    <Text ellipsis={{ tooltip: info.getValue() as string }} style={{ maxWidth: 500, fontFamily: 'monospace' }}>
                        {info.getValue() as string}
                    </Text>
                    {info.row.original.AIInsight && (
                        <Tooltip title="AI Insight Available">
                            <BrainCircuit size={16} color="#722ed1" />
                        </Tooltip>
                    )}
                </Space>
            ),
        },
        {
            id: 'actions',
            header: 'Action',
            cell: ({ row }) => (
                <Button
                    type="link"
                    size="small"
                    icon={<EyeOutlined size={14} />}
                    onClick={() => setContextLog(row.original)}
                >
                    Context
                </Button>
            ),
            size: 100,
        }
    ], []);

    const table = useReactTable({
        data: data?.data || [],
        columns,
        state: {
            pagination,
            expanded,
        },
        pageCount: data?.total ? Math.ceil(data.total / pagination.pageSize) : -1,
        manualPagination: true,
        onPaginationChange: setPagination,
        onExpandedChange: setExpanded,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getRowCanExpand: () => true,
    });

    // Chart Data Preparation (Client-side aggregation for demo, ideally server-side)
    const chartData = (data?.data || []).reduce((acc: any, log) => {
        // Group by minute
        const bucket = format(new Date(log.Timestamp), 'HH:mm');
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
    }, {});

    // Convert to Highcharts series
    // Sort keys
    const chartCategories = Object.keys(chartData).sort();
    const chartSeriesData = chartCategories.map(k => chartData[k]);


    const volumeOptions: Highcharts.Options = {
        chart: { type: 'column', height: 100, backgroundColor: 'transparent' },
        title: { text: undefined },
        xAxis: { categories: chartCategories, labels: { enabled: false }, tickWidth: 0 },
        yAxis: { visible: false, title: { text: undefined } },
        legend: { enabled: false },
        plotOptions: {
            column: {
                borderRadius: 2,
                color: '#1677ff',
                pointWidth: 10
            }
        },
        series: [{ type: 'column', name: 'Logs', data: chartSeriesData }],
        credits: { enabled: false }
    };

    return (
        <div>
            {/* Volume Chart */}
            <Card bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#8c8c8c', marginBottom: 4 }}>LOG VOLUME (Recent)</div>
                <HighchartsReact highcharts={Highcharts} options={volumeOptions} />
            </Card>

            {/* Filter Toolbar */}
            <Card bodyStyle={{ padding: '16px' }} style={{ marginBottom: 16 }}>
                <Space wrap>
                    <Input
                        prefix={<SearchOutlined />}
                        placeholder="Search logs..."
                        style={{ width: 300 }}
                        value={tempSearch}
                        onChange={(e) => setTempSearch(e.target.value)}
                        onPressEnter={() => {
                            setPagination(prev => ({ ...prev, pageIndex: 0 }));
                            setSearch(tempSearch);
                        }}
                    />
                    <Select
                        placeholder="Service"
                        allowClear
                        style={{ width: 150 }}
                        onChange={(v) => {
                            setService(v);
                            setPagination(prev => ({ ...prev, pageIndex: 0 }));
                        }}
                        value={service}
                        options={[
                            { value: 'order-service', label: 'Order Service' },
                            { value: 'payment-service', label: 'Payment Service' }
                        ]}
                    />
                    <Select
                        placeholder="Severity"
                        allowClear
                        style={{ width: 120 }}
                        onChange={(v) => {
                            setSeverity(v);
                            setPagination(prev => ({ ...prev, pageIndex: 0 }));
                        }}
                        value={severity}
                        options={[
                            { value: 'ERROR', label: 'ERROR' },
                            { value: 'WARN', label: 'WARN' },
                            { value: 'INFO', label: 'INFO' }
                        ]}
                    />
                    <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Refresh</Button>
                </Space>
            </Card>

            {/* Log Table (TanStack) */}
            <Card bodyStyle={{ padding: 0, overflow: 'hidden' }} bordered={false}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                            {table.getHeaderGroups().map(headerGroup => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map(header => (
                                        <th key={header.id} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#595959' }}>
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                        </th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center' }}><Spin /></td></tr>
                            ) : table.getRowModel().rows.map(row => (
                                <React.Fragment key={row.id}>
                                    <tr className="hover:bg-gray-50" style={{ borderBottom: '1px solid #f0f0f0' }}>
                                        {row.getVisibleCells().map(cell => (
                                            <td key={cell.id} style={{ padding: '12px 16px' }}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                    {row.getIsExpanded() && (
                                        <tr>
                                            <td colSpan={columns.length} style={{ padding: '0 24px 24px 24px', background: '#fafafa' }}>
                                                {(() => {
                                                    const record = row.original;
                                                    let parsedBody = record.Body;
                                                    try {
                                                        parsedBody = JSON.stringify(JSON.parse(record.Body), null, 2);
                                                    } catch (e) {
                                                        // Keep original body
                                                    }

                                                    let parsedAttributes = '{}';
                                                    if (record.AttributesJSON) {
                                                        try {
                                                            parsedAttributes = JSON.stringify(JSON.parse(record.AttributesJSON), null, 2);
                                                        } catch (e) {
                                                            parsedAttributes = record.AttributesJSON || '{}';
                                                        }
                                                    }

                                                    return (
                                                        <div style={{ marginTop: 12, padding: 16, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 4 }}>
                                                            {record.AIInsight && (
                                                                <Alert
                                                                    message="AI Analysis Insight"
                                                                    description={record.AIInsight}
                                                                    type="info"
                                                                    showIcon
                                                                    icon={<BrainCircuit />}
                                                                    style={{ marginBottom: 16, borderColor: '#722ed1', backgroundColor: '#f9f0ff' }}
                                                                />
                                                            )}
                                                            <div style={{ maxHeight: 300, overflow: 'auto' }}>
                                                                <Typography.Text strong>Body:</Typography.Text>
                                                                <pre style={{ margin: '4px 0 12px 0', fontSize: 11, color: '#595959', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                                                                    {parsedBody}
                                                                </pre>

                                                                {record.AttributesJSON && (
                                                                    <>
                                                                        <Typography.Text strong>Attributes:</Typography.Text>
                                                                        <pre style={{ margin: '4px 0', fontSize: 11, color: '#595959', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                                                                            {parsedAttributes}
                                                                        </pre>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div style={{ padding: '12px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text type="secondary">Showing {table.getRowModel().rows.length} of {data?.total || 0} logs</Text>
                    <Space>
                        <Button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Previous</Button>
                        <span style={{ margin: '0 8px' }}>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
                        <Button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next</Button>
                        <Select
                            value={table.getState().pagination.pageSize}
                            onChange={e => table.setPageSize(Number(e))}
                            options={[
                                { value: 20, label: '20 / page' },
                                { value: 50, label: '50 / page' },
                                { value: 100, label: '100 / page' },
                            ]}
                            style={{ width: 120 }}
                        />
                    </Space>
                </div>
            </Card>

            <ContextModal
                isOpen={!!contextLog}
                onClose={() => setContextLog(null)}
                targetLog={contextLog}
            />
        </div>
    );
};

export default LogExplorer;
