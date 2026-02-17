import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTraces } from '../../api/traces';
import type { Trace, Span } from '../../types';
import {
    useReactTable,
    getCoreRowModel,
    getExpandedRowModel,
    type ColumnDef,
    flexRender,
    type SortingState,
    type PaginationState,
} from '@tanstack/react-table';
import {
    Card, Select, Input, Tag, Button, Space, Row, Col,
    Typography, Table
} from 'antd';
import {
    ReloadOutlined,
    SearchOutlined,
    DownOutlined,
    RightOutlined,
    CaretUpOutlined,
    CaretDownOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);


const { Title } = Typography;

interface TracesProps {
    onNavigate?: (key: string, params?: any) => void;
    timeRange: [string, string] | null;
}

const Traces: React.FC<TracesProps> = ({ onNavigate, timeRange }) => {
    // Local state
    const [selectedServices, setSelectedServices] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState<string>('');
    // Table state
    const [sorting, setSorting] = useState<SortingState>([]);
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 20, // Revert to fixed default
    });
    const [expanded, setExpanded] = useState({});


    // Fetch data
    const limit = pagination.pageSize;
    const offset = pagination.pageIndex * limit;

    const { data, refetch, isLoading } = useQuery({
        queryKey: ['traces', timeRange, selectedServices, statusFilter, searchQuery, limit, offset, sorting],
        queryFn: () => {
            const sortField = sorting.length > 0 ? sorting[0].id : undefined;
            const sortOrder = sorting.length > 0 ? (sorting[0].desc ? 'desc' : 'asc') : undefined;

            return fetchTraces(
                timeRange?.[0],
                timeRange?.[1],
                selectedServices,
                statusFilter,
                searchQuery,
                limit,
                offset,
                sortField,
                sortOrder
            );
        },
        refetchInterval: 10000
    });

    const handleRefresh = useCallback(() => {
        refetch();
    }, [refetch]);

    const handleSearch = useCallback((value: string) => {
        setSearchQuery(value);
        setPagination(prev => ({ ...prev, pageIndex: 0 })); // Reset to first page
    }, []);

    const formatDuration = useCallback((microseconds: number) => {
        if (!microseconds) return 'N/A';
        if (microseconds < 1000) return `${microseconds} μs`;
        const ms = microseconds / 1000;
        if (ms < 1000) return `${ms.toFixed(2)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
    }, []);

    const getStatusColor = useCallback((status: string) => {
        if (!status) return 'default';
        if (status.includes('ERROR')) return 'error';
        if (status.includes('OK')) return 'success';
        return 'default';
    }, []);


    // Removed local RangePicker logic as it is now global


    // Column Definitions
    const columns = useMemo<ColumnDef<Trace>[]>(() => [
        {
            id: 'expander',
            header: () => null,
            cell: ({ row }) => (
                row.getCanExpand() ? (
                    <Button
                        type="text"
                        size="small"
                        icon={row.getIsExpanded() ? <DownOutlined /> : <RightOutlined />}
                        onClick={(e) => {
                            e.stopPropagation();
                            row.toggleExpanded();
                        }}
                        style={{ cursor: 'pointer' }}
                    />
                ) : null
            ),
            size: 40,
        },
        {
            accessorKey: 'trace_id',
            header: 'Trace ID',
            cell: info => {
                const id = info.getValue() as string;
                return (
                    <Typography.Text
                        style={{ fontSize: '12px', fontFamily: 'monospace', color: '#1677ff', cursor: 'pointer' }}
                        ellipsis={{ tooltip: id }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onNavigate) {
                                onNavigate('logs', { search: id });
                            }
                        }}
                    >
                        {id || 'N/A'}
                    </Typography.Text>
                );
            },
            size: 220, // Increased size
        },
        {
            accessorKey: 'service_name',
            header: 'Service',
            size: 150,
        },
        {
            accessorKey: 'timestamp',
            header: 'Timestamp',
            cell: info => {
                const time = info.getValue() as string;
                if (!time) return 'N/A';
                return (
                    <span title={dayjs(time).format('YYYY-MM-DD HH:mm:ss')}>
                        {dayjs(time).fromNow()}
                    </span>
                );
            },
            size: 180,
        },
        {
            accessorKey: 'duration',
            header: 'Duration',
            cell: info => formatDuration(info.getValue() as number),
            size: 120,
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: info => {
                const status = info.getValue() as string;
                return (
                    <Tag color={getStatusColor(status)}>
                        {status?.replace('STATUS_CODE_', '') || 'UNKNOWN'}
                    </Tag>
                );
            },
            size: 140,
        },
        {
            accessorKey: 'spans',
            header: 'Spans',
            cell: info => (info.getValue() as Span[])?.length || 0,
            size: 80,
        }
    ], [formatDuration, getStatusColor]);

    const table = useReactTable({
        data: data?.traces || [],
        columns,
        state: {
            sorting,
            pagination,
            expanded,
        },
        pageCount: data?.total ? Math.ceil(data.total / limit) : -1,
        manualPagination: true, // Server-side pagination
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onExpandedChange: setExpanded,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        // getSortedRowModel: getSortedRowModel(), // Server-side sorting not yet implemented, client-side optional if strict
        getRowCanExpand: () => true,
    });

    return (
        <div style={{ height: 'calc(100vh - 170px)', display: 'flex', flexDirection: 'column' }}>
            {/* Header / Filter Section */}
            <Card
                title={<Title level={4} style={{ margin: 0 }}>Traces</Title>}
                extra={
                    <Space>
                        <span style={{ fontSize: '14px', color: '#666' }}>
                            Total: {data?.total || 0}
                        </span>
                        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
                            Refresh
                        </Button>
                    </Space>
                }
                style={{ marginBottom: 16, flexShrink: 0 }}
            >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Row gutter={16}>

                        <Col span={6}>
                            <label>Service</label>
                            <Select
                                mode="multiple"
                                style={{ width: '100%' }}
                                placeholder="All Services"
                                onChange={(values) => {
                                    setSelectedServices(values);
                                    setPagination(prev => ({ ...prev, pageIndex: 0 }));
                                }}
                                options={[
                                    { value: 'order-service', label: 'Order Service' },
                                    { value: 'payment-service', label: 'Payment Service' },
                                ]}
                            />
                        </Col>
                        <Col span={4}>
                            <label>Status</label>
                            <Select
                                style={{ width: '100%' }}
                                placeholder="All Statuses"
                                allowClear
                                onChange={(value) => {
                                    setStatusFilter(value || '');
                                    setPagination(prev => ({ ...prev, pageIndex: 0 }));
                                }}
                                options={[
                                    { value: 'STATUS_CODE_OK', label: 'OK' },
                                    { value: 'STATUS_CODE_ERROR', label: 'ERROR' },
                                    { value: 'STATUS_CODE_UNSET', label: 'UNSET' },
                                ]}
                            />
                        </Col>
                        <Col span={6}>
                            <label>Search Trace ID</label>
                            <Input.Search
                                placeholder="Enter trace ID"
                                onSearch={handleSearch}
                                prefix={<SearchOutlined />}
                                allowClear
                            />
                        </Col>
                    </Row>
                </Space>
            </Card>

            {/* TanStack Table Container */}
            <Card bodyStyle={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }} style={{ flexGrow: 1, overflow: 'hidden' }}>
                <div style={{ overflow: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#f0f0f0', zIndex: 1 }}>
                            {table.getHeaderGroups().map(headerGroup => (
                                <tr key={headerGroup.id} style={{ borderBottom: '1px solid #ddd' }}>
                                    {headerGroup.headers.map(header => (
                                        <th
                                            key={header.id}
                                            style={{
                                                textAlign: 'left',
                                                padding: '12px 16px',
                                                fontWeight: 600,
                                                color: '#333',
                                                cursor: header.column.getCanSort() ? 'pointer' : 'default',
                                                userSelect: 'none'
                                            }}
                                            onClick={header.column.getToggleSortingHandler()}
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {{
                                                asc: <CaretUpOutlined style={{ marginLeft: 6, fontSize: '10px' }} />,
                                                desc: <CaretDownOutlined style={{ marginLeft: 6, fontSize: '10px' }} />,
                                            }[header.column.getIsSorted() as string] ?? null}
                                        </th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={columns.length} style={{ padding: '24px', textAlign: 'center', color: '#999' }}>
                                        Loading traces...
                                    </td>
                                </tr>
                            ) : table.getRowModel().rows.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length} style={{ padding: '24px', textAlign: 'center', color: '#999' }}>
                                        No traces found
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map(row => (
                                    <React.Fragment key={row.id}>
                                        <tr
                                            style={{
                                                borderBottom: '1px solid #f0f0f0',
                                                transition: 'background 0.2s',
                                                cursor: 'pointer'
                                            }}
                                            className="hover:bg-gray-50"
                                            onClick={() => row.toggleExpanded()}
                                            role="button"
                                            onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'white'}
                                        >
                                            {row.getVisibleCells().map(cell => (
                                                <td key={cell.id} style={{ padding: '12px 16px' }}>
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </td>
                                            ))}
                                        </tr>
                                        {row.getIsExpanded() && (
                                            <tr style={{ background: '#fafafa' }}>
                                                <td colSpan={columns.length} style={{ padding: '0 24px 24px 24px' }}>
                                                    <div style={{ marginTop: '12px' }}>
                                                        <Title level={5} style={{ fontSize: '14px', marginBottom: '12px' }}>Span Details</Title>
                                                        <Table
                                                            dataSource={row.original.spans || []}
                                                            pagination={false}
                                                            size="small"
                                                            rowKey="span_id"
                                                            columns={[
                                                                {
                                                                    title: 'Span ID',
                                                                    dataIndex: 'span_id',
                                                                    render: (id: string) => <code>{id?.slice(0, 16) || 'N/A'}</code>
                                                                },
                                                                { title: 'Operation', dataIndex: 'operation_name' },
                                                                {
                                                                    title: 'Start Time',
                                                                    dataIndex: 'start_time',
                                                                    render: (t: string) => t ? dayjs(t).format('HH:mm:ss.SSS') : 'N/A'
                                                                },
                                                                {
                                                                    title: 'Duration',
                                                                    dataIndex: 'duration',
                                                                    render: (d: number) => formatDuration(d)
                                                                }
                                                            ]}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div style={{
                    padding: '12px 24px',
                    borderTop: '1px solid #f0f0f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'white'
                }}>
                    <div style={{ fontSize: '14px', color: '#666' }}>
                        Showing {table.getRowModel().rows.length} of {data?.total || 0} results
                    </div>
                    <Space>
                        <Button
                            disabled={!table.getCanPreviousPage()}
                            onClick={() => table.previousPage()}
                        >
                            Previous
                        </Button>
                        <span style={{ margin: '0 8px' }}>
                            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                        </span>
                        <Button
                            disabled={!table.getCanNextPage()}
                            onClick={() => table.nextPage()}
                        >
                            Next
                        </Button>
                        <Select
                            value={table.getState().pagination.pageSize}
                            onChange={e => table.setPageSize(Number(e))}
                            options={[
                                { value: 20, label: '20 / page' },
                                { value: 50, label: '50 / page' },
                                { value: 100, label: '100 / page' },
                            ]}
                            style={{ width: 120, marginLeft: 16 }}
                        />
                    </Space>
                </div>
            </Card>
        </div>
    );
};

export default Traces;
