'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function PublicarTrabajo() {
  const [categories, setCategories] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    categoryId: '',
    city: '',
    state: '',
    zipcode: '',
    desiredDate: ''
  });

  useEffect(() => {
    api('/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  function updateField(name: string, value: string) {
    setForm((prev) => ({
      ...prev,
      [name]: value
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');

    try {
      await api('/job-requests', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          categoryId: form.categoryId,
          budgetMin: null,
          budgetMax: null,
          city: form.city,
          state: form.state,
          zipcode: form.zipcode || null,
          desiredDate: form.desiredDate || null
        })
      });

      setMessage('Solicitud publicada correctamente.');

      setForm({
        title: '',
        description: '',
        categoryId: '',
        city: '',
        state: '',
        zipcode: '',
        desiredDate: ''
      });
    } catch (e: any) {
      setError(e.message || 'No se pudo publicar la solicitud.');
    }
  }

  return (
    <main className="wrap">
      <div className="card">
        <h1>Publicar trabajo</h1>

        <p>
          Describe el servicio que necesitas y los especialistas podrán
          encontrar tu solicitud.
        </p>

        <form onSubmit={submit}>
          <div
            role="note"
            style={{
              padding: '12px',
              marginBottom: '16px',
              border: '1px solid #d6a83c',
              borderRadius: '6px',
              backgroundColor: '#fff8e6',
              color: '#453500'
            }}
          >
            <strong>Protege tu privacidad.</strong>{' '}
            El título y la descripción de tu solicitud serán
            visibles para los especialistas. No escribas tu
            domicilio exacto, número de casa o departamento,
            teléfono ni otros datos personales. La dirección
            del servicio se solicitará por separado y solamente
            se compartirá con el especialista contratado cuando
            se cumplan las condiciones de seguridad y pago.
          </div>

          <label>Título</label>
          <input
            value={form.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="Ejemplo: Reparar fuga en cocina"
            required
          />

          <label>Descripción</label>
          <textarea
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
            rows={5}
            placeholder="Describe el trabajo que necesitas."
            required
          />

          <label>Categoría</label>
          <select
            value={form.categoryId}
            onChange={(e) => updateField('categoryId', e.target.value)}
            required
          >
            <option value="">Selecciona una categoría</option>

            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

<h2>Ubicación del trabajo</h2>

          <label>Ciudad</label>
          <input
            value={form.city}
            onChange={(e) => updateField('city', e.target.value)}
            placeholder="Chicago"
            required
          />

          <label>Estado</label>
          <input
            value={form.state}
            onChange={(e) => updateField('state', e.target.value)}
            placeholder="Illinois"
            required
          />

          <label>Código postal</label>
          <input
            value={form.zipcode}
            onChange={(e) => updateField('zipcode', e.target.value)}
            placeholder="60601"
          />

          <label>Fecha deseada</label>
          <input
            type="date"
            value={form.desiredDate}
            onChange={(e) => updateField('desiredDate', e.target.value)}
          />

          <br />

          <button type="submit">
            Publicar solicitud
          </button>

          {message && (
            <p style={{ color: 'green' }}>{message}</p>
          )}

          {error && (
            <p style={{ color: 'red' }}>{error}</p>
          )}
        </form>

        <p>
          <a href="/dashboard">Volver al panel</a>
        </p>
      </div>
    </main>
  );
}
