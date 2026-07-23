export default function PageHeader({ title, subtitle, action }) {
  return (
    <div className="row between" style={{ marginBottom: 22, alignItems: 'flex-end' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && <p className="muted small" style={{ marginTop: 3 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
