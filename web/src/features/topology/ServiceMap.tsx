import { useEffect } from 'react'
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
    type Node,
    type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Server, Globe } from 'lucide-react'

import type { ServiceMapMetrics } from '../../types'
import { TimeRangeSelector, useTimeRange } from '../../components/TimeRangeSelector'

// --- Custom Node Component ---
const CustomServiceNode = ({ data }: { data: any }) => {
    return (
        <Card shadow="sm" padding="xs" radius="md" withBorder style={{
            minWidth: 180,
            borderColor: data.errorCount > 0 ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-gray-3)',
            background: 'var(--mantine-color-body)',
        }}>
            <Group justify="space-between" mb="xs">
                <Group gap="xs">
                    <ThemeIcon
                        variant="light"
                        color={data.errorCount > 0 ? 'red' : 'blue'}
                        size="md"
                    >
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
                    <Text size="xs" c="dimmed">Reqs</Text>
                    <Text fw={700} size="sm">{data.totalTraces}</Text>
                </Box>
                <Box>
                    <Text size="xs" c="dimmed">Avg Latency</Text>
                    <Text fw={700} size="sm" c={data.avgLatencyMs > 500 ? 'orange' : 'teal'}>
                        {data.avgLatencyMs}ms
                    </Text>
                </Box>
            </Group>
        </Card>
    )
}

const nodeTypes = {
    serviceNode: CustomServiceNode,
}

// --- Layout Helper ---
const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))

    const nodeWidth = 200
    const nodeHeight = 100

    dagreGraph.setGraph({ rankdir: 'LR' })

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
    })

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target)
    })

    dagre.layout(dagreGraph)

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id)
        return {
            ...node,
            targetPosition: Position.Left,
            sourcePosition: Position.Right,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        }
    })

    return { nodes: layoutedNodes, edges }
}


export function ServiceMap() {
    const tr = useTimeRange('5m')

    const { data: metrics, isLoading } = useQuery<ServiceMapMetrics>({
        queryKey: ['serviceMapMetrics', tr.start, tr.end],
        queryFn: async () => {
            const res = await fetch(`/api/metrics/service-map?start=${tr.start}&end=${tr.end}`)
            return res.json()
        },
        refetchInterval: 10000,
    })

    const [nodes, setNodes, onNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])

    useEffect(() => {
        if (!metrics || !metrics.nodes || !metrics.edges) {
            setNodes([])
            setEdges([])
            return
        }

        const newNodes: Node[] = metrics.nodes.map((n) => ({
            id: n.name,
            type: 'serviceNode',
            data: {
                label: n.name,
                totalTraces: n.total_traces,
                errorCount: n.error_count,
                avgLatencyMs: n.avg_latency_ms
            },
            position: { x: 0, y: 0 }, // Calculated by dagre
        }))

        const newEdges: Edge[] = metrics.edges.map((e) => ({
            id: `${e.source}->${e.target}`,
            source: e.source,
            target: e.target,
            animated: true,
            label: `${e.call_count} reqs | ${e.avg_latency_ms}ms`,
            labelStyle: { fill: '#868e96', fontWeight: 500, fontSize: 11 },
            style: {
                stroke: e.error_rate > 0.05 ? '#fa5252' : '#228be6',
                strokeWidth: 2,
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: e.error_rate > 0.05 ? '#fa5252' : '#228be6',
            },
        }))

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(newNodes, newEdges)

        setNodes(layoutedNodes)
        setEdges(layoutedEdges)
    }, [metrics, setNodes, setEdges])


    return (
        <Stack gap="md" style={{ height: 'calc(100vh - 100px)' }}>
            <Group justify="space-between">
                <Title order={3}>Service Topology</Title>
                <TimeRangeSelector
                    value={tr.timeRange}
                    onChange={tr.setTimeRange}
                />
            </Group>

            <Paper shadow="xs" radius="md" withBorder style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <LoadingOverlay visible={isLoading && nodes.length === 0} />

                {nodes.length > 0 ? (
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        nodeTypes={nodeTypes}
                        fitView
                        attributionPosition="bottom-right"
                    >
                        <Background color="#aaa" gap={16} />
                        <Controls />
                        <MiniMap
                            nodeStrokeColor={(n) => {
                                if (n.data.errorCount > 0) return '#fa5252';
                                return '#228be6';
                            }}
                            nodeColor={() => {
                                return '#fff';
                            }}
                        />
                    </ReactFlow>
                ) : (
                    <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <Stack align="center">
                            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                                <Globe size={24} />
                            </ThemeIcon>
                            <Text c="dimmed">Waiting for trace data flow...</Text>
                        </Stack>
                    </Box>
                )}
            </Paper>
        </Stack>
    )
}
