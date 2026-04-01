import { Routes, Route } from 'react-router-dom'
import DynamicOKRDashboard from './components/DynamicOKRDashboard.jsx'
import H2HDashboard from './components/H2HDashboard.jsx'
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DynamicOKRDashboard />} />
      <Route path="/h2h" element={<H2HDashboard />} />
    </Routes>
  )
}
