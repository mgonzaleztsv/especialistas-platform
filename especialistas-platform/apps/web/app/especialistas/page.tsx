'use client';

import { useEffect, useState } from 'react';
import { API } from '../../lib/api';

export default function Specialists() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  async function loadSpecialists() {
    try {
      setError('');

      const params = new URLSearchParams();

      if (category) params.set('category', category);
      if (city.trim()) params.set('city', city.trim());

      const url =
        API + '/specialists' + (params.toString() ? `?${params}` : '');

      const r = await fetch(url);

      if (!r.ok) {
        throw new Error('No se pudo cargar el directorio.');
      }

      const data = await r.json();
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    fetch(API + '/categories')
      .then((r) => r.json())
      .then(setCategories)
      .catch(() => setCategories([]));

    loadSpecialists();
  }, []);

  function clearFilters() {
    setCategory('');
    setCity('');

    fetch(API + '/specialists')
      .then((r) => r.json())
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  return (
    <main className="wrap">
      <h1>Especialistas</h1>
      <p>Encuentra profesionales disponibles para realizar tu trabajo.</p>

      <div className="card">
        <h2>Buscar especialistas</h2>

        <label>Especialidad</label>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Todas las especialidades</option>

          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>

        <label>Ciudad</label>

        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Ejemplo: Chicago"
        />

        <button onClick={loadSpecialists}>
          Buscar
        </button>

        <button
          type="button"
          onClick={clearFilters}
          style={{ marginTop: '8px' }}
        >
          Limpiar filtros
        </button>
      </div>

      {error && <p>{error}</p>}

      <div className="grid">
        {items.map((s) => {
          const location = s.user?.locations?.[0];

          return (
            <div className="card" key={s.id}>
              <h3>{s.user?.name}</h3>

              <p>{s.description || 'Perfil nuevo'}</p>

              <p>
                <strong>Experiencia:</strong> {s.experienceYears} años
              </p>

              {s.hourlyRate && (
                <p>
                  <strong>Tarifa:</strong>{' '}
                  ${Number(s.hourlyRate).toFixed(2)} / hora
                </p>
              )}

              {location && (
                <p>
                  <strong>Ubicación:</strong>{' '}
                  {[location.city, location.state]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}

              <p>
                <strong>Disponibilidad:</strong>{' '}
                {s.availabilityStatus === 'DISPONIBLE'
                  ? 'Disponible'
                  : s.availabilityStatus}
              </p>

              {s.verificationStatus === 'VERIFIED' && (
                <p>
                  <strong>✓ Verificado</strong>
                </p>
              )}

              <p>
                <strong>Confianza:</strong> {s.trustScore}%
              </p>

              <p>
                <strong>Calificación:</strong>{' '}
                {s.reviews?.length
                  ? `${(
                      s.reviews.reduce(
                        (sum: number, review: any) => sum + review.rating,
                        0
                      ) / s.reviews.length
                    ).toFixed(1)} / 5 (${s.reviews.length})`
                  : 'Sin calificaciones'}
              </p>

              <p>
                {s.categories?.length
                  ? s.categories
                      .map((x: any) => x.category.name)
                      .join(', ')
                  : 'Sin categorías todavía'}
              </p>

              <p>
                <a href={`/especialistas/${s.id}`}>
                  Ver perfil
                </a>
              </p>
            </div>
          );
        })}

        {!items.length && !error && (
          <div className="card">
            No encontramos especialistas con esos filtros.
          </div>
        )}
      </div>
    </main>
  );
}
