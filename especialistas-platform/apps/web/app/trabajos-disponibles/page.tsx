'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function TrabajosDisponibles() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [proposalJobId, setProposalJobId] = useState<string | null>(null);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [proposal, setProposal] = useState({
    amount: '',
    message: '',
    availableDate: ''
  });

  const [success, setSuccess] = useState('');

  useEffect(() => {
    api('/job-requests/available')
      .then(setItems)
      .catch((e) =>
        setError(e.message || 'No se pudieron cargar los trabajos.')
      )
      .finally(() => setLoading(false));
  }, []);

  function updateProposal(name: string, value: string) {
    setProposal((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  async function sendProposal(jobId: string) {
    setError('');
    setSuccess('');

    try {
      await api(`/job-requests/${jobId}/proposals`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(proposal.amount),
          message: proposal.message || null,
          availableDate: proposal.availableDate || null
        })
      });

      const updated = await api('/job-requests/available');
      setItems(updated);

      setSuccess('Propuesta enviada correctamente.');
      setProposalJobId(null);

      setProposal({
        amount: '',
        message: '',
        availableDate: ''
      });
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar la propuesta.');
    }
  }



  function startEditProposal(job: any) {
    const existing = job.proposals?.[0];

    if (!existing || !['PENDING', 'WITHDRAWN'].includes(existing.status)) return;

    setEditingProposalId(existing.id);
    setProposalJobId(job.id);
    setProposal({
      amount: String(existing.amount ?? ''),
      message: existing.message || '',
      availableDate: existing.availableDate
        ? String(existing.availableDate).slice(0, 10)
        : ''
    });
    setError('');
    setSuccess('');
  }

  async function saveEditedProposal(jobId: string, proposalId: string) {
    const amount = Number(proposal.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('El precio ofrecido debe ser mayor que cero.');
      return;
    }

    setError('');
    setSuccess('');

    try {
      await api(`/job-requests/${jobId}/proposals/${proposalId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          amount,
          message: proposal.message || null,
          availableDate: proposal.availableDate || null
        })
      });

      const updated = await api('/job-requests/available');
      setItems(updated);

      setEditingProposalId(null);
      setProposalJobId(null);
      setProposal({
        amount: '',
        message: '',
        availableDate: ''
      });

      setSuccess('Propuesta actualizada correctamente.');
    } catch (e: any) {
      setError(e.message || 'No se pudo actualizar la propuesta.');
    }
  }

  async function withdrawProposal(jobId: string, proposalId: string) {
    const confirmed = window.confirm(
      '¿Seguro que quieres retirar esta propuesta?'
    );

    if (!confirmed) return;

    setError('');
    setSuccess('');

    try {
      await api(`/job-requests/${jobId}/proposals/${proposalId}/withdraw`, {
        method: 'PATCH'
      });

      const updated = await api('/job-requests/available');
      setItems(updated);
      setSuccess('Propuesta retirada correctamente.');
    } catch (e: any) {
      setError(e.message || 'No se pudo retirar la propuesta.');
    }
  }

  return (
    <main className="wrap">
      <h1>Trabajos disponibles</h1>

      <p>
        Solicitudes que coinciden con tus especialidades y zona de trabajo.
      </p>

      {loading && <p>Cargando trabajos...</p>}

      {success && (
        <p style={{ color: 'green' }}>
          {success}
        </p>
      )}

      {error && (
        <p style={{ color: 'red' }}>
          {error}
        </p>
      )}

      <div className="grid">
        {items.map((job) => (
          <div className="card" key={job.id}>
            <h3>{job.title}</h3>

            <p>{job.description}</p>

            <p>
              <strong>Especialidad:</strong> {job.category?.name}
            </p>

            <p>
              <strong>Presupuesto:</strong>{' '}
              {job.budgetMin || job.budgetMax
                ? `$${job.budgetMin ?? 0} - $${job.budgetMax ?? 0}`
                : 'No especificado'}
            </p>

            <p>
              <strong>Ubicación:</strong>{' '}
              {[job.city, job.state, job.zipcode]
                .filter(Boolean)
                .join(', ')}
            </p>

            {job.desiredDate && (
              <p>
                <strong>Fecha deseada:</strong>{' '}
                {new Date(job.desiredDate).toLocaleDateString()}
              </p>
            )}

            <p>
              <strong>Calificación del cliente:</strong>{' '}
              {job.client?.specialistReviews?.length
                ? `${(
                    job.client.specialistReviews.reduce(
                      (sum: number, review: any) => sum + review.rating,
                      0
                    ) / job.client.specialistReviews.length
                  ).toFixed(1)} / 5 (${job.client.specialistReviews.length})`
                : 'Sin calificaciones'}
            </p>

            {job.proposals?.[0]?.status === 'PENDING' &&
            editingProposalId !== job.proposals?.[0]?.id ? (
              <div>
                <p>
                  <strong>Tu propuesta:</strong> Pendiente
                </p>

                <button
                  type="button"
                  onClick={() => startEditProposal(job)}
                  style={{ marginRight: '8px' }}
                >
                  Editar propuesta
                </button>

                <button
                  type="button"
                  onClick={() =>
                    withdrawProposal(job.id, job.proposals[0].id)
                  }
                >
                  Retirar propuesta
                </button>
              </div>
            ) : job.proposals?.[0]?.status === 'WITHDRAWN' &&
            editingProposalId !== job.proposals?.[0]?.id ? (
              <div>
                <p>
                  <strong>Tu propuesta:</strong> Retirada
                </p>

                <button
                  type="button"
                  onClick={() => startEditProposal(job)}
                >
                  Editar y reenviar propuesta
                </button>
              </div>
            ) : proposalJobId !== job.id ? (
              <button
                type="button"
                onClick={() => {
                  setProposalJobId(job.id);
                  setError('');
                  setSuccess('');
                }}
              >
                Enviar propuesta
              </button>
            ) : (
              <div style={{ marginTop: '16px' }}>
                <h4>
                {editingProposalId
                  ? job.proposals?.[0]?.status === 'WITHDRAWN'
                    ? 'Editar y reenviar propuesta'
                    : 'Editar propuesta'
                  : 'Enviar propuesta'}
              </h4>

                <label>Precio ofrecido (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={proposal.amount}
                  onChange={(e) =>
                    updateProposal('amount', e.target.value)
                  }
                  required
                />

                <label>Mensaje al cliente</label>
                <textarea
                  rows={4}
                  value={proposal.message}
                  onChange={(e) =>
                    updateProposal('message', e.target.value)
                  }
                  placeholder="Explica brevemente cómo realizarías el trabajo."
                />

                <label>Fecha disponible</label>
                <input
                  type="date"
                  value={proposal.availableDate}
                  onChange={(e) =>
                    updateProposal('availableDate', e.target.value)
                  }
                />

                <button
                  type="button"
                  onClick={() =>
                    editingProposalId
                      ? saveEditedProposal(job.id, editingProposalId)
                      : sendProposal(job.id)
                  }
                  disabled={!proposal.amount}
                >
                  {editingProposalId
                ? job.proposals?.[0]?.status === 'WITHDRAWN'
                  ? 'Reenviar propuesta'
                  : 'Guardar cambios'
                : 'Enviar'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProposalJobId(null);
                    setProposal({
                      amount: '',
                      message: '',
                      availableDate: ''
                    });
                  }}
                  style={{ marginTop: '8px' }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        ))}

        {!loading && !error && items.length === 0 && (
          <div className="card">
            <p>No hay trabajos disponibles que coincidan con tu perfil.</p>
          </div>
        )}
      </div>

      <p>
        <a href="/dashboard">Volver al panel</a>
      </p>
    </main>
  );
}
