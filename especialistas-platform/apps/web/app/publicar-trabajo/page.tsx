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
    budgetMin: '',
    budgetMax: '',
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
          budgetMin: form.budgetMin ? Number(form.budgetMin) : null,
          budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
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
        budgetMin: '',
        budgetMax: '',
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

          <label>Presupuesto mínimo (USD)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.budgetMin}
            onChange={(e) => updateField('budgetMin', e.target.value)}
          />

          <label>Presupuesto máximo (USD)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.budgetMax}
            onChange={(e) => updateField('budgetMax', e.target.value)}
          />

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
