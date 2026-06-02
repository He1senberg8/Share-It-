import { useState } from 'react'
import Signal from './component/Signal.jsx'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <Signal/>
    </>
  )
}

export default App
