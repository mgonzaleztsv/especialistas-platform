'use client';

import { useEffect, useState } from 'react';
import { API, api } from '../../lib/api';

export default function Specialists() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  const [accessChecked, setAccessChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [canSearch, setCanSearch] = useState(false);
  const [hasClientProfile, setHasClientProfile] = useState(false);

  async function loadSpecialists() {
    try {
      setError('');

      const params = new URLSearchParams();

      if (category) params.set('category', category);
      if (city.trim()) params.set('city', city.trim());

      const path =
        '/specialists' + (params.toString() ? `?${params}` : '');

      const data = await api(path);
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (!token) {
      setAccessChecked(true);
      return;
    }

    setLoggedIn(true);

    api('/users/me')
      .then((user) => {
        const hasClientAccess = user.client?.status === 'ACTIVE';
        setHasClientProfile(Boolean(user.client));
        setCanSearch(hasClientAccess);

        if (hasClientAccess) {
          fetch(API + '/categories')
            .then((r) => r.json())
            .then(setCategories)
            .catch(() => setCategories([]));

          loadSpecialists();
        }
      })
      .catch(() => {
        setLoggedIn(false);
        setCanSearch(false);
      })
      .finally(() => setAccessChecked(true));
  }, []);

  async function enableClient() {
    setError('');

    try {
      await api('/users/me/enable-client', {
        method: 'POST'
      });

      window.location.reload();
    } catch (e: any) {
      setError(e.message || 'No se pudo habilitar la función de contratación.');
    }
  }

  async function clearFilters() {
    setCategory('');
    setCity('');
    setError('');

    try {
      const data = await api('/specialists');
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!accessChecked) {
    return (
      <main className="wrap">
        <p>Comprobando acceso...</p>
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main className="wrap">
        <h1>Buscar especialistas</h1>
        <div className="card">
          <p>
            Para consultar el directorio y contratar especialistas necesitas
            iniciar sesión con una cuenta que tenga capacidad de contratación.
          </p>
          <p>
            <a href="/login">Entrar</a>
            {' · '}
            <a href="/register">Crear cuenta</a>
          </p>
        </div>
      </main>
    );
  }

  if (!canSearch) {
    return (
      <main className="wrap">
        <h1>Acceso al directorio</h1>
        <div className="card">
          {hasClientProfile ? (
            <>
              <p>
                Tu perfil de contratación todavía no está activo.
              </p>
              <p>
                Para consultar el directorio y contratar especialistas necesitas
                completar el proceso de verificación de tu cuenta.
              </p>
              <p>
                <a href="/dashboard">Completar perfil de contratación</a>
              </p>
            </>
          ) : (
            <>
              <p>
                Tu cuenta está configurada para ofrecer servicios.
              </p>
              <p>
                Si también deseas contratar especialistas, puedes iniciar tu
                registro como cliente.
              </p>
              <p>
                <button type="button" onClick={enableClient}>
                  Quiero contratar especialistas
                </button>
              </p>
              {error && <p>{error}</p>}
            </>
          )}

          <p>
            <a href="/dashboard">Volver a mi panel</a>
          </p>
        </div>
      </main>
    );
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
                {s.availabilityStatus === 'AVAILABLE'
                  ? 'Disponible'
                  : s.availabilityStatus}
              </p>

              {s.verificationStatus === 'VERIFIED' && (
                <p>
                  <strong>✓ Verificado</strong>
                </p>
              )}


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
