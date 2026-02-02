import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import App from './app/contexts/App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)