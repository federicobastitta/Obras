#!/usr/bin/env bash
# Instala o actualiza Obras en el servidor. Se puede correr todas las veces que haga falta.
# Lo corre Alldoo como root, parado en la carpeta del repo (/opt/obras), después de bajar el código.
#
# Variables (se cargan en el proyecto de Alldoo):
#   DOMINIO      dirección web de la app, por ejemplo obras.midominio.com. Sin esto queda solo en el servidor, sin https.
#   PROPIETARIO  nombre con el que se crea el primer acceso (solo la primera vez).
#
# No toca lo demás que corre en la máquina: usa su propio Node en /opt/obras-node, su propio usuario,
# y suma un sitio de nginx aparte. La base y las fotos viven en /var/lib/obras y nunca se borran.
set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Hay que correrlo como root."; exit 1; }
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
[ "$RAIZ" = "/opt/obras" ] || { echo "El código tiene que estar en /opt/obras (está en $RAIZ)."; exit 1; }
cd "$RAIZ"
export DEBIAN_FRONTEND=noninteractive
DOMINIO="${DOMINIO:-}"
NODE=/opt/obras-node/bin/node
PUERTO=3400

echo "== Node propio de Obras"
node_sirve() { [ -x "$NODE" ] && "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_sirve; then
  case "$(uname -m)" in x86_64) ARQ=x64 ;; aarch64) ARQ=arm64 ;; *) echo "Arquitectura no prevista: $(uname -m)"; exit 1 ;; esac
  TMP="$(mktemp -d)"
  curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$TMP/sumas.txt"
  ARCHIVO="$(grep -o "node-v22[0-9.]*-linux-$ARQ\.tar\.xz" "$TMP/sumas.txt" | head -n 1)"
  [ -n "$ARCHIVO" ] || { echo "No se encontró el Node 22 para bajar."; exit 1; }
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$ARCHIVO" -o "$TMP/$ARCHIVO"
  (cd "$TMP" && grep " $ARCHIVO\$" sumas.txt | sha256sum -c - > /dev/null) || { echo "La descarga de Node no coincide con su suma de control."; exit 1; }
  mkdir -p /opt/obras-node.nuevo
  tar -xJf "$TMP/$ARCHIVO" -C /opt/obras-node.nuevo --strip-components=1 --no-same-owner
  if [ -d /opt/obras-node ]; then mv /opt/obras-node "/opt/obras-node.viejo.$(date +%s)"; fi
  mv /opt/obras-node.nuevo /opt/obras-node
  node_sirve || { echo "El Node instalado no sirve."; exit 1; }
fi
chown -R root:root /opt/obras-node
echo "   $("$NODE" --version)"

echo "== Pruebas"
"$NODE" --disable-warning=ExperimentalWarning --test pruebas/*.test.js > /tmp/obras-pruebas.log 2>&1 \
  || { tail -n 30 /tmp/obras-pruebas.log; echo "== Las pruebas fallaron: no se instala nada."; exit 1; }

echo "== Usuario, carpetas y configuración"
id obras > /dev/null 2>&1 || useradd --system --home-dir /var/lib/obras --shell /usr/sbin/nologin obras
install -d -o obras -g obras -m 750 /var/lib/obras
install -d -m 755 /etc/obras
{
  [ -n "$DOMINIO" ] && echo "URL_BASE=https://$DOMINIO"
  [ -n "${PROPIETARIO:-}" ] && echo "PROPIETARIO=$PROPIETARIO"
  true
} > /etc/obras/obras.env

# Reinicio de datos, una sola vez por cada identificador de datos-iniciales/reinicio.txt (pedido expreso del dueño).
# No borra: aparta la carpeta de datos entera a un respaldo con fecha y la app arranca de cero.
if [ -f datos-iniciales/reinicio.txt ]; then
  REINICIO="$(tr -dc 'A-Za-z0-9-' < datos-iniciales/reinicio.txt | head -c 60)"
  if [ -n "$REINICIO" ] && ! grep -qsx "$REINICIO" /var/lib/obras-reinicios.txt; then
    echo "== Reinicio de datos ($REINICIO)"
    systemctl stop obras 2> /dev/null || true
    RESPALDO="/var/lib/obras-respaldo-$(date +%Y%m%d-%H%M%S)"
    mv /var/lib/obras "$RESPALDO"
    chmod 700 "$RESPALDO"
    install -d -o obras -g obras -m 750 /var/lib/obras
    echo "$REINICIO" >> /var/lib/obras-reinicios.txt
    echo "   Los datos anteriores quedaron apartados en $RESPALDO"
  fi
fi

echo "== Servicio"
install -m 644 infra/obras.service /etc/systemd/system/obras.service
systemctl daemon-reload
systemctl enable obras > /dev/null 2>&1
systemctl restart obras
LISTO=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PUERTO/salud" > /dev/null 2>&1; then LISTO=1; break; fi
  sleep 1
done
[ "$LISTO" = "1" ] || { echo "== El servicio no respondió."; journalctl -u obras -n 20 --no-pager || true; exit 1; }

# Carga de tareas pedida por el dueño (datos-iniciales/carga.json): una sola vez por identificador. Si falla, la instalación sigue.
if [ -f datos-iniciales/carga.json ]; then
  echo "== Carga de tareas"
  (
    set -a; . /etc/obras/obras.env; set +a
    runuser -u obras -- env URL_BASE="${URL_BASE:-}" PROPIETARIO="${PROPIETARIO:-}" DIR_DATOS=/var/lib/obras \
      "$NODE" --disable-warning=ExperimentalWarning servidor/cargar-cli.js
  ) || echo "== AVISO: no se pudo hacer la carga de tareas."
fi

# Alta de obras pedida por el dueño (datos-iniciales/altas.json): una sola vez por identificador. Si falla, la instalación sigue.
if [ -f datos-iniciales/altas.json ]; then
  echo "== Alta de obras"
  (
    set -a; . /etc/obras/obras.env; set +a
    runuser -u obras -- env URL_BASE="${URL_BASE:-}" DIR_DATOS=/var/lib/obras \
      "$NODE" --disable-warning=ExperimentalWarning servidor/altas-cli.js
  ) || echo "== AVISO: no se pudo hacer el alta de obras."
fi

# Equipo que hace las tareas de un propietario (datos-iniciales/equipo.json): una sola vez por identificador. Si falla, la instalación sigue.
if [ -f datos-iniciales/equipo.json ]; then
  echo "== Alta del equipo"
  (
    set -a; . /etc/obras/obras.env; set +a
    runuser -u obras -- env URL_BASE="${URL_BASE:-}" DIR_DATOS=/var/lib/obras \
      "$NODE" --disable-warning=ExperimentalWarning servidor/equipo-cli.js
  ) || echo "== AVISO: no se pudo hacer el alta del equipo."
fi

# Demostración: si el repo trae datos-iniciales/demo.json, deja cargadas las obras de ejemplo con ese arquitecto.
# Corre como el usuario de la app, para que la base y las fotos queden a su nombre. Si falla, la instalación sigue.
if [ -f datos-iniciales/demo.json ]; then
  echo "== Demostración"
  (
    set -a; . /etc/obras/obras.env; set +a
    runuser -u obras -- env URL_BASE="${URL_BASE:-}" PROPIETARIO="${PROPIETARIO:-}" DIR_DATOS=/var/lib/obras \
      "$NODE" --disable-warning=ExperimentalWarning servidor/demo-cli.js
  ) || echo "== AVISO: no se pudo preparar la demostración."
fi

if [ -z "$DOMINIO" ]; then
  echo "== Sin DOMINIO: la app quedó andando solo dentro del servidor (puerto $PUERTO), sin dirección web."
  echo "== Listo: $(git rev-parse --short HEAD)"
  exit 0
fi

echo "== nginx para $DOMINIO"
SITIO=/etc/nginx/sites-available/obras
if ! grep -qs "managed by Certbot" "$SITIO"; then
  cat > "$SITIO" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:$PUERTO;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
fi
# El sitio ya instalado (con los cambios de certbot) también tiene que aceptar archivos de hasta 20 MB.
sed -i -E 's/client_max_body_size [0-9]+m;/client_max_body_size 25m;/' "$SITIO"
ln -sfn "$SITIO" /etc/nginx/sites-enabled/obras
nginx -t
systemctl reload nginx

echo "== Certificado https"
if [ ! -d "/etc/letsencrypt/live/$DOMINIO" ]; then
  # certbot por snap si se puede (no depende del estado de apt en la máquina); si no, por apt.
  CERTBOT=""
  if [ -x /snap/bin/certbot ]; then CERTBOT=/snap/bin/certbot; elif command -v certbot > /dev/null 2>&1; then CERTBOT="$(command -v certbot)"; fi
  if [ -z "$CERTBOT" ] && command -v snap > /dev/null 2>&1; then
    snap install --classic certbot > /tmp/obras-certbot.log 2>&1 && CERTBOT=/snap/bin/certbot || tail -n 5 /tmp/obras-certbot.log
  fi
  if [ -z "$CERTBOT" ]; then
    { apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx; } > /tmp/obras-certbot.log 2>&1 \
      && CERTBOT="$(command -v certbot)" || tail -n 5 /tmp/obras-certbot.log
  fi
  if [ -z "$CERTBOT" ]; then
    echo "== AVISO: no se pudo instalar certbot. La app quedó andando por http, sin https."
    echo "== Listo SIN https: $(git rev-parse --short HEAD)"
    exit 0
  fi
  if ! "$CERTBOT" --nginx -d "$DOMINIO" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    echo "== AVISO: no se pudo sacar el certificado. Revisar que $DOMINIO apunte a este servidor y que los puertos 80 y 443 estén abiertos; después volver a desplegar."
    echo "== Listo SIN https: $(git rev-parse --short HEAD)"
    exit 0
  fi
fi
curl -fsS "https://$DOMINIO/salud" > /dev/null 2>&1 && echo "   https://$DOMINIO responde" || echo "== AVISO: https://$DOMINIO todavía no responde desde el propio servidor."
echo "== Los links de acceso de la primera vez están en /var/lib/obras/primer-acceso.txt"
echo "== Listo: $(git rev-parse --short HEAD)"
