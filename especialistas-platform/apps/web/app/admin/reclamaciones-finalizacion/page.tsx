'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type Claim = {
  id: string;
  jobRequestId: string;
  description: string;
  status: string;
  specialistResponseNotes: string | null;
  specialistRespondedAt: string | null;
  disputedAt: string | null;
  correctionCompletedAt: string | null;
  correctionReviewDeadline: string | null;
  correctionCompletionNotes: string | null;
  clientCorrectionAcceptedAt: string | null;
  clientCorrectionRespondedAt: string | null;
  clientCorrectionResponseNotes: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentPaidAt: string | null;
  paymentStatus: string | null;
  jobRequest: {
    id: string;
    title: string;
    status: string;
    city: string;
    state: string;
    client: { id: string; name: string };
    specialist: { id: string; name: string } | null;
  };
};

type Decision = 'RESOLVED' | 'REJECTED';

export default function AdminReclamacionesFinalizacion() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    id: string;
    decision: Decision;
  } | null>(null);

  async function loadClaims() {
    setLoading(true);
    setError('');

    try {
      const data = await api('/job-requests/admin/completion-claims');

      if (!Array.isArray(data)) {
        throw new Error('Respuesta administrativa no válida');
      }

      setClaims(data);
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar las reclamaciones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClaims();
  }, []);

  function estado(status: string) {
    if (status === 'PENDING') return 'Pendiente del especialista';
    if (status === 'CORRECTION_REQUESTED') return 'Corrección aceptada';
    if (status === 'DISPUTED') return 'En disputa';
    if (status === 'RESOLVED') return 'Resuelta';
    if (status === 'REJECTED') return 'Rechazada';
    return status;
  }

  function fecha(value: string | null | undefined) {
    if (!value) return 'No disponible';
    return new Date(value).toLocaleString();
  }

  function diasTranscurridos(value: string | null | undefined) {
    if (!value) return null;

    const inicio = new Date(value).getTime();

    if (!Number.isFinite(inicio) || inicio > Date.now()) {
      return null;
    }

    return Math.floor(
      (Date.now() - inicio) / (24 * 60 * 60 * 1000)
    );
  }

  function alertaAntiguedad(claim: Claim) {
    if (['RESOLVED', 'REJECTED'].includes(claim.status)) {
      return false;
    }

    const dias = diasTranscurridos(claim.createdAt);
    return dias !== null && dias >= 30;
  }

  function alertaDisputa30Dias(claim: Claim) {
    if (claim.status !== 'DISPUTED') {
      return false;
    }

    const dias = diasTranscurridos(claim.disputedAt);

    return dias !== null && dias >= 30;
  }

  function alertaSeguimientoPago(claim: Claim) {
    if (claim.paymentStatus !== 'PAID') {
      return false;
    }

    const dias = diasTranscurridos(claim.paymentPaidAt);
    return dias !== null && dias >= 90;
  }

  function segundaRevisionVencida(claim: Claim) {
    if (
      claim.status !== 'CORRECTION_REQUESTED' ||
      !claim.correctionCompletedAt ||
      !claim.correctionReviewDeadline ||
      claim.clientCorrectionRespondedAt
    ) {
      return false;
    }

    const vencimiento = new Date(
      claim.correctionReviewDeadline
    ).getTime();

    return (
      Number.isFinite(vencimiento) &&
      vencimiento <= Date.now()
    );
  }

  function puedeResolver(claim: Claim) {
    if (claim.status === 'DISPUTED') {
      return true;
    }

    if (claim.status !== 'CORRECTION_REQUESTED') {
      return false;
    }

    // La vía administrativa ordinaria solamente se habilita
    // cuando terminó la corrección y venció la segunda revisión
    // sin una respuesta previa del cliente.
    return segundaRevisionVencida(claim);
  }

  async function resolveClaim(
    claim: Claim,
    decision: Decision
  ) {
    if (updatingId !== null) return;

    const explanation = (notes[claim.id] || '').trim();

    if (explanation.length < 10 || explanation.length > 4000) {
      setError('La justificación debe tener entre 10 y 4000 caracteres.');
      return;
    }

    if (
      confirming?.id !== claim.id ||
      confirming.decision !== decision
    ) {
      setConfirming({ id: claim.id, decision });
      setError('');
      return;
    }

    setUpdatingId(claim.id);
    setConfirming(null);
    setError('');
    setMessage('');

    try {
      await api(
        `/job-requests/${claim.jobRequestId}/completion-claims/${claim.id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            resolutionNotes: explanation
          })
        }
      );

      await loadClaims();

      setMessage(
        decision === 'RESOLVED'
          ? 'Resolución administrativa registrada.'
          : 'Rechazo administrativo registrado.'
      );
    } catch (e: any) {
      setError(e.message || 'No se pudo registrar la resolución.');
    } finally {
      setUpdatingId(null);
    }
  }

  const pendientes = claims
    .filter(c => ['DISPUTED', 'CORRECTION_REQUESTED'].includes(c.status))
    .sort(
      (a, b) =>
        Number(segundaRevisionVencida(b)) -
        Number(segundaRevisionVencida(a))
    );
  const esperando = claims.filter(c => c.status === 'PENDING');
  const historial = claims.filter(
    c => ['RESOLVED', 'REJECTED'].includes(c.status)
  );

  function renderClaim(claim: Claim) {
    return (
      <article
        key={claim.id}
        style={{
          border: '1px solid #ccc',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16
        }}
      >
        <h3>{claim.jobRequest.title}</h3>

        <p><strong>Estado:</strong> {estado(claim.status)}</p>

        {claim.status === 'CORRECTION_REQUESTED' &&
          !puedeResolver(claim) && (
            <p>
              <strong>Resolución administrativa no disponible:</strong>{' '}
              la corrección continúa en curso o el cliente
              todavía dispone de su período de revisión.
              La reclamación sigue visible para seguimiento.
            </p>
          )}
        <p><strong>Cliente:</strong> {claim.jobRequest.client.name}</p>
        <p>
          <strong>Especialista:</strong>{' '}
          {claim.jobRequest.specialist?.name || 'No disponible'}
        </p>
        <p>
          <strong>Ubicación:</strong>{' '}
          {claim.jobRequest.city}, {claim.jobRequest.state}
        </p>
        <p><strong>Presentada:</strong> {fecha(claim.createdAt)}</p>

        {claim.status === 'DISPUTED' && (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>Inicio de la disputa:</strong>{' '}
              {fecha(claim.disputedAt)}
            </p>

            {claim.disputedAt ? (
              <p>
                <strong>Tiempo desde el inicio de la disputa:</strong>{' '}
                {diasTranscurridos(claim.disputedAt) ?? 'No disponible'} días.
              </p>
            ) : (
              <p>
                La fecha de inicio de esta disputa no está
                registrada. Debe revisarse su historial.
              </p>
            )}

            {alertaDisputa30Dias(claim) && (
              <p>
                <strong>
                  Seguimiento prioritario: objetivo de 30 días alcanzado.
                </strong>{' '}
                La disputa continúa abierta y requiere revisión
                administrativa. Esta alerta no constituye una
                resolución ni autoriza liberar fondos.
              </p>
            )}
          </div>
        )}

        {alertaAntiguedad(claim) && (
          <p>
            <strong>Seguimiento por antigüedad:</strong>{' '}
            la reclamación lleva al menos 30 días desde
            su presentación y sigue abierta. Debe revisarse
            su situación; esto no equivale necesariamente
            a 30 días desde el inicio de una disputa.
          </p>
        )}

        {alertaSeguimientoPago(claim) && (
          <p>
            <strong>Alerta financiera de 90 días:</strong>{' '}
            han transcurrido al menos 90 días desde el cobro
            registrado y el pago figura como pendiente de
            liberación. Revisar urgentemente con el proveedor.
            Esta alerta no autoriza retener ni liberar fondos.
          </p>
        )}
        <p><strong>Reclamación:</strong> {claim.description}</p>

        {claim.status === 'CORRECTION_REQUESTED' &&
          !claim.correctionCompletedAt && (
            <p>
              <strong>Corrección pendiente:</strong>{' '}
              el especialista todavía no ha comunicado su finalización.
            </p>
          )}

        {claim.correctionCompletedAt && (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>Corrección terminada:</strong>{' '}
              {fecha(claim.correctionCompletedAt)}
            </p>

            {claim.correctionCompletionNotes && (
              <p>
                <strong>Explicación de las correcciones:</strong>{' '}
                {claim.correctionCompletionNotes}
              </p>
            )}

            <p>
              <strong>Vencimiento de la segunda revisión:</strong>{' '}
              {fecha(claim.correctionReviewDeadline)}
            </p>

            {segundaRevisionVencida(claim) && (
              <p>
                <strong>
                  Seguimiento prioritario: plazo vencido sin
                  respuesta del cliente.
                </strong>{' '}
                El vencimiento no significa aceptación de
                las correcciones ni autoriza liberar fondos.
              </p>
            )}

            {claim.status === 'CORRECTION_REQUESTED' &&
              !claim.clientCorrectionRespondedAt &&
              !segundaRevisionVencida(claim) && (
                <p>
                  Pendiente de revisión del cliente.
                </p>
              )}

            {claim.clientCorrectionRespondedAt && (
              <>
                <p>
                  <strong>Respuesta del cliente:</strong>{' '}
                  {claim.clientCorrectionAcceptedAt
                    ? 'Aceptó las correcciones'
                    : 'Manifestó que persisten los defectos'}
                </p>

                <p>
                  <strong>Fecha de respuesta:</strong>{' '}
                  {fecha(claim.clientCorrectionRespondedAt)}
                </p>

                {claim.clientCorrectionResponseNotes && (
                  <p>
                    <strong>Explicación del cliente:</strong>{' '}
                    {claim.clientCorrectionResponseNotes}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {claim.specialistResponseNotes && (
          <>
            <p>
              <strong>Respuesta del especialista:</strong>{' '}
              {claim.specialistResponseNotes}
            </p>
            <p>
              <strong>Fecha de respuesta:</strong>{' '}
              {fecha(claim.specialistRespondedAt)}
            </p>
          </>
        )}

        {claim.resolutionNotes && (
          <>
            <p>
              <strong>Resolución administrativa:</strong>{' '}
              {claim.resolutionNotes}
            </p>
            <p>
              <strong>Fecha de resolución:</strong>{' '}
              {fecha(claim.resolvedAt)}
            </p>
          </>
        )}

        {puedeResolver(claim) && (
          <div style={{ marginTop: 16 }}>
            <label htmlFor={`notes-${claim.id}`}>
              <strong>Justificación administrativa</strong>
            </label>

            <textarea
              id={`notes-${claim.id}`}
              value={notes[claim.id] || ''}
              onChange={e => {
                setNotes(prev => ({
                  ...prev,
                  [claim.id]: e.target.value
                }));
                setConfirming(null);
              }}
              rows={4}
              maxLength={4000}
              disabled={updatingId !== null}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 8,
                marginBottom: 12
              }}
            />

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={updatingId !== null}
                onClick={() => resolveClaim(claim, 'RESOLVED')}
              >
                Registrar resolución
              </button>

              <button
                type="button"
                disabled={updatingId !== null}
                onClick={() => resolveClaim(claim, 'REJECTED')}
              >
                Rechazar reclamación
              </button>
            </div>

            {confirming?.id === claim.id && (
              <div style={{ marginTop: 12 }}>
                <p>
                  <strong>Confirmación:</strong>{' '}
                  {confirming.decision === 'RESOLVED'
                    ? '¿Registrar esta resolución?'
                    : '¿Rechazar esta reclamación?'}
                </p>

                <button
                  type="button"
                  disabled={updatingId !== null}
                  onClick={() =>
                    resolveClaim(claim, confirming.decision)
                  }
                >
                  Confirmar decisión
                </button>

                <button
                  type="button"
                  disabled={updatingId !== null}
                  onClick={() => setConfirming(null)}
                  style={{ marginLeft: 12 }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <main className="wrap">
      <h1>Reclamaciones por finalización de trabajos</h1>

      <p>
        Revisa las reclamaciones de los clientes y las respuestas
        de los especialistas. Las resoluciones administrativas
        no autorizan por sí mismas la liberación de fondos.
      </p>

      {loading && <p>Cargando reclamaciones...</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}

      {!loading && (
        <>
          <h2>Pendientes de resolución ({pendientes.length})</h2>
          {pendientes.length === 0
            ? <p>No hay reclamaciones pendientes de resolución.</p>
            : pendientes.map(renderClaim)}

          <h2>Esperando respuesta ({esperando.length})</h2>
          {esperando.length === 0
            ? <p>No hay reclamaciones esperando respuesta.</p>
            : esperando.map(renderClaim)}

          <h2>Historial ({historial.length})</h2>
          {historial.length === 0
            ? <p>No hay resoluciones registradas.</p>
            : historial.map(renderClaim)}
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <a href="/dashboard">Volver al panel</a>
      </p>
    </main>
  );
}
