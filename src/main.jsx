import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  componentDidCatch(error) {
    this.setState({ error: error.message || String(error) })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{background:'#080704',color:'#c9a84c',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:40,fontFamily:'Georgia,serif'}}>
          <div style={{maxWidth:600}}>
            <div style={{fontSize:32,marginBottom:16}}>✂</div>
            <div style={{fontSize:18,fontWeight:700,marginBottom:12}}>SEWVIA — Startup Error</div>
            <div style={{fontSize:13,color:'#d8cdb5',background:'#15120c',padding:16,borderRadius:8,fontFamily:'monospace',wordBreak:'break-all'}}>
              {this.state.error}
            </div>
            <div style={{fontSize:11,color:'#6e6450',marginTop:12}}>Please screenshot this and share with support.</div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)