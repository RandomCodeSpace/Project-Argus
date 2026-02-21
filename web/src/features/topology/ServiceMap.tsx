import { useEffect, useRef } from 'react'
import { Paper, Title, Stack, Text, Box, LoadingOverlay, Group, Badge, Card, ThemeIcon } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    MarkerType,
    Position,
    Handle,
    type Node,
    type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Server, Globe } from 'lucide-react'

import type { ServiceMapMetrics } from '../../types'
import { useTimeRange } from '../../components/TimeRangeSelector'
import { useLiveMode } from '../../contexts/LiveModeContext'
import { GlobalControls } from '../../components/GlobalControls'

const CustomServiceNode = ({ data }: { data: any }) => {
    const getGlowColor = (latency: number, errors: number) => {
        if (errors > 0) return 'rgba(250, 82, 82, 0.4)' // Red
        if (latency < 50) return 'rgba(64, 192, 87, 0.4)' // Green
        if (latency <= 200) return 'rgba(34, 139, 230, 0.4)' // Blue
        if (latency <= 500) return 'rgba(253, 126, 20, 0.4)' // Orange
        return 'rgba(250, 82, 82, 0.4)' // Red
    }

    return (
        <Box style={{ position: 'relative' }}>
            <Handle type="target" position={Position.Left} style={{ background: '#555' }} />
            <Card padding="xs" radius="md" withBorder style={{
                minWidth: 180,
                borderColor: data.errorCount > 0 ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-gray-3)',
                background: 'var(--mantine-color-body)',
                boxShadow: `0 0 15px ${getGlowColor(data.avgLatencyMs, data.errorCount)}`,
            }}>
                <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                        <ThemeIcon variant="light" color={data.errorCount > 0 ? 'red' : 'blue'} size="md">
                            <Server size={16} />
                        </ThemeIcon>
                        <Text fw={600} size="sm">{data.label}</Text>
                    </Group>
                    {data.errorCount > 0 && (
                        <Badge color="red" variant="dot" size="xs">Err</Badge>
                    )}
                </Group>
                <Group grow gap="xs">
                    <Box>
                        <Text size="xs" c="dimmed">Flow Rate</Text>
                        <Text fw={700} size="sm">
                            {data.durationSecs > 0 ? (data.totalTraces / data.durationSecs).toFixed(1) : 0} req/s
                        </Text>
                    </Box>
                    <Box>
                        <Text size="xs" c="dimmed">Avg Latency</Text>
                        <Text fw={700} size="sm" c={data.avgLatencyMs > 500 ? 'orange' : 'teal'}>
                            {data.avgLatencyMs}ms
                        </Text>
                    </Box>
                </Group>
            </Card>
            <Handle type="source" position={Position.Right} style={{ background: '#555' }} />
        </Box>
    )
}

const nodeTypes = { serviceNode: CustomServiceNode }

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))
    const nodeWidth = 220
    const nodeHeight = 120
    dagreGraph.setGraph({ rankdir: 'LR', ranksep: 150, nodesep: 100 })
    nodes.forEach((node) => dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight }))
    edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target))
    dagre.layout(dagreGraph)
    return {
        nodes: nodes.map((node) => {
            const pos = dagreGraph.node(node.id)
            return { ...node, targetPosition: Position.Left, sourcePosition: Position.Right, position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 } }
        }),
        edges,
    }
}

export function ServiceMap() {
    const tr = useTimeRange('5m')
    const { isLive, isConnected } = useLiveMode()

    const serviceMapQueryKey = isLive ? ['live', 'serviceMapMetrics'] : ['serviceMapMetrics', tr.start, tr.end]

    // Service Map data
    const { data: metrics, isFetching } = useQuery<ServiceMapMetrics>({
        queryKey: serviceMapQueryKey,
        queryFn: async () => {
            const res = await fetch(`/api/metrics/service-map?start=${tr.start}&end=${tr.end}`)
            return res.json()
        },
        enabled: !isLive,
        staleTime: 30000,
        refetchOnWindowFocus: false,
    })

    const [nodes, setNodes, onNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])
    const topologyRef = useRef<string>('')

    useEffect(() => {
        if (!metrics || !metrics.nodes || !metrics.edges) {
            setNodes([])
            setEdges([])
            return
        }

        let durationSecs = 1
        if (tr.start && tr.end) {
            durationSecs = (new Date(tr.end).getTime() - new Date(tr.start).getTime()) / 1000
            if (durationSecs <= 0) durationSecs = 1 // Prevent div by 0
        }

        const currentTopologyStr = [
            ...metrics.nodes.map(n => n.name).sort(),
            '|',
            ...metrics.edges.map(e => `${e.source}->${e.target}`).sort()
        ].join(',')

        const getLatencyColor = (latency: number, errorRate: number) => {
            if (errorRate > 0.05) return '#fa5252'; // Red
            if (latency < 50) return '#40c057'; // Green
            if (latency <= 200) return '#228be6'; // Blue
            if (latency <= 500) return '#fd7e14'; // Orange
            return '#fa5252'; // Red
        }

        if (topologyRef.current === currentTopologyStr && nodes.length > 0) {
            // Hot-swap data, preserve layout
            const nodeDataMap = new Map(metrics.nodes.map(n => [n.name, n]))
            setNodes(nds => nds.map(node => {
                const updated = nodeDataMap.get(node.id)
                if (updated) {
                    return {
                        ...node,
                        data: { ...node.data, totalTraces: updated.total_traces, errorCount: updated.error_count, avgLatencyMs: updated.avg_latency_ms, durationSecs }
                    }
                }
                return node
            }))

            const edgeDataMap = new Map(metrics.edges.map(e => [`${e.source}->${e.target}`, e]))
            setEdges(eds => eds.map(edge => {
                const updated = edgeDataMap.get(edge.id)
                if (updated) {
                    const color = getLatencyColor(updated.avg_latency_ms, updated.error_rate)
                    return {
                        ...edge,
                        label: `${updated.avg_latency_ms} ms`,
                        style: { ...edge.style, stroke: color },
                        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color }
                    }
                }
                return edge
            }))
            return
        }

        topologyRef.current = currentTopologyStr

        const newNodes: Node[] = metrics.nodes.map((n) => ({
            id: n.name,
            type: 'serviceNode',
            data: { label: n.name, totalTraces: n.total_traces, errorCount: n.error_count, avgLatencyMs: n.avg_latency_ms, durationSecs },
            position: { x: 0, y: 0 },
        }))

        const newEdges: Edge[] = metrics.edges.map((e) => {
            const color = getLatencyColor(e.avg_latency_ms, e.error_rate)
            return {
                id: `${e.source}->${e.target}`,
                source: e.source,
                target: e.target,
                type: 'default', // Using default bezier curves to reduce right-angle overlaps
                animated: true,
                label: `${e.avg_latency_ms} ms`,
                labelStyle: { fill: '#868e96', fontWeight: 500, fontSize: 11 },
                style: { stroke: color, strokeWidth: 2 },
                markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color },
            }
        })

        const { nodes: ln, edges: le } = getLayoutedElements(newNodes, newEdges)
        setNodes(ln)
        setEdges(le)
    }, [metrics, tr.start, tr.end, setNodes, setEdges])

    return (
        <Stack gap="md" style={{ height: '100%' }}>
            <Group justify="space-between">
                <Group gap="sm">
                    <Title order={3}>Service Topology</Title>
                    {isLive && (
                        <Badge variant="dot" color={isConnected ? 'green' : 'red'} size="lg">
                            {isConnected ? 'LIVE' : 'Reconnecting...'}
                        </Badge>
                    )}
                </Group>
                <GlobalControls />
            </Group>

            <Paper shadow="xs" radius="md" withBorder style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <LoadingOverlay visible={isFetching && !isLive} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />
                {nodes.length > 0 ? (
                    <>
                        <Paper shadow="sm" p="xs" radius="md" withBorder style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, backgroundColor: 'var(--mantine-color-body)' }}>
                            <Text size="xs" fw={600} mb={4}>Latency Legend</Text>
                            <Stack gap={2}>
                                <Group gap={6}><Box w={12} h={4} style={{ background: '#40c057', borderRadius: 2 }} /><Text size="xs">Very Fast ({"<"} 50ms)</Text></Group>
                                <Group gap={6}><Box w={12} h={4} style={{ background: '#228be6', borderRadius: 2 }} /><Text size="xs">Fast (50 - 200ms)</Text></Group>
                                <Group gap={6}><Box w={12} h={4} style={{ background: '#fd7e14', borderRadius: 2 }} /><Text size="xs">Average (200 - 500ms)</Text></Group>
                                <Group gap={6}><Box w={12} h={4} style={{ background: '#fa5252', borderRadius: 2 }} /><Text size="xs">Slow ({">"} 500ms) / Err</Text></Group>
                            </Stack>
                        </Paper>
                        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} fitView attributionPosition="bottom-right">
                            <Background color="#aaa" gap={16} />
                            <Controls />
                            <MiniMap
                                nodeStrokeColor={(n) => n.data.errorCount > 0 ? '#fa5252' : '#228be6'}
                                nodeColor={() => '#fff'}
                            />
                        </ReactFlow>
                    </>
                ) : (
                    <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <Stack align="center">
                            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                                <Globe size={24} />
                            </ThemeIcon>
                            <Text c="dimmed">{isLive ? 'Waiting for live data...' : 'Waiting for trace data flow...'}</Text>
                        </Stack>
                    </Box>
                )}
            </Paper>
        </Stack>
    )
}
