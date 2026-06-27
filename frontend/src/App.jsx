import { useState } from 'react'
import Signal from './component/Signal.jsx'
import FileProcessor from './component/FileProcessor.jsx'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <Signal/>
    {/* <FileProcessor/> */}
    </>
  )
}

export default App
