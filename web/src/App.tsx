import { AppLayout } from './layouts/AppLayout'
import { LiveModeProvider } from './contexts/LiveModeContext'

function App() {
  return (
    <LiveModeProvider>
      <AppLayout />
    </LiveModeProvider>
  )
}

export default App
