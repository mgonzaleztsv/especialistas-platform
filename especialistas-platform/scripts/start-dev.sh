#!/usr/bin/env bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ss -ltn | grep -q ':3001 '; then
  echo "Backend 3001 ya está activo."
else
  echo "Iniciando backend 3001..."
  nohup bash -lc "cd \"$ROOT\" && npm --prefix apps/api run dev" \
    > /tmp/especialistas-api.log 2>&1 &
fi

if ss -ltn | grep -q ':3000 '; then
  echo "Frontend 3000 ya está activo."
else
  echo "Iniciando frontend 3000..."
  nohup bash -lc "cd \"$ROOT\" && npm --prefix apps/web run dev" \
    > /tmp/especialistas-web.log 2>&1 &
fi

sleep 8

echo
echo "Estado:"
ss -ltnp | grep -E ':3000|:3001' || true
