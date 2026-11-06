'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type HistoryItem = {
  id: string;
  title: string;
  status: string;
  role: 'CLIENT' | 'SPECIALIST';
  counterpartName: string | null;
  createdAt: string;
  updatedAt: string;
  workCompletedAt: string | null;
  agreedAmount: number | null;
  currency: string;
  paymentStatus: string | null;
  paymentAmount: number | null;
  paidAt: string | null;
  releasedAt: string | null;
  refundedAt: string | null;
};

type Filter = 'ALL' | 'COMPLETED' | 'CANCELLED';

function money(amount: number | null, currency: string) {
  if (amount === null) return 'No disponible';

  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function date(value: string | null) {
  if (!value) return 'No disponible';

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'No disponible'
    : parsed.toLocaleDateString('es-MX');
}

function paymentLabel(item: HistoryItem) {
  switch (item.paymentStatus) {
    case 'PENDING':
      return 'Pago pendiente';
    case 'PAID':
      return 'Pago registrado; fondos retenidos';
    case 'RELEASED':
      return 'Fondos marcados como liberados';
    case 'SETTLED':
      return 'Liquidación registrada';
    case 'REFUNDED':
      return 'Pago reembolsado';
    case 'CANCELLED':
      return 'Pago cancelado';
    case 'FAILED':
      return 'Pago fallido';
    default:
      return 'Sin pago registrado';
  }
}

export default function Historial() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    api('/job-requests/history/services')
      .then((data: unknown) => {
        if (!active) return;
        if (!Array.isArray(data)) {
          throw new Error('Respuesta de historial no válida');
        }
        setItems(data as HistoryItem[]);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const visible = items.filter(
    item => filter === 'ALL' || item.status === filter
  );

  return (
    <main className="wrap">
      <h1>Historial de servicios</h1>

      <p>
        Consulta los servicios completados o cancelados,
        tanto como cliente como especialista.
      </p>

      <p><a href="/dashboard">Volver a mi panel</a></p>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 20
      }}>
        {([
          ['ALL', 'Todos'],
          ['COMPLETED', 'Completados'],
          ['CANCELLED', 'Cancelados'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            style={{
              padding: '8px 12px',
              fontWeight: filter === value ? 'bold' : 'normal'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p>Cargando historial...</p>}

      {error && (
        <div role="alert">
          <p>No se pudo consultar el historial: {error}</p>
          <p><a href="/login">Comprobar mi sesión</a></p>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <p>No hay servicios para este filtro.</p>
      )}

      {!loading && !error && visible.map(item => (
        <article
          key={`${item.role}-${item.id}`}
          className="card"
          style={{ marginBottom: 16, padding: 16 }}
        >
          <h2>{item.title}</h2>

          <p>
            <strong>Participación:</strong>{' '}
            {item.role === 'CLIENT'
              ? 'Cliente'
              : 'Especialista'}
          </p>

          <p>
            <strong>
              {item.role === 'CLIENT'
                ? 'Especialista:'
                : 'Cliente:'}
            </strong>{' '}
            {item.counterpartName || 'No disponible'}
          </p>

          <p>
            <strong>Estado:</strong>{' '}
            {item.status === 'COMPLETED'
              ? 'Completado'
              : 'Cancelado'}
          </p>

          <p>
            <strong>Fecha:</strong>{' '}
            {date(
              item.status === 'COMPLETED'
                ? item.workCompletedAt || item.updatedAt
                : item.updatedAt
            )}
          </p>

          <p>
            <strong>Precio acordado:</strong>{' '}
            {money(item.agreedAmount, item.currency)}
          </p>

          <p>
            <strong>Situación del pago:</strong>{' '}
            {paymentLabel(item)}
          </p>

          {item.paymentAmount !== null && (
            <p>
              <strong>Pago originalmente registrado:</strong>{' '}
              {money(item.paymentAmount, item.currency)}
            </p>
          )}

          {item.refundedAt && (
            <p>
              <strong>Fecha registrada de reembolso:</strong>{' '}
              {date(item.refundedAt)}
            </p>
          )}

          <p>
            <a href={
              item.role === 'CLIENT'
                ? '/mis-solicitudes'
                : '/mis-trabajos'
            }>
              Ir a mis {item.role === 'CLIENT'
                ? 'solicitudes'
                : 'trabajos'}
            </a>
          </p>
        </article>
      ))}
    </main>
  );
}
