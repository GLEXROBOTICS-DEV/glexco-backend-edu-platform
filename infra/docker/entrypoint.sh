#!/bin/sh
# Punto de entrada comun de las imagenes de GLEXCO.
#
# Existe porque el portal y los servicios arrancan distinto -Next tiene su propio
# lanzador- y meter esa diferencia en el CMD del Dockerfile con expansiones de
# shell anidadas produce una linea que nadie puede leer ni depurar.
#
# `exec` es importante: sustituye el shell por el proceso de Node en lugar de
# lanzarlo como hijo. Sin eso, Node no recibe el SIGTERM que envia el
# orquestador al desplegar, el apagado ordenado no se ejecuta y las peticiones en
# vuelo se cortan en seco en cada despliegue.
set -e

if [ "$GLEXCO_SERVICE" = "web" ]; then
  exec node node_modules/next/dist/bin/next start --port "${PORT:-3010}"
fi

exec node dist/main.js
