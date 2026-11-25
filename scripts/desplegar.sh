#!/usr/bin/env bash
# Despliega lo que ya está bajado en /opt/obras: corre las pruebas, reinicia el servicio y comprueba que responda.
# No borra datos: la base y las fotos viven aparte, en /var/lib/obras.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Pruebas"
node --disable-warning=ExperimentalWarning --test pruebas/*.test.js > /tmp/obras-pruebas.log 2>&1 || { tail -n 30 /tmp/obras-pruebas.log; echo "== Las pruebas fallaron: no se reinicia."; exit 1; }

echo "== Reinicio"
systemctl restart obras

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${PUERTO:-3400}/salud" > /dev/null 2>&1; then
    echo "== Listo: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done
echo "== El servicio no respondió después de reiniciar."
journalctl -u obras -n 20 --no-pager || true
exit 1
