import * as echarts from 'echarts/core'
import {
    LineChart,
    BarChart,
    HeatmapChart,
    ScatterChart,
    PieChart,
    GraphChart,
} from 'echarts/charts'
import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    TitleComponent,
    DataZoomComponent,
    MarkPointComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'

// Register the required components
echarts.use([
    LineChart,
    BarChart,
    HeatmapChart,
    ScatterChart,
    PieChart,
    GraphChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    TitleComponent,
    DataZoomComponent,
    MarkPointComponent,
    CanvasRenderer,
])

export { echarts }
export default ReactEChartsCore
