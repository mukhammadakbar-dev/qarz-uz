import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', maxWidth: 480, margin: '80px auto' }} className="card">
          <h2 style={{ fontSize: 20, marginBottom: 12, color: 'var(--danger)' }}>Nimadir xato ketdi</h2>
          <p className="muted" style={{ marginBottom: 20 }}>
            Kutilmagan xatolik yuz berdi. Sahifani qayta yuklab ko'ring.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Qayta yuklash
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
