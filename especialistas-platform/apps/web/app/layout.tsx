'use client';

import './globals.css';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isSpecialist, setIsSpecialist] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const isLoggedIn = Boolean(token);

    setLoggedIn(isLoggedIn);

    if (!isLoggedIn) return;

    api('/users/me')
      .then((user) => {
        setUserRole(user.role);
        setIsClient(user.client?.status === 'ACTIVE');
        setIsSpecialist(Boolean(user.specialist));
      })
      .catch(() => {});

    const loadUnreadTotal = () => {
      api('/job-requests/messages/unread-counts')
        .then((counts) => {
          const total = Object.values(counts || {}).reduce(
            (sum: number, value: any) => sum + Number(value || 0),
            0
          );
          setUnreadTotal(total);
        })
        .catch(() => {});
    };

    loadUnreadTotal();

    const interval = window.setInterval(loadUnreadTotal, 10000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <html lang="es">
      <body>
        <header
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #ddd',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <strong>
            <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
              Especialistas
            </a>
          </strong>

          <nav>
            {loggedIn ? (
              <>
                {isClient && (
                  <>
                    <a href="/especialistas">Buscar</a>
                    {' · '}
                  </>
                )}

                <a href="/dashboard">Mi panel</a>

                {' · '}

                <a href="/mensajes">
                  {unreadTotal > 0
                    ? `Mensajes (${unreadTotal})`
                    : 'Mensajes'}
                </a>

                {isSpecialist && (
                  <>
                    {' · '}
                    <a href="/perfil-especialista">Editar perfil</a>
                  </>
                )}
              </>
            ) : (
              <>
                <a href="/login">Entrar</a>
                {' · '}
                <a href="/register">Crear cuenta</a>
              </>
            )}
          </nav>
        </header>

        {children}
      </body>
    </html>
  );
}
