import React from "react";

interface TooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string | number;
}

export default function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0];
  const value = item?.value ?? "-";
  const name = item?.payload?.protocol ?? label;

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(10,22,40,0.95), rgba(10,22,40,0.85))',
      padding: '10px 14px',
      borderRadius: 12,
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.06)',
      minWidth: 120
    }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{String(name)}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: '#9ca3af' }}>value : {String(value)}</div>
    </div>
  );
}
