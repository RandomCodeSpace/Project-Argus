import React, { useState } from 'react';
import { Layout, Flex, Typography, Button, theme, DatePicker } from 'antd';
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Header: AntHeader } = Layout;
const { Text } = Typography;
const { RangePicker } = DatePicker;

interface HeaderProps {
    collapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
    timeRange: [string, string] | null;
    setTimeRange: (range: [string, string] | null) => void;
}

const Header: React.FC<HeaderProps> = ({ collapsed, setCollapsed, timeRange, setTimeRange }) => {
    const {
        token: { colorBgContainer },
    } = theme.useToken();

    const [dates, setDates] = useState<any>(null);

    // Time Range Presets
    const rangePresets: { label: string; value: [dayjs.Dayjs, dayjs.Dayjs] }[] = [
        { label: 'Last 5 Minutes', value: [dayjs().subtract(5, 'minute'), dayjs()] },
        { label: 'Last 15 Minutes', value: [dayjs().subtract(15, 'minute'), dayjs()] },
        { label: 'Last 30 Minutes', value: [dayjs().subtract(30, 'minute'), dayjs()] },
        { label: 'Last 1 Hour', value: [dayjs().subtract(1, 'hour'), dayjs()] },
        { label: 'Last 6 Hours', value: [dayjs().subtract(6, 'hour'), dayjs()] },
        { label: 'Last 12 Hours', value: [dayjs().subtract(12, 'hour'), dayjs()] },
        { label: 'Last 24 Hours', value: [dayjs().subtract(24, 'hour'), dayjs()] },
        { label: 'Last 7 Days', value: [dayjs().subtract(7, 'day'), dayjs()] },
    ];

    const disabledDate = (current: dayjs.Dayjs) => {
        if (!dates) {
            return false;
        }
        const tooLate = dates[0] && current.diff(dates[0], 'days') > 7;
        const tooEarly = dates[0] && dates[0].diff(current, 'days') > 7;
        return !!tooEarly || !!tooLate;
    };

    const onOpenChange = (open: boolean) => {
        if (open) {
            setDates(null);
        }
    };

    return (
        <AntHeader
            style={{
                padding: '0 24px',
                background: colorBgContainer,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: 64,
                borderBottom: '1px solid #f0f0f0'
            }}
        >
            <Flex align="center">
                <Button
                    type="text"
                    icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                    onClick={() => setCollapsed(!collapsed)}
                    style={{
                        fontSize: '16px',
                        width: 64,
                        height: 64,
                        marginLeft: -24
                    }}
                />
            </Flex>

            <Flex align="center" gap="middle">
                {/* Global Time Filter */}
                <RangePicker
                    showTime={{ format: 'HH:mm' }}
                    format="HH:mm DD-MMM"
                    presets={rangePresets}
                    value={timeRange ? [dayjs(timeRange[0]), dayjs(timeRange[1])] : undefined}
                    disabledDate={disabledDate}
                    onCalendarChange={(val) => setDates(val)}
                    onOpenChange={onOpenChange}
                    onChange={(dates) => {
                        if (dates && dates[0] && dates[1]) {
                            setTimeRange([
                                dates[0].toISOString(),
                                dates[1].toISOString()
                            ]);
                        } else {
                            setTimeRange(null);
                        }
                    }}
                    style={{ width: 380 }}
                />

                <div style={{ width: 1, height: 24, background: '#f0f0f0' }} />

                <Text type="secondary">System Status: <Text type="success" strong>OPERATIONAL</Text></Text>
            </Flex>
        </AntHeader>
    );
};

export default Header;
